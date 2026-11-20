use crate::process::{Control, Result, Runner};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    time::Duration,
};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum OutputFormat {
    Mp4,
    Mkv,
    Webm,
    Mp3,
    Wav,
    Flac,
    M4a,
    Html,
    Txt,
    #[serde(alias = "markdown")]
    Md,
    Pdf,
    #[serde(alias = "jpeg")]
    Jpg,
    Png,
    Webp,
    Bmp,
    #[serde(alias = "tif")]
    Tiff,
}
pub const FORMATS: [OutputFormat; 7] = [
    OutputFormat::Mp4,
    OutputFormat::Mkv,
    OutputFormat::Webm,
    OutputFormat::Mp3,
    OutputFormat::Wav,
    OutputFormat::Flac,
    OutputFormat::M4a,
];

impl OutputFormat {
    pub fn extension(self) -> &'static str {
        match self {
            Self::Mp4 => "mp4",
            Self::Mkv => "mkv",
            Self::Webm => "webm",
            Self::Mp3 => "mp3",
            Self::Wav => "wav",
            Self::Flac => "flac",
            Self::M4a => "m4a",
            Self::Html => "html",
            Self::Txt => "txt",
            Self::Md => "md",
            Self::Pdf => "pdf",
            Self::Jpg => "jpg",
            Self::Png => "png",
            Self::Webp => "webp",
            Self::Bmp => "bmp",
            Self::Tiff => "tiff",
        }
    }
    pub fn video(self) -> bool {
        matches!(self, Self::Mp4 | Self::Mkv | Self::Webm)
    }
    pub fn text(self) -> bool {
        matches!(self, Self::Html | Self::Txt | Self::Md)
    }
    pub fn image(self) -> bool {
        matches!(
            self,
            Self::Jpg | Self::Png | Self::Webp | Self::Bmp | Self::Tiff
        )
    }
    pub fn codecs(self) -> (Option<&'static str>, &'static str) {
        match self {
            Self::Mp4 | Self::Mkv => (Some("libx264"), "aac"),
            Self::Webm => (Some("libvpx-vp9"), "libopus"),
            Self::Mp3 => (None, "libmp3lame"),
            Self::Wav => (None, "pcm_s16le"),
            Self::Flac => (None, "flac"),
            Self::M4a => (None, "aac"),
            Self::Jpg
            | Self::Png
            | Self::Webp
            | Self::Bmp
            | Self::Tiff
            | Self::Html
            | Self::Txt
            | Self::Md => (None, ""),
            Self::Pdf => (None, ""),
        }
    }
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Availability {
    pub format: OutputFormat,
    pub available: bool,
    pub reason: Option<String>,
}
#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct EngineReport {
    pub ready: bool,
    pub ffmpeg_version: Option<String>,
    pub ffprobe_version: Option<String>,
    pub folder: Option<String>,
    pub formats: Vec<Availability>,
    pub message: String,
}
impl EngineReport {
    pub fn missing(message: String) -> Self {
        Self {
            ready: false,
            ffmpeg_version: None,
            ffprobe_version: None,
            folder: None,
            formats: Vec::new(),
            message,
        }
    }
}
#[derive(Clone)]
pub struct Engines {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
    pub encoders: HashSet<String>,
    pub report: EngineReport,
}

pub fn encoder_names(text: &str) -> HashSet<String> {
    text.lines()
        .filter_map(|line| {
            let mut words = line.split_whitespace();
            let flags = words.next()?;
            let name = words.next()?;
            (flags.len() == 6 && matches!(flags.as_bytes()[0], b'V' | b'A') && name != "=")
                .then(|| name.to_string())
        })
        .collect()
}
pub fn availability(
    encoders: &HashSet<String>,
    format: OutputFormat,
    media: Option<&MediaInfo>,
    video_input: bool,
) -> Availability {
    let (video_codec, audio_codec) = format.codecs();
    let reason = if format.image() || format.text() {
        Some("Image outputs require an image input and the built-in image converter.".into())
    } else if format.video() && !video_input {
        Some("Audio inputs offer audio outputs only.".into())
    } else if format.video() && media.is_some_and(|m| m.video.is_none()) {
        Some("No actual video stream was found.".into())
    } else if !format.video() && media.is_some_and(|m| m.audio.is_none()) {
        Some("No audio stream is available to convert or extract.".into())
    } else {
        let mut required = Vec::new();
        if let Some(codec) = video_codec {
            required.push(codec);
        }
        if !format.video() || media.is_none_or(|m| m.audio.is_some()) {
            required.push(audio_codec);
        }
        let missing: Vec<_> = required
            .into_iter()
            .filter(|codec| !encoders.contains(*codec))
            .collect();
        (!missing.is_empty()).then(|| format!("Missing encoder: {}.", missing.join(", ")))
    };
    Availability {
        format,
        available: reason.is_none(),
        reason,
    }
}
pub fn inspect_engines(
    ffmpeg: PathBuf,
    ffprobe: PathBuf,
    folder: Option<String>,
    runner: &dyn Runner,
    control: &Control,
) -> Result<Engines> {
    let version = |program: &Path, label: &str| -> Result<String> {
        let result = runner.run(
            program,
            &["-version".into()],
            control,
            Some(Duration::from_secs(10)),
            None,
        )?;
        let text = String::from_utf8_lossy(&result.stdout);
        let line = text.lines().next().unwrap_or("");
        if !result.success
            || !line.starts_with(&format!("{label} version "))
            || line.split_whitespace().nth(2).is_none()
        {
            return Err(format!(
                "Bundled {label} did not return a valid version. Repair or reinstall Clip-Clip-Go."
            ));
        }
        Ok(line.chars().take(240).collect())
    };
    let ffmpeg_version = version(&ffmpeg, "ffmpeg")?;
    let ffprobe_version = version(&ffprobe, "ffprobe")?;
    let result = runner.run(
        &ffmpeg,
        &["-hide_banner".into(), "-encoders".into()],
        control,
        Some(Duration::from_secs(10)),
        None,
    )?;
    if !result.success {
        return Err(
            "Bundled FFmpeg could not report its encoders. Repair or reinstall Clip-Clip-Go."
                .into(),
        );
    }
    let encoders = encoder_names(&String::from_utf8_lossy(&result.stdout));
    let formats = FORMATS
        .iter()
        .map(|&f| availability(&encoders, f, None, true))
        .collect();
    let report=EngineReport{ready:true,ffmpeg_version:Some(ffmpeg_version),ffprobe_version:Some(ffprobe_version),folder,formats,message:"FFmpeg and FFprobe versions checked. Bundled encoders are available; formats depend on the selected streams.".into()};
    Ok(Engines {
        ffmpeg,
        ffprobe,
        encoders,
        report,
    })
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StreamInfo {
    pub index: u32,
    pub codec: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub duration: Option<f64>,
    pub video: Option<StreamInfo>,
    pub audio: Option<StreamInfo>,
    pub container: String,
    pub formats: Vec<Availability>,
}
#[derive(Deserialize)]
struct ProbeDocument {
    #[serde(default)]
    streams: Vec<ProbeStream>,
    format: Option<ProbeFormat>,
}
#[derive(Deserialize)]
struct ProbeStream {
    index: u32,
    codec_type: Option<String>,
    codec_name: Option<String>,
    duration: Option<String>,
    disposition: Option<Disposition>,
}
#[derive(Deserialize)]
struct Disposition {
    #[serde(default)]
    attached_pic: u8,
}
#[derive(Deserialize)]
struct ProbeFormat {
    duration: Option<String>,
    format_name: Option<String>,
}
pub fn parse_probe(bytes: &[u8]) -> Result<MediaInfo> {
    let document: ProbeDocument = serde_json::from_slice(bytes)
        .map_err(|_| "FFprobe returned invalid media information.".to_string())?;
    let actual_video = document.streams.iter().find(|s| {
        s.codec_type.as_deref() == Some("video")
            && !s.disposition.as_ref().is_some_and(|d| d.attached_pic != 0)
    });
    let first_audio = document
        .streams
        .iter()
        .find(|s| s.codec_type.as_deref() == Some("audio"));
    let stream = |s: &ProbeStream| -> Option<StreamInfo> {
        Some(StreamInfo {
            index: s.index,
            codec: s.codec_name.clone()?,
        })
    };
    let video = actual_video.and_then(stream);
    let audio = first_audio.and_then(stream);
    if video.is_none() && audio.is_none() {
        return Err("No supported audio or actual video stream was found. Cover art, subtitles and attachments are excluded.".into());
    }
    let positive = |s: &str| s.parse::<f64>().ok().filter(|n| n.is_finite() && *n > 0.0);
    let duration = document
        .format
        .as_ref()
        .and_then(|f| f.duration.as_deref())
        .and_then(positive)
        .or_else(|| {
            [actual_video, first_audio]
                .into_iter()
                .flatten()
                .filter_map(|s| s.duration.as_deref().and_then(positive))
                .max_by(f64::total_cmp)
        });
    let container = document
        .format
        .and_then(|f| f.format_name)
        .unwrap_or_default();
    if !container.split(',').any(|f| {
        matches!(
            f,
            "mov" | "mp4" | "m4a" | "matroska" | "webm" | "mp3" | "wav" | "flac" | "ogg"
        )
    }) {
        return Err("This media container is not supported in this milestone.".into());
    }
    Ok(MediaInfo {
        duration,
        video,
        audio,
        container,
        formats: Vec::new(),
    })
}
pub fn probe(
    engines: &Engines,
    path: &Path,
    runner: &dyn Runner,
    control: &Control,
) -> Result<MediaInfo> {
    let args=["-v","error","-protocol_whitelist","file,pipe","-format_whitelist","mov,matroska,webm,mp3,wav,flac,ogg","-show_entries","format=duration,format_name:stream=index,codec_type,codec_name,duration:stream_disposition=attached_pic","-of","json"];
    let mut args: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    args.push(path.to_string_lossy().into_owned());
    let result = runner.run(
        &engines.ffprobe,
        &args,
        control,
        Some(Duration::from_secs(30)),
        None,
    )?;
    if !result.success {
        return Err("FFprobe could not read this file. It may be corrupt, unsupported, inaccessible or no longer present.".into());
    }
    parse_probe(&result.stdout)
}
pub fn is_video_input(path: &Path) -> Result<bool> {
    match path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "mp4" | "mkv" | "webm" | "mov" => Ok(true),
        "mp3" | "wav" | "flac" | "m4a" | "ogg" => Ok(false),
        _ => Err(
            "This is not a supported audio/video input. Document conversion is not available yet."
                .into(),
        ),
    }
}
