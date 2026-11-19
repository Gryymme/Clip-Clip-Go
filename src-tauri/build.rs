fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["select_media_file"])),
    )
    .expect("failed to build Tauri application");
}
