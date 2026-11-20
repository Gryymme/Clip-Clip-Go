use crate::process::Result;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Format {
    pub id: String,
    pub ext: String,
    pub video: bool,
    pub audio: bool,
    pub uncertain: bool,
    pub vcodec: Option<String>,
    pub acodec: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f64>,
    pub bitrate: Option<f64>,
    pub size: Option<u64>,
    pub approximate_size: bool,
    pub sample_rate: Option<u32>,
    pub channels: Option<u32>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Media {
    pub title: String,
    pub source: String,
    pub thumbnail: Option<String>,
    pub duration: Option<f64>,
    pub formats: Vec<Format>,
}
pub fn url(input: &str) -> Result<String> {
    if input.len() > 8192 || input.chars().any(char::is_control) {
        return Err("Enter one HTTP or HTTPS media URL (maximum 8192 characters).".into());
    }
    let parsed =
        tauri::Url::parse(input.trim()).map_err(|_| "Enter a valid HTTP or HTTPS media URL.")?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("Use HTTP or HTTPS without embedded credentials.".into());
    }
    Ok(parsed.to_string())
}
pub fn positive(v: &Value) -> Option<f64> {
    v.as_f64().filter(|n| n.is_finite() && *n > 0.0)
}
fn integer(v: &Value) -> Option<u32> {
    v.as_u64()
        .and_then(|n| u32::try_from(n).ok())
        .filter(|n| *n > 0)
}
pub fn codec(s: &str) -> String {
    let prefix = s.split('.').next().unwrap_or(s);
    match prefix {
        "avc1" | "avc3" => "h264",
        "hev1" | "hvc1" => "hevc",
        "vp09" => "vp9",
        "av01" => "av1",
        "mp4a" => "aac",
        _ => prefix,
    }
    .to_string()
}
pub fn parse(bytes: &[u8], original: &str) -> Result<Media> {
    let doc: Value = serde_json::from_slice(bytes)
        .map_err(|_| "The site returned unreadable media information.")?;
    if doc["_type"].as_str().is_some_and(|t| t != "video") || doc.get("entries").is_some() {
        return Err("Choose one media item. Playlists and channels are not supported.".into());
    }
    if doc["is_live"] == true
        || matches!(
            doc["live_status"].as_str(),
            Some("is_live" | "is_upcoming" | "post_live")
        )
    {
        return Err(
            "Live and upcoming streams are not supported. Try a completed recording.".into(),
        );
    }
    if doc["has_drm"] == true {
        return Err("DRM-protected media is not supported.".into());
    }
    let raw = doc["formats"]
        .as_array()
        .cloned()
        .unwrap_or_else(|| vec![doc.clone()]);
    if raw.len() > 2000 {
        return Err("This item has too many source variants to inspect safely.".into());
    }
    let mut formats = Vec::new();
    for f in raw {
        if f["has_drm"] == true
            || !matches!(
                f["protocol"].as_str(),
                None | Some("http" | "https" | "m3u8_native" | "m3u8" | "http_dash_segments")
            )
        {
            continue;
        }
        let Some(id) = f["format_id"].as_str().filter(|id| {
            !id.is_empty()
                && id.len() <= 128
                && id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
        }) else {
            continue;
        };
        let ext = f["ext"].as_str().unwrap_or("").to_string();
        let v = f["vcodec"].as_str();
        let a = f["acodec"].as_str();
        let uncertain = v.is_none() || a.is_none();
        let audio_extension = matches!(
            ext.as_str(),
            "mp3" | "m4a" | "wav" | "flac" | "ogg" | "opus" | "aac"
        );
        let video = match v {
            Some("none") => false,
            Some(_) => true,
            None => !audio_extension && a.is_none_or(|c| c == "none"),
        };
        let audio = match a {
            Some("none") => false,
            Some(_) => true,
            None => audio_extension || v == Some("none"),
        };
        if !video && !audio {
            continue;
        }
        if formats.iter().any(|x: &Format| x.id == id) {
            continue;
        }
        formats.push(Format {
            id: id.into(),
            ext,
            video,
            audio,
            uncertain,
            vcodec: v.filter(|s| *s != "none").map(codec),
            acodec: a.filter(|s| *s != "none").map(codec),
            width: integer(&f["width"]),
            height: integer(&f["height"]),
            fps: positive(&f["fps"]),
            bitrate: positive(&f["tbr"]),
            size: f["filesize"].as_u64().or(f["filesize_approx"].as_u64()),
            approximate_size: f["filesize"].as_u64().is_none(),
            sample_rate: integer(&f["asr"]),
            channels: integer(&f["audio_channels"]),
        });
    }
    if formats.is_empty() {
        return Err("No downloadable, unprotected audio or video streams were reported.".into());
    }
    Ok(Media {
        title: doc["title"]
            .as_str()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or("Untitled media")
            .chars()
            .take(1024)
            .collect(),
        source: doc["extractor_key"]
            .as_str()
            .or(doc["extractor"].as_str())
            .unwrap_or_else(|| {
                tauri::Url::parse(original)
                    .ok()
                    .and_then(|u| u.host_str().map(String::from))
                    .map(|_| "Direct media")
                    .unwrap_or("Media")
            })
            .chars()
            .take(128)
            .collect(),
        thumbnail: doc["thumbnail"].as_str().and_then(|s| url(s).ok()),
        duration: positive(&doc["duration"]),
        formats,
    })
}
pub fn site_error(text: &str) -> String {
    super::errors::message(text)
}
