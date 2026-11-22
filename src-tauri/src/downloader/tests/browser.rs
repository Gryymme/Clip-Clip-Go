use super::*;
use crate::companion::{
    shared::{self, Candidate, Envelope, Request},
    windows,
};
struct Site {
    url: String,
    requests: Arc<Mutex<Vec<String>>>,
    stop: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}
impl Site {
    fn new(folder: PathBuf, redirect: Option<String>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        listener.set_nonblocking(true).unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let quit = stop.clone();
        let requests = Arc::new(Mutex::new(vec![]));
        let seen = requests.clone();
        let thread = thread::spawn(move || {
            while !quit.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((mut c, _)) => {
                        let folder = folder.clone();
                        let seen = seen.clone();
                        let redirect = redirect.clone();
                        thread::spawn(move || {
                            c.set_nonblocking(false).unwrap();
                            c.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
                            c.set_write_timeout(Some(Duration::from_secs(2))).unwrap();
                            let mut bytes = vec![];
                            let mut b = [0];
                            while !bytes.ends_with(b"\r\n\r\n") && bytes.len() < 40 * 1024 {
                                if c.read(&mut b).unwrap_or(0) == 0 {
                                    return;
                                }
                                bytes.push(b[0]);
                            }
                            let text = String::from_utf8_lossy(&bytes).into_owned();
                            seen.lock().unwrap().push(text.clone());
                            let path = text
                                .lines()
                                .next()
                                .and_then(|l| l.split_whitespace().nth(1))
                                .unwrap_or("/")
                                .split('?')
                                .next()
                                .unwrap();
                            if path == "/redirect" {
                                let _=write!(c,"HTTP/1.1 302 Found\r\nLocation: {}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",redirect.unwrap());
                                return;
                            }
                            if path == "/expired" {
                                let _=c.write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                                return;
                            }
                            let name = if path == "/media" {
                                "fixture.mp4"
                            } else {
                                path.trim_start_matches('/')
                            };
                            if name.contains("..") || name.contains('/') || name.contains('\\') {
                                return;
                            }
                            let body = fs::read(folder.join(name)).unwrap_or_default();
                            let ct = if name.ends_with("m3u8") {
                                "Application/Vnd.Apple.MpegURL"
                            } else if name.ends_with("mpd") {
                                "application/dash+xml"
                            } else if name.ends_with("ts") {
                                "video/mp2t"
                            } else if name.ends_with("m4a") {
                                "audio/mp4"
                            } else {
                                "video/mp4"
                            };
                            let range = text.lines().find_map(|l| {
                                l.to_ascii_lowercase()
                                    .strip_prefix("range: bytes=")
                                    .map(String::from)
                            });
                            let mut start = 0;
                            let mut end = body.len().saturating_sub(1);
                            if let Some(ref r) = range {
                                let (a, b) = r.split_once('-').unwrap_or(("0", ""));
                                start = a.parse::<usize>().unwrap_or(0).min(end);
                                end = b.parse::<usize>().unwrap_or(end).min(end);
                            }
                            let len = if body.is_empty() { 0 } else { end - start + 1 };
                            let extra = if range.is_some() {
                                format!("Content-Range: bytes {start}-{end}/{}\r\n", body.len())
                            } else {
                                String::new()
                            };
                            let _=write!(c,"HTTP/1.1 {}\r\nContent-Type: {ct}\r\nContent-Length: {len}\r\nAccept-Ranges: bytes\r\n{extra}Connection: close\r\n\r\n",if range.is_some(){"206 Partial Content"}else{"200 OK"});
                            if !text.starts_with("HEAD") && len > 0 {
                                let _ = c.write_all(&body[start..=end]);
                            }
                            let _ = c.shutdown(std::net::Shutdown::Write);
                        });
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5))
                    }
                    Err(_) => break,
                }
            }
        });
        Self {
            url,
            requests,
            stop,
            thread: Some(thread),
        }
    }
}
impl Drop for Site {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(t) = self.thread.take() {
            t.join().unwrap();
        }
    }
}
fn candidate(site: &str, path: &str) -> Candidate {
    serde_json::from_value(json!({"id":"fixture","pageUrl":format!("{site}/outer-page?retain=one"),"frameUrl":format!("{site}/frame"),"mediaUrl":format!("{site}/{path}"),"mediaType":if path.ends_with("mpd"){"dash"}else if path.ends_with("m3u8"){"hls"}else{"direct"},"title":null,"width":null,"height":null,"frameId":2,"documentId":"frame-document","navigationId":"page-navigation","observedAt":shared::now(),"expiresAt":shared::now()+shared::TTL-100,"context":{"referer":format!("{site}/frame")}})).unwrap()
}
#[test]
fn browser_candidate_crosses_real_user_pipe_and_local_transport_then_existing_pipeline() {
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
            "testsrc2=size=640x360:rate=25:duration=3",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000:duration=3",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-g",
            "25",
            "-c:a",
            "aac",
            "-ac",
            "2",
            "-shortest",
        ],
    );
    generate(
        &e,
        &d.path().join("playlist.m3u8"),
        &[
            "-i",
            d.path().join("fixture.mp4").to_str().unwrap(),
            "-c",
            "copy",
            "-f",
            "hls",
            "-hls_time",
            "1",
            "-hls_list_size",
            "0",
            "-hls_segment_filename",
            d.path().join("segment-%03d.ts").to_str().unwrap(),
        ],
    );
    generate(
        &e,
        &d.path().join("small.m3u8"),
        &[
            "-i",
            d.path().join("fixture.mp4").to_str().unwrap(),
            "-vf",
            "scale=320:180",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-g",
            "25",
            "-c:a",
            "copy",
            "-f",
            "hls",
            "-hls_time",
            "1",
            "-hls_list_size",
            "0",
            "-hls_segment_filename",
            d.path().join("small-%03d.ts").to_str().unwrap(),
        ],
    );
    fs::write(d.path().join("master.m3u8"),"#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360,FRAME-RATE=25\nplaylist.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=350000,RESOLUTION=320x180,FRAME-RATE=25\nsmall.m3u8\n").unwrap();
    // Capture MPD snapshots through a non-file sink; publish only the complete final
    // XML after muxing. Repeated atomic replacement of an MPD can fail on Windows.
    let generation = Control::default();
    *generation.working_directory.lock().unwrap() = Some(d.path().into());
    let args = [
        "-hide_banner",
        "-v",
        "error",
        "-nostdin",
        "-i",
        d.path().join("fixture.mp4").to_str().unwrap(),
        "-map",
        "0",
        "-c",
        "copy",
        "-f",
        "dash",
        "-seg_duration",
        "1",
        "-use_template",
        "1",
        "-use_timeline",
        "1",
        "pipe:1",
    ]
    .map(String::from);
    let generated = NativeRunner
        .run(
            &e.ffmpeg,
            &args,
            &generation,
            Some(Duration::from_secs(30)),
            None,
        )
        .unwrap();
    assert!(generated.success, "{}", generated.stderr);
    let snapshots = String::from_utf8(generated.stdout).unwrap();
    let final_manifest = &snapshots[snapshots.rfind("<?xml").expect("A generated MPD snapshot")..];
    assert!(final_manifest.trim_end().ends_with("</MPD>"));
    fs::write(d.path().join("manifest.mpd"), final_manifest).unwrap();
    assert!(
        fs::metadata(d.path().join("init-stream0.m4s"))
            .unwrap()
            .len()
            > 0
    );
    let site = Site::new(d.path().into(), None);
    let runtime = crate::companion::Runtime::default();
    // Native Messaging's actual framed schema is round-tripped before Windows IPC.
    let request = Request::Candidate {
        v: 1,
        request_id: "source".into(),
        candidate: candidate(&site.url, "media?signature=a%2Bb&token=exact"),
    };
    let mut wire = vec![];
    shared::write_frame(&mut wire, &request).unwrap();
    let request: Request = shared::read_frame(&mut &wire[..]).unwrap().unwrap();
    let pipe = format!(
        "{}-test-{}",
        windows::pipe_name().unwrap(),
        std::process::id()
    );
    let stop = Arc::new(AtomicBool::new(false));
    let r = runtime.clone();
    let own = std::env::current_exe().unwrap();
    let expected = own.canonicalize().unwrap();
    let server = windows::serve(pipe.clone(), stop.clone(), move |message, client| {
        assert_eq!(client.unwrap().canonicalize().unwrap(), expected);
        r.accept(message)
    })
    .unwrap();
    let wrong = Envelope {
        origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop/".into(),
        request: Request::Hello {
            v: 1,
            request_id: "wrong-peer".into(),
        },
    };
    assert!(windows::exchange(&pipe, &d.path().join("wrong.exe"), &wrong).is_err());
    thread::sleep(Duration::from_millis(50));
    let reply = windows::exchange(
        &pipe,
        &own,
        &Envelope {
            origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop/".into(),
            request,
        },
    )
    .unwrap();
    assert!(reply.ok);
    let c = runtime.take("fixture").unwrap();
    assert!(c.page_url.contains("outer-page"));
    assert!(c.media_url.contains("signature=a%2Bb&token=exact"));
    stop.store(true, Ordering::SeqCst);
    server.join().unwrap();
    for (index, source) in [
        c,
        candidate(&site.url, "master.m3u8"),
        candidate(&site.url, "manifest.mpd"),
    ]
    .into_iter()
    .enumerate()
    {
        let input = MediaInput::Browser(source);
        let (url, relay) = input.transport().unwrap();
        let control = Control::default();
        let stage = workspace(d.path(), &control).unwrap();
        let output = TraceRunner
            .run(
                &t.yt,
                &inspection_args(&t, &e, stage.path(), &url),
                &control,
                Some(Duration::from_secs(30)),
                None,
            )
            .unwrap();
        assert!(
            output.success,
            "{}; relay {:?}",
            protocol::sanitized(&output.stderr),
            relay.as_ref().and_then(|r| r.failure())
        );
        let media = metadata::parse(&output.stdout, input.url()).unwrap();
        drop(relay);
        drop(stage);
        if index == 0 {
            assert_eq!(
                media.formats.iter().filter(|f| f.video).count(),
                1,
                "Direct files have no invented alternative source qualities"
            );
        }
        if index == 1 {
            assert!(media.formats.iter().any(|f| f.height == Some(360)));
            assert!(media.formats.iter().any(|f| f.height == Some(180)));
        }
        let inspected = Inspected {
            id: 1,
            input,
            media,
        };
        let s = settings();
        let p = plan::build(&inspected.media, &s, &e).unwrap();
        let out = execute(
            &t,
            &e,
            &inspected,
            &s,
            &p,
            d.path(),
            &format!("browser-output-{index}"),
            &Control::default(),
            &TraceRunner,
            Arc::new(|_, _, _| {}),
        )
        .unwrap_or_else(|error| {
            eprintln!(
                "Fixture requests: {:?}",
                site.requests
                    .lock()
                    .unwrap()
                    .iter()
                    .map(|r| r.lines().next().unwrap_or("").to_string())
                    .collect::<Vec<_>>()
            );
            panic!("{error}")
        });
        let doc = probe(&out, &e, &NativeRunner, &Control::default()).unwrap();
        assert_eq!(stream(&doc, "video").unwrap()["height"], 360);
        assert_eq!(stream(&doc, "audio").unwrap()["channels"], 2);
        assert_eq!(stream(&doc, "video").unwrap()["codec_name"], "h264");
        assert_eq!(stream(&doc, "video").unwrap()["avg_frame_rate"], "25/1");
        assert_eq!(stream(&doc, "audio").unwrap()["codec_name"], "aac");
        assert_eq!(stream(&doc, "audio").unwrap()["sample_rate"], "48000");
    }
    let records = site.requests.lock().unwrap();
    assert!(records
        .iter()
        .any(|r| r.contains("signature=a%2Bb&token=exact")));
    assert!(records.iter().all(|r| r
        .to_lowercase()
        .contains(&format!("referer: {}/frame", site.url))));
    assert!(records
        .iter()
        .all(|r| !r.to_lowercase().contains("cookie:")
            && !r.to_lowercase().contains("authorization:")));
}
#[test]
fn relay_drops_referer_on_redirect_and_other_hosts_and_preserves_http_denial() {
    let d = dir();
    fs::write(d.path().join("fixture.mp4"), b"fixture bytes").unwrap();
    let destination = Site::new(d.path().into(), None);
    let source = Site::new(d.path().into(), Some(format!("{}/media", destination.url)));
    let c = candidate(&source.url, "redirect");
    let relay = relay::Relay::start(&c).unwrap();
    let local = url::Url::parse(&relay.url).unwrap();
    let mut stream = TcpStream::connect(("127.0.0.1", local.port().unwrap())).unwrap();
    write!(
        stream,
        "GET {}?{} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
        local.path(),
        local.query().unwrap()
    )
    .unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    assert!(response.contains("200 Media"));
    assert!(source.requests.lock().unwrap()[0]
        .to_ascii_lowercase()
        .contains("referer:"));
    assert!(!destination.requests.lock().unwrap()[0]
        .to_ascii_lowercase()
        .contains("referer:"));
    drop(relay);
    let relay = relay::Relay::start(&candidate(&source.url, "expired")).unwrap();
    let local = url::Url::parse(&relay.url).unwrap();
    let mut stream = TcpStream::connect(("127.0.0.1", local.port().unwrap())).unwrap();
    write!(
        stream,
        "GET {}?{} HTTP/1.1\r\nHost: localhost\r\n\r\n",
        local.path(),
        local.query().unwrap()
    )
    .unwrap();
    response.clear();
    stream.read_to_string(&mut response).unwrap();
    assert!(response.contains("403 Media"));
    let port = local.port().unwrap();
    drop(relay);
    assert!(TcpStream::connect(("127.0.0.1", port)).is_err());
}
