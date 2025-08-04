use chrono::Local;
use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

pub struct Logger {
    log_file_path: PathBuf,
}

impl Logger {
    pub fn new<P: AsRef<Path>>(directory_path: P) -> io::Result<Self> {
        let dir_path = directory_path.as_ref();
        std::fs::create_dir_all(dir_path)?;
        let log_file_path = dir_path.join("app.log");
        if !log_file_path.exists() {
            File::create(&log_file_path)?;
        }

        Ok(Logger { log_file_path })
    }

    fn log(&self, message: &str) -> io::Result<()> {
        let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S");
        let log_entry = format!("[{}] {}\n", timestamp, message);

        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.log_file_path)?;

        file.write_all(log_entry.as_bytes())?;
        file.flush()?;

        Ok(())
    }

    fn log_or_console(&self, message: &str) {
        if let Err(e) = self.log(message) {
            eprintln!("Failed to log to file: {}", e);
            eprintln!("{}", message);
        }
    }

    pub fn info(&self, message: &str) {
        self.log_or_console(&format!("INFO: {}", message))
    }

    pub fn warn(&self, message: &str) {
        self.log_or_console(&format!("WARN: {}", message))
    }

    pub fn error(&self, message: &str) {
        self.log_or_console(&format!("ERROR: {}", message))
    }

    pub fn debug(&self, message: &str) {
        self.log_or_console(&format!("DEBUG: {}", message))
    }
    pub fn log_file_path(&self) -> &Path {
        &self.log_file_path
    }

    pub fn get_log_file_path(&self) -> &PathBuf {
        &self.log_file_path
    }
}