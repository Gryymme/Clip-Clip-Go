#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod media;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![media::select_media_file])
        .run(tauri::generate_context!())
        .expect("error while running Clip-Clip-Go");
}
