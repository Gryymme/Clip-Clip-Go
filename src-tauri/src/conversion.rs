use crate::{
    engine::{self, EngineReport, Engines, MediaInfo, OutputFormat, FORMATS},
    process::{Control, LineHandler, NativeRunner, Result, Runner, CANCELLED},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri_plugin_dialog::DialogExt;

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum JobPhase {
    Validating,
    Running,
    Verifying,
    Cancelling,
    Succeeded,
    Failed,
    Cancelled,
}
impl JobPhase {
    fn busy(&self) -> bool {
        !matches!(self, Self::Succeeded | Self::Failed | Self::Cancelled)
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: u64,
    pub revision: u64,
    pub phase: JobPhase,
    pub input_path: String,
    pub destination: Option<String>,
    pub format: OutputFormat,
    pub duration: Option<f64>,
    pub seconds: f64,
    pub percent: Option<f64>,
    pub pages_done: Option<u16>,
    pub pages_total: Option<u16>,
    pub message: String,
}
#[derive(Default)]
struct Inner {
    engines: Option<Engines>,
    report: Option<EngineReport>,
    active: Option<Arc<Control>>,
    job: Option<Job>,
    selected: HashSet<PathBuf>,
    destinations: HashSet<PathBuf>,
    outputs: HashSet<PathBuf>,
    inspections: Vec<Arc<Control>>,
}
#[derive(Default)]
pub struct Core {
    inner: Mutex<Inner>,
    sequence: AtomicU64,
    stopping: AtomicBool,
}
#[derive(Default)]
pub struct Runtime {
    pub core: Arc<Core>,
    pub previews: crate::preview::Previews,
    pub drops: Mutex<Vec<PathBuf>>,
}
pub(crate) struct Operation {
    core: Arc<Core>,
    pub(crate) control: Arc<Control>,
}
impl Drop for Operation {
    fn drop(&mut self) {
        let mut inner = self.core.inner.lock().unwrap();
        inner.inspections.retain(|c| !Arc::ptr_eq(c, &self.control));
        if inner
            .active
            .as_ref()
            .is_some_and(|c| Arc::ptr_eq(c, &self.control))
        {
            inner.active = None;
        }
    }
}
impl Core {
    pub fn record_output(&self, path: &Path) {
        self.inner.lock().unwrap().outputs.insert(path.to_owned());
    }
    pub fn owned_output(&self, path: &Path) -> bool {
        self.inner.lock().unwrap().outputs.contains(path)
    }
    pub fn stop_submissions(&self) {
        self.stopping.store(true, Ordering::SeqCst);
    }
    pub(crate) fn reserve(self: &Arc<Self>) -> Result<Operation> {
        let mut inner = self.inner.lock().unwrap();
        if self.stopping.load(Ordering::SeqCst) {
            return Err("The application is closing.".into());
        }
        if inner.active.is_some() {
            return Err("Another engine operation is in progress. Wait for it to finish.".into());
        }
        let control = Arc::new(Control::default());
        inner.active = Some(control.clone());
        Ok(Operation {
            core: self.clone(),
            control,
        })
    }
    pub(crate) fn inspect(self: &Arc<Self>) -> Result<Operation> {
        let mut inner = self.inner.lock().unwrap();
        if self.stopping.load(Ordering::SeqCst) {
            return Err("The application is closing.".into());
        }
        let control = Arc::new(Control::default());
        inner.inspections.push(control.clone());
        Ok(Operation {
            core: self.clone(),
            control,
        })
    }
    pub fn settled(&self) -> bool {
        let inner = self.inner.lock().unwrap();
        inner.active.is_none() && inner.inspections.is_empty()
    }
    fn destination(&self, path: &str) -> Result<PathBuf> {
        let path = PathBuf::from(path);
        if !self.inner.lock().unwrap().destinations.contains(&path) {
            return Err("Choose the destination in the app's Save dialog.".into());
        }
        if path.exists() || !path.parent().is_some_and(|p| p.is_dir()) {
            return Err(
                "The destination exists or its folder is inaccessible. Choose a new destination."
                    .into(),
            );
        }
        Ok(path)
    }
    pub fn busy(&self) -> bool {
        self.inner.lock().unwrap().active.is_some()
    }
    pub fn remember(&self, path: &Path) {
        if let Ok(path) = path.canonicalize() {
            self.inner.lock().unwrap().selected.insert(path);
        }
    }
    pub(crate) fn authorize(&self, path: &str) -> Result<PathBuf> {
        let path = Path::new(path).canonicalize().map_err(|_| {
            "The input file is missing or inaccessible. Select it again.".to_string()
        })?;
        if !self.inner.lock().unwrap().selected.contains(&path) {
            return Err(
                "Select the input using the app's file dialog before converting it.".into(),
            );
        }
        Ok(path)
    }
    pub(crate) fn engines(&self) -> Result<Engines> {
        self.inner.lock().unwrap().engines.clone().ok_or_else(|| {
            "Bundled conversion engines are unavailable. Repair or reinstall Clip-Clip-Go.".into()
        })
    }
    fn update(&self, id: u64, change: impl FnOnce(&mut Job)) {
        if let Some(job) = self.inner.lock().unwrap().job.as_mut() {
            if job.id == id {
                change(job);
                job.revision += 1;
            }
        }
    }
    fn job(&self) -> Option<Job> {
        self.inner.lock().unwrap().job.clone()
    }
    pub fn shutdown(&self) {
        let controls = {
            let inner = self.inner.lock().unwrap();
            inner
                .active
                .iter()
                .chain(inner.inspections.iter())
                .cloned()
                .collect::<Vec<_>>()
        };
        for control in controls {
            control.cancel();
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EngineSource {
    Current,
    Bundled,
}
#[tauri::command]
pub async fn configure_engines(
    state: tauri::State<'_, Runtime>,
    source: EngineSource,
) -> Result<EngineReport> {
    let core = state.core.clone();
    let operation = core.inspect()?;
    tauri::async_runtime::spawn_blocking(move || {
        if matches!(source, EngineSource::Current) {
            if let Some(report) = core.inner.lock().unwrap().report.clone() {
                return Ok(report);
            }
        }
        let inspected = crate::bundled::resolve().and_then(|(ffmpeg, ffprobe)| {
            engine::inspect_engines(ffmpeg, ffprobe, None, &NativeRunner, &operation.control)
        });
        let mut inner = core.inner.lock().unwrap();
        match inspected {
            Ok(engines) => {
                let report = engines.report.clone();
                inner.engines = Some(engines);
                inner.report = Some(report.clone());
                Ok(report)
            }
            Err(message) => {
                let report = EngineReport::missing(message);
                inner.engines = None;
                inner.report = Some(report.clone());
                Ok(report)
            }
        }
    })
    .await
    .map_err(|_| {
        "Bundled engines could not be checked. Restart the app or repair the installation."
            .to_string()
    })?
}

#[tauri::command]
pub async fn probe_media(
    state: tauri::State<'_, Runtime>,
    input_path: String,
) -> Result<MediaInfo> {
    let core = state.core.clone();
    let path = core.authorize(&input_path)?;
    engine::is_video_input(&path)?;
    let engines = core.engines()?;
    let operation = core.inspect()?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut info = engine::probe(&engines, &path, &NativeRunner, &operation.control)?;
        let video_input = engine::is_video_input(&path)?;
        info.formats = FORMATS
            .iter()
            .map(|&f| engine::availability(&engines.encoders, f, Some(&info), video_input))
            .collect();
        Ok(info)
    })
    .await
    .map_err(|_| "Media inspection could not be completed.".to_string())?
}

#[tauri::command]
pub async fn probe_image(
    state: tauri::State<'_, Runtime>,
    input_path: String,
) -> Result<crate::images::ImageInfo> {
    let core = state.core.clone();
    let path = core.authorize(&input_path)?;
    if !crate::images::is_image_input(&path) {
        return Err("Select a supported image file.".into());
    }
    let operation = core.inspect()?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::images::decode(&path, &operation.control).map(|decoded| decoded.info)
    })
    .await
    .map_err(|_| {
        "Image inspection could not be completed. Choose a smaller or different image.".to_string()
    })?
}

#[tauri::command]
pub async fn probe_pdf(
    state: tauri::State<'_, Runtime>,
    input_path: String,
) -> Result<crate::pdf::PdfInfo> {
    let core = state.core.clone();
    let path = core.authorize(&input_path)?;
    if !crate::pdf::is_input(&path) {
        return Err("Choose a PDF file.".into());
    }
    let operation = core.inspect()?;
    tauri::async_runtime::spawn_blocking(move || crate::pdf::inspect(&path, &operation.control))
        .await
        .map_err(|_| "PDF inspection failed.")?
}

pub fn command_args(
    input: &Path,
    temp: &Path,
    format: OutputFormat,
    media: &MediaInfo,
) -> Result<Vec<String>> {
    if format == OutputFormat::Gif {
        return Err("GIF requires the typed palette conversion plan.".into());
    }
    if format.image() || format.text() || format == OutputFormat::Pdf {
        return Err("Image formats cannot use the audio/video runner.".into());
    }
    let mut args: Vec<String> = [
        "-hide_banner",
        "-nostdin",
        "-y",
        "-loglevel",
        "error",
        "-nostats",
        "-progress",
        "pipe:1",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        "mov,matroska,webm,mp3,wav,flac,ogg",
        "-i",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    args.push(input.to_string_lossy().into_owned());
    let (video_codec, audio_codec) = format.codecs();
    if format.video() {
        let video = media
            .video
            .as_ref()
            .ok_or("No actual video stream is available.")?;
        args.extend([
            "-map".into(),
            format!("0:{}", video.index),
            "-c:v".into(),
            video_codec.unwrap().into(),
        ]);
        args.extend(
            [
                "-pix_fmt",
                "yuv420p",
                "-vf",
                "scale=ceil(iw/2)*2:ceil(ih/2)*2",
            ]
            .map(String::from),
        );
        if format == OutputFormat::Webm {
            args.extend(
                [
                    "-crf",
                    "32",
                    "-b:v",
                    "0",
                    "-deadline",
                    "good",
                    "-cpu-used",
                    "2",
                ]
                .map(String::from),
            );
        } else {
            args.extend(["-preset", "medium", "-crf", "23"].map(String::from));
        }
    } else {
        args.push("-vn".into());
    }
    if let Some(audio) = media.audio.as_ref() {
        args.extend([
            "-map".into(),
            format!("0:{}", audio.index),
            "-c:a".into(),
            audio_codec.into(),
        ]);
        match format {
            OutputFormat::Mp3 => args.extend(["-q:a", "2", "-ac", "2"].map(String::from)),
            OutputFormat::Flac => args.extend(["-compression_level", "5"].map(String::from)),
            OutputFormat::Wav => {}
            OutputFormat::Webm => args.extend(["-b:a", "128k"].map(String::from)),
            _ => args.extend(["-b:a", "192k"].map(String::from)),
        }
    } else if !format.video() {
        return Err("This file has no audio stream to convert or extract.".into());
    }
    args.extend(["-sn", "-dn", "-map_metadata", "-1", "-map_chapters", "-1"].map(String::from));
    if matches!(format, OutputFormat::Mp4 | OutputFormat::M4a) {
        args.extend(["-movflags", "+faststart"].map(String::from));
    }
    let container = match format {
        OutputFormat::Mkv => "matroska",
        OutputFormat::M4a => "ipod",
        _ => format.extension(),
    };
    args.extend([
        "-f".into(),
        container.into(),
        temp.to_string_lossy().into_owned(),
    ]);
    Ok(args)
}

pub fn progress_seconds(line: &str) -> Option<f64> {
    let (key, value) = line.trim().split_once('=')?;
    let seconds = match key {
        "out_time_us" => value.parse::<f64>().ok()? / 1_000_000.0,
        "out_time" => {
            let parts: Vec<_> = value.split(':').collect();
            if parts.len() != 3 {
                return None;
            }
            parts[0].parse::<f64>().ok()? * 3600.0
                + parts[1].parse::<f64>().ok()? * 60.0
                + parts[2].parse::<f64>().ok()?
        }
        _ => return None,
    };
    (seconds.is_finite() && seconds >= 0.0).then_some(seconds)
}

pub fn destination_path(input: &Path, chosen: &Path, format: OutputFormat) -> Result<PathBuf> {
    let mut destination = chosen.to_path_buf();
    destination.set_extension(format.extension());
    let parent = destination
        .parent()
        .ok_or("Choose a destination folder.")?
        .canonicalize()
        .map_err(|_| "The destination folder is missing or inaccessible.".to_string())?;
    if !parent.is_dir() {
        return Err("Choose a valid destination folder.".into());
    }
    destination = parent.join(
        destination
            .file_name()
            .ok_or("Choose a destination filename.")?,
    );
    let input = input
        .canonicalize()
        .map_err(|_| "The input file is missing or inaccessible.".to_string())?;
    let identical = if cfg!(windows) {
        input
            .to_string_lossy()
            .eq_ignore_ascii_case(&destination.to_string_lossy())
    } else {
        input == destination
    };
    if identical {
        return Err("The destination is the input file. Choose a different filename to preserve the original.".into());
    }
    match std::fs::symlink_metadata(&destination){
        Ok(_)=>return Err("That destination already exists. Choose another filename; existing files are never overwritten.".into()),
        Err(error) if error.kind()==std::io::ErrorKind::NotFound=>{},
        Err(_)=>return Err("The destination could not be checked. Choose another filename or folder.".into()),
    }
    Ok(destination)
}

fn validate_output(format: OutputFormat, input: &MediaInfo, output: &MediaInfo) -> Result<()> {
    let expected_video = match format {
        OutputFormat::Mp4 | OutputFormat::Mkv => Some("h264"),
        OutputFormat::Webm => Some("vp9"),
        _ => None,
    };
    let expected_audio = match format {
        OutputFormat::Webm => "opus",
        OutputFormat::Mp3 => "mp3",
        OutputFormat::Wav => "pcm_s16le",
        OutputFormat::Flac => "flac",
        _ => "aac",
    };
    if expected_video.is_some_and(|codec| output.video.as_ref().is_none_or(|s| s.codec != codec))
        || ((!format.video() || input.audio.is_some())
            && output
                .audio
                .as_ref()
                .is_none_or(|s| s.codec != expected_audio))
    {
        return Err("The output did not contain the expected encoded streams. No destination file was published.".into());
    }
    let required = match format {
        OutputFormat::Mp4 | OutputFormat::M4a => "mov",
        OutputFormat::Mkv | OutputFormat::Webm => "matroska",
        _ => format.extension(),
    };
    if !output.container.split(',').any(|s| s == required) {
        return Err(
            "The output container could not be validated. No destination file was published."
                .into(),
        );
    }
    Ok(())
}

// The image writer receives the already-open handle, so cancellation cannot unlink
// the staging path and then have an encoder recreate an unowned file at that path.
pub struct StagedOutput<'a> {
    control: &'a Control,
    pub file: Option<std::fs::File>,
    pub path: PathBuf,
    destination: PathBuf,
}
impl Drop for StagedOutput<'_> {
    fn drop(&mut self) {
        drop(self.file.take());
        self.control.cleanup();
    }
}
impl StagedOutput<'_> {
    pub fn publish(self) -> Result<PathBuf> {
        let _publication = self.control.publication.lock().unwrap();
        self.control.check()?;
        let temporary = self
            .control
            .temporary
            .lock()
            .unwrap()
            .take()
            .ok_or(CANCELLED)?;
        temporary.persist_noclobber(&self.destination).map_err(|_| "Could not publish the output. The destination may now exist or be inaccessible. Choose another filename.".to_string())?;
        Ok(self.destination.clone())
    }
}
pub fn stage_output<'a>(
    input: &Path,
    chosen: &Path,
    format: OutputFormat,
    control: &'a Control,
) -> Result<StagedOutput<'a>> {
    control.check()?;
    let destination = destination_path(input, chosen, format)?;
    let temporary = tempfile::Builder::new()
        .prefix(".clip-clip-go-")
        .suffix(&format!(".{}", format.extension()))
        .tempfile_in(destination.parent().unwrap())
        .map_err(|_| {
            "Cannot create a temporary file beside the destination. Check folder permissions."
                .to_string()
        })?;
    let (file, path) = temporary.into_parts();
    let staged = StagedOutput {
        control,
        file: Some(file),
        path: path.to_path_buf(),
        destination,
    };
    *control.temporary.lock().unwrap() = Some(path);
    control.check()?;
    Ok(staged)
}

pub fn convert_to(
    engines: &Engines,
    input: &Path,
    chosen: &Path,
    format: OutputFormat,
    media: &MediaInfo,
    control: &Control,
    runner: &dyn Runner,
    progress: Option<LineHandler>,
    verifying: impl FnOnce(),
) -> Result<PathBuf> {
    control.check()?;
    let available = engine::availability(
        &engines.encoders,
        format,
        Some(media),
        engine::is_video_input(input)?,
    );
    if let Some(reason) = available.reason {
        return Err(reason);
    }
    let mut staged = stage_output(input, chosen, format, control)?;
    drop(staged.file.take());
    let temporary_path = staged.path.clone();
    let args = command_args(input, &temporary_path, format, media)?;
    let result = runner.run(&engines.ffmpeg, &args, control, None, progress)?;
    control.check()?;
    if !result.success {
        let detail = result
            .stderr
            .lines()
            .filter(|s| !s.trim().is_empty())
            .take(3)
            .collect::<Vec<_>>()
            .join(" ");
        return Err(format!(
            "FFmpeg could not complete the conversion. {}",
            detail.chars().take(600).collect::<String>()
        ));
    }
    verifying();
    if std::fs::metadata(&temporary_path)
        .map(|m| m.len())
        .unwrap_or(0)
        == 0
    {
        return Err("FFmpeg produced an empty output. No destination file was published.".into());
    }
    let output = engine::probe(engines, &temporary_path, runner, control)?;
    validate_output(format, media, &output)?;
    staged.publish()
}

#[tauri::command]
pub fn start_conversion(
    state: tauri::State<'_, Runtime>,
    output_path: String,
    input_path: String,
    format: OutputFormat,
    pdf_options: Option<crate::pdf::PdfOptions>,
    gif_options: Option<crate::gif::GifOptions>,
) -> Result<Job> {
    let core = state.core.clone();
    state.previews.cancel_all();
    let input = core.authorize(&input_path)?;
    let image_input = crate::images::is_image_input(&input);
    let pdf_input = crate::pdf::is_input(&input);
    let pdf_route = crate::pdf::route(&input, format);
    let text_input = crate::text::input_kind(&input).is_some();
    if (text_input && !crate::text::route(&input, format) && !pdf_route)
        || (pdf_input && !pdf_route)
    {
        return Err("Choose a supported, different text/PDF output format.".into());
    }
    if !text_input
        && !pdf_input
        && (image_input != format.image() || format.text() || format == OutputFormat::Pdf)
    {
        return Err("Choose an output appropriate for the selected input category.".into());
    }
    if !image_input && !text_input && !pdf_input {
        engine::is_video_input(&input)?;
    }
    let engines = if image_input || text_input || pdf_input {
        None
    } else {
        Some(core.engines()?)
    };
    let chosen = core.destination(&output_path)?;
    let operation = core.reserve()?;
    let id = core.sequence.fetch_add(1, Ordering::SeqCst) + 1;
    let job = Job {
        id,
        revision: 0,
        phase: JobPhase::Validating,
        input_path,
        destination: None,
        format,
        duration: None,
        seconds: 0.0,
        percent: None,
        pages_done: None,
        pages_total: None,
        message: if pdf_input {
            "Validating the PDF…".into()
        } else if text_input {
            "Parsing and preparing the text document…".into()
        } else if image_input {
            "Decoding and validating the selected image…".into()
        } else {
            "Validating the selected media…".into()
        },
    };
    core.inner.lock().unwrap().job = Some(job.clone());
    std::thread::spawn(move || {
        let result = (|| -> Result<PathBuf> {
            let text = if text_input && !pdf_route {
                Some(crate::text::render(&input, format, &operation.control)?)
            } else {
                None
            };
            let image = if image_input {
                Some(crate::images::decode(&input, &operation.control)?)
            } else {
                None
            };
            let media = if let Some(engines) = engines.as_ref() {
                let media = engine::probe(engines, &input, &NativeRunner, &operation.control)?;
                if let Some(reason) = engine::availability(
                    &engines.encoders,
                    format,
                    Some(&media),
                    engine::is_video_input(&input)?,
                )
                .reason
                {
                    return Err(reason);
                }
                if format == OutputFormat::Gif {
                    gif_options.unwrap_or_default().dimensions(&media)?;
                }
                Some(media)
            } else {
                None
            };
            if pdf_input {
                crate::pdf::inspect(&input, &operation.control)?;
            }
            operation.control.check()?;
            core.update(id, |j| {
                j.phase = JobPhase::Validating;
                j.duration = media.as_ref().and_then(|m| m.duration);
                j.message = "Rechecking queued input and destination…".into();
            });
            let folder_output = pdf_input && format.image();
            let destination = if folder_output {
                chosen.clone()
            } else {
                destination_path(&input, &chosen, format)?
            };
            core.update(id, |j| {
                j.phase = JobPhase::Running;
                j.destination = Some(destination.to_string_lossy().into_owned());
                j.message = "Converting…".into();
            });
            if pdf_route {
                let mut page_progress = |done: u16, total: u16| {
                    core.update(id, |j| {
                        if j.phase != JobPhase::Cancelling {
                            j.pages_done = Some(done);
                            j.pages_total = Some(total);
                            j.percent = Some(f64::from(done) / f64::from(total) * 100.0);
                            j.message = format!(
                                "Processed page {done} of {total}. Validating before publication…"
                            );
                        }
                    });
                };
                if pdf_input && format.image() {
                    return crate::pdf::render_pages(
                        &input,
                        &destination,
                        format,
                        &pdf_options.unwrap_or_default(),
                        &operation.control,
                        &mut page_progress,
                    );
                }
                if format == OutputFormat::Pdf {
                    return crate::pdf::generate(
                        &input,
                        &destination,
                        &operation.control,
                        &mut page_progress,
                    );
                }
                let extracted =
                    crate::pdf::extract(&input, format, &operation.control, &mut page_progress)?;
                return crate::text::publish(
                    extracted,
                    &input,
                    &destination,
                    format,
                    &operation.control,
                    |_| {},
                );
            }
            if let Some(text) = text {
                return crate::text::publish(
                    text,
                    &input,
                    &destination,
                    format,
                    &operation.control,
                    |stage| {
                        core.update(id, |j| {
                            if j.phase == JobPhase::Cancelling {
                                return;
                            }
                            j.phase = if stage == "writing" {
                                JobPhase::Running
                            } else {
                                JobPhase::Verifying
                            };
                            j.message = match stage {
                                "writing" => "Writing the converted document…",
                                "verifying" => "Validating the UTF-8 output…",
                                _ => "Publishing the validated document…",
                            }
                            .into();
                        })
                    },
                );
            }
            if let Some(image) = image {
                return crate::images::convert_to(
                    image,
                    &input,
                    &destination,
                    format,
                    &operation.control,
                    |stage| {
                        core.update(id, |j| {
                            if j.phase == JobPhase::Cancelling {
                                return;
                            }
                            j.phase = if stage == "encoding" {
                                JobPhase::Running
                            } else {
                                JobPhase::Verifying
                            };
                            j.message = match stage {
                                "encoding" => "Encoding image…",
                                "verifying" => {
                                    "Decoding the output to validate its format and dimensions…"
                                }
                                _ => "Publishing the validated image…",
                            }
                            .into();
                        });
                    },
                );
            }
            let media = media.ok_or("Media inspection did not complete.")?;
            let engines = engines
                .as_ref()
                .ok_or("Bundled media engines are unavailable.")?;
            let progress_core = core.clone();
            let progress: LineHandler = Box::new(move |line| {
                if let Some(seconds) = progress_seconds(line) {
                    progress_core.update(id, |j| {
                        if j.phase == JobPhase::Running {
                            j.seconds = j.seconds.max(seconds);
                            j.percent =
                                j.duration.map(|d| (j.seconds / d * 100.0).clamp(0.0, 99.0));
                        }
                    });
                }
            });
            if format == OutputFormat::Gif {
                return crate::gif::convert_to(
                    engines,
                    &input,
                    &destination,
                    &media,
                    gif_options.unwrap_or_default(),
                    &operation.control,
                    &NativeRunner,
                    Some(progress),
                    |stage| {
                        core.update(id, |j| {
                            if j.phase == JobPhase::Cancelling {
                                return;
                            }
                            j.seconds = 0.0;
                            j.percent = None;
                            j.phase = if stage == "verifying" || stage == "publishing" {
                                JobPhase::Verifying
                            } else {
                                JobPhase::Running
                            };
                            j.message = match stage {
                                "palette" => "Analyzing clip colors to generate a GIF palette…",
                                "encoding" => "Encoding animated GIF with the generated palette…",
                                "verifying" => {
                                    "Validating GIF frames, dimensions, timing and continuous loop…"
                                }
                                _ => "Publishing validated GIF…",
                            }
                            .into();
                        });
                    },
                );
            }
            convert_to(
                &engines,
                &input,
                &destination,
                format,
                &media,
                &operation.control,
                &NativeRunner,
                Some(progress),
                || {
                    core.update(id, |j| {
                        j.phase = JobPhase::Verifying;
                        j.message = "Validating the completed output…".into();
                    });
                },
            )
        })();
        // A terminal snapshot must imply that the native operation slot is free.
        if let Ok(path) = &result {
            core.record_output(path);
        }
        operation.control.cleanup();
        drop(operation);
        core.update(id, |j| match result {
            Ok(path) => {
                j.phase = JobPhase::Succeeded;
                j.percent = if image_input || text_input || pdf_input {
                    None
                } else {
                    Some(100.0)
                };
                j.destination = Some(path.to_string_lossy().into_owned());
                j.message = "Conversion completed and output validated.".into();
            }
            Err(message) => {
                j.phase = if message == CANCELLED {
                    JobPhase::Cancelled
                } else {
                    JobPhase::Failed
                };
                j.message = message;
            }
        });
    });
    Ok(job)
}

#[tauri::command]
pub fn start_images_pdf(
    state: tauri::State<'_, Runtime>,
    output_path: String,
    input_paths: Vec<String>,
    page_size: crate::pdf::ImagePageSize,
) -> Result<Job> {
    state.previews.cancel_all();
    if input_paths.is_empty() || input_paths.len() > 100 {
        return Err("Choose 1–100 still images.".into());
    }
    let core = state.core.clone();
    crate::pdf::image_page_dimensions(page_size, 1.0, 1.0)?;
    let inputs = input_paths
        .iter()
        .map(|p| {
            let path = core.authorize(p)?;
            if !crate::images::is_image_input(&path) {
                return Err(
                    "Images to PDF accepts JPEG, PNG, WebP, BMP, TIFF and HEIC still images only."
                        .into(),
                );
            }
            Ok(path)
        })
        .collect::<Result<Vec<_>>>()?;
    let chosen = core.destination(&output_path)?;
    let operation = core.reserve()?;
    let id = core.sequence.fetch_add(1, Ordering::SeqCst) + 1;
    let job = Job {
        id,
        revision: 0,
        phase: JobPhase::Validating,
        input_path: format!("{} images (visible list order)", inputs.len()),
        destination: None,
        format: OutputFormat::Pdf,
        duration: None,
        seconds: 0.0,
        percent: None,
        pages_done: Some(0),
        pages_total: Some(inputs.len() as u16),
        message: "Rechecking queued inputs and destination…".into(),
    };
    core.inner.lock().unwrap().job = Some(job.clone());
    std::thread::spawn(move || {
        let result = (|| {
            operation.control.check()?;
            let destination = destination_path(&inputs[0], &chosen, OutputFormat::Pdf)?;
            core.update(id, |j| {
                j.phase = JobPhase::Running;
                j.destination = Some(destination.to_string_lossy().into_owned());
                j.message = "Validating and assembling image pages…".into();
            });
            crate::pdf::images_to_pdf(
                &inputs,
                &destination,
                page_size,
                &operation.control,
                &mut |done, total| {
                    core.update(id, |j| {
                        if j.phase != JobPhase::Cancelling {
                            j.pages_done = Some(done);
                            j.pages_total = Some(total);
                            j.percent = Some(f64::from(done) / f64::from(total) * 100.0);
                            j.message = format!(
                                "Processed page {done} of {total}. Validating before publication…"
                            );
                        }
                    })
                },
            )
        })();
        if let Ok(path) = &result {
            core.record_output(path);
        }
        operation.control.cleanup();
        drop(operation);
        core.update(id, |j| match result {
            Ok(path) => {
                j.phase = JobPhase::Succeeded;
                j.destination = Some(path.to_string_lossy().into_owned());
                j.percent = Some(100.0);
                j.message = "PDF completed and page count validated.".into();
            }
            Err(message) => {
                j.phase = if message == CANCELLED {
                    JobPhase::Cancelled
                } else {
                    JobPhase::Failed
                };
                j.message = message;
            }
        });
    });
    Ok(job)
}
#[tauri::command]
pub fn start_merge_pdf(
    state: tauri::State<'_, Runtime>,
    output_path: String,
    input_paths: Vec<String>,
) -> Result<Job> {
    state.previews.cancel_all();
    if input_paths.len() < 2 || input_paths.len() > 100 {
        return Err("Choose 2–100 PDFs.".into());
    }
    let core = state.core.clone();
    let inputs = input_paths
        .iter()
        .map(|p| {
            let path = core.authorize(p)?;
            if !crate::pdf::is_input(&path) {
                return Err("Merge PDF accepts PDFs only.".into());
            }
            Ok(path)
        })
        .collect::<Result<Vec<_>>>()?;
    let chosen = core.destination(&output_path)?;
    let operation = core.reserve()?;
    let id = core.sequence.fetch_add(1, Ordering::SeqCst) + 1;
    let job = Job {
        id,
        revision: 0,
        phase: JobPhase::Validating,
        input_path: format!("{} PDFs (visible list order)", inputs.len()),
        destination: None,
        format: OutputFormat::Pdf,
        duration: None,
        seconds: 0.0,
        percent: None,
        pages_done: Some(0),
        pages_total: None,
        message: "Rechecking queued inputs and destination…".into(),
    };
    core.inner.lock().unwrap().job = Some(job.clone());
    std::thread::spawn(move || {
        let result = (|| {
            operation.control.check()?;
            let destination = destination_path(&inputs[0], &chosen, OutputFormat::Pdf)?;
            core.update(id, |j| {
                j.destination = Some(destination.to_string_lossy().into_owned());
                if j.phase != JobPhase::Cancelling {
                    j.phase = JobPhase::Running;
                    j.message = "Validating PDF inputs…".into();
                }
            });
            crate::pdf::merge_pdfs(
                &inputs,
                &destination,
                &operation.control,
                &mut |done, total| {
                    core.update(id, |j| {
                        if j.phase != JobPhase::Cancelling {
                            j.pages_done = Some(done);
                            j.pages_total = Some(total);
                            j.percent = Some(f64::from(done) / f64::from(total) * 100.0);
                            j.message = format!(
                                "Processed page {done} of {total}. Validating before publication…"
                            );
                        }
                    })
                },
                &mut |stage| {
                    core.update(id, |j| {
                        if j.phase != JobPhase::Cancelling {
                            j.percent = None;
                            j.phase = if stage == "verifying" || stage == "publishing" {
                                JobPhase::Verifying
                            } else {
                                JobPhase::Running
                            };
                            j.message = match stage {
                                "writing" => "Writing merged PDF…",
                                "verifying" => "Validating merged pages and dimensions…",
                                _ => "Publishing validated PDF…",
                            }
                            .into();
                        }
                    })
                },
            )
        })();
        if let Ok(path) = &result {
            core.record_output(path);
        }
        operation.control.cleanup();
        drop(operation);
        core.update(id, |j| match result {
            Ok(path) => {
                j.phase = JobPhase::Succeeded;
                j.destination = Some(path.to_string_lossy().into_owned());
                j.percent = Some(100.0);
                j.message = "PDF completed and page count validated.".into();
            }
            Err(message) => {
                j.phase = if message == CANCELLED {
                    JobPhase::Cancelled
                } else {
                    JobPhase::Failed
                };
                j.message = message;
            }
        });
    });
    Ok(job)
}
#[tauri::command]
pub fn get_conversion_status(state: tauri::State<'_, Runtime>) -> Option<Job> {
    state.core.job()
}
#[tauri::command]
pub fn cancel_conversion(state: tauri::State<'_, Runtime>, id: u64) -> Result<()> {
    let core = &state.core;
    let control = {
        let mut inner = core.inner.lock().unwrap();
        let job = inner.job.as_mut().ok_or("No conversion is active.")?;
        if job.id != id || !job.phase.busy() {
            return Err("This conversion is no longer active.".into());
        }
        job.phase = JobPhase::Cancelling;
        job.revision += 1;
        job.message = if job.format.image() || job.format.text() || job.format == OutputFormat::Pdf
        {
            "Cancelling… Waiting for the current processing step to finish, then removing its temporary output.".into()
        } else {
            "Cancelling and cleaning up the temporary output…".into()
        };
        inner.active.clone()
    };
    if let Some(control) = control {
        control.cancel();
    }
    Ok(())
}

#[cfg(test)]
mod tests;

/// Save-dialog authorization is separate from execution; paths never grant arbitrary file access.
#[tauri::command]
pub async fn choose_queue_destination(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Runtime>,
    suggested: String,
    format: OutputFormat,
    folder_output: bool,
) -> Result<Option<String>> {
    let core = state.core.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = save_destination(&window, suggested, format.extension(), folder_output)? else {
            return Ok(None);
        };
        core.inner.lock().unwrap().destinations.insert(path.clone());
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|_| "Could not choose a destination.".to_string())?
}

pub(crate) fn save_destination(
    window: &tauri::WebviewWindow,
    suggested: String,
    extension: &str,
    folder_output: bool,
) -> Result<Option<PathBuf>> {
    let mut dialog = window
        .dialog()
        .file()
        .set_parent(window)
        .set_title(if folder_output {
            "Name a NEW output folder"
        } else {
            "Save output without overwriting"
        })
        .set_file_name(suggested);
    if !folder_output {
        dialog = dialog.add_filter(extension.to_uppercase(), &[extension]);
    }
    let Some(chosen) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let path = chosen
        .into_path()
        .map_err(|_| "Could not access that destination.")?;
    save_path(path, extension, folder_output).map(Some)
}

fn save_path(mut path: PathBuf, extension: &str, folder_output: bool) -> Result<PathBuf> {
    if !folder_output {
        path.set_extension(extension);
    }
    if path.exists() || !path.parent().is_some_and(|p| p.is_dir()) {
        return Err(
            "Choose a new destination in an accessible folder. Existing outputs are protected."
            .into(),
        );
    }
    Ok(path)
}
