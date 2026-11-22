use std::sync::{atomic::{AtomicBool, Ordering}, Mutex};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

#[derive(Default)]
pub struct Session {
    counts: Mutex<(u32, u32)>,
    confirming: AtomicBool,
    frontend_ready: AtomicBool,
    pub closing: AtomicBool,
}
#[tauri::command]
pub fn queue_counts(state: tauri::State<'_, Session>, waiting: u32, running: u32) {
    *state.counts.lock().unwrap() = (waiting, running);
    state.frontend_ready.store(true, Ordering::SeqCst);
}
pub fn close_requested(window: &tauri::Window, event: &tauri::WindowEvent) {
    let tauri::WindowEvent::CloseRequested { api, .. } = event else { return; };
    let app = window.app_handle().clone();
    let session = app.state::<Session>();
    if session.closing.load(Ordering::SeqCst) { api.prevent_close(); return; }
    let (waiting, running) = *session.counts.lock().unwrap();
    // Always settle owned workers on exit, including metadata/preview work.
    api.prevent_close();
    if session.confirming.swap(true, Ordering::SeqCst) { return; }
    // Ask the scheduler for a fresh snapshot instead of confirming against delayed IPC counts.
    if session.frontend_ready.load(Ordering::SeqCst) && window.emit("queue-close-requested", ()).is_ok() { return; }
    confirm_close(app, waiting, running);
}
#[tauri::command]
pub fn confirm_queue_close(app: tauri::AppHandle, waiting: u32, running: u32) {
    if !app.state::<Session>().closing.load(Ordering::SeqCst) { confirm_close(app, waiting, running); }
}
fn confirm_close(app: tauri::AppHandle, waiting: u32, running: u32) {
    let occupied = !app.state::<crate::conversion::Runtime>().core.settled();
    if waiting == 0 && running == 0 && !occupied { exit_after_cleanup(app); return; }
    let callback_app = app.clone();
    app.dialog().message(format!("Close ClipClipGO? {waiting} waiting job(s) will be discarded; {running} processing job(s) will be stopped. Any active inspection will stop too. Waiting jobs are not resumed after restarting."))
        .title("Work is still in this session")
        .buttons(MessageDialogButtons::OkCancelCustom("Close and stop work".into(), "Keep working".into()))
        .show(move |yes| {
            if yes { exit_after_cleanup(callback_app); }
            else { callback_app.state::<Session>().confirming.store(false, Ordering::SeqCst); }
        });
}
fn exit_after_cleanup(app: tauri::AppHandle) {
    app.state::<Session>().closing.store(true, Ordering::SeqCst);
    let core = app.state::<crate::conversion::Runtime>().core.clone();
    core.stop_submissions();
    let _ = app.emit("queue-shutdown", ());
    std::thread::spawn(move || {
        core.shutdown();
        app.state::<crate::conversion::Runtime>().previews.cancel_all();
        app.state::<crate::downloader::Runtime>().shutdown();
        app.state::<crate::companion::Runtime>().stop();
        // Cancellation may be cooperative for native image/PDF operations. Wait for their lease.
        while !core.settled() { std::thread::sleep(std::time::Duration::from_millis(40)); }
        app.exit(0);
    });
}

#[tauri::command]
pub fn open_queue_output(state: tauri::State<'_, crate::conversion::Runtime>, path: String, folder: bool) -> Result<(), String> {
    use std::{os::windows::ffi::OsStrExt, path::Path, ptr::{null, null_mut}};
    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};
    let output = Path::new(&path);
    if !state.core.owned_output(output) { return Err("Only outputs published in this session can be opened.".into()); }
    if !output.exists() { return Err("The saved output has been moved, removed or is inaccessible.".into()); }
    let target = if folder && output.is_file() { output.parent().ok_or("Output folder is unavailable.")? } else { output };
    let canonical = target.canonicalize().map_err(|_| "The saved output is inaccessible.")?;
    // ShellExecute accepts one path, with no shell command string or caller-supplied arguments.
    let text = canonical.to_string_lossy();
    let readable = if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        std::path::PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = text.strip_prefix(r"\\?\") { std::path::PathBuf::from(rest) } else { canonical.clone() };
    let target: Vec<u16> = readable.as_os_str().encode_wide().chain(Some(0)).collect();
    let verb: Vec<u16> = "open\0".encode_utf16().collect();
    let result = unsafe { ShellExecuteW(null_mut(), verb.as_ptr(), target.as_ptr(), null(), null(), SW_SHOWNORMAL) };
    if result as isize <= 32 { return Err("Windows could not open the saved output. Use its destination path.".into()); }
    Ok(())
}
