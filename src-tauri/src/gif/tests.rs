use super::*;
use crate::{
    engine,
    process::{Captured, NativeRunner, CANCELLED},
};
use std::{fs, sync::Mutex, time::Duration};
fn work() -> tempfile::TempDir {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/gif-tests");
    fs::create_dir_all(&root).unwrap();
    tempfile::tempdir_in(root).unwrap()
}
fn media(rotation: i32, sar: &str) -> MediaInfo {
    engine::parse_probe(format!(r#"{{"streams":[{{"index":2,"codec_type":"video","codec_name":"h264","width":640,"height":360,"sample_aspect_ratio":"{sar}","side_data_list":[{{"rotation":{rotation}}}]}}],"format":{{"format_name":"mov,mp4","duration":"0.6"}}}}"#).as_bytes()).unwrap()
}
#[test]
fn plans_are_palette_based_audio_free_and_preserve_oriented_aspect() {
    let options = GifOptions {
        max_edge: 320,
        fps: 10,
    };
    let source = media(90, "1:1");
    assert_eq!(options.dimensions(&source).unwrap(), (180, 320));
    assert_eq!(options.dimensions(&media(0, "2:1")).unwrap(), (320, 90));
    let palette = Path::new("C:/owned/palette.png");
    let input = Path::new("C:/video & spaces/source.mov");
    let output = Path::new("C:/owned/output.gif");
    let first = args(input, output, palette, &source, options, true).unwrap();
    let second = args(input, output, palette, &source, options, false).unwrap();
    assert!(first
        .iter()
        .any(|a| a.contains("fps=10,scale=180:320:flags=lanczos,setsar=1,palettegen=")));
    assert!(second
        .iter()
        .any(|a| a.contains("[0:2]") && a.contains("paletteuse=dither=sierra2_4a")));
    assert!(second.windows(2).any(|w| w == ["-loop", "0"]));
    assert!(first
        .windows(2)
        .any(|w| w == ["-i", input.to_str().unwrap()]));
    for plan in [&first, &second] {
        assert!(plan.contains(&"-an".into()));
        for forbidden in [
            "-c:a",
            "-b:a",
            "-crf",
            "-preset",
            "-pix_fmt",
            "-movflags",
            "-vn",
            "-noautorotate",
        ] {
            assert!(!plan.iter().any(|a| a == forbidden), "{forbidden}");
        }
    }
    for bad in [
        GifOptions {
            max_edge: 1920,
            fps: 10,
        },
        GifOptions {
            max_edge: 480,
            fps: 0,
        },
    ] {
        assert!(bad.dimensions(&source).is_err());
    }
    let mut no_video = source.clone();
    no_video.video = None;
    assert!(options.dimensions(&no_video).is_err());
    let encoders = ["gif".to_string()].into();
    assert!(engine::availability(&encoders, OutputFormat::Gif, Some(&source), true).available);
    assert!(!engine::availability(&encoders, OutputFormat::Gif, Some(&no_video), true).available);
    assert!(!engine::availability(&encoders, OutputFormat::Gif, Some(&source), false).available);
}

fn engines() -> Engines {
    let (ffmpeg, ffprobe) = crate::bundled::test_sidecars().unwrap();
    engine::inspect_engines(ffmpeg, ffprobe, None, &NativeRunner, &Control::default()).unwrap()
}
fn run(engines: &Engines, args: &[String]) {
    let result = NativeRunner
        .run(
            &engines.ffmpeg,
            args,
            &Control::default(),
            Some(Duration::from_secs(30)),
            None,
        )
        .unwrap();
    assert!(result.success, "{}", result.stderr);
}
#[test]
fn bundled_engine_animated_gif_decodes_with_dimensions_timing_loop_and_rotation() {
    let dir = work();
    let engines = engines();
    let input = dir.path().join("source.mp4");
    let mut generate = [
        "-nostdin",
        "-y",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=640x360:rate=20:duration=0.6",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=0.6",
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
    generate.push(input.to_string_lossy().into_owned());
    run(&engines, &generate);
    let rotated = dir.path().join("rotated.mp4");
    let mut rotate = vec![
        "-nostdin".into(),
        "-y".into(),
        "-v".into(),
        "error".into(),
        "-display_rotation:v:0".into(),
        "90".into(),
        "-i".into(),
        input.to_string_lossy().into_owned(),
    ];
    rotate.extend(["-c", "copy"].map(String::from));
    rotate.push(rotated.to_string_lossy().into_owned());
    run(&engines, &rotate);
    let original = fs::read(&input).unwrap();
    for (source, fps, expected) in [(&input, 10, (320, 180)), (&rotated, 15, (180, 320))] {
        let source_info =
            engine::probe(&engines, source, &NativeRunner, &Control::default()).unwrap();
        let options = GifOptions { max_edge: 320, fps };
        assert_eq!(options.dimensions(&source_info).unwrap(), expected);
        let output = dir.path().join(format!("result-{fps}.gif"));
        let mut stages = Vec::new();
        convert_to(
            &engines,
            source,
            &output,
            &source_info,
            options,
            &Control::default(),
            &NativeRunner,
            None,
            |s| stages.push(s.to_string()),
        )
        .unwrap();
        assert_eq!(
            stages,
            vec!["palette", "encoding", "verifying", "publishing"]
        );
        let info = inspect(&output, &Control::default()).unwrap();
        assert_eq!((u32::from(info.width), u32::from(info.height)), expected);
        assert_eq!(info.loops, Some(0));
        assert!(info.frames >= 5);
        assert!((info.centiseconds as f64 / 100.0 - 0.6).abs() < 0.12);
        assert!(convert_to(
            &engines,
            source,
            &output,
            &source_info,
            options,
            &Control::default(),
            &NativeRunner,
            None,
            |_| {}
        )
        .unwrap_err()
        .contains("already exists"));
    }
    // Cancel from real encoder progress, exercising NativeRunner process reaping.
    let source_info = engine::probe(&engines, &input, &NativeRunner, &Control::default()).unwrap();
    let control = std::sync::Arc::new(Control::default());
    let cancel = control.clone();
    let cancelled = dir.path().join("real-cancel.gif");
    let result = convert_to(
        &engines,
        &input,
        &cancelled,
        &source_info,
        GifOptions::default(),
        &control,
        &NativeRunner,
        Some(Box::new(move |line| {
            if crate::conversion::progress_seconds(line).is_some() {
                cancel.cancel();
            }
        })),
        |_| {},
    );
    assert_eq!(result.unwrap_err(), CANCELLED);
    assert!(!cancelled.exists());
    // Publication still protects a file created after encoding/validation.
    let race = dir.path().join("race.gif");
    assert!(convert_to(
        &engines,
        &input,
        &race,
        &source_info,
        GifOptions::default(),
        &Control::default(),
        &NativeRunner,
        None,
        |s| {
            if s == "publishing" {
                fs::write(&race, b"rival").unwrap();
            }
        }
    )
    .is_err());
    assert_eq!(fs::read(&race).unwrap(), b"rival");
    assert_eq!(fs::read(input).unwrap(), original);
    assert!(!fs::read_dir(dir.path()).unwrap().any(|e| e
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".clip-clip-go-")));
}

struct StopRunner {
    calls: Mutex<usize>,
    stop_at: usize,
}
impl Runner for StopRunner {
    fn run(
        &self,
        _: &Path,
        args: &[String],
        control: &Control,
        _: Option<Duration>,
        _: Option<LineHandler>,
    ) -> Result<Captured> {
        let mut calls = self.calls.lock().unwrap();
        *calls += 1;
        fs::write(args.last().unwrap(), b"owned intermediate").unwrap();
        if *calls == self.stop_at {
            control.cancel();
            return Err(CANCELLED.into());
        }
        Ok(Captured {
            stdout: vec![],
            stderr: String::new(),
            success: true,
            exit_code: Some(0),
        })
    }
}
#[test]
fn cancellation_and_failed_validation_remove_all_intermediates() {
    let dir = work();
    let input = dir.path().join("input.mp4");
    fs::write(&input, b"original").unwrap();
    let engines = engines();
    let media = media(0, "1:1");
    for stop_at in [1, 2, 99] {
        let output = dir.path().join(format!("cancel-{stop_at}.gif"));
        let result = convert_to(
            &engines,
            &input,
            &output,
            &media,
            GifOptions::default(),
            &Control::default(),
            &StopRunner {
                calls: Mutex::new(0),
                stop_at,
            },
            None,
            |_| {},
        );
        if stop_at < 99 {
            assert_eq!(result.unwrap_err(), CANCELLED);
        } else {
            assert!(result.unwrap_err().contains("validation failed"));
        }
        assert!(!output.exists());
        assert_eq!(fs::read(&input).unwrap(), b"original");
        assert!(!fs::read_dir(dir.path()).unwrap().any(|e| e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".clip-clip-go-")));
    }
}
