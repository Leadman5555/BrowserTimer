use crate::tracker::SerializedSession;
use serde::ser::Error;
use serde_json;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum PersistenceError {
    #[error("IO error: {0}")]
    Io(#[from] io::Error),
    #[error("JSON serialization error: {0}")]
    JsonSerialization(#[from] serde_json::Error),
    #[error("Session not found: {0}")]
    SessionNotFound(String),
}

type Result<T> = std::result::Result<T, PersistenceError>;

pub struct SessionLoader {
    save_directory: PathBuf,
}

impl SessionLoader {
    pub fn new<P: AsRef<Path>>(save_directory: P) -> Result<Self> {
        let save_dir = save_directory.as_ref();

        if !save_dir.exists() {
            fs::create_dir_all(save_dir)?;
        }

        Ok(Self {
            save_directory: save_dir.to_path_buf(),
        })
    }
    pub fn with_default_directory() -> Result<Self> {
        let default_dir = Self::default_save_directory()?;
        Self::new(default_dir)
    }
    fn default_save_directory() -> Result<PathBuf> {
        let mut path = dirs::data_dir()
            .or_else(|| dirs::home_dir())
            .ok_or_else(|| {
                PersistenceError::Io(io::Error::new(
                    io::ErrorKind::NotFound,
                    "Could not determine default save directory",
                ))
            })?;

        path.push("browser_timer");
        path.push("sessions");
        Ok(path)
    }

    fn session_file_path(&self, session_name: &str) -> PathBuf {
        let mut path = self.save_directory.clone();
        path.push(format!("{}.json", session_name));
        path
    }

    pub fn save_session(&self, session: &SerializedSession) -> Result<()> {
        let file_path = self.session_file_path(&session.session_name);
        let json_data = serde_json::to_string(session)?;
        let temp_file_path = file_path.with_extension("json.tmp");
        {
            let mut file = fs::File::create(&temp_file_path)?;
            file.write_all(json_data.as_bytes())?;
            file.sync_all()?;
        }
        fs::rename(temp_file_path, file_path)?;
        Ok(())
    }

    pub fn load_session(&self, session_name: &str) -> Result<SerializedSession> {
        let file_path = self.session_file_path(session_name);
        if !file_path.exists() {
            return Err(PersistenceError::SessionNotFound(session_name.to_string()));
        }
        let session: SerializedSession = serde_json::from_str(&fs::read_to_string(&file_path)?)?;
        if session.session_name != session_name {
            return Err(PersistenceError::JsonSerialization(
                serde_json::Error::custom(format!(
                    "Session name mismatch: expected '{}', found '{}'. If loading from a backup, rename the file to match the session name.",
                    session_name, session.session_name
                )),
            ));
        }
        Ok(session)
    }
    pub fn session_exists(&self, session_name: &str) -> bool {
        self.session_file_path(session_name).exists()
    }

    pub fn list_sessions(&self) -> Result<Vec<String>> {
        if !self.save_directory.exists() {
            return Err(PersistenceError::Io(io::Error::new(
                io::ErrorKind::NotFound,
                "Save directory does not exist",
            )));
        }

        let entries = fs::read_dir(&self.save_directory)?;
        let mut sessions = Vec::with_capacity(entries.size_hint().0);
        for entry in entries {
            let entry = entry?;
            let path = entry.path();

            if path.is_file() && path.extension().map_or(false, |ext| ext == "json") {
                if let Some(file_stem) = path.file_stem() {
                    if let Some(session_name) = file_stem.to_str() {
                        sessions.push(session_name.to_string());
                    }
                }
            }
        }

        sessions.sort_unstable();
        Ok(sessions)
    }

    pub fn delete_session(&self, session_name: &str) -> Result<()> {
        let file_path = self.session_file_path(session_name);
        if !file_path.exists() {
            return Err(PersistenceError::SessionNotFound(session_name.to_string()));
        }
        fs::remove_file(file_path)?;
        Ok(())
    }

    pub fn get_save_directory(&self) -> &Path {
        &self.save_directory
    }

    pub fn backup_session(&self, session_name: &str) -> Result<PathBuf> {
        let file_path = self.session_file_path(session_name);
        if !file_path.exists() {
            return Err(PersistenceError::SessionNotFound(session_name.to_string()));
        }
        let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
        let backup_name = format!("{}_{}.json", session_name, timestamp);
        let mut backup_path = self.save_directory.join("backups");
        if !backup_path.exists() {
            fs::create_dir(&backup_path)?;
        }
        backup_path.push(backup_name);
        fs::copy(&file_path, &backup_path)?;
        Ok(backup_path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tracker::{SerializedUrlNode, TabInstance};
    use std::collections::HashMap;
    use tempfile::TempDir;

    fn create_test_session() -> SerializedSession {
        let mut data = HashMap::new();
        data.insert(
            "example.com".to_string(),
            SerializedUrlNode {
                sub_part: "example.com".to_string(),
                aggregate_time: 5000,
                instances: Some(vec![TabInstance::new(1, 1234)]),
                children: HashMap::new(),
            },
        );

        SerializedSession {
            session_name: "test_session".to_string(),
            data,
        }
    }

    #[test]
    fn test_new_creates_directory() {
        let temp_dir = TempDir::new().unwrap();
        let save_path = temp_dir.path().join("sessions");

        let persistence = SessionLoader::new(&save_path).unwrap();

        assert!(save_path.exists());
        assert_eq!(persistence.get_save_directory(), save_path);
    }

    #[test]
    fn test_save_and_load_session() {
        let temp_dir = TempDir::new().unwrap();
        let persistence = SessionLoader::new(temp_dir.path()).unwrap();

        let session = create_test_session();
        persistence.save_session(&session).unwrap();
        let loaded_session = persistence.load_session("test_session").unwrap();

        assert_eq!(loaded_session.session_name, session.session_name);
        assert_eq!(loaded_session.data.len(), session.data.len());
        assert!(loaded_session.data.contains_key("example.com"));
    }

    #[test]
    fn test_session_exists() {
        let temp_dir = TempDir::new().unwrap();
        let persistence = SessionLoader::new(temp_dir.path()).unwrap();

        let session = create_test_session();

        assert!(!persistence.session_exists("test_session"));

        persistence.save_session(&session).unwrap();

        assert!(persistence.session_exists("test_session"));
    }

    #[test]
    fn test_load_nonexistent_session() {
        let temp_dir = TempDir::new().unwrap();
        let persistence = SessionLoader::new(temp_dir.path()).unwrap();

        let result = persistence.load_session("nonexistent");
        assert!(matches!(result, Err(PersistenceError::SessionNotFound(_))));
    }

    #[test]
    fn test_list_sessions() {
        let temp_dir = TempDir::new().unwrap();
        let persistence = SessionLoader::new(temp_dir.path()).unwrap();

        let sessions = persistence.list_sessions().unwrap();
        assert!(sessions.is_empty());

        let mut session1 = create_test_session();
        session1.session_name = "session1".to_string();
        persistence.save_session(&session1).unwrap();

        let mut session2 = create_test_session();
        session2.session_name = "session2".to_string();
        persistence.save_session(&session2).unwrap();

        let sessions = persistence.list_sessions().unwrap();
        assert_eq!(sessions.len(), 2);
        assert!(sessions.contains(&"session1".to_string()));
        assert!(sessions.contains(&"session2".to_string()));
    }

    #[test]
    fn test_delete_session() {
        let temp_dir = TempDir::new().unwrap();
        let persistence = SessionLoader::new(temp_dir.path()).unwrap();

        let session = create_test_session();
        persistence.save_session(&session).unwrap();

        assert!(persistence.session_exists("test_session"));

        persistence.delete_session("test_session").unwrap();

        assert!(!persistence.session_exists("test_session"));
    }

    #[test]
    fn test_backup_session() {
        let temp_dir = TempDir::new().unwrap();
        let persistence = SessionLoader::new(temp_dir.path()).unwrap();

        let session = create_test_session();
        persistence.save_session(&session).unwrap();

        let backup_path = persistence.backup_session("test_session").unwrap();

        assert!(backup_path.exists());
        assert!(
            backup_path
                .file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .starts_with("test_session_")
        );
    }
}
