mod engine_integrity;

fn main() {
    let target = std::env::var("TARGET").expect("Cargo build target missing");
    assert_eq!(
        target, "x86_64-pc-windows-msvc",
        "Unsupported engine target: only Windows x64 MSVC is supported"
    );
    println!("cargo:rerun-if-changed=../scripts/ffmpeg-manifest.json");
    println!("cargo:rerun-if-changed=../third-party/ffmpeg");
    println!("cargo:rerun-if-changed=engine_integrity.rs");
    let manifest: serde_json::Value =
        serde_json::from_str(include_str!("../scripts/ffmpeg-manifest.json")).unwrap();
    for name in ["ffmpeg", "ffprobe"] {
        let path = format!("binaries/{name}-{target}.exe");
        println!("cargo:rerun-if-changed={path}");
        assert!(
            engine_integrity::verify(
                std::path::Path::new(&path),
                manifest["binaries"][name]["sha256"].as_str().unwrap()
            )
            .unwrap_or(false),
            "Bundled {name} is missing or damaged. Run npm run engines:prepare before compiling."
        );
    }
    for (name, hash) in manifest["noticeFiles"]
        .as_object()
        .expect("Missing notice hashes")
    {
        let path = format!("../third-party/ffmpeg/{name}");
        assert!(engine_integrity::verify(std::path::Path::new(&path), hash.as_str().unwrap()).unwrap_or(false), "Required FFmpeg notice {name} is missing or changed. Restore third-party/ffmpeg before building.");
    }
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "select_media_file",
            "configure_engines",
            "probe_media",
            "start_conversion",
            "get_conversion_status",
            "cancel_conversion",
        ]),
    ))
    .expect("failed to build Tauri application");
}
