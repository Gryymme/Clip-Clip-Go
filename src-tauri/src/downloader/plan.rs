use super::metadata::{Format, Media};
use crate::{engine::Engines, process::Result};
use serde::{Deserialize, Serialize};

pub const CONTRACT: &str = include_str!("compatibility.json");
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub mode: String,
    pub format: String,
    pub video_source: String,
    pub audio_source: String,
    pub resolution: Option<u32>,
    pub fps: Option<u32>,
    pub video_encoder: String,
    pub quality: String,
    pub video_kbps: Option<u32>,
    pub keep_audio: bool,
    pub audio_encoder: String,
    pub audio_kbps: Option<u32>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u32>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Container {
    pub id: String,
    pub video: Vec<String>,
    pub audio: Vec<String>,
    pub copy_video: Vec<String>,
    pub copy_audio: Vec<String>,
    pub muxer: String,
    pub probe: String,
}
#[derive(Deserialize)]
struct Contract {
    containers: Vec<Container>,
}
pub fn container(id: &str) -> Result<Container> {
    serde_json::from_str::<Contract>(CONTRACT)
        .unwrap()
        .containers
        .into_iter()
        .find(|x| x.id == id)
        .ok_or("Choose a supported output format.".into())
}
pub fn encoder_codec(id: &str) -> &str {
    match id {
        "libx264" => "h264",
        "libx265" => "hevc",
        "libvpx-vp9" => "vp9",
        "libaom-av1" => "av1",
        "libopus" => "opus",
        "libmp3lame" => "mp3",
        "libvorbis" => "vorbis",
        _ => id,
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub sources: Vec<String>,
    pub video_source: Option<String>,
    pub audio_source: Option<String>,
    pub video_encoder: Option<String>,
    pub audio_encoder: Option<String>,
    pub copy_video: bool,
    pub copy_audio: bool,
    pub conversion: bool,
    pub merge: bool,
    pub uncertain: bool,
    pub summary: String,
}
fn best<'a>(items: impl Iterator<Item = &'a Format>, video: bool) -> Option<&'a Format> {
    items.max_by(|a, b| {
        let key = |f: &Format| {
            if video {
                (
                    f.height.unwrap_or(0),
                    f.fps.unwrap_or(0.0),
                    f.bitrate.unwrap_or(0.0),
                )
            } else {
                (u32::from(!f.video), 0.0, f.bitrate.unwrap_or(0.0))
            }
        };
        key(a)
            .partial_cmp(&key(b))
            .unwrap_or(std::cmp::Ordering::Equal)
    })
}
pub fn sources<'a>(
    media: &'a Media,
    s: &Settings,
) -> Result<(Option<&'a Format>, Option<&'a Format>)> {
    let video = if s.mode == "video" {
        Some(
            if s.video_source == "best" {
                best(media.formats.iter().filter(|f| f.video), true)
            } else {
                media
                    .formats
                    .iter()
                    .find(|f| f.id == s.video_source && f.video)
            }
            .ok_or("The selected video source is unavailable. Inspect the link again.")?,
        )
    } else {
        None
    };
    let audio = if s.mode == "audio" || s.keep_audio {
        if s.audio_source == "none" {
            None
        } else if s.audio_source == "auto" {
            video.filter(|v| v.audio || v.uncertain).or_else(|| {
                best(
                    media.formats.iter().filter(|f| f.audio || f.uncertain),
                    false,
                )
            })
        } else {
            Some(
                media
                    .formats
                    .iter()
                    .find(|f| f.id == s.audio_source && (f.audio || f.uncertain))
                    .ok_or("The selected audio source is unavailable. Inspect the link again.")?,
            )
        }
    } else {
        None
    };
    if s.mode == "audio" && audio.is_none() {
        return Err("This source has no reported audio stream.".into());
    }
    if s.mode == "video" && s.keep_audio && audio.is_none() {
        return Err(
            "No audio source is available. Choose Remove audio to download video only.".into(),
        );
    }
    Ok((video, audio))
}
pub fn bitrate(codec: &str, kbps: u32) -> Result<()> {
    let (lo, hi) = match codec {
        "libmp3lame" => (8, 320),
        "aac" => (16, 512),
        "libopus" => (6, 510),
        "libvorbis" => (45, 500),
        _ => return Err("Bitrate does not apply to lossless or PCM audio.".into()),
    };
    if !(lo..=hi).contains(&kbps) {
        return Err(format!("Audio bitrate for {codec} must be {lo}–{hi} kb/s."));
    }
    Ok(())
}
fn choose(
    request: &str,
    allowed: &[String],
    copy: &[String],
    source: Option<&str>,
    changed: bool,
    engines: &Engines,
) -> Result<(String, bool)> {
    if request != "auto"
        && (!allowed.iter().any(|x| x == request) || !engines.encoders.contains(request))
    {
        return Err(
            "The selected encoder is incompatible or unavailable in bundled FFmpeg.".into(),
        );
    }
    if !changed
        && source.is_some_and(|c| copy.iter().any(|x| x == c))
        && (request == "auto" || source == Some(encoder_codec(request)))
    {
        return Ok((source.unwrap().into(), true));
    }
    let encoder = if request == "auto" {
        allowed
            .iter()
            .find(|x| engines.encoders.contains(*x))
            .ok_or("No compatible bundled encoder is available.")?
            .clone()
    } else {
        request.into()
    };
    Ok((encoder, false))
}
pub fn build(media: &Media, s: &Settings, engines: &Engines) -> Result<Plan> {
    let c = container(&s.format)?;
    if !matches!(s.mode.as_str(), "video" | "audio") || (s.mode == "video") == c.video.is_empty() {
        return Err("Choose a format compatible with Video or Audio mode.".into());
    }
    if !matches!(
        s.quality.as_str(),
        "preserve" | "high" | "balanced" | "small" | "bitrate"
    ) {
        return Err("Choose a video quality mode.".into());
    }
    if s.quality == "bitrate" {
        if !s.video_kbps.is_some_and(|b| (100..=100000).contains(&b)) {
            return Err("Video target bitrate must be 100–100000 kb/s.".into());
        }
    } else if s.video_kbps.is_some() {
        return Err("Target bitrate requires bitrate mode.".into());
    }
    if s.mode == "audio"
        && (s.resolution.is_some()
            || s.fps.is_some()
            || s.video_encoder != "auto"
            || s.quality != "preserve")
    {
        return Err("Video settings do not apply in Audio mode.".into());
    }
    if s.fps.is_some_and(|f| ![24, 25, 30, 50, 60].contains(&f)) {
        return Err("Unsupported frame rate.".into());
    }
    let (video, audio) = sources(media, s)?;
    if let Some(height) = s.resolution {
        if ![2160, 1440, 1080, 720, 480, 360].contains(&height)
            || video.and_then(|v| v.height).is_none_or(|h| height > h)
        {
            return Err(
                "Choose a known source resolution or a smaller height; upscaling is unavailable."
                    .into(),
            );
        }
    }
    if !s.keep_audio
        && s.mode == "video"
        && (s.audio_kbps.is_some()
            || s.sample_rate.is_some()
            || s.channels.is_some()
            || s.audio_encoder != "auto")
    {
        return Err("Audio settings require Keep audio.".into());
    }
    let mut copy_video = false;
    let mut copy_audio = false;
    let video_encoder = if let Some(v) = video {
        let changed = s.resolution.is_some_and(|r| Some(r) != v.height)
            || s.fps
                .is_some_and(|f| v.fps.is_none_or(|n| (n - f as f64).abs() > 0.001))
            || s.quality != "preserve";
        let (e, copy) = choose(
            &s.video_encoder,
            &c.video,
            &c.copy_video,
            v.vcodec.as_deref(),
            changed,
            engines,
        )?;
        copy_video = copy;
        Some(e)
    } else {
        None
    };
    let audio_encoder = if let Some(a) = audio {
        let changed = s.audio_kbps.is_some()
            || s.sample_rate.is_some_and(|r| Some(r) != a.sample_rate)
            || s.channels.is_some_and(|n| Some(n) != a.channels);
        let (e, copy) = choose(
            &s.audio_encoder,
            &c.audio,
            &c.copy_audio,
            a.acodec.as_deref(),
            changed,
            engines,
        )?;
        let resolved = if copy {
            c.audio
                .iter()
                .find(|x| encoder_codec(x) == e)
                .map(String::as_str)
                .unwrap_or(&e)
        } else {
            &e
        };
        if let Some(b) = s.audio_kbps {
            bitrate(resolved, b)?;
        }
        if let Some(rate) = s.sample_rate {
            if ![8000, 16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000].contains(&rate)
                || (resolved == "libopus" && ![8000, 16000, 24000, 48000].contains(&rate))
                || (resolved == "libmp3lame" && rate > 48000)
            {
                return Err(
                    "That sample rate is incompatible with the selected audio encoder.".into(),
                );
            }
        }
        if s.channels.is_some_and(|n| ![1, 2].contains(&n)) {
            return Err("Choose Same as source, Mono or Stereo.".into());
        }
        if resolved == "libmp3lame" && s.channels.is_none() && a.channels.is_some_and(|n| n > 2) {
            return Err("MP3 requires Mono or Stereo for this multichannel source.".into());
        }
        // Opus always decodes at 48 kHz. Reject requests that cannot be verified as that rate.
        if resolved == "libopus" && s.sample_rate.is_some_and(|r| r != 48000) {
            return Err(
                "Opus output uses 48000 Hz. Choose 48000 Hz explicitly when changing sample rate."
                    .into(),
            );
        }
        if !copy
            && s.sample_rate.is_none()
            && ((resolved == "libopus" && a.sample_rate.is_some_and(|r| r != 48000))
                || (resolved == "libmp3lame" && a.sample_rate.is_some_and(|r| r > 48000)))
        {
            return Err("The source sample rate is incompatible with the output codec. Choose a supported sample rate explicitly.".into());
        }
        copy_audio = copy;
        Some(e)
    } else {
        None
    };
    let mut ids = Vec::new();
    for f in [video, audio].into_iter().flatten() {
        if !ids.contains(&f.id) {
            ids.push(f.id.clone());
        }
    }
    let conversion =
        video_encoder.is_some() && !copy_video || audio_encoder.is_some() && !copy_audio;
    let uncertain = [video, audio]
        .into_iter()
        .flatten()
        .any(|f| f.uncertain || f.video && f.vcodec.is_none() || f.audio && f.acodec.is_none());
    let summary = format!(
        "{} · {} · {} · {}",
        s.format.to_uppercase(),
        if s.mode == "video" {
            s.resolution
                .map(|h| format!("{h}p"))
                .unwrap_or("source resolution".into())
        } else {
            "audio only".into()
        },
        s.fps.map(|f| format!("{f} fps")).unwrap_or(
            if s.mode == "video" {
                "source frame rate"
            } else {
                "selected audio settings"
            }
            .into()
        ),
        if uncertain {
            "conversion may be required (incomplete source details)"
        } else if conversion {
            "conversion required"
        } else {
            "stream copy / remux"
        }
    );
    Ok(Plan {
        sources: ids.clone(),
        video_source: video.map(|f| f.id.clone()),
        audio_source: audio.map(|f| f.id.clone()),
        video_encoder,
        audio_encoder,
        copy_video,
        copy_audio,
        conversion,
        merge: ids.len() > 1,
        uncertain,
        summary,
    })
}
// Source IDs are resolved once during planning. Measured metadata refines encoding
// decisions; it must never run Best/Automatic again against undownloaded variants.
pub fn bound_settings(s: &Settings, p: &Plan) -> Settings {
    let mut bound = s.clone();
    if let Some(id) = &p.video_source {
        bound.video_source = id.clone();
    }
    if let Some(id) = &p.audio_source {
        bound.audio_source = id.clone();
    }
    bound
}
pub fn reconcile(media: &Media, s: &Settings, p: &Plan, engines: &Engines) -> Result<Plan> {
    for (id, video) in [
        (p.video_source.as_ref(), true),
        (p.audio_source.as_ref(), false),
    ] {
        if let Some(id) = id {
            if media.formats.iter().find(|f| &f.id == id).is_none_or(|f| {
                if video {
                    !f.video
                } else {
                    !f.audio
                }
            }) {
                return Err(format!("The site's streams changed: selected {} stream {id} is absent from its downloaded file. Inspect the link again.",if video{"video"}else{"audio"}));
            }
        }
    }
    build(media, &bound_settings(s, p), engines)
}
pub fn ffmpeg_args(
    inputs: &[std::path::PathBuf],
    output: &std::path::Path,
    s: &Settings,
    p: &Plan,
) -> Vec<String> {
    let mut args = vec![
        "-hide_banner",
        "-nostdin",
        "-n",
        "-loglevel",
        "error",
        "-nostats",
        "-progress",
        "pipe:1",
    ]
    .into_iter()
    .map(String::from)
    .collect::<Vec<_>>();
    for input in inputs {
        args.extend([
            "-protocol_whitelist".into(),
            "file,pipe".into(),
            "-format_whitelist".into(),
            super::INPUT_FORMATS.into(),
            "-i".into(),
            input.to_string_lossy().into_owned(),
        ]);
    }
    if let Some(e) = &p.video_encoder {
        let index = p
            .sources
            .iter()
            .position(|id| Some(id) == p.video_source.as_ref())
            .unwrap();
        args.extend([
            "-map".into(),
            format!("{index}:v:0"),
            "-c:v".into(),
            if p.copy_video {
                "copy".into()
            } else {
                e.clone()
            },
        ]);
        if !p.copy_video {
            args.extend(["-pix_fmt", "yuv420p"].map(String::from));
            let scale = if let Some(h) = s.resolution {
                format!("scale=w='max(2,trunc(iw*min(1,{h}/ih)/2)*2)':h='max(2,trunc(ih*min(1,{h}/ih)/2)*2)'")
            } else {
                "scale=trunc(iw/2)*2:trunc(ih/2)*2".into()
            };
            args.extend(["-vf".into(), scale]);
            if let Some(f) = s.fps {
                args.extend(["-r".into(), f.to_string()]);
            }
            args.extend([
                "-fps_mode:v".into(),
                if s.fps.is_some() {
                    "cfr"
                } else {
                    "passthrough"
                }
                .into(),
            ]);
            if s.quality == "bitrate" {
                args.extend(["-b:v".into(), format!("{}k", s.video_kbps.unwrap())]);
            } else {
                let q = match (e.as_str(), s.quality.as_str()) {
                    ("libx264" | "libx265", "high") => 18,
                    ("libx264" | "libx265", "small") => 28,
                    ("libx264" | "libx265", _) => 23,
                    (_, "high") => 24,
                    (_, "small") => 40,
                    _ => 32,
                };
                args.extend(["-crf".into(), q.to_string()]);
                if e == "libvpx-vp9" {
                    args.extend(["-b:v", "0"].map(String::from));
                }
            }
            if e == "libx264" || e == "libx265" {
                args.extend(["-preset", "medium"].map(String::from));
            }
            if e == "libvpx-vp9" {
                args.extend(["-deadline", "good", "-cpu-used", "2"].map(String::from));
            }
            if e == "libaom-av1" {
                args.extend(["-cpu-used", "6"].map(String::from));
            }
        }
    } else {
        args.push("-vn".into());
    }
    if let Some(e) = &p.audio_encoder {
        let index = p
            .sources
            .iter()
            .position(|id| Some(id) == p.audio_source.as_ref())
            .unwrap();
        args.extend([
            "-map".into(),
            format!("{index}:a:0"),
            "-c:a".into(),
            if p.copy_audio {
                "copy".into()
            } else {
                e.clone()
            },
        ]);
        if !p.copy_audio {
            if !matches!(e.as_str(), "flac" | "pcm_s16le") {
                let b = s
                    .audio_kbps
                    .unwrap_or(if e == "libopus" { 128 } else { 192 });
                args.extend(["-b:a".into(), format!("{b}k")]);
            }
            if let Some(rate) = s.sample_rate {
                args.extend(["-ar".into(), rate.to_string()]);
            }
            if let Some(ch) = s.channels {
                args.extend(["-ac".into(), ch.to_string()]);
            }
        }
    } else {
        args.push("-an".into());
    }
    args.extend(["-sn", "-dn", "-map_metadata", "-1", "-map_chapters", "-1"].map(String::from));
    if matches!(s.format.as_str(), "mp4" | "m4a") {
        args.extend(["-movflags", "+faststart"].map(String::from));
    }
    args.extend([
        "-f".into(),
        container(&s.format).unwrap().muxer,
        output.to_string_lossy().into_owned(),
    ]);
    args
}
