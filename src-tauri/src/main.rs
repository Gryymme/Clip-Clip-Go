#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod history;
mod session;
mod bundled;
mod companion;
mod conversion;
mod downloader;
mod engine;
mod gif;
#[path = "../engine_integrity.rs"]
mod engine_integrity;
mod images;
mod media;
mod pdf;
mod preview;
mod process;
mod process_tree;
mod text;

fn main() {
    tauri::Builder::default()
        .manage(history::Runtime::default())
        .manage(session::Session::default())
        .manage(conversion::Runtime::default())
        .manage(downloader::Runtime::default())
        .manage(companion::Runtime::default())
        .setup(|app| {
            use tauri::Manager;
            let runtime = app.state::<companion::Runtime>();
            if let Err(e) = runtime.start(app.handle().clone()) {
                runtime.record_start_error(e);
            }
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            session::close_requested(window, event);
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
            conversion::choose_queue_destination,
            downloader::prepare_download,
            downloader::discard_download,
            history::history_change,
            history::history_open,
            session::history_flush_done,
            session::queue_counts,
            session::confirm_queue_close,
            session::open_queue_output,
            downloader::inspect_download,
            downloader::inspect_browser_download,
            companion::companion_status,
            companion::dismiss_browser_source,
            companion::setup_browser_companion,
            companion::connect_browser_companion,
            companion::browser_companion_action,
            companion::remove_browser_bridge,
            downloader::download_status,
            downloader::cancel_download,
            downloader::download_capabilities,
            downloader::plan_download,
            downloader::choose_download_folder,
            downloader::start_download,
            media::select_media_file,
            conversion::configure_engines,
            conversion::probe_media,
            conversion::probe_image,
            conversion::probe_pdf,
            media::select_images,
            media::select_pdfs,
            conversion::start_merge_pdf,
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
                app.state::<downloader::Runtime>().shutdown();
                app.state::<companion::Runtime>().stop();
            }
        });
}
