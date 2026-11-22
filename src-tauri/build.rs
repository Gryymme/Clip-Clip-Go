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
    println!("cargo:rerun-if-changed=../scripts/pdf-manifest.json");
    println!("cargo:rerun-if-changed=../scripts/downloader-manifest.json");
    println!("cargo:rerun-if-changed=../third-party/downloader");
    let downloader: serde_json::Value =
        serde_json::from_str(include_str!("../scripts/downloader-manifest.json")).unwrap();
    for (name, key) in [("yt-dlp", "ytDlp"), ("deno", "deno")] {
        let path = format!("binaries/{name}-{target}.exe");
        println!("cargo:rerun-if-changed={path}");
        assert!(
            engine_integrity::verify(
                std::path::Path::new(&path),
                downloader[key]["sha256"].as_str().unwrap()
            )
            .unwrap_or(false),
            "Bundled {name} missing or damaged. Run npm run downloader:prepare."
        );
    }
    for (name, hash) in downloader["noticeFiles"].as_object().unwrap() {
        assert!(
            engine_integrity::verify(
                std::path::Path::new(&format!("../third-party/downloader/{name}")),
                hash.as_str().unwrap()
            )
            .unwrap_or(false),
            "Required Downloader notice {name} changed or missing."
        );
    }
    println!("cargo:rerun-if-changed=../third-party/pdf");
    let pdf: serde_json::Value = serde_json::from_str(
        include_str!("../scripts/pdf-manifest.json").trim_start_matches('\u{feff}'),
    )
    .expect("Invalid PDF manifest");
    for (name, hash) in [
        ("pdfium.dll", pdf["pdfium"]["dllSha256"].as_str()),
        ("NotoSans-Regular.ttf", pdf["font"]["sha256"].as_str()),
    ] {
        let path = format!("resources/pdf/{name}");
        println!("cargo:rerun-if-changed={path}");
        assert!(
            engine_integrity::verify(
                std::path::Path::new(&path),
                hash.expect("Missing PDF asset hash")
            )
            .unwrap_or(false),
            "Bundled PDF asset {name} is missing or damaged. Run npm run pdf:prepare."
        );
    }
    for (name, hash) in pdf["noticeFiles"].as_object().expect("Missing PDF notices") {
        assert!(
            engine_integrity::verify(
                std::path::Path::new(&format!("../third-party/pdf/{name}")),
                hash.as_str().unwrap()
            )
            .unwrap_or(false),
            "Required PDF notice {name} changed or missing."
        );
    }
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "inspect_download",
            "inspect_browser_download",
            "companion_status",
            "dismiss_browser_source",
            "setup_browser_companion",
            "connect_browser_companion",
            "browser_companion_action",
            "remove_browser_bridge",
            "download_status",
            "cancel_download",
            "download_capabilities",
            "plan_download",
            "choose_download_folder",
            "start_download",
            "select_media_file",
            "configure_engines",
            "probe_media",
            "probe_image",
            "generate_preview",
            "cancel_preview",
            "probe_pdf",
            "select_images",
            "select_pdfs",
            "start_merge_pdf",
            "claim_drop",
            "start_images_pdf",
            "start_conversion",
            "get_conversion_status",
            "cancel_conversion",
        ]),
    ))
    .expect("failed to build Tauri application");
}
