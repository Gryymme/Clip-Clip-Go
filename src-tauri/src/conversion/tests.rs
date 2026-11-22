use super::*;
use crate::engine::{encoder_names, parse_probe, Availability};
use crate::process::Captured;
use std::{collections::VecDeque, fs, time::Duration};

fn test_dir() -> tempfile::TempDir {
    let parent = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/conversion-tests");
    fs::create_dir_all(&parent).unwrap();
    tempfile::tempdir_in(parent).unwrap()
}
fn info(video: bool, audio: bool) -> MediaInfo {
    MediaInfo {
        duration: Some(2.0),
        video_geometry: video.then_some(engine::VideoGeometry{width:160.0,height:96.0}),
        video: video.then(|| engine::StreamInfo {
            index: 2,
            codec: "h264".into(),
        }),
        audio: audio.then(|| engine::StreamInfo {
            index: 4,
            codec: "aac".into(),
        }),
        container: "mov,mp4".into(),
        formats: vec![],
    }
}
fn engines() -> Engines {
    Engines {
        ffmpeg: "mock-ffmpeg.exe".into(),
        ffprobe: "mock-ffprobe.exe".into(),
        encoders: [
            "libx264",
            "aac",
            "libvpx-vp9",
            "libopus",
            "libmp3lame",
            "pcm_s16le",
            "flac",
        ]
        .map(String::from)
        .into(),
        report: EngineReport {
            ready: true,
            ffmpeg_version: Some("ffmpeg version test".into()),
            ffprobe_version: Some("ffprobe version test".into()),
            folder: None,
            formats: Vec::<Availability>::new(),
            message: "test".into(),
        },
    }
}
fn json_output() -> Vec<u8> {
    br#"{"streams":[{"index":0,"codec_type":"audio","codec_name":"flac"}],"format":{"duration":"2","format_name":"flac"}}"#.to_vec()
}
struct MockRunner {
    mode: &'static str,
    destination: PathBuf,
    calls: Mutex<Vec<Vec<String>>>,
}
impl Runner for MockRunner {
    fn run(
        &self,
        executable: &Path,
        args: &[String],
        control: &Control,
        _: Option<Duration>,
        mut progress: Option<LineHandler>,
    ) -> Result<Captured> {
        self.calls.lock().unwrap().push(args.to_vec());
        if executable == Path::new("mock-ffprobe.exe") {
            if self.mode == "bad-probe" {
                return Ok(Captured {
                    stdout: b"invalid".to_vec(),
                    stderr: String::new(),
                    success: true,
                    exit_code: Some(0),
                });
            }
            return Ok(Captured {
                stdout: json_output(),
                stderr: String::new(),
                success: true,
                exit_code: Some(0),
            });
        }
        let temporary = Path::new(args.last().unwrap());
        fs::write(temporary, b"encoded test output").unwrap();
        if let Some(progress) = progress.as_mut() {
            progress("out_time_us=1000000");
            progress("progress=end");
        }
        if self.mode == "cancel" {
            control.cancel();
            return Err(CANCELLED.into());
        }
        if self.mode == "race" {
            fs::write(&self.destination, b"another application's output").unwrap();
        }
        if self.mode == "empty" {
            fs::write(temporary, b"").unwrap();
        }
        Ok(Captured {
            stdout: Vec::new(),
            stderr: "Test decoder error".into(),
            success: self.mode != "fail",
            exit_code: Some(if self.mode == "fail" { 1 } else { 0 }),
        })
    }
}
fn run_mock(mode: &'static str) -> (tempfile::TempDir, PathBuf, Result<PathBuf>, usize) {
    let dir = test_dir();
    let input = dir.path().join("source.wav");
    let destination = dir.path().join("output.flac");
    fs::write(&input, b"original bytes").unwrap();
    if mode == "exists" {
        fs::write(&destination, b"existing destination").unwrap();
    }
    let runner = MockRunner {
        mode,
        destination: destination.clone(),
        calls: Mutex::new(vec![]),
    };
    let result = convert_to(
        &engines(),
        &input,
        &destination,
        OutputFormat::Flac,
        &info(false, true),
        &Control::default(),
        &runner,
        None,
        || {},
    );
    assert_eq!(fs::read(&input).unwrap(), b"original bytes");
    assert!(fs::read_dir(dir.path()).unwrap().all(|entry| !entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".clip-clip-go-")));
    let calls = runner.calls.lock().unwrap().len();
    (dir, destination, result, calls)
}

#[test]
fn explicit_presets_and_stream_maps() {
    for format in FORMATS.into_iter().filter(|f| *f != OutputFormat::Gif) {
        let args = command_args(
            Path::new("C:/input with spaces & quotes.mp4"),
            Path::new("C:/owned.tmp"),
            format,
            &info(true, true),
        )
        .unwrap();
        assert!(args
            .windows(2)
            .any(|w| w == ["-i", "C:/input with spaces & quotes.mp4"]));
        assert!(args.windows(2).any(|w| w == ["-map", "0:4"]));
        assert_eq!(
            args.windows(2).any(|w| w == ["-map", "0:2"]),
            format.video()
        );
        assert!(args.windows(2).any(|w| w == ["-c:a", format.codecs().1]));
        assert!(args.contains(&"-sn".into()) && args.contains(&"-dn".into()));
        assert_eq!(args.last().unwrap(), "C:/owned.tmp");
        assert!(!args.iter().any(|a| a == "copy"));
    }
    assert!(command_args(
        Path::new("in.mp4"),
        Path::new("out.mp3"),
        OutputFormat::Mp3,
        &info(true, false)
    )
    .is_err());
    let silent = command_args(
        Path::new("in.mp4"),
        Path::new("out.mp4"),
        OutputFormat::Mp4,
        &info(true, false),
    )
    .unwrap();
    assert!(!silent.contains(&"-c:a".into()));
}
#[test]
fn probe_excludes_cover_art_subtitles_and_attachments() {
    let parsed=parse_probe(br#"{"streams":[{"index":0,"codec_type":"video","codec_name":"mjpeg","disposition":{"attached_pic":1}},{"index":1,"codec_type":"subtitle"},{"index":2,"codec_type":"attachment"},{"index":3,"codec_type":"video","codec_name":"h264"},{"index":4,"codec_type":"audio","codec_name":"aac"},{"index":5,"codec_type":"audio","codec_name":"mp3"}],"format":{"duration":"N/A","format_name":"matroska,webm"}}"#).unwrap();
    assert_eq!(parsed.video.unwrap().index, 3);
    assert_eq!(parsed.audio.unwrap().index, 4);
    assert_eq!(parsed.duration, None);
    assert!(parse_probe(b"corrupt").is_err());
    assert!(parse_probe(br#"{"streams":[{"index":0,"codec_type":"video","codec_name":"mjpeg","disposition":{"attached_pic":1}}]}"#).is_err());
}
#[test]
fn encoders_and_stream_presence_gate_formats() {
    let mut available =
        encoder_names(" V....D libx264 encoder\n A..... aac encoder\n ------\n V..... = Video\n");
    assert!(
        engine::availability(&available, OutputFormat::Mp4, Some(&info(true, true)), true)
            .available
    );
    available.remove("aac");
    assert!(
        !engine::availability(&available, OutputFormat::Mp4, Some(&info(true, true)), true)
            .available
    );
    assert!(
        engine::availability(
            &available,
            OutputFormat::Mp4,
            Some(&info(true, false)),
            true
        )
        .available
    );
    assert!(
        !engine::availability(
            &engines().encoders,
            OutputFormat::Mp3,
            Some(&info(true, false)),
            true
        )
        .available
    );
    assert!(
        !engine::availability(
            &engines().encoders,
            OutputFormat::Mp4,
            Some(&info(true, true)),
            false
        )
        .available
    );
}
#[test]
fn progress_is_real_bounded_and_handles_unknown_values() {
    assert_eq!(progress_seconds("out_time_us=1250000"), Some(1.25));
    assert_eq!(progress_seconds("out_time=01:02:03.500"), Some(3723.5));
    for line in [
        "progress=end",
        "out_time_us=N/A",
        "out_time_us=-1",
        "out_time_us=NaN",
        "out_time_us=inf",
        "out_time=bad",
    ] {
        assert_eq!(progress_seconds(line), None);
    }
}
#[test]
fn destination_enforces_extension_and_protects_input() {
    let dir = test_dir();
    let input = dir.path().join("source.mp4");
    fs::write(&input, b"original").unwrap();
    assert!(
        destination_path(&input, &dir.path().join("source.wrong"), OutputFormat::Mp4)
            .unwrap_err()
            .contains("input file")
    );
    let output =
        destination_path(&input, &dir.path().join("result.txt"), OutputFormat::Mp4).unwrap();
    assert_eq!(output.extension().unwrap(), "mp4");
}
#[test]
fn output_is_validated_then_published_without_overwrite() {
    let (_dir, path, result, calls) = run_mock("ok");
    assert_eq!(result.unwrap(), path.canonicalize().unwrap());
    assert_eq!(fs::read(path).unwrap(), b"encoded test output");
    assert_eq!(calls, 2);
    let (_dir, path, result, calls) = run_mock("exists");
    assert!(result.unwrap_err().contains("already exists"));
    assert_eq!(calls, 0);
    assert_eq!(fs::read(path).unwrap(), b"existing destination");
    let (_dir, path, result, _) = run_mock("race");
    assert!(result.is_err());
    assert_eq!(fs::read(path).unwrap(), b"another application's output");
}
#[test]
fn failures_cancellation_empty_and_invalid_outputs_clean_only_owned_temporary() {
    for mode in ["fail", "cancel", "empty", "bad-probe"] {
        let (_dir, path, result, _) = run_mock(mode);
        assert!(result.is_err(), "{mode}");
        assert!(!path.exists());
        if mode == "cancel" {
            assert_eq!(result.unwrap_err(), CANCELLED);
        }
    }
}
#[test]
fn successful_exit_with_wrong_codecs_is_not_success() {
    assert!(validate_output(OutputFormat::Mp3, &info(false, true), &info(false, true)).is_err());
}
struct SetupRunner(Mutex<VecDeque<Captured>>);
impl Runner for SetupRunner {
    fn run(
        &self,
        _: &Path,
        _: &[String],
        _: &Control,
        _: Option<Duration>,
        _: Option<LineHandler>,
    ) -> Result<Captured> {
        self.0
            .lock()
            .unwrap()
            .pop_front()
            .ok_or("Unexpected call".into())
    }
}
#[test]
fn versions_are_checked_and_missing_encoders_are_reported() {
    let response = |text: &str| Captured {
        stdout: text.as_bytes().to_vec(),
        stderr: String::new(),
        success: true,
        exit_code: Some(0),
    };
    let runner = SetupRunner(Mutex::new(VecDeque::from([
        response("ffmpeg version 8.0\n"),
        response("ffprobe version 8.0\n"),
        response(" A..... flac FLAC\n"),
    ])));
    let e = engine::inspect_engines(
        "ffmpeg".into(),
        "ffprobe".into(),
        None,
        &runner,
        &Control::default(),
    )
    .unwrap();
    assert!(
        e.report
            .formats
            .iter()
            .find(|f| f.format == OutputFormat::Flac)
            .unwrap()
            .available
    );
    assert!(
        !e.report
            .formats
            .iter()
            .find(|f| f.format == OutputFormat::Mp4)
            .unwrap()
            .available
    );
    let invalid = SetupRunner(Mutex::new(VecDeque::from([response("unrelated program")])));
    assert!(engine::inspect_engines(
        "ffmpeg".into(),
        "ffprobe".into(),
        None,
        &invalid,
        &Control::default()
    )
    .is_err());
}
#[test]
fn runtime_authorizes_only_selected_inputs_and_serializes_work() {
    let dir = test_dir();
    let input = dir.path().join("source.wav");
    fs::write(&input, b"input").unwrap();
    let core = Arc::new(Core::default());
    assert!(core.authorize(input.to_str().unwrap()).is_err());
    core.remember(&input);
    assert!(core.authorize(input.to_str().unwrap()).is_ok());
    let operation = core.reserve().unwrap();
    assert!(core.reserve().is_err());
    let temporary = tempfile::NamedTempFile::new_in(dir.path())
        .unwrap()
        .into_temp_path();
    let temporary_path = temporary.to_path_buf();
    let unrelated = dir.path().join("unrelated");
    fs::write(&unrelated, b"keep").unwrap();
    *operation.control.temporary.lock().unwrap() = Some(temporary);
    core.shutdown();
    assert_eq!(operation.control.check().unwrap_err(), CANCELLED);
    assert!(!temporary_path.exists());
    assert!(unrelated.exists());
    drop(operation);
    assert!(core.reserve().is_ok());
}
#[test]
fn bundled_real_engine_smoke_all_presets() {
    // Isolate PATH removal in an owned child so parallel tests and the host stay untouched.
    if std::env::var_os("CLIP_CLIP_GO_SMOKE_NO_PATH").is_none() {
        let mut child = std::process::Command::new(std::env::current_exe().unwrap());
        child
            .args([
                "--exact",
                "conversion::tests::bundled_real_engine_smoke_all_presets",
                "--nocapture",
            ])
            .env("PATH", "")
            .env("CLIP_CLIP_GO_SMOKE_NO_PATH", "1");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            child.creation_flags(0x08000000);
        }
        let result = child.output().unwrap();
        assert!(
            result.status.success(),
            "No-PATH smoke failed: {} {}",
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        );
        return;
    }
    assert_eq!(std::env::var("PATH").unwrap(), "");
    let (ffmpeg, ffprobe) =
        crate::bundled::test_sidecars().expect("Prepare bundled sidecars before testing");
    let engines =
        engine::inspect_engines(ffmpeg, ffprobe, None, &NativeRunner, &Control::default()).unwrap();
    assert!(engines.report.formats.iter().all(|f| f.available));
    let dir = test_dir();
    let input = dir.path().join("fixture.mp4");
    let mut args = [
        "-hide_banner",
        "-nostdin",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=160x96:rate=12:duration=0.3",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=0.3",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
    ]
    .map(String::from)
    .to_vec();
    args.push(input.to_string_lossy().into_owned());
    assert!(
        NativeRunner
            .run(
                &engines.ffmpeg,
                &args,
                &Control::default(),
                Some(Duration::from_secs(20)),
                None
            )
            .unwrap()
            .success
    );
    let original = fs::read(&input).unwrap();
    let media = engine::probe(&engines, &input, &NativeRunner, &Control::default()).unwrap();
    assert!(media.video.is_some() && media.audio.is_some());
    for format in FORMATS.into_iter().filter(|f| *f != OutputFormat::Gif) {
        let destination = dir.path().join(format!("converted.{}", format.extension()));
        let result = convert_to(
            &engines,
            &input,
            &destination,
            format,
            &media,
            &Control::default(),
            &NativeRunner,
            None,
            || {},
        )
        .unwrap();
        assert!(fs::metadata(&result).unwrap().len() > 0);
        assert!(convert_to(
            &engines,
            &input,
            &destination,
            format,
            &media,
            &Control::default(),
            &NativeRunner,
            None,
            || {}
        )
        .unwrap_err()
        .contains("already exists"));
    }
    // Audio input to audio output exercises the same production path too.
    let audio = dir.path().join("converted.wav");
    let audio_info = engine::probe(&engines, &audio, &NativeRunner, &Control::default()).unwrap();
    convert_to(
        &engines,
        &audio,
        &dir.path().join("audio-only.flac"),
        OutputFormat::Flac,
        &audio_info,
        &Control::default(),
        &NativeRunner,
        None,
        || {},
    )
    .unwrap();
    assert_eq!(fs::read(input).unwrap(), original);
    assert!(fs::read_dir(dir.path()).unwrap().all(|f| !f
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".clip-clip-go-")));
}
