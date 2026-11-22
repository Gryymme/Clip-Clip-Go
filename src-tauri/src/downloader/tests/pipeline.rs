//! Mocked failure/cancellation boundaries; real media is covered by the HTTP tests.
use super::*;
struct PipelineFixture {
    fail: Option<&'static str>,
    downloads: std::sync::atomic::AtomicUsize,
}
impl Runner for PipelineFixture {
    fn run(
        &self,
        exe: &Path,
        args: &[String],
        control: &Control,
        _: Option<Duration>,
        mut handler: Option<LineHandler>,
    ) -> Result<crate::process::Captured> {
        control.check()?;
        let name = exe.file_name().unwrap().to_string_lossy();
        let mut bytes = Vec::new();
        if name.starts_with("yt-dlp") {
            let attempt = self.downloads.fetch_add(1, Ordering::SeqCst);
            if self.fail == Some("expired") && attempt == 0 {
                return Ok(crate::process::Captured {
                    success: false,
                    exit_code: Some(1),
                    stdout: vec![],
                    stderr: "HTTP 403: https://media.example.test/source?signature=secret".into(),
                });
            }
            if self.fail == Some("network") {
                return Ok(crate::process::Captured {
                    success: false,
                    exit_code: Some(1),
                    stdout: vec![],
                    stderr: "Connection timed out".into(),
                });
            }
            let path = Path::new(&args[args.iter().position(|s| s == "--output").unwrap() + 1]);
            fs::write(path, b"downloaded fixture").unwrap();
            let id = if args.iter().any(|s| s == "all[format_id='v']") {
                "v"
            } else {
                "a"
            };
            if let Some(handler) = handler.as_mut() {
                handler(r#"CCG:{"downloaded_bytes":500,"total_bytes":1000}"#);
                handler(&format!(
                    "CCG_DONE:{}",
                    json!({"filepath":path,"format_id":id})
                ));
            }
        } else if name.starts_with("ffprobe") {
            let last = args.last().unwrap();
            let v = json!({"index":0,"codec_type":"video","codec_name":"h264","width":960,"height":540,"avg_frame_rate":"30000/1001","duration":"4"});
            let a = json!({"index":1,"codec_type":"audio","codec_name":"aac","sample_rate":"48000","channels":2,"duration":"4"});
            let streams = if last.contains("source-0") {
                vec![v]
            } else if last.contains("source-1") {
                vec![a]
            } else {
                vec![v, a]
            };
            bytes = serde_json::to_vec(
                &json!({"streams":streams,"format":{"format_name":"mov,mp4","duration":"4"}}),
            )
            .unwrap();
        } else {
            if self.fail == Some("encoder") && !args.last().unwrap().ends_with("merged.mkv") {
                return Ok(crate::process::Captured {
                    success: false,
                    exit_code: Some(42),
                    stdout: vec![],
                    stderr: "Encoder rejected settings. https://media.example.test/?token=secret"
                        .into(),
                });
            }
            fs::write(args.last().unwrap(), b"encoded fixture").unwrap();
        }
        Ok(crate::process::Captured {
            success: true,
            exit_code: Some(0),
            stdout: bytes,
            stderr: String::new(),
        })
    }
}

#[test]
fn cancellation_at_each_stage_and_expiry_retry_preserve_plan_and_publication() {
    let d = dir();
    let e = engines();
    let t = Tools {
        yt: "yt-dlp.exe".into(),
        deno: "deno.exe".into(),
    };
    let mut s = settings();
    s.quality = "high".into();
    let inspected = Inspected {
        id: 1,
        input: MediaInput::Page("https://media.example.test/item?t=1".into()),
        media: metadata(),
    };
    let p = plan::build(&inspected.media, &s, &e).unwrap();
    for stage in ["downloading", "merging", "converting", "finalizing"] {
        let c = Arc::new(Control::default());
        let cancel = c.clone();
        let runner = PipelineFixture {
            fail: None,
            downloads: Default::default(),
        };
        let notify: Notify = Arc::new(move |current, _, point| {
            if current == stage && point.is_none() {
                cancel.cancel();
            }
        });
        assert_eq!(
            execute(
                &t,
                &e,
                &inspected,
                &s,
                &p,
                d.path(),
                stage,
                &c,
                &runner,
                notify
            )
            .unwrap_err(),
            CANCELLED
        );
        assert!(!d.path().join(format!("{stage}.mp4")).exists());
    }
    let runner = PipelineFixture {
        fail: Some("expired"),
        downloads: Default::default(),
    };
    let events = Arc::new(Mutex::new(Vec::new()));
    let capture = events.clone();
    let notify: Notify = Arc::new(move |_, _, point| {
        if let Some(d) = point.and_then(|p| p.diagnostic) {
            capture.lock().unwrap().push(d);
        }
    });
    let output = execute(
        &t,
        &e,
        &inspected,
        &s,
        &p,
        d.path(),
        "retried",
        &Control::default(),
        &runner,
        notify,
    )
    .unwrap();
    assert!(output.exists());
    assert_eq!(runner.downloads.load(Ordering::SeqCst), 3);
    let diag = events.lock().unwrap();
    assert!(diag.iter().all(|d| d.selected_ids == p.sources));
    assert!(!serde_json::to_string(&*diag).unwrap().contains("secret"));
    drop(diag);
    for (failure, prefix) in [
        ("network", "Download failed"),
        ("encoder", "Output processing failed"),
    ] {
        let runner = PipelineFixture {
            fail: Some(failure),
            downloads: Default::default(),
        };
        let result = execute(
            &t,
            &e,
            &inspected,
            &s,
            &p,
            d.path(),
            failure,
            &Control::default(),
            &runner,
            Arc::new(|_, _, _| {}),
        );
        assert!(result.unwrap_err().starts_with(prefix));
        assert!(!d.path().join(format!("{failure}.mp4")).exists());
    }
}
