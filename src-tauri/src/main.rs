#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bundled;
mod conversion;
mod engine;
#[path = "../engine_integrity.rs"]
mod engine_integrity;
mod images;
mod media;
mod pdf;
mod process;
mod text;

fn main() {
    tauri::Builder::default()
        .manage(conversion::Runtime::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            media::select_media_file,
            conversion::configure_engines,
            conversion::probe_media,
            conversion::probe_image,
            conversion::probe_pdf,
            media::select_images,
            conversion::start_images_pdf,
            conversion::start_conversion,
            conversion::get_conversion_status,
            conversion::cancel_conversion
        ])
        .build(tauri::generate_context!())
        .expect("error while building Clip-Clip-Go")
        .run(|app, event| {
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                use tauri::Manager;
                app.state::<conversion::Runtime>().core.shutdown();
            }
        });
}
