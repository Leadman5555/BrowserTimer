mod message_handler;
mod session_loader;
mod tracker;

fn main() {
    eprintln!("Native messaging host starting...");

    let loader = session_loader::SessionLoader::with_default_directory();
    if let Ok(session_loader) = loader {
        eprintln!(
            "Current save directory: {}",
            session_loader.get_save_directory().display()
        );
        let mut host = message_handler::NativeMessagingHost::new(session_loader);
        host.run();
    } else {
        eprintln!(
            "Failed to instantiate the session loader. Reason {}",
            loader.err().unwrap()
        );
    }
    eprintln!("Native messaging host shutting down...");
}
