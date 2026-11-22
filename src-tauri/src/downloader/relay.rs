//! Ephemeral loopback transport for narrowly scoped browser Referer context.
//! No cookies, browser cache, captured response body, or yt-dlp global headers.
use crate::{
    companion::{
        shared::{http_url, Candidate},
        windows::wide,
    },
    process::Result,
};
use std::{
    ffi::c_void,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    ptr::{null, null_mut},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use url::Url;
use windows_sys::Win32::Networking::WinHttp::*;
const MAX_MANIFEST: usize = 4 * 1024 * 1024;
const MEDIA_EXTENSIONS: &[&str] = &[
    "mp4", "m4a", "webm", "mkv", "mov", "m4v", "mp3", "wav", "ogg", "opus", "flac", "aac", "m3u8",
    "mpd", "m4s", "ts",
];
pub struct Relay {
    pub url: String,
    stop: Arc<AtomicBool>,
    failure: Arc<Mutex<Option<String>>>,
    thread: Option<std::thread::JoinHandle<()>>,
}
#[derive(Clone)]
struct Routes {
    base: String,
    origin: url::Origin,
    referer: String,
    stop: Arc<AtomicBool>,
    failure: Arc<Mutex<Option<String>>>,
}
fn encode_template(value: &str) -> String {
    // DASH template variables must remain visible to yt-dlp before each request.
    let mut text = value.to_string();
    let mut vars = vec![];
    let mut offset = 0;
    while let Some(start) = text[offset..].find('$') {
        let start = offset + start;
        let Some(end) = text[start + 1..].find('$') else {
            break;
        };
        let end = start + 1 + end;
        let token = text[start..=end].to_owned();
        if token[1..token.len() - 1]
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"%_".contains(&b))
        {
            let placeholder = format!("CCGTEMPLATE{}END", vars.len());
            text.replace_range(start..=end, &placeholder);
            offset = start + placeholder.len();
            vars.push((placeholder, token));
        } else {
            offset = end + 1;
        }
    }
    let mut encoded = url::form_urlencoded::byte_serialize(text.as_bytes()).collect::<String>();
    for (key, value) in vars {
        encoded = encoded.replace(&key, &value);
    }
    encoded
}
impl Routes {
    fn map(&self, base: &Url, target: &str) -> Result<String> {
        let u = base
            .join(target.trim())
            .map_err(|_| "Invalid media manifest URL.")?;
        http_url(u.as_str())?;
        let ext = u
            .path()
            .rsplit('.')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();
        let suffix = if MEDIA_EXTENSIONS.contains(&ext.as_str()) {
            format!(".{ext}")
        } else {
            String::new()
        };
        Ok(format!(
            "{}/media{suffix}?u={}",
            self.base,
            encode_template(u.as_str())
        ))
    }
    fn check(&self) -> Result<()> {
        if self.stop.load(Ordering::SeqCst) {
            return Err("Browser media transport stopped.".into());
        }
        Ok(())
    }
}
impl Relay {
    pub fn start(c: &Candidate) -> Result<Self> {
        c.validate(crate::companion::shared::now())?;
        let referer = c
            .context
            .referer
            .clone()
            .ok_or("Browser Referer context is missing.")?;
        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|_| "Cannot start scoped browser media transport.")?;
        listener
            .set_nonblocking(true)
            .map_err(|_| "Cannot configure browser transport.")?;
        let mut random = [0u8; 32];
        getrandom::fill(&mut random).map_err(|_| "Cannot secure browser transport.")?;
        let token = random
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        let base = format!(
            "http://127.0.0.1:{}/{}",
            listener
                .local_addr()
                .map_err(|_| "Cannot configure browser transport.")?
                .port(),
            token
        );
        let stop = Arc::new(AtomicBool::new(false));
        let failure = Arc::new(Mutex::new(None));
        let routes = Routes {
            base,
            origin: http_url(&c.media_url)?.origin(),
            referer,
            stop: stop.clone(),
            failure: failure.clone(),
        };
        let url = routes.map(&http_url(&c.media_url)?, &c.media_url)?;
        let count = Arc::new(AtomicUsize::new(0));
        let thread = std::thread::spawn(move || {
            while routes.check().is_ok() {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let routes = routes.clone();
                        let count = count.clone();
                        if count.fetch_add(1, Ordering::SeqCst) >= 8 {
                            count.fetch_sub(1, Ordering::SeqCst);
                            let _=stream.write_all(b"HTTP/1.1 503 Busy\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
                            continue;
                        }
                        std::thread::spawn(move || {
                            let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                            let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
                            if let Err(error) = serve(&mut stream, &routes) {
                                *routes.failure.lock().unwrap() = Some(error);
                                let _=stream.write_all(b"HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
                            }
                            count.fetch_sub(1, Ordering::SeqCst);
                        });
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(10))
                    }
                    Err(_) => break,
                }
            }
        });
        Ok(Self {
            url,
            stop,
            failure,
            thread: Some(thread),
        })
    }
    pub fn failure(&self) -> Option<String> {
        self.failure.lock().unwrap().clone()
    }
}
impl Drop for Relay {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}
struct Internet(*mut c_void);
impl Drop for Internet {
    fn drop(&mut self) {
        unsafe {
            WinHttpCloseHandle(self.0);
        }
    }
}
struct Response {
    request: Internet,
    _connection: Internet,
    _session: Internet,
    url: Url,
    status: u32,
}
fn option(handle: *mut c_void, key: u32, value: u32) -> Result<()> {
    if unsafe { WinHttpSetOption(handle, key, &value as *const _ as _, 4) } == 0 {
        return Err("Cannot restrict browser media request context.".into());
    }
    Ok(())
}
fn header(handle: *mut c_void, key: u32) -> Option<String> {
    unsafe {
        let mut n = 0;
        WinHttpQueryHeaders(handle, key, null(), null_mut(), &mut n, null_mut());
        if n == 0 || n > 32768 {
            return None;
        }
        let mut buf = vec![0u16; n as usize / 2 + 1];
        if WinHttpQueryHeaders(
            handle,
            key,
            null(),
            buf.as_mut_ptr() as _,
            &mut n,
            null_mut(),
        ) == 0
        {
            return None;
        }
        let s =
            String::from_utf16_lossy(&buf[..buf.iter().position(|c| *c == 0).unwrap_or(buf.len())]);
        if s.chars().any(char::is_control) {
            return None;
        }
        Some(s)
    }
}
pub fn scoped_referer<'a>(
    origin: &url::Origin,
    target: &Url,
    redirected: bool,
    referer: &'a str,
) -> Option<&'a str> {
    if !redirected && *origin == target.origin() {
        Some(referer)
    } else {
        None
    }
}
fn fetch(routes: &Routes, mut target: Url, method: &str, range: Option<&str>) -> Result<Response> {
    for redirects in 0..=5 {
        routes.check()?;
        http_url(target.as_str())?;
        unsafe {
            let session = Internet(WinHttpOpen(
                wide("ClipClipGO/0.1").as_ptr(),
                WINHTTP_ACCESS_TYPE_NO_PROXY,
                null(),
                null(),
                0,
            ));
            if session.0.is_null() {
                return Err("Cannot initialize browser media transport.".into());
            }
            if WinHttpSetTimeouts(session.0, 3000, 3000, 3000, 1500) == 0 {
                return Err("Cannot set browser media network deadlines.".into());
            }
            let host = target
                .host_str()
                .ok_or("Invalid media host.")?
                .trim_matches(['[', ']']);
            let connection = Internet(WinHttpConnect(
                session.0,
                wide(host).as_ptr(),
                target
                    .port_or_known_default()
                    .ok_or("Invalid media port.")?,
                0,
            ));
            if connection.0.is_null() {
                return Err("Cannot connect to browser media host.".into());
            }
            let path = match target.query() {
                Some(q) => format!("{}?{q}", target.path()),
                None => target.path().to_owned(),
            };
            let flags = WINHTTP_FLAG_ESCAPE_DISABLE
                | WINHTTP_FLAG_ESCAPE_DISABLE_QUERY
                | if target.scheme() == "https" {
                    WINHTTP_FLAG_SECURE
                } else {
                    0
                };
            let request = Internet(WinHttpOpenRequest(
                connection.0,
                wide(method).as_ptr(),
                wide(path).as_ptr(),
                null(),
                null(),
                null(),
                flags,
            ));
            if request.0.is_null() {
                return Err("Cannot prepare browser media request.".into());
            }
            option(
                request.0,
                WINHTTP_OPTION_REDIRECT_POLICY,
                WINHTTP_OPTION_REDIRECT_POLICY_NEVER,
            )?;
            option(
                request.0,
                WINHTTP_OPTION_DISABLE_FEATURE,
                WINHTTP_DISABLE_COOKIES | WINHTTP_DISABLE_AUTHENTICATION,
            )?;
            option(
                request.0,
                WINHTTP_OPTION_AUTOLOGON_POLICY,
                WINHTTP_AUTOLOGON_SECURITY_LEVEL_HIGH,
            )?;
            let mut headers = "Accept-Encoding: identity\r\n".to_string();
            if let Some(referer) =
                scoped_referer(&routes.origin, &target, redirects > 0, &routes.referer)
            {
                headers.push_str(&format!("Referer: {referer}\r\n"));
            }
            if let Some(range) = range {
                headers.push_str(&format!("Range: {range}\r\n"));
            }
            if WinHttpSendRequest(
                request.0,
                wide(&headers).as_ptr(),
                u32::MAX,
                null(),
                0,
                0,
                0,
            ) == 0
                || WinHttpReceiveResponse(request.0, null_mut()) == 0
            {
                return Err("Browser media network request failed or timed out.".into());
            }
            let status = header(request.0, WINHTTP_QUERY_STATUS_CODE)
                .and_then(|s| s.parse().ok())
                .ok_or("Invalid browser media HTTP response.")?;
            if [301, 302, 303, 307, 308].contains(&status) {
                let next = header(request.0, WINHTTP_QUERY_LOCATION)
                    .ok_or("Media redirect has no location.")?;
                let next = target.join(&next).map_err(|_| "Invalid media redirect.")?;
                http_url(next.as_str())?;
                if target.scheme() == "https" && next.scheme() != "https" {
                    return Err("An insecure media redirect was rejected.".into());
                }
                target = next;
                continue;
            }
            return Ok(Response {
                request,
                _connection: connection,
                _session: session,
                url: target,
                status,
            });
        }
    }
    Err("Too many browser media redirects.".into())
}
fn read_response(response: &Response, buf: &mut [u8]) -> Result<usize> {
    let mut n = 0;
    if unsafe {
        WinHttpReadData(
            response.request.0,
            buf.as_mut_ptr() as _,
            buf.len() as u32,
            &mut n,
        )
    } == 0
    {
        return Err("Browser media response was interrupted or timed out.".into());
    }
    Ok(n as usize)
}
fn serve(stream: &mut TcpStream, routes: &Routes) -> Result<()> {
    let mut bytes = vec![];
    let mut b = [0];
    while !bytes.ends_with(b"\r\n\r\n") {
        routes.check()?;
        if bytes.len() >= 40 * 1024
            || stream
                .read(&mut b)
                .map_err(|_| "Local media request timed out.")?
                == 0
        {
            return Err("Invalid local media request.".into());
        }
        bytes.push(b[0]);
    }
    let text = std::str::from_utf8(&bytes).map_err(|_| "Invalid local media request.")?;
    let mut lines = text.lines();
    let mut parts = lines
        .next()
        .ok_or("Invalid media request.")?
        .split_whitespace();
    let method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("");
    if !["GET", "HEAD"].contains(&method) || !path.starts_with('/') || path.starts_with("//") {
        return Err("Local media request rejected.".into());
    }
    let local = Url::parse(&format!("http://127.0.0.1{path}"))
        .map_err(|_| "Invalid local media request.")?;
    let prefix = Url::parse(&routes.base).unwrap().path().to_owned() + "/media";
    let valid_suffix = local.path().strip_prefix(&prefix).is_some_and(|suffix| {
        suffix.is_empty()
            || suffix
                .strip_prefix('.')
                .is_some_and(|ext| MEDIA_EXTENSIONS.contains(&ext))
    });
    if !valid_suffix {
        return Err("Local media token rejected.".into());
    }
    let query = local.query_pairs().collect::<Vec<_>>();
    if query.len() != 1 || query[0].0 != "u" {
        return Err("Invalid local media route.".into());
    }
    let target = http_url(&query[0].1)?;
    let range = lines.find_map(|line| {
        let (k, v) = line.split_once(':')?;
        if k.eq_ignore_ascii_case("range") {
            let v = v.trim();
            if v.len() <= 128
                && v.starts_with("bytes=")
                && v[6..]
                    .bytes()
                    .all(|b| b.is_ascii_digit() || b",-".contains(&b))
            {
                Some(v)
            } else {
                None
            }
        } else {
            None
        }
    });
    let response = fetch(routes, target, method, range)?;
    let ct = header(response.request.0, WINHTTP_QUERY_CONTENT_TYPE)
        .unwrap_or_else(|| "application/octet-stream".into());
    let manifest = ct.to_ascii_lowercase().contains("mpegurl")
        || ct.to_ascii_lowercase().contains("dash+xml")
        || response.url.path().to_ascii_lowercase().ends_with(".m3u8")
        || response.url.path().to_ascii_lowercase().ends_with(".mpd");
    if manifest && response.status == 200 && method == "GET" {
        let mut body = vec![];
        let mut buf = [0; 65536];
        loop {
            routes.check()?;
            let n = read_response(&response, &mut buf)?;
            if n == 0 {
                break;
            }
            if body.len() + n > MAX_MANIFEST {
                return Err("Media manifest is too large to inspect safely.".into());
            }
            body.extend_from_slice(&buf[..n]);
        }
        let content = std::str::from_utf8(&body)
            .map_err(|_| "Only UTF-8 browser media manifests are supported.".to_string())?;
        let is_hls = content.trim_start().starts_with("#EXTM3U");
        let ct = if is_hls {
            "application/vnd.apple.mpegurl"
        } else {
            "application/dash+xml"
        };
        let rewritten = if is_hls {
            hls(content, &response.url, &|base, u| routes.map(base, u))?
        } else {
            dash(content, &response.url, &|base, u| routes.map(base, u))?
        };
        write!(stream,"HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Type: {ct}\r\nContent-Length: {}\r\n\r\n{rewritten}",rewritten.len()).map_err(|_|"Media consumer disconnected.")?;
    } else {
        write!(
            stream,
            "HTTP/1.1 {} Media\r\nConnection: close\r\nContent-Type: {ct}\r\n",
            response.status
        )
        .map_err(|_| "Media consumer disconnected.")?;
        for (name, key) in [
            ("Content-Length", WINHTTP_QUERY_CONTENT_LENGTH),
            ("Content-Range", WINHTTP_QUERY_CONTENT_RANGE),
            ("Accept-Ranges", WINHTTP_QUERY_ACCEPT_RANGES),
        ] {
            if let Some(value) = header(response.request.0, key) {
                write!(stream, "{name}: {value}\r\n")
                    .map_err(|_| "Media consumer disconnected.")?;
            }
        }
        stream
            .write_all(b"\r\n")
            .map_err(|_| "Media consumer disconnected.")?;
        if method == "GET" {
            let mut buf = [0; 65536];
            loop {
                routes.check()?;
                let n = read_response(&response, &mut buf)?;
                if n == 0 {
                    break;
                }
                stream
                    .write_all(&buf[..n])
                    .map_err(|_| "Media consumer disconnected.")?;
            }
        }
    }
    Ok(())
}
type Mapper<'a> = dyn Fn(&Url, &str) -> Result<String> + 'a;
pub fn hls(text: &str, base: &Url, map: &Mapper<'_>) -> Result<String> {
    if !text.contains("#EXT-X-STREAM-INF") && !text.contains("#EXT-X-ENDLIST") {
        return Err("Live or incomplete HLS playlists are unsupported.".into());
    }
    if text.contains("SAMPLE-AES")
        || text.lines().any(|l| {
            l.starts_with("#EXT-X-KEY")
                && l.contains("KEYFORMAT=")
                && !l.contains("KEYFORMAT=\"identity\"")
        })
    {
        return Err("DRM-protected or unsupported encrypted HLS is not supported.".into());
    }
    let mut out = String::new();
    for line in text.lines() {
        let mut line = line.trim().to_owned();
        if !line.is_empty() {
            if !line.starts_with('#') {
                line = map(base, &line)?;
            } else {
                let mut offset = 0;
                while let Some(start) = line[offset..].find("URI=\"") {
                    let start = offset + start + 5;
                    let end = start
                        + line[start..]
                            .find('"')
                            .ok_or("Invalid HLS URI attribute.")?;
                    let value = map(base, &line[start..end])?;
                    line.replace_range(start..end, &value);
                    offset = start + value.len() + 1;
                }
            }
        }
        out.push_str(&line);
        out.push('\n');
    }
    Ok(out)
}
#[derive(Default)]
struct Node {
    name: String,
    attrs: Vec<(String, String)>,
    children: Vec<Part>,
}
enum Part {
    Node(Node),
    Text(String),
}
fn xml_node(
    reader: &mut quick_xml::Reader<&[u8]>,
    start: quick_xml::events::BytesStart<'_>,
    empty: bool,
    depth: usize,
    count: &mut usize,
) -> Result<Node> {
    if depth > 64 || *count > 50_000 {
        return Err("DASH manifest structure exceeds limits.".into());
    }
    *count += 1;
    let mut node = Node {
        name: start.name().as_ref().to_string(),
        ..Default::default()
    };
    for a in start.attributes() {
        let a = a.map_err(|_| "Invalid DASH attribute.")?;
        node.attrs.push((
            a.key.as_ref().to_string(),
            a.normalized_value(quick_xml::XmlVersion::Implicit1_0)
                .map_err(|_| "Invalid DASH escaping.")?
                .into_owned(),
        ));
    }
    if empty {
        return Ok(node);
    }
    loop {
        match reader.read_event().map_err(|_| "Invalid DASH XML.")? {
            quick_xml::events::Event::Start(s) => node.children.push(Part::Node(xml_node(
                reader,
                s.into_owned(),
                false,
                depth + 1,
                count,
            )?)),
            quick_xml::events::Event::Empty(s) => node.children.push(Part::Node(xml_node(
                reader,
                s.into_owned(),
                true,
                depth + 1,
                count,
            )?)),
            quick_xml::events::Event::Text(t) => {
                let s = t.as_ref();
                node.children.push(Part::Text(
                    quick_xml::escape::unescape(s)
                        .map_err(|_| "Invalid DASH escaping.")?
                        .into_owned(),
                ));
            }
            quick_xml::events::Event::GeneralRef(r) => node.children.push(Part::Text(
                quick_xml::escape::unescape(&format!("&{};", r.as_ref()))
                    .map_err(|_| "Unsupported DASH entity.")?
                    .into_owned(),
            )),
            quick_xml::events::Event::CData(t) => {
                node.children.push(Part::Text(t.as_ref().to_string()))
            }
            quick_xml::events::Event::End(_) => break,
            quick_xml::events::Event::DocType(_) | quick_xml::events::Event::Eof => {
                return Err("Unsupported DASH XML structure.".into())
            }
            _ => {}
        }
    }
    Ok(node)
}
fn local(name: &str) -> &str {
    name.rsplit(':').next().unwrap_or(name)
}
fn rewrite_xml(node: &mut Node, base: &Url, map: &Mapper<'_>) -> Result<()> {
    if local(&node.name) == "ContentProtection" {
        return Err("DRM-protected DASH is unsupported.".into());
    }
    if node
        .attrs
        .iter()
        .any(|(k, v)| k == "type" && v == "dynamic")
    {
        return Err("Live DASH manifests are unsupported.".into());
    }
    if node.attrs.iter().any(|(k, _)| k == "xlink:href") {
        return Err(
            "External DASH XML links are not supported by scoped browser transport.".into(),
        );
    }
    let mut effective = base.clone();
    if let Some((_, value)) = node.attrs.iter().find(|(k, _)| k == "xml:base") {
        effective = base.join(value).map_err(|_| "Invalid DASH base.")?;
    }
    let bases = node
        .children
        .iter()
        .filter_map(|p| {
            if let Part::Node(n) = p {
                if local(&n.name) == "BaseURL" {
                    Some(n)
                } else {
                    None
                }
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    if bases.len() > 1 {
        return Err(
            "Multiple DASH BaseURL alternatives are not supported by scoped browser transport."
                .into(),
        );
    }
    if let Some(b) = bases.first() {
        let text = b
            .children
            .iter()
            .filter_map(|p| {
                if let Part::Text(t) = p {
                    Some(t.as_str())
                } else {
                    None
                }
            })
            .collect::<String>();
        effective = effective
            .join(text.trim())
            .map_err(|_| "Invalid DASH base URL.")?;
    }
    for (k, v) in &mut node.attrs {
        if ["media", "initialization", "sourceURL", "index"].contains(&k.as_str()) && !v.is_empty()
        {
            *v = map(&effective, v)?;
        } else if k == "xml:base" {
            *v = map(&effective, "")?;
        }
    }
    for part in &mut node.children {
        if let Part::Node(child) = part {
            if local(&child.name) == "BaseURL" {
                child.children = vec![Part::Text(map(&effective, "")?)];
            } else {
                rewrite_xml(child, &effective, map)?;
            }
        }
    }
    Ok(())
}
fn xml_write(node: &Node, out: &mut String) {
    out.push('<');
    out.push_str(&node.name);
    for (k, v) in &node.attrs {
        out.push(' ');
        out.push_str(k);
        out.push_str("=\"");
        out.push_str(&quick_xml::escape::escape(v));
        out.push('"');
    }
    out.push('>');
    for p in &node.children {
        match p {
            Part::Text(t) => out.push_str(&quick_xml::escape::escape(t)),
            Part::Node(n) => xml_write(n, out),
        }
    }
    out.push_str("</");
    out.push_str(&node.name);
    out.push('>');
}
pub fn dash(text: &str, base: &Url, map: &Mapper<'_>) -> Result<String> {
    let mut reader = quick_xml::Reader::from_str(text);
    let mut count = 0;
    let mut root = loop {
        match reader.read_event().map_err(|_| "Invalid DASH XML.")? {
            quick_xml::events::Event::Start(s) => {
                break xml_node(&mut reader, s.into_owned(), false, 0, &mut count)?
            }
            quick_xml::events::Event::DocType(_) | quick_xml::events::Event::Eof => {
                return Err("Invalid DASH manifest.".into())
            }
            _ => {}
        }
    };
    if local(&root.name) != "MPD" {
        return Err("The response is not a DASH manifest.".into());
    }
    rewrite_xml(&mut root, base, map)?;
    let mut out = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>");
    xml_write(&root, &mut out);
    Ok(out)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn manifest_context_scope_and_rewriting() {
        let base = Url::parse("https://cdn.example.test/live/master.m3u8?sig=keep").unwrap();
        let other = Url::parse("https://other.example.test/file").unwrap();
        assert!(scoped_referer(&base.origin(), &other, false, "https://page.test/").is_none());
        assert!(scoped_referer(&base.origin(), &base, true, "https://page.test/").is_none());
        assert!(scoped_referer(&base.origin(), &base, false, "https://page.test/").is_some());
        let map = |b: &Url, v: &str| {
            Ok(format!(
                "http://127.0.0.1/token/media?u={}",
                encode_template(b.join(v).unwrap().as_str())
            ))
        };
        let m = hls(
            "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=400000\nhi/media.m3u8?sig=a%2Bb\n",
            &base,
            &map,
        )
        .unwrap();
        assert!(m.contains("sig%3Da%252Bb"));
        assert!(hls("#EXTM3U\n#EXTINF:4\nx.ts", &base, &map).is_err());
        assert!(hls(
            "#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI=\"x\"\n#EXT-X-ENDLIST",
            &base,
            &map
        )
        .is_err());
        let m=dash(r#"<MPD type="static"><BaseURL>assets/</BaseURL><Period><AdaptationSet><SegmentTemplate media="v-$Number%05d$.m4s?sig=a&amp;k=b" initialization="init.mp4"/><Representation id="x"/></AdaptationSet></Period></MPD>"#,&base,&map).unwrap();
        assert!(m.contains("$Number%05d$"));
        assert!(m.contains("assets"));
        assert!(!m.contains("media=\"v-"));
        assert!(dash("<!DOCTYPE MPD><MPD/>", &base, &map).is_err());
    }
}
