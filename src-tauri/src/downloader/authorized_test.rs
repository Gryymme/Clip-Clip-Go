//! Explicit opt-in public fixture, separate from the routine localhost suite.
use super::*;
use std::fs;
#[test]
#[ignore = "Requires explicit CCG_AUTHORIZED_MEDIA_URL; never runs against public sites in routine tests"]
fn authorized_youtube_fixture() {
    let input = std::env::var("CCG_AUTHORIZED_MEDIA_URL")
        .expect("Set the explicitly authorized fixture URL");
    let url = metadata::url(&input).unwrap();
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/downloader-tests");
    fs::create_dir_all(&root).unwrap();
    let d = tempfile::tempdir_in(root).unwrap();
    let (ffmpeg, ffprobe) = crate::bundled::test_sidecars().unwrap();
    let e =
        crate::engine::inspect_engines(ffmpeg, ffprobe, None, &NativeRunner, &Control::default())
            .unwrap();
    let t = tools_at(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries"),
        true,
    )
    .unwrap();
    let inspect = |url: &str| -> Media {
        let c = Control::default();
        let stage = workspace(d.path(), &c).unwrap();
        let args = inspection_args(&t, &e, stage.path(), url);
        let output = NativeRunner
            .run(&t.yt, &args, &c, Some(Duration::from_secs(60)), None)
            .unwrap();
        assert!(
            output.success,
            "Inspection failed (exit {:?}): {}",
            output.exit_code,
            protocol::sanitized(&output.stderr)
        );
        metadata::parse(&output.stdout, url).expect("Invalid inspected metadata")
    };
    let media = inspect(&url);
    println!(
        "Authorized inspection: duration {:?}, {} reported formats",
        media.duration,
        media.formats.len()
    );
    let parsed = tauri::Url::parse(&url).unwrap();
    let id = parsed
        .query_pairs()
        .find(|(k, _)| k == "v")
        .map(|(_, v)| v.to_string())
        .expect("This fixture expects the provided watch URL");
    let mut share = tauri::Url::parse(&format!("https://youtu.be/{id}")).unwrap();
    for (k, v) in parsed.query_pairs().filter(|(k, _)| k != "v") {
        share.query_pairs_mut().append_pair(&k, &v);
    }
    share.set_fragment(parsed.fragment());
    let shared = inspect(share.as_str());
    assert_eq!(shared.title, media.title);
    assert_eq!(
        shared.formats.iter().map(|f| &f.id).collect::<Vec<_>>(),
        media.formats.iter().map(|f| &f.id).collect::<Vec<_>>()
    );
    println!("Watch/share inspection matched; meaningful URL parameters retained.");
    let cache = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join(".engine-cache/authorized-youtube-inspection.json");
    fs::write(cache, serde_json::to_vec_pretty(&media).unwrap()).unwrap();
    if std::env::var("CCG_AUTHORIZED_DOWNLOAD").as_deref() != Ok("true") {
        return;
    }
    assert!(
        media.duration.is_some_and(|s| s <= 600.0),
        "Inspect the duration before authorizing a larger test"
    );
    let requested = std::env::var("CCG_AUTHORIZED_VIDEO_ID").ok();
    let source = media
        .formats
        .iter()
        .filter(|f| {
            f.video
                && !f.audio
                && f.height.is_some_and(|h| h <= 360)
                && requested.as_ref().is_none_or(|id| &f.id == id)
        })
        .max_by_key(|f| f.height.unwrap())
        .expect("No selected small video variant for this test");
    println!(
        "Testing selected {}p video format {} with automatic audio, MP4 output",
        source.height.unwrap(),
        source.id
    );
    let mut s:Settings=serde_json::from_value(json!({"mode":"video","format":"mp4","videoSource":"best","audioSource":"auto","resolution":null,"fps":null,"videoEncoder":"auto","quality":"preserve","videoKbps":null,"keepAudio":true,"audioEncoder":"auto","audioKbps":null,"sampleRate":null,"channels":null})).unwrap();
    s.video_source = source.id.clone();
    let p = plan::build(&media, &s, &e).unwrap();
    let inspected = Inspected {
        id: 1,
        input: MediaInput::Page(url),
        media,
    };
    let notify: Notify = Arc::new(|stage, message, point| {
        if let Some(diag) = point.and_then(|p| p.diagnostic) {
            println!(
                "{} · {} · exit {:?} · {}",
                diag.stage, diag.engine, diag.exit_code, diag.detail
            );
        } else if !message.is_empty() {
            println!("Stage: {stage}");
        }
    });
    let out = execute(
        &t,
        &e,
        &inspected,
        &s,
        &p,
        d.path(),
        "authorized",
        &Control::default(),
        &NativeRunner,
        notify,
    )
    .expect("Authorized download failed; inspect bounded diagnostics above");
    let doc = probe(&out, &e, &NativeRunner, &Control::default()).unwrap();
    assert!(stream(&doc, "video").is_some() && stream(&doc, "audio").is_some());
    println!(
        "Published and FFprobe-validated video/audio output ({} bytes)",
        fs::metadata(out).unwrap().len()
    );
}
