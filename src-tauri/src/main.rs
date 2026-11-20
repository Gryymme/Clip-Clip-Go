#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bundled;
mod conversion;
mod engine;
#[path = "../engine_integrity.rs"]
mod engine_integrity;
mod images;
mod media;
mod pdf;
mod preview;
mod process;
mod text;

fn main() {
    tauri::Builder::default()
        .manage(conversion::Runtime::default())
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                use tauri::Manager;
                let state = window.state::<conversion::Runtime>();
                *state.drops.lock().unwrap() = if paths.len() <= 100 {
                    paths.clone()
                } else {
                    Vec::new()
                };
            }
        })
        .invoke_handler(tauri::generate_handler![
            media::select_media_file,
            conversion::configure_engines,
            conversion::probe_media,
            conversion::probe_image,
            conversion::probe_pdf,
            media::select_images,
            media::claim_drop,
            conversion::start_images_pdf,
            conversion::start_conversion,
            conversion::get_conversion_status,
            conversion::cancel_conversion,
            preview::generate_preview,
            preview::cancel_preview
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
                app.state::<conversion::Runtime>().previews.cancel_all();
            }
        });
}
