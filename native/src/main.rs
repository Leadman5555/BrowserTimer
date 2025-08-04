use crate::logger::Logger;

mod logger;
mod message_handler;
mod session_loader;
mod tracker;

fn main() {
    let logger = Logger::new("./logs").unwrap(); // no logger, no app
    logger.info("Native messaging host starting...");
    eprintln!("Logging to file {}", logger.log_file_path().display());
    let loader = session_loader::SessionLoader::with_default_directory();
    if let Ok(session_loader) = loader {
        logger.info(
            format!(
                "Current save directory: {}",
                session_loader.get_save_directory().display()
            )
            .as_str(),
        );
        let mut host = message_handler::NativeMessagingHost::new(session_loader);
        host.run();
    } else {
        logger.error(
            format!(
                "Failed to instantiate the session loader. Reason {}",
                loader.err().unwrap()
            )
            .as_str(),
        );
    }
    logger.info("Native messaging host shutting down...");
}
