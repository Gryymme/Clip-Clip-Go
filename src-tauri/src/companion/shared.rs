//! Versioned, bounded Native Messaging and IPC payloads. No engine options or paths.
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
pub type Result<T> = std::result::Result<T, String>;
pub const HOST: &str = "com.clipclipgo.companion";
pub const MAX_MESSAGE: usize = 48 * 1024;
pub const TTL: u64 = 10 * 60 * 1000;
pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
pub fn http_url(input: &str) -> Result<url::Url> {
    if input.len() > 8192 || input.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("Invalid media URL.".into());
    }
    let u = url::Url::parse(input).map_err(|_| "Invalid HTTP(S) URL.")?;
    if !matches!(u.scheme(), "http" | "https")
        || u.host_str().is_none()
        || !u.username().is_empty()
        || u.password().is_some()
    {
        return Err("Use HTTP(S) URLs without credentials; blob sources are browser-local.".into());
    }
    Ok(u)
}
pub fn extension_id(value: &str) -> bool {
    value.len() == 32 && value.bytes().all(|b| (b'a'..=b'p').contains(&b))
}
pub fn sender_id(origin: &str) -> Result<&str> {
    let id = origin
        .strip_prefix("chrome-extension://")
        .and_then(|s| s.strip_suffix('/'))
        .ok_or("Rejected sender origin.")?;
    if !extension_id(id) {
        return Err("Rejected sender origin.".into());
    }
    Ok(id)
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Context {
    pub referer: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Candidate {
    pub id: String,
    pub page_url: String,
    pub frame_url: String,
    pub media_url: String,
    pub media_type: String,
    pub title: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub drm: Option<bool>,
    pub frame_id: u32,
    pub document_id: String,
    pub navigation_id: String,
    pub observed_at: u64,
    pub expires_at: u64,
    pub context: Context,
}
fn identifier(s: &str, limit: usize) -> bool {
    !s.is_empty()
        && s.len() <= limit
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
}
impl Candidate {
    pub fn validate(&self, clock: u64) -> Result<()> {
        if self.drm == Some(true) {
            return Err("DRM-protected media is unsupported.".into());
        }
        if !identifier(&self.id, 64)
            || !identifier(&self.navigation_id, 64)
            || self.document_id.len() > 128
            || self.document_id.chars().any(char::is_control)
            || self.frame_id > 1_000_000
        {
            return Err("Invalid candidate identity.".into());
        }
        let page = http_url(&self.page_url)?;
        let frame = http_url(&self.frame_url)?;
        http_url(&self.media_url)?;
        if !["direct", "hls", "dash"].contains(&self.media_type.as_str())
            || self.title.as_ref().is_some_and(|s| {
                s.len() > 4096
                    || s.chars().count() > 1024
                    || s.chars().any(|c| c.is_control() && c != '\n')
            })
            || [self.width, self.height]
                .iter()
                .flatten()
                .any(|n| *n == 0 || *n > 32768)
        {
            return Err("Invalid media metadata.".into());
        }
        if self.expires_at <= clock
            || self.observed_at > clock + 60_000
            || self.expires_at < self.observed_at
            || self.expires_at - self.observed_at > TTL
            || clock.saturating_sub(self.observed_at) > TTL
        {
            return Err("Source expired. Detect it again in the browser.".into());
        }
        if let Some(r) = &self.context.referer {
            let r = http_url(r)?;
            if r.origin() != page.origin() && r.origin() != frame.origin() {
                return Err("Referer context is unrelated to the selected frame.".into());
            }
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum Request {
    Hello {
        v: u8,
        #[serde(rename = "requestId")]
        request_id: String,
    },
    Candidate {
        v: u8,
        #[serde(rename = "requestId")]
        request_id: String,
        candidate: Candidate,
    },
}
impl Request {
    pub fn id(&self) -> &str {
        match self {
            Self::Hello { request_id, .. } | Self::Candidate { request_id, .. } => request_id,
        }
    }
    pub fn validate(&self, clock: u64) -> Result<()> {
        let v = match self {
            Self::Hello { v, .. } | Self::Candidate { v, .. } => *v,
        };
        if v != 1 || !identifier(self.id(), 64) {
            return Err("Unsupported bridge version or request identity.".into());
        }
        if let Self::Candidate { candidate, .. } = self {
            candidate.validate(clock)?;
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Envelope {
    pub origin: String,
    pub request: Request,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Reply {
    pub v: u8,
    pub request_id: String,
    pub ok: bool,
    pub code: String,
    pub message: String,
}
impl Reply {
    pub fn new(request: &Request, ok: bool, code: &str, message: &str) -> Self {
        Self {
            v: 1,
            request_id: request.id().into(),
            ok,
            code: code.into(),
            message: message.into(),
        }
    }
}
pub fn read_frame<R: Read, T: serde::de::DeserializeOwned>(reader: &mut R) -> Result<Option<T>> {
    let mut header = [0u8; 4];
    let count = reader
        .read(&mut header[..1])
        .map_err(|_| "Bridge read failed.")?;
    if count == 0 {
        return Ok(None);
    }
    reader
        .read_exact(&mut header[1..])
        .map_err(|_| "Truncated bridge length.")?;
    let length = u32::from_le_bytes(header) as usize;
    if length == 0 || length > MAX_MESSAGE {
        return Err("Bridge message exceeds the allowed size.".into());
    }
    let mut data = vec![0; length];
    reader
        .read_exact(&mut data)
        .map_err(|_| "Truncated bridge message.")?;
    serde_json::from_slice(&data)
        .map(Some)
        .map_err(|_| "Invalid bridge schema or JSON.".into())
}
pub fn write_frame<W: Write, T: Serialize>(writer: &mut W, value: &T) -> Result<()> {
    let data = serde_json::to_vec(value).map_err(|_| "Could not encode bridge message.")?;
    if data.len() > MAX_MESSAGE {
        return Err("Bridge response exceeds the allowed size.".into());
    }
    writer
        .write_all(&(data.len() as u32).to_le_bytes())
        .and_then(|_| writer.write_all(&data))
        .and_then(|_| writer.flush())
        .map_err(|_| "Bridge write failed.".into())
}
#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    pub fn candidate() -> Candidate {
        Candidate {
            id: "fixture-1".into(),
            page_url: "https://page.example.test/watch?q=keep".into(),
            frame_url: "https://frame.example.test/player".into(),
            media_url: "https://cdn.example.test/video?signature=keep%2Bexact".into(),
            media_type: "direct".into(),
            title: None,
            width: None,
            height: None,
            drm: None,
            frame_id: 2,
            document_id: "document".into(),
            navigation_id: "navigation".into(),
            observed_at: now(),
            expires_at: now() + TTL - 100,
            context: Context {
                referer: Some("https://frame.example.test/player".into()),
            },
        }
    }
    #[test]
    fn framing_sender_schema_and_expiry() {
        let request = Request::Candidate {
            v: 1,
            request_id: "request".into(),
            candidate: candidate(),
        };
        request.validate(now()).unwrap();
        let mut bytes = vec![];
        write_frame(&mut bytes, &request).unwrap();
        let parsed: Request = read_frame(&mut &bytes[..]).unwrap().unwrap();
        assert_eq!(parsed.id(), "request");
        for data in [
            &bytes[..2],
            &bytes[..bytes.len() - 1],
            &[255u8; 4][..],
            b"\0\0\0\0",
        ] {
            assert!(read_frame::<_, Request>(&mut &*data).is_err());
        }
        assert!(sender_id("chrome-extension://abcdefghijklmnopabcdefghijklmnop/").is_ok());
        for sender in [
            "https://example.test/",
            "chrome-extension://*/",
            "chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz/",
        ] {
            assert!(sender_id(sender).is_err());
        }
        assert!(serde_json::from_str::<Request>(
            r#"{"v":1,"type":"hello","requestId":"r","command":"exec"}"#
        )
        .is_err());
        let mut c = candidate();
        c.expires_at = now() - 1;
        assert!(c.validate(now()).is_err());
        c = candidate();
        c.context.referer = Some("https://other.test/".into());
        assert!(c.validate(now()).is_err());
        c = candidate();
        c.media_url = "blob:https://example.test/id".into();
        assert!(c.validate(now()).is_err());
    }
}
