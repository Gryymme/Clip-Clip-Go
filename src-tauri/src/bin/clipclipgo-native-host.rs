// Console subsystem is required for Chrome's length-prefixed stdio. No log on stdout.
#[allow(dead_code)]
#[path = "../companion/setup.rs"]
mod setup;
#[path = "../companion/shared.rs"]
mod shared;
#[allow(dead_code)]
#[path = "../companion/windows.rs"]
mod windows;
use shared::*;
fn run() -> Result<()> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args
        .first()
        .is_some_and(|s| s == "--register-development" || s == "--unregister-development")
    {
        // Maintenance CLI, invoked only by the documented user-run development scripts.
        if args.len() != 4 {
            return Err("Usage: --register-development|--unregister-development <actual extension ID> <desktop.exe> <absolute owned directory>".into());
        }
        if !extension_id(&args[1]) {
            return Err("Use the actual extension ID shown by Chrome.".into());
        }
        let root = std::path::Path::new(&args[3]);
        let app = std::path::Path::new(&args[2]);
        if args[0] == "--register-development" {
            setup::register(
                root,
                app,
                &std::env::current_exe().map_err(|_| "Cannot locate host.")?,
                &args[1],
                &setup::ChromeRegistry,
            )?;
        } else {
            setup::remove(root, app, &setup::ChromeRegistry)?;
        }
        eprintln!("ClipClipGO development bridge maintenance completed.");
        return Ok(());
    }
    let origin = args
        .first()
        .ok_or("Chrome must launch this Native Messaging host.")?;
    let id = sender_id(origin)?;
    if args.len() > 2
        || args.iter().skip(1).any(|a| {
            !a.strip_prefix("--parent-window=")
                .is_some_and(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()))
        })
    {
        return Err("Unexpected native host argument.".into());
    }
    let exe = std::env::current_exe().map_err(|_| "Cannot locate native host.")?;
    let config = setup::config(exe.parent().ok_or("Cannot locate native host.")?)?;
    setup::validate_manifest(exe.parent().ok_or("Cannot locate native host.")?, &config)?;
    if id != config.extension_id {
        return Err("Extension sender is not registered for this host.".into());
    }
    let mut input = std::io::stdin().lock();
    let mut output = std::io::stdout().lock();
    while let Some(request) = read_frame::<_, Request>(&mut input)? {
        let reply = if let Err(error) = request.validate(now()) {
            Reply::new(
                &request,
                false,
                if error.contains("expired") {
                    "expired"
                } else {
                    "rejected"
                },
                &error,
            )
        } else {
            match windows::exchange(
                &windows::pipe_name()?,
                &config.desktop_path,
                &Envelope {
                    origin: origin.clone(),
                    request: request.clone(),
                },
            ) {
                Ok(reply) => reply,
                Err(_) => Reply::new(
                    &request,
                    false,
                    "app_not_running",
                    "Open ClipClipGO, then check the connection and send again.",
                ),
            }
        };
        write_frame(&mut output, &reply)?;
    }
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("ClipClipGO native host: {error}");
        std::process::exit(1);
    }
}
