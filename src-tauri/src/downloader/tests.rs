use super::*;
mod browser;
mod pipeline;
use std::{
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::atomic::AtomicBool,
    thread,
};
fn dir() -> tempfile::TempDir {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/downloader-tests");
    fs::create_dir_all(&root).unwrap();
    tempfile::tempdir_in(root).unwrap()
}
fn engines() -> Engines {
    let (a, b) = crate::bundled::test_sidecars().unwrap();
    crate::engine::inspect_engines(a, b, None, &NativeRunner, &Control::default()).unwrap()
}
fn settings() -> Settings {
    serde_json::from_value(json!({"mode":"video","format":"mp4","videoSource":"best","audioSource":"auto","resolution":null,"fps":null,"videoEncoder":"auto","quality":"preserve","videoKbps":null,"keepAudio":true,"audioEncoder":"auto","audioKbps":null,"sampleRate":null,"channels":null})).unwrap()
}
fn metadata() -> Media {
    metadata::parse(br#"{"title":"Fixture","duration":4,"formats":[{"format_id":"v","ext":"mp4","vcodec":"avc1.64001f","acodec":"none","width":960,"height":540,"fps":29.97,"tbr":900},{"format_id":"a","ext":"m4a","vcodec":"none","acodec":"mp4a.40.2","asr":48000,"audio_channels":2,"tbr":128},{"format_id":"lower","ext":"mp4","vcodec":"h264","acodec":"aac","width":640,"height":360,"fps":24,"tbr":500}]}"#,"https://media.example.test/item").unwrap()
}

#[test]
fn metadata_missing_fields_and_boundaries() {
    let m = metadata();
    assert_eq!(m.formats[0].vcodec.as_deref(), Some("h264"));
    assert!(!m.formats[0].audio);
    assert_eq!(m.formats[0].size, None);
    assert_eq!(m.thumbnail, None);
    for bytes in [
        br#"{"_type":"playlist","entries":[]}"#.as_slice(),
        br#"{"is_live":true}"#,
        br#"{"live_status":"is_upcoming"}"#,
        br#"{"has_drm":true}"#,
    ] {
        assert!(metadata::parse(bytes, "https://example.test").is_err());
    }
    let m = metadata::parse(
        br#"{"format_id":"direct","ext":"mp4","url":"https://example.test/a.mp4"}"#,
        "https://example.test/a.mp4",
    )
    .unwrap();
    assert!(m.formats[0].uncertain);
    assert_eq!(m.formats[0].vcodec, None);
    assert_eq!(m.title, "Untitled media");
    assert_eq!(m.duration, None);
    for u in [
        "file:///C:/secret",
        "ftp://example.test/x",
        "https://user:pass@example.test/",
        "https://example.test/\n",
    ] {
        assert!(metadata::url(u).is_err());
    }
    assert!(metadata::url("https://example.test/watch?v=x&list=y").is_ok());
    assert!(metadata::parse(
        br#"{"formats":[{"format_id":"best+evil","vcodec":"h264"}]}"#,
        "https://example.test"
    )
    .is_err());
}
#[test]
fn native_selection_compatibility_and_encoding_options() {
    let e = engines();
    let m = metadata();
    let mut s = settings();
    let p = plan::build(&m, &s, &e).unwrap();
    assert_eq!(p.sources, vec!["v", "a"]);
    assert!(p.merge && p.copy_video && p.copy_audio && !p.conversion);
    s.format = "webm".into();
    let p = plan::build(&m, &s, &e).unwrap();
    assert!(p.conversion && !p.copy_video && !p.copy_audio);
    assert_eq!(p.video_encoder.as_deref(), Some("libvpx-vp9"));
    s.video_encoder = "libx264".into();
    assert!(plan::build(&m, &s, &e).is_err());
    s = settings();
    s.video_source = "lower".into();
    assert_eq!(plan::build(&m, &s, &e).unwrap().sources, vec!["lower"]);
    s.resolution = Some(720);
    assert!(plan::build(&m, &s, &e).is_err());
    s.resolution = Some(360);
    s.fps = Some(60);
    let p = plan::build(&m, &s, &e).unwrap();
    assert!(p.conversion);
    let args = plan::ffmpeg_args(&["source.mp4".into()], Path::new("out.mp4"), &s, &p);
    assert!(args.windows(2).any(|p| p == ["-r", "60"]));
    assert!(!args.iter().any(|s| s.contains("minterpolate")));
    assert!(args.iter().any(|s| s.contains("min(1,360/ih)")));
    s.quality = "bitrate".into();
    s.video_kbps = Some(700);
    let args = plan::ffmpeg_args(
        &["source.mp4".into()],
        Path::new("out.mp4"),
        &s,
        &plan::build(&m, &s, &e).unwrap(),
    );
    assert!(args.windows(2).any(|p| p == ["-b:v", "700k"]));
    assert!(!args.contains(&"-crf".into()));
    s.video_kbps = Some(0);
    assert!(plan::build(&m, &s, &e).is_err());
    s = settings();
    s.keep_audio = false;
    let p = plan::build(&m, &s, &e).unwrap();
    assert_eq!(p.sources, vec!["v"]);
    assert!(p.audio_encoder.is_none());
    let mut unavailable = e.clone();
    unavailable.encoders.remove("libx264");
    s.video_encoder = "libx264".into();
    assert!(plan::build(&m, &s, &unavailable).is_err());
    s = settings();
    s.mode = "audio".into();
    s.format = "mp3".into();
    let p = plan::build(&m, &s, &e).unwrap();
    assert_eq!(p.sources, vec!["a"]);
    assert!(p.video_encoder.is_none());
    for (codec, n, ok) in [
        ("libmp3lame", 320, true),
        ("libmp3lame", 321, false),
        ("aac", 0, false),
        ("libopus", 510, true),
        ("flac", 128, false),
    ] {
        assert_eq!(plan::bitrate(codec, n).is_ok(), ok);
    }
    s.format = "flac".into();
    s.audio_kbps = Some(128);
    assert!(plan::build(&m, &s, &e).is_err());
    s.audio_kbps = None;
    s.sample_rate = Some(12345);
    assert!(plan::build(&m, &s, &e).is_err());
}

#[test]
fn measured_fractional_fps_must_not_reselect_an_undownloaded_variant() {
    let e = engines();
    let s = settings();
    let mut media = metadata();
    media.formats[0].fps = Some(60.0);
    let mut alternative = media.formats[0].clone();
    alternative.id = "undownloaded".into();
    alternative.bitrate = Some(800.0);
    media.formats.push(alternative);
    let selected = plan::build(&media, &s, &e).unwrap();
    assert_eq!(selected.video_source.as_deref(), Some("v"));
    media.formats[0].fps = Some(60000.0 / 1001.0);
    // Reproduce the old post-download selection. It falsely changed the planned ID.
    let incorrectly_reselected = plan::build(&media, &s, &e).unwrap();
    assert_ne!(
        incorrectly_reselected.video_source, selected.video_source,
        "The fixture must reproduce the previous false mismatch"
    );
    let resolved = plan::reconcile(&media, &s, &selected, &e).unwrap();
    assert_eq!(resolved.sources, selected.sources);
    assert_eq!(resolved.video_source, selected.video_source);
    assert_eq!(resolved.audio_source, selected.audio_source);
    media.formats[0].video = false;
    assert!(plan::reconcile(&media, &s, &selected, &e)
        .unwrap_err()
        .contains("streams changed"));
}
#[test]
fn progress_and_protected_publication() {
    assert!(progress("other output").is_none());
    let p =
        progress(r#"CCG:{"downloaded_bytes":500,"total_bytes":1000,"speed":250,"eta":2}"#).unwrap();
    assert_eq!(p.percent, Some(50.0));
    assert_eq!(p.speed, Some(250.0));
    assert_eq!(
        progress(r#"CCG:{"downloaded_bytes":500,"total_bytes_estimate":1000}"#)
            .unwrap()
            .percent,
        Some(50.0)
    );
    assert_eq!(
        progress(r#"CCG:{"downloaded_bytes":2000,"total_bytes":1000}"#)
            .unwrap()
            .percent,
        Some(100.0)
    );
    let d = dir();
    let stage = d.path().join("output.mp4");
    let target = d.path().join("final.mp4");
    fs::write(&stage, b"validated").unwrap();
    let c = Control::default();
    publish(&stage, &target, &c).unwrap();
    let rival = d.path().join("rival.mp4");
    fs::write(&rival, b"rival output").unwrap();
    assert!(publish(&rival, &target, &c).is_err());
    assert_eq!(fs::read(&target).unwrap(), b"validated");
    let cancelled = Control::default();
    cancelled.cancel();
    assert_eq!(
        publish(&stage, &d.path().join("cancel.mp4"), &cancelled).unwrap_err(),
        CANCELLED
    );
    assert!(!d.path().join("cancel.mp4").exists());
    assert_eq!(filename("../../CON"), "_.._CON");
    assert_eq!(filename("CON.txt"), "_CON.txt");
    assert_eq!(filename("NUL"), "_NUL");
    assert!(!filename("a\\b/c: d? ").contains(['\\', '/', ':', '?']));
}
#[test]
fn only_owned_workspace_is_cleaned() {
    let d = dir();
    let keep = d.path().join("keep.txt");
    fs::write(&keep, b"user").unwrap();
    let c = Control::default();
    let stage = workspace(d.path(), &c).unwrap();
    let path = stage.path().to_path_buf();
    fs::write(path.join("download.part"), b"partial").unwrap();
    c.cancel();
    assert!(!path.exists());
    assert_eq!(fs::read(keep).unwrap(), b"user");
}
#[test]
fn bundled_resolution_and_offline_runtime() {
    let d = dir();
    assert!(tools_at(d.path(), false).is_err());
    let t = tools_at(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries"),
        true,
    )
    .unwrap();
    let c = Control::default();
    let stage = workspace(d.path(), &c).unwrap();
    let r = NativeRunner
        .run(
            &t.deno,
            &[
                "eval".into(),
                "--no-config".into(),
                "--no-remote".into(),
                "console.log(1 + 1)".into(),
            ],
            &c,
            Some(Duration::from_secs(10)),
            None,
        )
        .unwrap();
    assert!(r.success, "{}", r.stderr);
    assert_eq!(String::from_utf8_lossy(&r.stdout).trim(), "2");
    let e = engines();
    let a = base_args(&t, &e, stage.path());
    for arg in [
        "--ignore-config",
        "--no-plugin-dirs",
        "--no-remote-components",
        "--no-js-runtimes",
    ] {
        assert!(a.contains(&arg.into()));
    }
    assert!(a.iter().any(|x| x == &format!("deno:{}", t.deno.display())));
}

struct Server {
    url: String,
    stop: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
    requests: Arc<Mutex<Vec<String>>>,
}
impl Server {
    fn new(folder: PathBuf) -> Self {
        Self::with_throttle(folder, false)
    }
    fn with_throttle(folder: PathBuf, throttle: bool) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        listener.set_nonblocking(true).unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let quit = stop.clone();
        let requests = Arc::new(Mutex::new(vec![]));
        let seen = requests.clone();
        let thread = thread::spawn(move || {
            while !quit.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((mut connection, _)) => {
                        // On Windows an accepted socket inherits the listener's
                        // nonblocking mode. A fast write_all otherwise returns
                        // WSAEWOULDBLOCK after ~240 KiB, truncating the fixture.
                        connection.set_nonblocking(false).unwrap();
                        connection
                            .set_write_timeout(Some(Duration::from_secs(10)))
                            .unwrap();
                        connection
                            .set_read_timeout(Some(Duration::from_secs(2)))
                            .unwrap();
                        let mut request = Vec::new();
                        let mut b = [0u8; 1024];
                        while request.len() < 16384 {
                            let n = connection.read(&mut b).unwrap_or(0);
                            if n == 0 {
                                break;
                            }
                            request.extend_from_slice(&b[..n]);
                            if request.windows(4).any(|w| w == b"\r\n\r\n") {
                                break;
                            }
                        }
                        let text = String::from_utf8_lossy(&request);
                        let first = text.lines().next().unwrap_or("").to_string();
                        seen.lock().unwrap().push(first.clone());
                        let name = first
                            .split_whitespace()
                            .nth(1)
                            .unwrap_or("/")
                            .trim_start_matches('/');
                        let (body, kind) = if name == "item.html" {
                            (b"<html><title>Local generated fixture</title><video controls src='/fixture.mp4'></video></html>".to_vec(),"text/html")
                        } else if name == "separate.mpd" {
                            (br#"<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT4S" minBufferTime="PT1S"><Period duration="PT4S"><AdaptationSet mimeType="video/mp4"><Representation id="v" codecs="avc1.42c01f" width="960" height="540" frameRate="30" bandwidth="1000000"><BaseURL>video.mp4</BaseURL></Representation><Representation id="alternative" codecs="avc1.42c01f" width="960" height="540" frameRate="30" bandwidth="800000"><BaseURL>video.mp4</BaseURL></Representation></AdaptationSet><AdaptationSet mimeType="audio/mp4"><Representation id="a" codecs="mp4a.40.2" audioSamplingRate="48000" bandwidth="128000"><AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="2"/><BaseURL>audio.m4a</BaseURL></Representation></AdaptationSet></Period></MPD>"#.to_vec(),"application/dash+xml")
                        } else if name.contains('/')
                            || (name != "fixture.mp4" && name != "video.mp4" && name != "audio.m4a")
                        {
                            (vec![], "text/plain")
                        } else {
                            (
                                fs::read(folder.join(name)).unwrap_or_default(),
                                if name.ends_with("m4a") {
                                    "audio/mp4"
                                } else {
                                    "video/mp4"
                                },
                            )
                        };
                        let mut start = 0;
                        let mut end = body.len().saturating_sub(1);
                        let mut partial = false;
                        if let Some(range) = text.lines().find_map(|l| {
                            l.to_lowercase()
                                .strip_prefix("range: bytes=")
                                .map(String::from)
                        }) {
                            let (a, b) = range.split_once('-').unwrap_or(("0", ""));
                            start = a.parse::<usize>().unwrap_or(0).min(end);
                            end = b.parse::<usize>().unwrap_or(end).min(end);
                            partial = true;
                        }
                        let length = if body.is_empty() {
                            0
                        } else {
                            end.saturating_sub(start) + 1
                        };
                        let code = if partial {
                            "206 Partial Content"
                        } else {
                            "200 OK"
                        };
                        let extra = if partial {
                            format!("Content-Range: bytes {start}-{end}/{}\r\n", body.len())
                        } else {
                            String::new()
                        };
                        let _=write!(connection,"HTTP/1.1 {code}\r\nContent-Type: {kind}\r\nContent-Length: {length}\r\nAccept-Ranges: bytes\r\n{extra}Connection: close\r\n\r\n");
                        if !first.starts_with("HEAD") && length > 0 {
                            for chunk in body[start..=end].chunks(16384) {
                                if let Err(error) = connection.write_all(chunk) {
                                    eprintln!("Local HTTP fixture response write failed: {error}");
                                    break;
                                }
                                if throttle && kind != "text/html" && kind != "application/dash+xml"
                                {
                                    thread::sleep(Duration::from_millis(20));
                                }
                            }
                        }
                        let _ = connection.shutdown(std::net::Shutdown::Write);
                        // Gracefully finish the response and allow the client to close.
                        let mut end_of_request = [0u8; 256];
                        while connection.read(&mut end_of_request).is_ok_and(|n| n > 0) {}
                    }
                    Err(_) => thread::sleep(Duration::from_millis(5)),
                }
            }
        });
        Self {
            url: format!("http://{addr}"),
            stop,
            thread: Some(thread),
            requests,
        }
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect(self.url.trim_start_matches("http://"));
        if let Some(t) = self.thread.take() {
            t.join().unwrap();
        }
    }
}
fn generate(e: &Engines, path: &Path, args: &[&str]) {
    let mut all = vec!["-hide_banner", "-loglevel", "error", "-nostdin", "-y"]
        .into_iter()
        .chain(args.iter().copied())
        .map(String::from)
        .collect::<Vec<_>>();
    all.push(path.to_string_lossy().replace('\\', "/"));
    let control = Control::default();
    *control.working_directory.lock().unwrap() = path.parent().map(Path::to_owned);
    let r = NativeRunner
        .run(
            &e.ffmpeg,
            &all,
            &control,
            Some(Duration::from_secs(40)),
            None,
        )
        .unwrap();
    assert!(r.success, "{}", r.stderr);
}
struct TraceRunner;
impl Runner for TraceRunner {
    fn run(
        &self,
        e: &Path,
        a: &[String],
        c: &Control,
        t: Option<Duration>,
        p: Option<LineHandler>,
    ) -> Result<crate::process::Captured> {
        let mut args = a.to_vec();
        if e.file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("yt-dlp")
        {
            args.splice(0..0, ["--proxy".into(), String::new()]);
        }
        let r = NativeRunner.run(e, &args, c, t, p)?;
        if !r.success {
            eprintln!("Local fixture engine failure: {}", r.stderr);
        }
        Ok(r)
    }
}
fn inspect_local(t: &Tools, e: &Engines, url: &str, scratch: &Path) -> Media {
    let c = Control::default();
    let stage = workspace(scratch, &c).unwrap();
    let mut a = base_args(t, e, stage.path());
    a.extend(
        [
            "--dump-single-json",
            "--skip-download",
            "--flat-playlist",
            "--no-warnings",
            "--no-progress",
            "--",
        ]
        .map(String::from),
    );
    a.push(url.into());
    let r = TraceRunner
        .run(&t.yt, &a, &c, Some(Duration::from_secs(20)), None)
        .unwrap();
    assert!(r.success, "{}", r.stderr);
    metadata::parse(&r.stdout, url)
        .unwrap_or_else(|error| panic!("{error}: {}", String::from_utf8_lossy(&r.stdout)))
}

#[test]
fn local_http_real_download_convert_merge_and_ffprobe() {
    let d = dir();
    let e = engines();
    let t = tools_at(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries"),
        true,
    )
    .unwrap();
    generate(
        &e,
        &d.path().join("fixture.mp4"),
        &[
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=960x540:rate=30:duration=4",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000:duration=4",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "25",
            "-c:a",
            "aac",
            "-ac",
            "2",
            "-movflags",
            "+faststart",
        ],
    );
    generate(
        &e,
        &d.path().join("video.mp4"),
        &[
            "-i",
            d.path().join("fixture.mp4").to_str().unwrap(),
            "-map",
            "0:v:0",
            "-c",
            "copy",
            "-an",
        ],
    );
    generate(
        &e,
        &d.path().join("audio.m4a"),
        &[
            "-i",
            d.path().join("fixture.mp4").to_str().unwrap(),
            "-map",
            "0:a:0",
            "-c",
            "copy",
            "-vn",
        ],
    );
    let server = Server::new(d.path().into());
    let url = format!("{}/item.html", server.url);
    let media = inspect_local(&t, &e, &url, d.path());
    assert!(
        !server
            .requests
            .lock()
            .unwrap()
            .iter()
            .any(|r| r.starts_with("GET /fixture.mp4")),
        "Inspection fetched media payload: {:?}",
        server.requests.lock().unwrap()
    );
    let inspected = Inspected {
        id: 1,
        input: MediaInput::Page(url),
        media,
    };
    let mut s = settings();
    s.resolution = None;
    let events = Arc::new(Mutex::new(Vec::new()));
    let captured = events.clone();
    let notify = Arc::new(move |stage: &str, _: &str, p: Option<DownloadProgress>| {
        captured
            .lock()
            .unwrap()
            .push((stage.to_string(), p.and_then(|p| p.bytes)));
    });
    let p = plan::build(&inspected.media, &s, &e).unwrap();
    let out = execute(
        &t,
        &e,
        &inspected,
        &s,
        &p,
        d.path(),
        "copy",
        &Control::default(),
        &TraceRunner,
        notify.clone(),
    )
    .unwrap();
    let doc = probe(&out, &e, &NativeRunner, &Control::default()).unwrap();
    assert_eq!(stream(&doc, "video").unwrap()["codec_name"], "h264");
    assert_eq!(stream(&doc, "audio").unwrap()["codec_name"], "aac");
    let cancelled = Arc::new(Control::default());
    let cancel_from_progress = cancelled.clone();
    let cancel_notify = Arc::new(
        move |_: &str, _: &str, progress: Option<DownloadProgress>| {
            if progress.and_then(|p| p.bytes).is_some_and(|b| b > 0) {
                cancel_from_progress.cancel();
            }
        },
    );
    let result = execute(
        &t,
        &e,
        &inspected,
        &s,
        &p,
        d.path(),
        "cancelled",
        &cancelled,
        &TraceRunner,
        cancel_notify,
    );
    assert_eq!(result.unwrap_err(), CANCELLED);
    assert!(!d.path().join("cancelled.mp4").exists());
    // Reinspect direct media and verify requested dimensions, frame rate, audio properties and target bitrate.
    let direct = format!("{}/fixture.mp4", server.url);
    let mut media = inspect_local(&t, &e, &direct, d.path());
    let source_doc = probe(
        &d.path().join("fixture.mp4"),
        &e,
        &NativeRunner,
        &Control::default(),
    )
    .unwrap();
    actual_format(&mut media.formats[0], &source_doc);
    let inspected = Inspected {
        id: 2,
        input: MediaInput::Page(direct),
        media,
    };
    s.resolution = Some(360);
    s.fps = Some(24);
    s.quality = "bitrate".into();
    s.video_kbps = Some(500);
    s.audio_kbps = Some(128);
    s.sample_rate = Some(44100);
    s.channels = Some(1);
    let p = plan::build(&inspected.media, &s, &e).unwrap();
    let out = execute(
        &t,
        &e,
        &inspected,
        &s,
        &p,
        d.path(),
        "encoded",
        &Control::default(),
        &TraceRunner,
        notify.clone(),
    )
    .unwrap();
    let doc = probe(&out, &e, &NativeRunner, &Control::default()).unwrap();
    let v = stream(&doc, "video").unwrap();
    assert_eq!(v["height"], 360);
    assert_eq!(v["width"], 640);
    assert!((rate(&v["avg_frame_rate"]).unwrap() - 24.0).abs() < 0.01);
    assert_eq!(stream(&doc, "audio").unwrap()["channels"], 1);
    assert_eq!(stream(&doc, "audio").unwrap()["sample_rate"], "44100");
    let b = number(&v["bit_rate"]).unwrap();
    assert!(
        (250000.0..=750000.0).contains(&b),
        "video target 500k, measured {b}"
    );
    // Every output muxer, including audio formats outside the older Converter presets.
    for format in ["mp3", "m4a", "wav", "flac", "ogg", "opus", "mkv", "webm"] {
        let mut s = settings();
        s.format = format.into();
        if !matches!(format, "mkv" | "webm") {
            s.mode = "audio".into();
        }
        if matches!(format, "opus" | "webm") {
            s.sample_rate = Some(48000);
        }
        if format == "mp3" {
            s.audio_kbps = Some(128);
            s.channels = Some(2);
        }
        let p = plan::build(&inspected.media, &s, &e).unwrap();
        let out = execute(
            &t,
            &e,
            &inspected,
            &s,
            &p,
            d.path(),
            &format!("smoke-{format}"),
            &Control::default(),
            &TraceRunner,
            notify.clone(),
        )
        .unwrap();
        let doc = probe(&out, &e, &NativeRunner, &Control::default()).unwrap();
        assert!(stream(&doc, "audio").is_some());
        if format == "mp3" {
            let b = number(&stream(&doc, "audio").unwrap()["bit_rate"]).unwrap();
            assert!((115200.0..=140800.0).contains(&b));
        }
    }
    let separate = format!("{}/separate.mpd", server.url);
    let media = inspect_local(&t, &e, &separate, d.path());
    let inspected = Inspected {
        id: 3,
        input: MediaInput::Page(separate),
        media,
    };
    let mut s = settings();
    s.format = "mkv".into();
    let p = plan::build(&inspected.media, &s, &e).unwrap();
    assert!(p.merge, "{:?}", inspected.media.formats);
    let out = execute(
        &t,
        &e,
        &inspected,
        &s,
        &p,
        d.path(),
        "merged",
        &Control::default(),
        &TraceRunner,
        notify.clone(),
    )
    .unwrap();
    let doc = probe(&out, &e, &NativeRunner, &Control::default()).unwrap();
    assert!(stream(&doc, "video").is_some() && stream(&doc, "audio").is_some());
    for (name, mode) in [("video.mp4", "video"), ("audio.m4a", "audio")] {
        let url = format!("{}/{name}", server.url);
        let media = inspect_local(&t, &e, &url, d.path());
        let inspected = Inspected {
            id: 4,
            input: MediaInput::Page(url),
            media,
        };
        let mut s = settings();
        s.mode = mode.into();
        s.keep_audio = false;
        s.format = if mode == "audio" { "flac" } else { "mp4" }.into();
        let p = plan::build(&inspected.media, &s, &e).unwrap();
        let out = execute(
            &t,
            &e,
            &inspected,
            &s,
            &p,
            d.path(),
            &format!("only-{mode}"),
            &Control::default(),
            &TraceRunner,
            notify.clone(),
        )
        .unwrap();
        let doc = probe(&out, &e, &NativeRunner, &Control::default()).unwrap();
        assert_eq!(stream(&doc, "video").is_some(), mode == "video");
        assert_eq!(stream(&doc, "audio").is_some(), mode == "audio");
    }
    let seen = events.lock().unwrap();
    assert!(seen.iter().any(|(s, _)| s == "merging"));
    assert!(seen.iter().any(|(s, _)| s == "converting"));
    assert!(
        seen.iter()
            .any(|(s, b)| s == "downloading" && b.is_some_and(|n| n > 0)),
        "No real download progress parsed"
    );
    assert!(!fs::read_dir(d.path()).unwrap().any(|f| f
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".clipclipgo-download-")));
}

#[test]
fn actual_available_encoders_and_rejected_output_validation() {
    let d = dir();
    let e = engines();
    let source = d.path().join("tiny.mp4");
    generate(
        &e,
        &source,
        &[
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=128x72:rate=25:duration=1",
            "-f",
            "lavfi",
            "-i",
            "sine=sample_rate=48000:duration=1",
            "-c:v",
            "libx264",
            "-c:a",
            "aac",
            "-ac",
            "2",
        ],
    );
    let doc = probe(&source, &e, &NativeRunner, &Control::default()).unwrap();
    let mut media = metadata();
    media.duration = number(&doc["format"]["duration"]);
    media.formats.truncate(1);
    actual_format(&mut media.formats[0], &doc);
    let contract: Value = serde_json::from_str(plan::CONTRACT).unwrap();
    for encoder in contract["encoders"].as_array().unwrap() {
        assert_eq!(
            plan::encoder_codec(encoder["id"].as_str().unwrap()),
            encoder["codec"].as_str().unwrap()
        );
    }
    for encoder in ["libx264", "libx265", "libvpx-vp9", "libaom-av1"] {
        if !e.encoders.contains(encoder) {
            continue;
        }
        let mut s = settings();
        s.video_encoder = encoder.into();
        s.quality = "high".into();
        if encoder == "libvpx-vp9" {
            s.format = "webm".into();
            s.sample_rate = Some(48000);
        }
        let p = plan::build(&media, &s, &e).unwrap();
        let out = d.path().join(format!("{encoder}.{}", s.format));
        let args = plan::ffmpeg_args(&[source.clone()], &out, &s, &p);
        let r = NativeRunner
            .run(
                &e.ffmpeg,
                &args,
                &Control::default(),
                Some(Duration::from_secs(30)),
                None,
            )
            .unwrap();
        assert!(r.success, "{encoder}: {}", r.stderr);
        let doc = probe(&out, &e, &NativeRunner, &Control::default()).unwrap();
        validate(&doc, &media, &s, &p).unwrap();
        let mut invalid = doc.clone();
        invalid["streams"][0]["width"] = json!(999);
        assert!(validate(&invalid, &media, &s, &p).is_err());
    }
}

#[test]
fn leases_and_stale_native_updates_are_protected() {
    let core = Arc::new(conversion::Core::default());
    let lease = core.reserve().unwrap();
    assert!(core.busy());
    assert!(core.reserve().is_err());
    drop(lease);
    assert!(!core.busy());
    let runtime = Runtime::default();
    runtime.inner.lock().unwrap().job = Some(Job::new(2, "inspecting", "new"));
    runtime.stage(1, "ready", "stale");
    assert_eq!(
        runtime.inner.lock().unwrap().job.as_ref().unwrap().message,
        "new"
    );
}

#[test]
fn progress_handles_estimates_fragments_missing_fields_and_runtime_scope() {
    let p = progress(r#"CCG:{"downloaded_bytes":400}"#).unwrap();
    assert!(p.percent.is_none());
    let p =
        progress(r#"CCG:{"downloaded_bytes":400,"total_bytes_estimate":1000,"format_id":null}"#)
            .unwrap();
    assert_eq!(p.percent, Some(40.0));
    assert_eq!(p.kind.as_deref(), Some("estimated"));
    let p = progress(r#"CCG:{"fragment_index":2,"fragment_count":8,"total_bytes_estimate":999}"#)
        .unwrap();
    assert_eq!(p.percent, Some(25.0));
    assert_eq!(p.kind.as_deref(), Some("fragments"));
    for text in [
        "CCG:broken",
        r#"CCG:{"total_bytes":0}"#,
        r#"CCG:{"total_bytes":"NA","speed":null}"#,
    ] {
        assert!(progress(text).is_none_or(|p| p.percent.is_none()));
    }
    let runtime = Runtime::default();
    runtime.inner.lock().unwrap().job = Some(Job::new(7, "downloading", "Source 1"));
    runtime.point(
        7,
        "downloading",
        DownloadProgress {
            stream: Some(1),
            streams: Some(2),
            percent: Some(70.0),
            ..Default::default()
        },
    );
    runtime.point(
        6,
        "downloading",
        DownloadProgress {
            percent: Some(99.0),
            ..Default::default()
        },
    );
    runtime.point(
        7,
        "converting",
        DownloadProgress {
            percent: Some(99.0),
            ..Default::default()
        },
    );
    assert_eq!(
        runtime.inner.lock().unwrap().job.as_ref().unwrap().percent,
        Some(70.0)
    );
    runtime.point(
        7,
        "downloading",
        DownloadProgress {
            stream: Some(2),
            streams: Some(2),
            ..Default::default()
        },
    );
    runtime.point(
        7,
        "downloading",
        DownloadProgress {
            stream: Some(1),
            percent: Some(100.0),
            ..Default::default()
        },
    );
    let j = runtime.inner.lock().unwrap().job.clone().unwrap();
    assert_eq!(j.stream, Some(2));
    assert!(j.percent.is_none());
    assert_eq!(j.stage, "downloading");
    runtime.stage(7, "merging", "Merging");
    runtime.point(
        7,
        "downloading",
        DownloadProgress {
            percent: Some(100.0),
            ..Default::default()
        },
    );
    assert_eq!(
        runtime.inner.lock().unwrap().job.as_ref().unwrap().stage,
        "merging"
    );
    runtime.stage(7, "cancelling", "Cancel");
    runtime.point(
        7,
        "merging",
        DownloadProgress {
            percent: Some(100.0),
            ..Default::default()
        },
    );
    assert!(runtime
        .inner
        .lock()
        .unwrap()
        .job
        .as_ref()
        .unwrap()
        .percent
        .is_none());
}

#[test]
fn completion_records_are_explicit_and_contained_and_diagnostics_redact_secrets() {
    let d = dir();
    let work = d.path().join("job");
    fs::create_dir(&work).unwrap();
    let source = work.join("actual-output.bin");
    fs::write(&source, b"completed").unwrap();
    let mut records = Completion::default();
    records.line("[download] Destination: a guessed extension");
    assert!(records.file(&work, "v").is_err());
    records.line(&format!(
        "CCG_DONE:{}",
        json!({"filepath":source,"format_id":"v"})
    ));
    assert_eq!(
        records.file(&work, "v").unwrap(),
        source.canonicalize().unwrap()
    );
    assert!(records
        .file(&work, "another-id")
        .unwrap_err()
        .contains("streams changed"));
    let mut missing_id = Completion::default();
    missing_id.line(&format!("CCG_DONE:{}", json!({"filepath":source})));
    assert!(missing_id.file(&work, "v").is_ok());
    let outside = d.path().join("user.bin");
    fs::write(&outside, b"user").unwrap();
    let mut escaped = Completion::default();
    escaped.line(&format!(
        "CCG_DONE:{}",
        json!({"filepath":outside,"format_id":"v"})
    ));
    assert!(escaped.file(&work, "v").is_err());
    assert_eq!(fs::read(&outside).unwrap(), b"user");
    records.line(&format!("CCG_DONE:{}", json!({"filepath":source})));
    assert!(records.file(&work, "v").is_err());
    let clean=protocol::sanitized("ERROR: HTTP 403 for https://user:password@media.example.test/video?token=secret&signature=private\nCookie: auth=cookie-secret\nAuthorization: Bearer sensitive\nfailed decoder at C:\\Users\\Example\\private.media\nparameter token=another-secret");
    for secret in [
        "password",
        "cookie-secret",
        "sensitive",
        "private.media",
        "another-secret",
        "https://",
        "signature=",
    ] {
        assert!(!clean.contains(secret), "{clean}");
    }
    assert!(clean.contains("HTTP 403"));
    assert!(clean.len() < 2000);
}

#[test]
fn watch_and_share_urls_preserve_all_query_and_fragment_information() {
    for input in [
        "https://www.youtube.com/watch?v=AbCdEfGhI12&t=37s&list=PL_example&index=3",
        "https://youtu.be/AbCdEfGhI12?si=share-value&t=37#chapter",
        "https://m.youtube.com/watch?v=AbCdEfGhI12&start=7&end=21",
    ] {
        assert_eq!(metadata::url(input).unwrap(), input);
    }
}

#[test]
fn website_inspection_keeps_complete_urls_as_one_argument_without_extractor_restrictions() {
    let e = engines();
    let t = Tools {
        yt: "yt-dlp.exe".into(),
        deno: "deno.exe".into(),
    };
    for input in [
        "https://fullxcinema.com/cheaters-retreat-2-2011/",
        "https://www.imdb.com/video/vi3232221721/?playlistId=nm13946181",
        "https://cinejoy.pk/watch/tv/5920/1/1",
        "https://www.youtube.com/watch?v=irVNGjRFZGk&t=1s",
        "https://youtu.be/irVNGjRFZGk?si=share-value&t=1s#chapter",
        "https://example.test/player?token=a%2Fb%2Bz&file=x%3Dy&filter=public#part",
    ] {
        let validated = metadata::url(input).unwrap();
        assert_eq!(validated, input);
        let args = inspection_args(&t, &e, Path::new("owned scratch"), &validated);
        assert_eq!(&args[args.len() - 2..], &["--", input]);
        assert!(args.iter().any(|arg| arg == "--skip-download"));
        assert!(args.iter().any(|arg| arg == "--dump-single-json"));
        for restricted in ["--force-generic-extractor", "--use-extractors", "--ies"] {
            assert!(!args.iter().any(|arg| arg == restricted));
        }
    }
}

#[test]
fn throttled_two_sources_keep_selected_ids_and_emit_live_progress_before_merge() {
    let d = dir();
    let e = engines();
    let t = tools_at(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries"),
        true,
    )
    .unwrap();
    generate(
        &e,
        &d.path().join("video.mp4"),
        &[
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=960x540:rate=30000/1001:duration=4",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "12",
            "-an",
            "-movflags",
            "+faststart",
        ],
    );
    generate(
        &e,
        &d.path().join("audio.m4a"),
        &[
            "-f",
            "lavfi",
            "-i",
            "sine=sample_rate=48000:duration=4",
            "-c:a",
            "aac",
            "-ac",
            "2",
        ],
    );
    assert!(
        fs::metadata(d.path().join("video.mp4")).unwrap().len() > 1024 * 1024,
        "Fixture must be large enough for intermediate updates"
    );
    let server = Server::with_throttle(d.path().into(), true);
    let url = format!("{}/separate.mpd", server.url);
    let mut media = inspect_local(&t, &e, &url, d.path());
    assert!(media.formats.iter().filter(|f| f.video).count() >= 2);
    // Treat a deliberately inaccurate site duration as metadata, not a final-file requirement.
    media.duration = Some(900.0);
    let inspected = Inspected {
        id: 1,
        input: MediaInput::Page(url),
        media,
    };
    let mut s = settings();
    s.format = "webm".into();
    s.resolution = Some(360);
    s.fps = Some(24);
    s.sample_rate = Some(48000);
    let p = plan::build(&inspected.media, &s, &e).unwrap();
    assert_eq!(p.video_source.as_deref(), Some("v"));
    assert!(p.merge);
    let runtime = Runtime::default();
    runtime.inner.lock().unwrap().job = Some(Job::new(1, "downloading", "Download"));
    let events = Arc::new(Mutex::new(Vec::new()));
    let log = events.clone();
    let r = runtime.clone();
    let notify: Notify = Arc::new(move |stage, message, point| {
        let marker = point
            .as_ref()
            .and_then(|p| p.diagnostic.as_ref())
            .map(|d| format!("engine:{}", d.stage));
        if let Some(p) = point {
            r.point(1, stage, p);
        } else {
            r.stage(1, stage, message);
        }
        let j = r.inner.lock().unwrap().job.clone().unwrap();
        log.lock().unwrap().push((
            marker.unwrap_or(stage.into()),
            j.stream,
            j.percent,
            j.bytes,
            std::time::Instant::now(),
        ));
    });
    let out = execute(
        &t,
        &e,
        &inspected,
        &s,
        &p,
        d.path(),
        "throttled",
        &Control::default(),
        &TraceRunner,
        notify,
    )
    .unwrap();
    let doc = probe(&out, &e, &NativeRunner, &Control::default()).unwrap();
    assert_eq!(stream(&doc, "video").unwrap()["codec_name"], "vp9");
    assert_eq!(stream(&doc, "audio").unwrap()["codec_name"], "opus");
    assert_eq!(stream(&doc, "video").unwrap()["height"], 360);
    let events = events.lock().unwrap();
    let first = events
        .iter()
        .filter(|(stage, source, percent, bytes, _)| {
            stage == "downloading"
                && *source == Some(1)
                && percent.is_some_and(|p| p > 0.0 && p < 100.0)
                && bytes.is_some_and(|b| b > 0)
        })
        .collect::<Vec<_>>();
    assert!(
        first.len() >= 3,
        "Expected multiple source-1 updates while downloading, got {}",
        first.len()
    );
    let first_exit = events
        .iter()
        .find(|(stage, _, _, _, _)| stage == "engine:downloading")
        .unwrap()
        .4;
    assert!(first[0].4 < first_exit);
    assert!(first.windows(2).any(|p| p[0].3 < p[1].3));
    assert!(
        events
            .iter()
            .any(|(stage, source, percent, _, _)| stage == "downloading"
                && *source == Some(2)
                && percent.is_none()),
        "Source 2 must reset the source progress"
    );
    let stages = events.iter().map(|e| e.0.as_str()).collect::<Vec<_>>();
    let merge = stages.iter().position(|s| *s == "merging").unwrap();
    let convert = stages.iter().position(|s| *s == "converting").unwrap();
    let finalize = stages.iter().position(|s| *s == "finalizing").unwrap();
    assert!(merge < convert && convert < finalize);
    let j = runtime.inner.lock().unwrap().job.clone().unwrap();
    assert_eq!(j.stage, "finalizing");
    assert!(j
        .diagnostics
        .iter()
        .any(|d| d.stage == "merging" && d.exit_code == Some(0)));
    assert!(j
        .diagnostics
        .iter()
        .any(|d| d.stage == "final validation" && d.exit_code == Some(0)));
    runtime.finish(1, Ok(Some(out)));
    assert_eq!(
        runtime.inner.lock().unwrap().job.as_ref().unwrap().stage,
        "succeeded"
    );
}
