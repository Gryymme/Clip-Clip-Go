//! One inspected item and one job, using the converter's operation lease.
#[cfg(test)]
mod authorized_test;
#[cfg(test)]
mod error_tests;
mod errors;
mod metadata;
mod plan;
mod protocol;
mod relay;
#[cfg(test)]
mod tests;
use crate::{
    conversion,
    engine::Engines,
    process::{Control, LineHandler, NativeRunner, Result, Runner, CANCELLED},
};
use metadata::{Format, Media};
use plan::{Plan, Settings};
use protocol::{
    Completion, Diagnostic, Notify, ReportRunner, COMPLETION_TEMPLATE, PROGRESS_TEMPLATE,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri_plugin_dialog::DialogExt;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    id: u64,
    revision: u64,
    stage: String,
    message: String,
    percent: Option<f64>,
    bytes: Option<u64>,
    total: Option<u64>,
    speed: Option<f64>,
    eta: Option<f64>,
    stream: Option<usize>,
    streams: Option<usize>,
    progress_kind: Option<String>,
    diagnostics: Vec<Diagnostic>,
    media: Option<Media>,
    destination: Option<String>,
    browser_source: Option<crate::companion::shared::Candidate>,
}
impl Job {
    fn new(id: u64, stage: &str, message: &str) -> Self {
        Self {
            id,
            revision: 0,
            stage: stage.into(),
            message: message.into(),
            percent: None,
            bytes: None,
            total: None,
            speed: None,
            eta: None,
            stream: None,
            streams: None,
            progress_kind: None,
            diagnostics: Vec::new(),
            media: None,
            destination: None,
            browser_source: None,
        }
    }
}
#[derive(Clone)]
struct Inspected {
    id: u64,
    input: MediaInput,
    media: Media,
}
#[derive(Clone)]
enum MediaInput {
    Page(String),
    Browser(crate::companion::shared::Candidate),
}
impl MediaInput {
    fn url(&self) -> &str {
        match self {
            Self::Page(url) => url,
            Self::Browser(c) => &c.media_url,
        }
    }
    fn transport(&self) -> Result<(String, Option<relay::Relay>)> {
        if let Self::Browser(c) = self {
            c.validate(crate::companion::shared::now())?;
            if c.context.referer.is_some() {
                let relay = relay::Relay::start(c)?;
                return Ok((relay.url.clone(), Some(relay)));
            }
        }
        Ok((self.url().to_owned(), None))
    }
}
#[derive(Clone)]
struct Prepared { inspected: Inspected, settings: Settings, name: String, folder: PathBuf }
#[derive(Default)]
struct Inner {
    job: Option<Job>,
    inspected: Option<Inspected>,
    control: Option<Arc<Control>>,
    folder: Option<PathBuf>,
    prepared: HashMap<u64, Prepared>,
    executions: HashMap<u64, Runtime>,
}
#[derive(Default, Clone)]
pub struct Runtime {
    inner: Arc<Mutex<Inner>>,
    sequence: Arc<AtomicU64>,
}
impl Runtime {
    fn prepare_snapshot(&self, inspected: Inspected, settings: Settings, name: String) -> Result<Value> {
    let mut inner = self.inner.lock().unwrap();
    let folder = inner.folder.clone().ok_or("Choose a destination folder first.")?;
    let destination = folder.join(format!("{}.{}", filename(&name), settings.format));
    let ticket = self.sequence.fetch_add(1, Ordering::SeqCst) + 1;
    inner.prepared.insert(ticket, Prepared { inspected, settings, name, folder });
    Ok(json!({"ticket":ticket,"destination":destination.to_string_lossy()}))
    }
    fn point(&self, id: u64, stage: &str, p: DownloadProgress) {
        self.update(id, |j| {
            if let Some(diagnostic) = p.diagnostic {
                if j.diagnostics.len() == 16 {
                    j.diagnostics.remove(0);
                }
                j.diagnostics.push(diagnostic);
                return;
            }
            if j.stage != stage
                || j.stage == "cancelling"
                || p.stream.zip(j.stream).is_some_and(|(next, old)| next < old)
            {
                return;
            }
            j.percent = p.percent;
            j.bytes = p.bytes;
            j.total = p.total;
            j.speed = p.speed;
            j.eta = p.eta;
            j.progress_kind = p.kind;
            if p.stream.is_some() {
                j.stream = p.stream;
                j.streams = p.streams;
            }
        });
    }
    pub fn shutdown(&self) {
        if let Some(c) = self.inner.lock().unwrap().control.clone() {
            c.cancel();
        }
    }
    fn update(&self, id: u64, f: impl FnOnce(&mut Job)) {
        if let Some(j) = self.inner.lock().unwrap().job.as_mut() {
            if j.id == id {
                f(j);
                j.revision += 1;
            }
        }
    }
    fn stage(&self, id: u64, stage: &str, message: &str) {
        self.update(id, |j| {
            if j.stage != "cancelling" {
                j.stage = stage.into();
                j.message = message.into();
                j.percent = None;
                j.bytes = None;
                j.total = None;
                j.speed = None;
                j.eta = None;
                j.progress_kind = None;
                j.stream = None;
                j.streams = None;
            }
        });
    }
    fn inspected(&self, id: u64) -> Result<Inspected> {
        self.inner
            .lock()
            .unwrap()
            .inspected
            .as_ref()
            .filter(|m| m.id == id)
            .cloned()
            .ok_or("Inspect the link again before downloading.".into())
    }
    fn finish(&self, id: u64, result: Result<Option<PathBuf>>) {
        self.update(id, |j| match result {
            Ok(path) => {
                j.stage = if path.is_some() { "succeeded" } else { "ready" }.into();
                j.message = if path.is_some() {
                    "Download saved and validated."
                } else {
                    "Choose a source and output settings."
                }
                .into();
                j.destination = path.map(|p| p.to_string_lossy().into_owned());
                j.percent = None;
            }
            Err(error) => {
                j.stage = if error == CANCELLED {
                    "cancelled"
                } else {
                    "failed"
                }
                .into();
                j.message = if error == CANCELLED {
                    "Download operation cancelled.".into()
                } else {
                    error
                };
                j.percent = None;
            }
        });
        let mut inner = self.inner.lock().unwrap();
        if inner.job.as_ref().is_some_and(|j| j.id == id) {
            inner.control = None;
        }
    }
}
#[derive(Clone)]
struct Tools {
    yt: PathBuf,
    deno: PathBuf,
}
const MANIFEST: &str = include_str!("../../scripts/downloader-manifest.json");
const INPUT_FORMATS:&str="mov,matroska,webm,mp3,wav,flac,ogg,aac,mpegts,mpeg,avi,asf,flv,h264,hevc,av1,ivf,aiff,au,ac3,eac3";
fn tools_at(directory: &Path, development: bool) -> Result<Tools> {
    let m: Value = serde_json::from_str(MANIFEST).unwrap();
    let resolve = |name: &str, key: &str| -> Result<PathBuf> {
        let path = directory.join(if development {
            format!("{name}-x86_64-pc-windows-msvc.exe")
        } else {
            format!("{name}.exe")
        });
        if !crate::engine_integrity::verify(&path, m[key]["sha256"].as_str().unwrap())
            .unwrap_or(false)
        {
            return Err("Bundled Downloader engines are missing or damaged. Repair or reinstall ClipClipGO.".into());
        }
        Ok(path)
    };
    Ok(Tools {
        yt: resolve("yt-dlp", "ytDlp")?,
        deno: resolve("deno", "deno")?,
    })
}
fn tools() -> Result<Tools> {
    let exe = std::env::current_exe().map_err(|_| "Cannot locate bundled Downloader engines.")?;
    tools_at(
        exe.parent().ok_or("Cannot locate application folder.")?,
        false,
    )
}
fn base_args(t: &Tools, e: &Engines, stage: &Path) -> Vec<String> {
    vec![
        "--ignore-config".into(),
        "--no-config-locations".into(),
        "--no-plugin-dirs".into(),
        "--no-update".into(),
        "--no-cache-dir".into(),
        "--no-remote-components".into(),
        "--no-js-runtimes".into(),
        "--js-runtimes".into(),
        format!("deno:{}", t.deno.display()),
        "--ffmpeg-location".into(),
        e.ffmpeg.to_string_lossy().into_owned(),
        "--no-playlist".into(),
        "--break-match-filters".into(),
        "!is_live & live_status !=? is_upcoming & live_status !=? post_live & !has_drm".into(),
        "--playlist-end".into(),
        "1".into(),
        "--socket-timeout".into(),
        "15".into(),
        "--retries".into(),
        "2".into(),
        "--extractor-retries".into(),
        "1".into(),
        "--paths".into(),
        stage.to_string_lossy().into_owned(),
        "--paths".into(),
        format!("temp:{}", stage.display()),
    ]
}
fn inspection_args(t: &Tools, e: &Engines, stage: &Path, url: &str) -> Vec<String> {
    let mut args = base_args(t, e, stage);
    args.extend(
        [
            "--dump-single-json",
            "--skip-download",
            "--flat-playlist",
            "--no-warnings",
            "--no-progress",
            "--",
            url,
        ]
        .map(String::from),
    );
    args
}
fn workspace(parent: &Path, control: &Control) -> Result<tempfile::TempDir> {
    let stage = tempfile::Builder::new()
        .prefix(".clipclipgo-download-")
        .tempdir_in(parent)
        .map_err(|_| "Could not create a job directory in the destination folder.")?;
    *control.temporary_directory.lock().unwrap() = Some(stage.path().into());
    *control.working_directory.lock().unwrap() = Some(stage.path().into());
    control.check()?;
    Ok(stage)
}
#[tauri::command]
pub fn inspect_download(
    state: tauri::State<'_, Runtime>,
    shared: tauri::State<'_, conversion::Runtime>,
    url: String,
) -> Result<Job> {
    let url = metadata::url(&url)?;
    inspect_input(state.inner(), shared.inner(), MediaInput::Page(url))
}
#[tauri::command]
pub fn inspect_browser_download(
    state: tauri::State<'_, Runtime>,
    shared: tauri::State<'_, conversion::Runtime>,
    companion: tauri::State<'_, crate::companion::Runtime>,
    id: String,
) -> Result<Job> {
    let candidate = companion.pending(&id)?;
    let job = inspect_input(
        state.inner(),
        shared.inner(),
        MediaInput::Browser(candidate),
    )?;
    let _ = companion.take(&id);
    Ok(job)
}
fn inspect_input(state: &Runtime, shared: &conversion::Runtime, input: MediaInput) -> Result<Job> {
    let operation = shared.core.inspect()?;
    shared.previews.cancel_all();
    let engines = shared.core.engines()?;
    let runtime = state.clone();
    let id = runtime.sequence.fetch_add(1, Ordering::SeqCst) + 1;
    let mut job = Job::new(id, "inspecting", "Inspecting the link…");
    if let MediaInput::Browser(c) = &input {
        job.browser_source = Some(c.clone());
    }
    {
        let mut i = runtime.inner.lock().unwrap();
        if i.control.is_some() { return Err("A link inspection is already active. Finish or cancel it first.".into()); }
        i.job = Some(job.clone());
        i.inspected = None;
        i.control = Some(operation.control.clone());
    }
    std::thread::spawn(move || {
        let result = (|| {
            let t = tools()?;
            // Inspection scratch is application-owned, never a website-provided path.
            // System temp is allowed at runtime; development tests explicitly use project scratch.
            let temp = std::env::temp_dir();
            let stage = workspace(&temp, &operation.control)?;
            let (url, relay) = input.transport()?;
            let args = inspection_args(&t, &engines, stage.path(), &url);
            let report_runtime = runtime.clone();
            let notify: Notify = Arc::new(move |stage, _, point| {
                if let Some(point) = point {
                    report_runtime.point(id, stage, point);
                }
            });
            let inspection_runner = ReportRunner {
                runner: &NativeRunner,
                stage: "inspecting",
                ids: &[],
                notify,
            };
            let output = inspection_runner.run(
                &t.yt,
                &args,
                &operation.control,
                Some(Duration::from_secs(60)),
                None,
            )?;
            if !output.success {
                return Err(relay
                    .as_ref()
                    .and_then(|r| r.failure())
                    .unwrap_or_else(|| metadata::site_error(&output.stderr)));
            }
            let media = metadata::parse(&output.stdout, input.url())?;
            operation.control.check()?;
            {
                let mut i = runtime.inner.lock().unwrap();
                i.inspected = Some(Inspected {
                    id,
                    input,
                    media: media.clone(),
                });
            }
            runtime.update(id, |j| j.media = Some(media));
            Ok(None)
        })();
        operation.control.cleanup();
        drop(operation);
        runtime.finish(id, result);
    });
    Ok(job)
}
#[tauri::command]
pub fn download_status(state: tauri::State<'_, Runtime>, id: Option<u64>) -> Option<Job> {
    if let Some(id) = id {
        let runtime = state.inner.lock().unwrap().executions.get(&id).cloned()?;
        let job = runtime.inner.lock().unwrap().job.clone();
        // finish clears its control after the process lease/resources have settled.
        if runtime.inner.lock().unwrap().control.is_none() {
            state.inner.lock().unwrap().executions.remove(&id);
        }
        return job;
    }
    let mut inner = state.inner.lock().unwrap();
    if inner.control.is_none() {
        if inner.inspected.as_ref().is_some_and(|s|matches!(&s.input,MediaInput::Browser(c) if c.expires_at<=crate::companion::shared::now())){inner.inspected=None;}
        if let Some(job) = inner.job.as_mut() {
            if job
                .browser_source
                .as_ref()
                .is_some_and(|c| c.expires_at <= crate::companion::shared::now())
            {
                job.browser_source = None;
                job.revision += 1;
            }
        }
    }
    inner.job.clone()
}
#[tauri::command]
pub fn cancel_download(state: tauri::State<'_, Runtime>, id: u64) -> Result<()> {
    let execution = state.inner.lock().unwrap().executions.get(&id).cloned();
    if let Some(runtime) = execution { runtime.shutdown(); return Ok(()); }
    let control = {
        let i = state.inner.lock().unwrap();
        if i.job.as_ref().is_none_or(|j| j.id != id) {
            return Err("That download operation is no longer active.".into());
        }
        i.control.clone()
    };
    if let Some(c) = control {
        state.stage(id, "cancelling", "Cancelling and cleaning up…");
        c.cancel();
    }
    Ok(())
}
#[tauri::command]
pub async fn download_capabilities(shared: tauri::State<'_, conversion::Runtime>) -> Result<Value> {
    let engines = shared.core.engines()?;
    tauri::async_runtime::spawn_blocking(move||{tools()?;let m:Value=serde_json::from_str(MANIFEST).unwrap();let mut encoders:Vec<_>=engines.encoders.into_iter().collect();encoders.sort();Ok(json!({"encoders":encoders,"ytDlp":m["ytDlp"]["version"],"deno":m["deno"]["version"],"contract":serde_json::from_str::<Value>(plan::CONTRACT).unwrap()}))}).await.map_err(|_|"Could not check Downloader engines.")?
}
#[tauri::command]
pub fn plan_download(
    state: tauri::State<'_, Runtime>,
    shared: tauri::State<'_, conversion::Runtime>,
    inspection_id: u64,
    settings: Settings,
) -> Result<Plan> {
    plan::build(
        &state.inspected(inspection_id)?.media,
        &settings,
        &shared.core.engines()?,
    )
}
#[tauri::command]
pub async fn choose_download_folder(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Runtime>,
    shared: tauri::State<'_, conversion::Runtime>,
) -> Result<Option<String>> {
    let operation = shared.core.inspect()?;
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = operation;
        let chosen = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Choose download destination folder")
            .blocking_pick_folder();
        let Some(chosen) = chosen else {
            return Ok(None);
        };
        let path = chosen
            .into_path()
            .map_err(|_| "Cannot access that folder.")?
            .canonicalize()
            .map_err(|_| "Cannot access that folder.")?;
        if !path.is_dir() {
            return Err("Choose a destination folder.".into());
        }
        runtime.inner.lock().unwrap().folder = Some(path.clone());
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|_| "Could not choose destination folder.")?
}
pub fn filename(name: &str) -> String {
    let s: String = name
        .chars()
        .filter(|c| !c.is_control())
        .map(|c| if "<>:\"/\\|?*".contains(c) { '_' } else { c })
        .take(100)
        .collect();
    let s = s.trim().trim_matches('.').trim_end_matches([' ', '.']);
    let base = s.split('.').next().unwrap_or("").to_ascii_uppercase();
    if s.is_empty() {
        "media".into()
    } else if matches!(
        base.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CLOCK$" | "CONIN$" | "CONOUT$"
    ) || ["COM", "LPT"].iter().any(|p| {
        base.starts_with(p)
            && base[p.len()..].chars().count() == 1
            && "123456789¹²³".contains(&base[p.len()..])
    }) {
        format!("_{s}")
    } else {
        s.into()
    }
}
pub fn publish(stage: &Path, destination: &Path, control: &Control) -> Result<PathBuf> {
    let _lock = control.publication.lock().unwrap();
    control.check()?;
    // A same-volume hard link atomically creates the destination and fails if it exists.
    // No copy-to-final window exposes a partially written user file.
    std::fs::hard_link(stage,destination).map_err(|_|"Could not publish the output. The filename may already exist or the destination does not support protected publication. Choose another filename or folder.")?;
    Ok(destination.into())
}
#[derive(Debug, Default)]
pub struct DownloadProgress {
    percent: Option<f64>,
    bytes: Option<u64>,
    total: Option<u64>,
    speed: Option<f64>,
    eta: Option<f64>,
    kind: Option<String>,
    stream: Option<usize>,
    streams: Option<usize>,
    diagnostic: Option<Diagnostic>,
}
pub fn progress(line: &str) -> Option<DownloadProgress> {
    let v: Value = serde_json::from_str(line.strip_prefix("CCG:")?).ok()?;
    let bytes = v["downloaded_bytes"].as_u64();
    let exact = v["total_bytes"].as_u64().filter(|n| *n > 0);
    let estimate = number(&v["total_bytes_estimate"])
        .map(|n| n as u64)
        .filter(|n| *n > 0);
    let fragments = v["fragment_index"]
        .as_u64()
        .zip(v["fragment_count"].as_u64().filter(|n| *n > 0));
    let (percent, kind) = if let Some((b, t)) = bytes.zip(exact) {
        (Some(b as f64 / t as f64 * 100.0), Some("bytes"))
    } else if let Some((done, total)) = fragments {
        (Some(done as f64 / total as f64 * 100.0), Some("fragments"))
    } else if let Some((b, t)) = bytes.zip(estimate) {
        (
            Some((b as f64 / t as f64 * 100.0).min(99.9)),
            Some("estimated"),
        )
    } else {
        (None, None)
    };
    Some(DownloadProgress {
        percent: percent.map(|p| p.clamp(0.0, 100.0)),
        kind: kind.map(String::from),
        bytes,
        total: exact.or(estimate),
        speed: metadata::positive(&v["speed"]),
        eta: v["eta"].as_f64().filter(|n| n.is_finite() && *n >= 0.0),
        ..Default::default()
    })
}
fn probe(path: &Path, engines: &Engines, runner: &dyn Runner, control: &Control) -> Result<Value> {
    let args = [
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        INPUT_FORMATS,
        "-show_streams",
        "-show_format",
        "-of",
        "json",
    ]
    .map(String::from)
    .into_iter()
    .chain([path.to_string_lossy().into_owned()])
    .collect::<Vec<_>>();
    let r = runner.run(
        &engines.ffprobe,
        &args,
        control,
        Some(Duration::from_secs(30)),
        None,
    )?;
    if !r.success {
        return Err("FFprobe could not validate downloaded media. No output was published.".into());
    }
    serde_json::from_slice(&r.stdout).map_err(|_| "FFprobe returned invalid media data.".into())
}
fn stream<'a>(doc: &'a Value, kind: &str) -> Option<&'a Value> {
    doc["streams"]
        .as_array()?
        .iter()
        .find(|s| s["codec_type"] == kind && s["disposition"]["attached_pic"] != 1)
}
fn number(v: &Value) -> Option<f64> {
    v.as_f64()
        .or_else(|| v.as_str()?.parse().ok())
        .filter(|n| n.is_finite() && *n > 0.0)
}
fn rate(v: &Value) -> Option<f64> {
    let s = v.as_str()?;
    let (a, b) = s.split_once('/')?;
    let n = a.parse::<f64>().ok()? / b.parse::<f64>().ok()?;
    (n.is_finite() && n > 0.0).then_some(n)
}
fn actual_format(f: &mut Format, doc: &Value) {
    let video = stream(doc, "video");
    let audio = stream(doc, "audio");
    f.video = video.is_some();
    f.audio = audio.is_some();
    f.uncertain = false;
    f.vcodec = video
        .and_then(|s| s["codec_name"].as_str())
        .map(String::from);
    f.acodec = audio
        .and_then(|s| s["codec_name"].as_str())
        .map(String::from);
    f.width = video.and_then(|s| s["width"].as_u64()).map(|n| n as u32);
    f.height = video.and_then(|s| s["height"].as_u64()).map(|n| n as u32);
    f.fps = video.and_then(|s| rate(&s["avg_frame_rate"]));
    f.sample_rate = audio
        .and_then(|s| number(&s["sample_rate"]))
        .map(|n| n as u32);
    f.channels = audio.and_then(|s| s["channels"].as_u64()).map(|n| n as u32);
}
fn validate(doc: &Value, source: &Media, s: &Settings, p: &Plan) -> Result<()> {
    let c = plan::container(&s.format)?;
    let error = "The output did not match the requested settings. No file was published.";
    if !doc["format"]["format_name"]
        .as_str()
        .is_some_and(|n| n.split(',').any(|x| x == c.probe))
    {
        return Err(error.into());
    }
    if let Some(expected) = source.duration {
        if number(&doc["format"]["duration"])
            .is_none_or(|duration| (duration - expected).abs() > (expected * 0.05).max(2.0))
        {
            return Err(
                "The output duration differs substantially from the source. No file was published."
                    .into(),
            );
        }
    }
    let locked = plan::bound_settings(s, p);
    let (v, a) = plan::sources(source, &locked)?;
    for (kind, e, copy) in [
        ("video", p.video_encoder.as_deref(), p.copy_video),
        ("audio", p.audio_encoder.as_deref(), p.copy_audio),
    ] {
        let out = stream(doc, kind);
        if out.is_some() != e.is_some() {
            return Err(error.into());
        }
        if let (Some(out), Some(e)) = (out, e) {
            if out["codec_name"] != if copy { e } else { plan::encoder_codec(e) } {
                return Err(error.into());
            }
        }
    }
    if let Some(v) = v {
        let out = stream(doc, "video").ok_or(error)?;
        if let (Some(w), Some(h)) = (v.width, v.height) {
            let scale = s
                .resolution
                .map(|r| (r as f64 / h as f64).min(1.0))
                .unwrap_or(1.0);
            let dimensions = if p.copy_video {
                (w, h)
            } else {
                (
                    ((w as f64 * scale / 2.0).floor() * 2.0) as u32,
                    ((h as f64 * scale / 2.0).floor() * 2.0) as u32,
                )
            };
            if out["width"].as_u64() != Some(dimensions.0 as u64)
                || out["height"].as_u64() != Some(dimensions.1 as u64)
            {
                return Err(error.into());
            }
        }
        if let Some(expected) = s.fps.map(|f| f as f64).or(v.fps) {
            if rate(&out["avg_frame_rate"]).is_none_or(|f| (f - expected).abs() > 0.15) {
                return Err(error.into());
            }
        }
    }
    if let Some(a) = a {
        let out = stream(doc, "audio").ok_or(error)?;
        if let Some(ch) = s.channels.or(a.channels) {
            if out["channels"].as_u64() != Some(ch as u64) {
                return Err(error.into());
            }
        }
        let expected = s.sample_rate.or(a.sample_rate);
        if let Some(expected) = expected {
            if number(&out["sample_rate"]).is_none_or(|r| r != expected as f64) {
                return Err("The output sample rate differs from the selection. Choose a sample rate supported by the output codec. No file was published.".into());
            }
        }
    }
    Ok(())
}
fn execute(
    t: &Tools,
    engines: &Engines,
    inspected: &Inspected,
    s: &Settings,
    p: &Plan,
    folder: &Path,
    name: &str,
    control: &Control,
    runner: &dyn Runner,
    notify: Notify,
) -> Result<PathBuf> {
    let destination = folder.join(format!("{}.{}", filename(name), s.format));
    if destination
        .try_exists()
        .map_err(|_| "Cannot check the destination filename.")?
    {
        return Err("That filename already exists. Choose another name; existing files are never overwritten.".into());
    }
    let stage = workspace(folder, control)?;
    let (input_url, relay) = inspected.input.transport()?;
    let mut paths = Vec::new();
    let mut actual = inspected.media.clone();
    actual.duration = None;
    for (index, id) in p.sources.iter().enumerate() {
        control.check()?;
        notify(
            "downloading",
            &format!("Downloading source {} of {}…", index + 1, p.sources.len()),
            None,
        );
        let mut args = base_args(t, engines, stage.path());
        args.extend([
            "--format".into(),
            format!("all[format_id='{id}']"),
            "--fixup".into(),
            "never".into(),
            "--abort-on-unavailable-fragments".into(),
            "--no-continue".into(),
            "--no-mtime".into(),
            "--downloader".into(),
            "native".into(),
            "--newline".into(),
            "--progress".into(),
            "--progress-template".into(),
            PROGRESS_TEMPLATE.into(),
            "--progress-delta".into(),
            "0.1".into(),
            "--no-colors".into(),
            "--no-quiet".into(),
            "--no-simulate".into(),
            "--print".into(),
            COMPLETION_TEMPLATE.into(),
            "--output".into(),
            stage
                .path()
                .join(format!("source-{index}.media"))
                .to_string_lossy()
                .into_owned(),
            "--".into(),
            input_url.clone(),
        ]);
        let mut completed = None;
        let download_runner = ReportRunner {
            runner,
            stage: "downloading",
            ids: &p.sources,
            notify: notify.clone(),
        };
        // Each invocation extracts the original page again and resolves fresh signed URLs.
        // Retry an expired/denied media response once with another extraction, keeping IDs.
        for attempt in 0..2 {
            let records = Arc::new(Mutex::new(Completion::default()));
            let capture = records.clone();
            let n = notify.clone();
            let stream_count = p.sources.len();
            n(
                "downloading",
                "",
                Some(DownloadProgress {
                    stream: Some(index + 1),
                    streams: Some(stream_count),
                    ..Default::default()
                }),
            );
            let handler: LineHandler = Box::new(move |line| {
                capture.lock().unwrap().line(line);
                if let Some(mut point) = progress(line) {
                    point.stream = Some(index + 1);
                    point.streams = Some(stream_count);
                    n("downloading", "", Some(point));
                }
            });
            let result = download_runner.run(&t.yt, &args, control, None, Some(handler))?;
            control.check()?;
            if result.success {
                completed = Some(records.lock().unwrap().file(stage.path(), id)?);
                break;
            }
            if attempt == 0 && (result.stderr.contains("403") || result.stderr.contains("410")) {
                // Delete only this attempt's known partial file; no directory scanning.
                let owned = stage.path().join(format!("source-{index}.media"));
                for candidate in [
                    owned.clone(),
                    owned.with_extension("media.part"),
                    owned.with_extension("media.ytdl"),
                ] {
                    let _ = std::fs::remove_file(candidate);
                }
                notify("downloading", "Refreshing the selected source link…", None);
                continue;
            }
            return Err(format!(
                "Download failed for source {}. {}",
                index + 1,
                relay
                    .as_ref()
                    .and_then(|r| r.failure())
                    .unwrap_or_else(|| metadata::site_error(&result.stderr))
            ));
        }
        let path = completed.ok_or("Download completion could not be confirmed.")?;
        let source_runner = ReportRunner {
            runner,
            stage: "source validation",
            ids: &p.sources,
            notify: notify.clone(),
        };
        let doc = probe(&path, engines, &source_runner, control).map_err(|e| {
            if e == CANCELLED {
                e
            } else {
                format!("Source validation failed: {e}")
            }
        })?;
        if let Some(duration) = number(&doc["format"]["duration"]) {
            actual.duration = Some(actual.duration.unwrap_or(0.0).max(duration));
        }
        let f = actual
            .formats
            .iter_mut()
            .find(|f| &f.id == id)
            .ok_or("The selected source is missing from its execution plan.")?;
        actual_format(f, &doc);
        paths.push(path);
    }
    let actual_plan = plan::reconcile(&actual, s, p, engines).map_err(|error| {
        if error.contains("streams changed") {
            format!("Source validation failed: {error}")
        } else {
            format!("Output planning failed: {error}")
        }
    })?;
    let input = if actual_plan.merge {
        notify("merging", "Merging selected video and audio streams…", None);
        let merged = stage.path().join("merged.mkv");
        let mut copy = actual_plan.clone();
        copy.copy_video = copy.video_encoder.is_some();
        copy.copy_audio = copy.audio_encoder.is_some();
        let mut merge_settings = s.clone();
        merge_settings.format = "mkv".into();
        let args = plan::ffmpeg_args(&paths, &merged, &merge_settings, &copy);
        let merge_runner = ReportRunner {
            runner,
            stage: "merging",
            ids: &p.sources,
            notify: notify.clone(),
        };
        let r = merge_runner.run(&engines.ffmpeg, &args, control, None, None)?;
        if !r.success {
            return Err("Merge failed. FFmpeg could not merge the selected streams. Expand diagnostics for details.".into());
        }
        vec![merged]
    } else {
        paths
    };
    let mut output_plan = actual_plan.clone();
    if output_plan.merge {
        output_plan.sources = vec!["merged".into()];
        output_plan.video_source = output_plan.video_source.map(|_| "merged".into());
        output_plan.audio_source = output_plan.audio_source.map(|_| "merged".into());
    }
    let output = stage.path().join(format!("output.{}", s.format));
    notify(
        if actual_plan.conversion {
            "converting"
        } else {
            "finalizing"
        },
        if actual_plan.conversion {
            "Converting selected streams…"
        } else {
            "Remuxing without re-encoding…"
        },
        None,
    );
    let duration = actual.duration;
    let n = notify.clone();
    let handler: LineHandler = Box::new(move |line| {
        if let Some(seconds) = conversion::progress_seconds(line) {
            let p = DownloadProgress {
                percent: duration.map(|d| (seconds / d * 100.0).clamp(0.0, 99.9)),
                ..Default::default()
            };
            n(
                if actual_plan.conversion {
                    "converting"
                } else {
                    "finalizing"
                },
                "Processing output streams…",
                Some(p),
            );
        }
    });
    let args = plan::ffmpeg_args(&input, &output, s, &output_plan);
    let output_runner = ReportRunner {
        runner,
        stage: if actual_plan.conversion {
            "converting"
        } else {
            "finalizing"
        },
        ids: &p.sources,
        notify: notify.clone(),
    };
    let result = output_runner.run(&engines.ffmpeg, &args, control, None, Some(handler))?;
    if !result.success {
        return Err("Output processing failed. FFmpeg could not complete the selected encoding or remux settings. Expand diagnostics for details.".into());
    }
    control.check()?;
    notify("finalizing", "Validating output with FFprobe…", None);
    control.check()?;
    if std::fs::metadata(&output).map(|m| m.len()).unwrap_or(0) == 0 {
        return Err("The output is empty. No file was published.".into());
    }
    let final_runner = ReportRunner {
        runner,
        stage: "final validation",
        ids: &p.sources,
        notify: notify.clone(),
    };
    let doc = probe(&output, engines, &final_runner, control).map_err(|e| {
        if e == CANCELLED {
            e
        } else {
            format!("Final validation failed: {e}")
        }
    })?;
    validate(&doc, &actual, s, &actual_plan)
        .map_err(|e| format!("Final validation failed: {e}"))?;
    notify("finalizing", "Publishing the validated output…", None);
    publish(&output, &destination, control)
}
#[tauri::command]
pub fn prepare_download(
    state: tauri::State<'_, Runtime>, shared: tauri::State<'_, conversion::Runtime>,
    inspection_id: u64, settings: Settings, name: String,
) -> Result<Value> {
    if name.trim().is_empty() || name.chars().count() > 100 {
        return Err("Enter an output filename of 1–100 characters without its extension.".into());
    }
    let inspected = state.inspected(inspection_id)?;
    plan::build(&inspected.media, &settings, &shared.core.engines()?)?;
    state.prepare_snapshot(inspected, settings, name)
}
#[tauri::command]
pub fn discard_download(state: tauri::State<'_, Runtime>, ticket: u64) {
    state.inner.lock().unwrap().prepared.remove(&ticket);
}
#[tauri::command]
pub fn start_download(
    state: tauri::State<'_, Runtime>, shared: tauri::State<'_, conversion::Runtime>, ticket: u64,
) -> Result<Job> {
    let operation = shared.core.reserve()?;
    shared.previews.cancel_all();
    let Prepared { inspected, settings, name, folder } = state.inner.lock().unwrap().prepared.remove(&ticket)
        .ok_or("This queued media is no longer available. Inspect and submit it again.")?;
    if !folder.is_dir() { return Err("The queued destination folder is inaccessible.".into()); }
    if let MediaInput::Browser(c) = &inspected.input { c.validate(crate::companion::shared::now())?; }
    let engines = shared.core.engines()?;
    let plan = plan::build(&inspected.media, &settings, &engines)?;
    // Output execution has its own status slot; inspecting another link cannot replace it.
    let runtime = Runtime { sequence: state.sequence.clone(), ..Runtime::default() };
    let id = runtime.sequence.fetch_add(1, Ordering::SeqCst) + 1;
    let job = Job::new(id, "downloading", "Preparing the selected source streams…");
    {
        let mut i = runtime.inner.lock().unwrap();
        i.job = Some(job.clone());
        i.control = Some(operation.control.clone());
    }
    state.inner.lock().unwrap().executions.insert(id, runtime.clone());
    let output_core = shared.core.clone();
    std::thread::spawn(move || {
        let r = runtime.clone();
        let notify = Arc::new(
            move |stage: &str, message: &str, progress: Option<DownloadProgress>| {
                if progress.is_none() {
                    r.stage(id, stage, message);
                } else {
                    r.point(id, stage, progress.unwrap());
                }
            },
        );
        let result = tools()
            .and_then(|tools| {
                execute(
                    &tools,
                    &engines,
                    &inspected,
                    &settings,
                    &plan,
                    &folder,
                    &name,
                    &operation.control,
                    &NativeRunner,
                    notify,
                )
            })
            .map(Some);
        if let Ok(Some(path)) = &result { output_core.record_output(path); }
        operation.control.cleanup();
        drop(operation);
        runtime.finish(id, result);
    });
    Ok(job)
}
