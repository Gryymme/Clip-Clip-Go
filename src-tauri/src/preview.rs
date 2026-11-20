//! Bounded, session-owned thumbnails. Only authorized selections; no temp files,
//! filesystem URL exposure, shell, network protocols or conversion-slot ownership.
use crate::{
    engine::{self, Engines},
    process::{Control, NativeRunner, Result, Runner, CANCELLED},
};
use base64::{prelude::BASE64_STANDARD, Engine};
use serde::Serialize;
use std::{
    io::Cursor,
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};
const WIDTH: u32 = 320;
const HEIGHT: u32 = 240;
const MAX_BYTES: usize = 384 * 1024;
#[derive(Default)]
struct Inner {
    latest: u64,
    active: Option<(u64, Arc<Control>)>,
}
#[derive(Clone, Default)]
pub struct Previews {
    inner: Arc<Mutex<Inner>>,
    serial: Arc<Mutex<()>>,
}
impl Previews {
    fn begin(&self, id: u64) -> Result<Arc<Control>> {
        let mut inner = self.inner.lock().unwrap();
        if id <= inner.latest {
            return Err(CANCELLED.into());
        }
        inner.latest = id;
        let control = Arc::new(Control::default());
        let previous = inner.active.replace((id, control.clone()));
        drop(inner);
        if let Some((_, previous)) = previous {
            previous.cancel();
        }
        Ok(control)
    }
    fn finish(&self, id: u64) {
        let mut inner = self.inner.lock().unwrap();
        if inner
            .active
            .as_ref()
            .is_some_and(|(active, _)| *active == id)
        {
            inner.active = None;
        }
    }
    fn cancel(&self, id: u64) {
        let mut inner = self.inner.lock().unwrap();
        inner.latest = inner.latest.max(id);
        if inner
            .active
            .as_ref()
            .is_some_and(|(active, _)| *active <= id)
        {
            let (_, control) = inner.active.take().unwrap();
            drop(inner);
            control.cancel();
        }
    }
    pub fn cancel_all(&self) {
        let active = self.inner.lock().unwrap().active.take();
        if let Some((_, control)) = active {
            control.cancel();
        }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Thumbnail {
    pub data_url: String,
    pub width: u32,
    pub height: u32,
    pub source_width: Option<u32>,
    pub source_height: Option<u32>,
}
fn png(bytes: Vec<u8>, control: &Control) -> Result<Thumbnail> {
    control.check()?;
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err("Preview exceeded its size budget.".into());
    }
    let mut reader = image::ImageReader::with_format(Cursor::new(&bytes), image::ImageFormat::Png);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(WIDTH);
    limits.max_image_height = Some(HEIGHT);
    limits.max_alloc = Some(2 * 1024 * 1024);
    reader.limits(limits);
    let image = reader
        .decode()
        .map_err(|_| "Preview could not be decoded within its limits.")?;
    control.check()?;
    Ok(Thumbnail {
        data_url: format!("data:image/png;base64,{}", BASE64_STANDARD.encode(bytes)),
        width: image.width(),
        height: image.height(),
        source_width: None,
        source_height: None,
    })
}
fn image_preview(path: &Path, control: &Control) -> Result<Thumbnail> {
    let decoded = crate::images::decode(path, control)?;
    control.check()?;
    let (width, height) = decoded.pixels.dimensions();
    let thumbnail = image::DynamicImage::ImageRgba8(decoded.pixels).thumbnail(WIDTH, HEIGHT);
    let mut bytes = Cursor::new(Vec::new());
    thumbnail
        .write_to(&mut bytes, image::ImageFormat::Png)
        .map_err(|_| "Could not encode image preview.")?;
    let mut result = png(bytes.into_inner(), control)?;
    result.source_width = Some(width);
    result.source_height = Some(height);
    Ok(result)
}
fn frame_args(path: &Path, index: u32, seek: f64) -> Vec<String> {
    let mut args = [
        "-hide_banner",
        "-nostdin",
        "-loglevel",
        "error",
        "-max_alloc",
        "134217728",
        "-threads",
        "1",
        "-filter_threads",
        "1",
        "-max_pixels",
        "16000000",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        "mov,matroska,webm,mp3,wav,flac,ogg",
        "-ss",
    ]
    .map(String::from)
    .to_vec();
    args.extend([
        format!("{seek:.3}"),
        "-i".into(),
        path.to_string_lossy().into_owned(),
        "-map".into(),
        format!("0:{index}"),
    ]);
    args.extend(
        [
            "-an",
            "-sn",
            "-dn",
            "-frames:v",
            "1",
            "-vf",
            "scale=320:240:force_original_aspect_ratio=decrease:reset_sar=1",
            "-pix_fmt",
            "rgb24",
            "-threads",
            "1",
            "-f",
            "image2pipe",
            "-c:v",
            "png",
            "pipe:1",
        ]
        .map(String::from),
    );
    args
}
fn video_preview(
    path: &Path,
    engines: &Engines,
    control: &Control,
    runner: &dyn Runner,
) -> Result<Thumbnail> {
    let info = engine::probe(engines, path, runner, control)?;
    let index = info
        .video
        .ok_or("No actual video frame is available.")?
        .index;
    let seek = info.duration.map(|d| (d * 0.1).min(5.0)).unwrap_or(0.0);
    for time in [seek, 0.0] {
        control.check()?;
        let result = runner.run(
            &engines.ffmpeg,
            &frame_args(path, index, time),
            control,
            Some(Duration::from_secs(8)),
            None,
        )?;
        control.check()?;
        if result.success && !result.stdout.is_empty() {
            return png(result.stdout, control);
        }
        if seek == 0.0 {
            break;
        }
    }
    Err("No preview frame could be generated. Conversion is still available.".into())
}
#[tauri::command]
pub async fn generate_preview(
    state: tauri::State<'_, crate::conversion::Runtime>,
    input_path: String,
    request_id: u64,
) -> Result<Thumbnail> {
    let path = state.core.authorize(&input_path)?;
    let is_image = crate::images::is_image_input(&path);
    if !is_image && !engine::is_video_input(&path).unwrap_or(false) {
        return Err("Only image and video thumbnails are supported.".into());
    }
    if state.core.busy() {
        return Err("Preview deferred while a conversion is active.".into());
    }
    let engines = if is_image {
        None
    } else {
        Some(state.core.engines()?)
    };
    let previews = state.previews.clone();
    let control = previews.begin(request_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let result = (|| {
            let _serial = previews.serial.lock().unwrap();
            control.check()?;
            if is_image {
                image_preview(&path, &control)
            } else {
                video_preview(&path, engines.as_ref().unwrap(), &control, &NativeRunner)
            }
        })();
        previews.finish(request_id);
        result
    })
    .await
    .map_err(|_| "Preview generation failed; conversion remains available.".to_string())?
}
#[tauri::command]
pub fn cancel_preview(state: tauri::State<'_, crate::conversion::Runtime>, request_id: u64) {
    state.previews.cancel(request_id);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn requests_cancel_only_owned_work_and_fence_late_starts() {
        let p = Previews::default();
        p.cancel(1);
        assert!(p.begin(1).is_err());
        let a = p.begin(2).unwrap();
        let b = p.begin(3).unwrap();
        assert!(a.check().is_err());
        p.cancel(2);
        assert!(b.check().is_ok());
        p.finish(2);
        p.cancel_all();
        assert!(b.check().is_err());
    }
    #[test]
    fn images_are_bounded_and_cancellation_is_checked() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/preview-tests");
        std::fs::create_dir_all(&root).unwrap();
        let dir = tempfile::tempdir_in(root).unwrap();
        let path = dir.path().join("wide.png");
        image::RgbaImage::from_pixel(1200, 600, image::Rgba([255, 0, 0, 128]))
            .save(&path)
            .unwrap();
        let c = Control::default();
        let result = image_preview(&path, &c).unwrap();
        assert_eq!((result.width, result.height), (320, 160));
        assert!(result.data_url.len() < MAX_BYTES * 2);
        c.cancel();
        assert_eq!(image_preview(&path, &c).err().unwrap(), CANCELLED);
    }
    #[test]
    fn frame_arguments_are_fixed_and_exclude_extra_streams() {
        let args = frame_args(Path::new("a file.mp4"), 3, 1.25);
        assert!(args.windows(2).any(|p| p == ["-map", "0:3"]));
        assert!(args
            .windows(2)
            .any(|p| p == ["-protocol_whitelist", "file,pipe"]));
        assert!(args.contains(&"-an".into()));
        assert!(args.contains(&"-sn".into()));
        assert_eq!(args.last().unwrap(), "pipe:1");
    }
    #[test]
    fn bundled_video_frame_is_real_and_bounded() {
        let (ffmpeg, ffprobe) = crate::bundled::test_sidecars().unwrap();
        let control = Control::default();
        let runner = NativeRunner;
        let engines = engine::inspect_engines(ffmpeg, ffprobe, None, &runner, &control).unwrap();
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/preview-tests");
        std::fs::create_dir_all(&root).unwrap();
        let dir = tempfile::tempdir_in(root).unwrap();
        let path = dir.path().join("fixture.mp4");
        let mut args = [
            "-hide_banner",
            "-nostdin",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=96x64:rate=4",
            "-t",
            "1",
            "-an",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
        ]
        .map(String::from)
        .to_vec();
        args.push(path.to_string_lossy().into_owned());
        let generated = runner
            .run(
                &engines.ffmpeg,
                &args,
                &control,
                Some(Duration::from_secs(30)),
                None,
            )
            .unwrap();
        assert!(generated.success, "{}", generated.stderr);
        let original = std::fs::read(&path).unwrap();
        let result = video_preview(&path, &engines, &control, &runner).unwrap();
        assert!(result.width <= WIDTH && result.height <= HEIGHT);
        let bytes = BASE64_STANDARD
            .decode(result.data_url.split(',').nth(1).unwrap())
            .unwrap();
        let raster = image::load_from_memory(&bytes).unwrap().to_rgb8();
        assert!(raster.pixels().any(|p| p[0] > 180));
        assert!(raster.pixels().any(|p| p[2] > 180));
        assert_eq!(original, std::fs::read(path).unwrap());
    }
    #[test]
    fn image_thumbnail_applies_exif_orientation() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/preview-tests");
        std::fs::create_dir_all(&root).unwrap();
        let dir = tempfile::tempdir_in(root).unwrap();
        let path = dir.path().join("oriented.jpg");
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new(&mut jpeg)
            .encode_image(&image::DynamicImage::ImageRgb8(
                image::RgbImage::from_pixel(40, 20, image::Rgb([255, 0, 0])),
            ))
            .unwrap();
        let tiff = b"II*\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0\x06\0\0\0\0\0\0\0";
        let mut oriented = jpeg[..2].to_vec();
        oriented.extend([0xff, 0xe1]);
        oriented.extend(((tiff.len() + 8) as u16).to_be_bytes());
        oriented.extend(b"Exif\0\0");
        oriented.extend(tiff);
        oriented.extend(&jpeg[2..]);
        std::fs::write(&path, oriented).unwrap();
        let result = image_preview(&path, &Control::default()).unwrap();
        assert!(result.height > result.width);
    }
}
