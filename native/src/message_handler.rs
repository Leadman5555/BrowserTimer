use crate::session_loader::{PersistenceError, SessionLoader};
use crate::tracker::{Tracker, TrackerError};
use serde::{Deserialize, Serialize};
use std::io::{self, Read, Write};
use thiserror::Error;

#[derive(Debug, Deserialize)]
pub(crate) struct TabActionData {
    url: String,
    tab_id: u32,
}
#[derive(Debug, Error)]
pub enum HandlerError {
    #[error("Native messaging error: {0}")]
    NativeMessaging(#[from] NativeMessagingError),
    #[error("Tracker error: {0}")]
    Tracker(#[from] TrackerError),
    #[error("Persistence error: {0}")]
    Persistence(#[from] PersistenceError),
}

#[derive(Error, Debug)]
pub enum NativeMessagingError {
    #[error("IO error: {0}")]
    Io(#[from] io::Error),
    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Invalid message length: {0}")]
    InvalidLength(u32),
    #[error("Message too large: {0} bytes")]
    MessageTooLarge(u32),
    #[error("Invalid session name: {0}")]
    InvalidSessionName(String),
}

const TRACKER_NOT_STARTED: &str = "Tracker not started";
const TRACKER_ALREADY_STARTED: &str = "Tracker already started";

#[derive(Debug, Deserialize)]
pub(crate) enum Action {
    Start,
    Stop,
    GetData,
    GetActive,
    Ping,
    TabFocused,
    TabUnfocused,
    TabClosed,
    GetSessions,
    DeleteSession,
}

#[derive(Debug)]
enum TabOperation {
    Focus,
    Unfocus,
    Close,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "action", content = "data")]
pub(crate) enum IncomingMessage {
    TabFocused(TabActionData),
    TabUnfocused(TabActionData),
    TabClosed(TabActionData),
    Start { session_name: String },
    Stop,
    GetData,
    GetActive,
    Ping,
    GetSessions,
    DeleteSession { session_name: String },
}

#[derive(Debug, Serialize)]
pub(crate) struct OutgoingMessage {
    pub success: bool,
    pub data: Option<serde_json::Value>,
    pub error: Option<String>,
}

impl OutgoingMessage {
    pub fn success(data: Option<serde_json::Value>) -> Self {
        Self {
            success: true,
            data,
            error: None,
        }
    }

    pub fn error(error: String) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(error),
        }
    }
}

pub(crate) struct NativeMessagingHost {
    stdin: io::Stdin,
    stdout: io::Stdout,
    tracker: Option<Tracker>,
    session_loader: SessionLoader,
    read_buffer: Vec<u8>,
}

impl NativeMessagingHost {
    pub fn new(session_loader: SessionLoader) -> Self {
        Self {
            stdin: io::stdin(),
            stdout: io::stdout(),
            tracker: None,
            session_loader,
            read_buffer: Vec::new(),
        }
    }

    const MAX_MESSAGE_SIZE: u32 = 1024 * 1024;
    pub fn read_message(&mut self) -> Result<IncomingMessage, NativeMessagingError> {
        // Header
        let mut length_bytes = [0u8; 4];
        self.stdin.read_exact(&mut length_bytes)?;
        let length = u32::from_le_bytes(length_bytes);

        if length > NativeMessagingHost::MAX_MESSAGE_SIZE {
            return Err(NativeMessagingError::MessageTooLarge(length));
        }
        if length == 0 {
            return Err(NativeMessagingError::InvalidLength(length));
        }
        self.read_buffer.clear();
        self.read_buffer.resize(length as usize, 0);

        self.stdin.read_exact(&mut self.read_buffer)?;
        let message: IncomingMessage = serde_json::from_slice(&self.read_buffer)?;
        Ok(message)
    }

    pub fn send_message(&mut self, message: &OutgoingMessage) -> Result<(), NativeMessagingError> {
        let json = serde_json::to_string(message)?;
        let json_bytes = json.as_bytes();
        let length = json_bytes.len() as u32;
        self.stdout.write_all(&length.to_le_bytes())?;
        self.stdout.write_all(json_bytes)?;
        self.stdout.flush()?;
        Ok(())
    }
    pub fn run(&mut self) {
        loop {
            match self.read_message() {
                Ok(message) => {
                    let response = self.handle_message(message);
                    if let Err(e) = self.send_message(&response) {
                        eprintln!("Failed to send response: {}", e);
                        break;
                    }
                }
                Err(NativeMessagingError::Io(ref e))
                if e.kind() == io::ErrorKind::UnexpectedEof =>
                    {
                        if let Some(mut tracker) = self.tracker.take() {
                            if let Err(e) = self
                                .session_loader
                                .save_session(&tracker.serialize_session(false))
                            {
                                eprintln!("Failed to save session: {}", e);
                            }
                        }
                        eprintln!("Connection closed");
                        return;
                    }
                Err(e) => {
                    eprintln!("Error reading message: {}", e);
                    let _ = self.send_message(&OutgoingMessage::error(e.to_string()));
                    break;
                }
            }
        }
    }

    fn verify_session_name(session_name: &str) -> Result<(), NativeMessagingError> {
        if session_name.is_empty() {
            return Err(NativeMessagingError::InvalidSessionName(
                "Session name cannot be empty".to_string(),
            ));
        }
        if session_name.len() > 100 {
            return Err(NativeMessagingError::InvalidSessionName(
                "Session name is too long. Allowed length: 100 characters".to_string(),
            ));
        }
        let invalid_chars = ['/', '\\', ':', '*', '?', '"', '<', '>', '|', '\0'];
        if session_name.chars().any(|c| invalid_chars.contains(&c)) {
            return Err(NativeMessagingError::InvalidSessionName(
                "Session name contains invalid characters".to_string(),
            ));
        }
        Ok(())
    }

    fn handle_message(&mut self, message: IncomingMessage) -> OutgoingMessage {
        match message {
            IncomingMessage::TabFocused(data) => {
                self.handle_tab_operation(TabOperation::Focus, data)
            }
            IncomingMessage::TabUnfocused(data) => {
                self.handle_tab_operation(TabOperation::Unfocus, data)
            }
            IncomingMessage::TabClosed(data) => {
                self.handle_tab_operation(TabOperation::Close, data)
            }
            IncomingMessage::Start { session_name } => self.handle_start_action(&session_name),
            IncomingMessage::Stop => self.handle_stop_action(),
            IncomingMessage::GetActive => self.handle_get_active_action(),
            IncomingMessage::GetData => self.handle_get_data_action(),
            IncomingMessage::GetSessions => self.handle_session_listing(),
            IncomingMessage::DeleteSession { session_name } => {
                self.handle_session_deletion(&session_name)
            }
            IncomingMessage::Ping => OutgoingMessage::success(None),
        }
    }

    fn handle_tab_operation(
        &mut self,
        operation: TabOperation,
        data: TabActionData,
    ) -> OutgoingMessage {
        match self.tracker.as_mut() {
            Some(tracker) => {
                let result = match operation {
                    TabOperation::Focus => tracker.track_tab_focused(&data.url, data.tab_id),
                    TabOperation::Unfocus => tracker.track_tab_unfocused(&data.url, data.tab_id),
                    TabOperation::Close => tracker.track_tab_closed(&data.url, data.tab_id),
                };

                match result {
                    Ok(()) => OutgoingMessage::success(None),
                    Err(e) => OutgoingMessage::error(e.to_string()),
                }
            }
            None => OutgoingMessage::error(TRACKER_NOT_STARTED.to_string()),
        }
    }

    fn handle_session_deletion(&self, session_name: &str) -> OutgoingMessage {
        match self.session_loader.delete_session(session_name) {
            Ok(_) => OutgoingMessage::success(None),
            Err(e) => OutgoingMessage::error(e.to_string()),
        }
    }
    fn handle_session_listing(&self) -> OutgoingMessage {
        match self.session_loader.list_sessions() {
            Ok(sessions) => OutgoingMessage::success(Some(serde_json::json!(sessions))),
            Err(e) => OutgoingMessage::error(e.to_string()),
        }
    }
    fn with_tracker_mut<F, T>(&mut self, f: F) -> OutgoingMessage
    where
        F: FnOnce(&mut Tracker) -> Result<T, HandlerError>,
    {
        match self.tracker.as_mut() {
            Some(tracker) => match f(tracker) {
                Ok(_) => OutgoingMessage::success(None),
                Err(e) => OutgoingMessage::error(e.to_string()),
            },
            None => OutgoingMessage::error(TRACKER_NOT_STARTED.to_string()),
        }
    }

    fn create_or_load_tracker(&self, session_name: &str) -> Result<Tracker, PersistenceError> {
        if self.session_loader.session_exists(session_name) {
            let saved_data = self.session_loader.load_session(session_name)?;
            Ok(Tracker::from_serialized(
                saved_data.session_name,
                saved_data.data,
                false,
            ))
        } else {
            Ok(Tracker::new(session_name.to_string()))
        }
    }

    fn handle_stop_action(&mut self) -> OutgoingMessage {
        match self.tracker.as_mut() {
            Some(tracker) => {
                match self
                    .session_loader
                    .save_session(&tracker.serialize_session(false))
                {
                    Ok(_) => {
                        self.tracker = None;
                        OutgoingMessage::success(None)
                    }
                    Err(e) => OutgoingMessage::error(e.to_string()),
                }
            }
            None => OutgoingMessage::error(TRACKER_NOT_STARTED.to_string()),
        }
    }

    fn handle_get_active_action(&self) -> OutgoingMessage {
        match &self.tracker {
            Some(tracker) => OutgoingMessage::success(Some(
                serde_json::json!({"session_name": tracker.get_session_name()}),
            )),
            None => OutgoingMessage::success(None),
        }
    }

    fn handle_get_data_action(&mut self) -> OutgoingMessage {
        self.with_tracker_mut(|tracker| {
            let serialized = tracker.serialize_session(true);
            Ok(serialized)
        })
            .map_success(|data| serde_json::json!(data))
    }

    fn handle_start_action(&mut self, session_name: &str) -> OutgoingMessage {
        match self.try_start_action(session_name) {
            Ok(()) => OutgoingMessage::success(None),
            Err(e) => OutgoingMessage::error(e),
        }
    }

    fn try_start_action(&mut self, session_name: &str) -> Result<(), String> {
        if self.tracker.is_some() {
            return Err(TRACKER_ALREADY_STARTED.to_string());
        }
        Self::verify_session_name(session_name).map_err_to_string()?;
        self.tracker = Some(
            self.create_or_load_tracker(session_name)
                .map_err_to_string()?,
        );
        Ok(())
    }
}

trait OutgoingMessageExt {
    fn map_success<F, T>(self, f: F) -> Self
    where
        F: FnOnce(()) -> T,
        T: serde::Serialize;
}

impl OutgoingMessageExt for OutgoingMessage {
    fn map_success<F, T>(self, _: F) -> Self
    where
        F: FnOnce(()) -> T,
        T: serde::Serialize,
    {
        match self.data {
            Some(data) => Self::success(Some(data)),
            None => self,
        }
    }
}

trait ResultExt<T> {
    fn map_err_to_string(self) -> Result<T, String>;
}

impl<T, E: std::fmt::Display> ResultExt<T> for Result<T, E> {
    fn map_err_to_string(self) -> Result<T, String> {
        self.map_err(|e| e.to_string())
    }
}
