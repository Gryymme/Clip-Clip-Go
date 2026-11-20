//! Classify extraction failures using error evidence, never words inside URLs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExtractionError {
    SourceUnavailable,
    Filtered,
    RateLimited,
    BotChallenge,
    MissingRuntime,
    Authentication,
    HttpDenied,
    Unavailable,
    Unsupported,
    Drm,
    Network,
    Parsing,
    Unknown,
}

fn message_text(text: &str) -> String {
    // Prefer actual ERROR lines over incidental warnings, tracebacks and site titles.
    let errors = text
        .lines()
        .filter(|line| line.trim_start().starts_with("ERROR:"))
        .collect::<Vec<_>>();
    let selected = if errors.is_empty() {
        text.to_string()
    } else {
        errors.join("\n")
    };
    selected
        .split_whitespace()
        .filter(|word| !word.contains("://") && !word.starts_with("www."))
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

pub fn classify(text: &str) -> ExtractionError {
    use ExtractionError::*;
    let text = message_text(text);
    let has = |patterns: &[&str]| patterns.iter().any(|p| text.contains(p));
    if has(&["requested format is not available"]) {
        SourceUnavailable
    } else if has(&[
        "does not pass filter",
        "rejected by match filter",
        "match filter rejected",
    ]) {
        Filtered
    } else if has(&[
        "http error 429",
        "http 429",
        "status code 429",
        "rate limit",
        "too many requests",
    ]) {
        RateLimited
    } else if has(&[
        "not a bot",
        "verify you are human",
        "verify that you are human",
        "captcha challenge",
        "cloudflare challenge",
        "aws waf challenge",
        "x-amzn-waf-action: challenge",
    ]) {
        BotChallenge
    } else if has(&[
        "no supported javascript runtime",
        "javascript runtime could not be found",
        "javascript runtime is missing",
        "javascript runtime not found",
        "unable to find a javascript runtime",
        "yt-dlp-ejs is not installed",
        "yt_dlp_ejs is not installed",
    ]) {
        MissingRuntime
    } else if has(&[
        "http error 401",
        "http 401",
        "login required",
        "log in",
        "sign in",
        "requires authentication",
        "private video",
        "this video is private",
        "members-only",
    ]) {
        Authentication
    } else if has(&[
        "http error 403",
        "http 403",
        "status code 403",
        "403 forbidden",
    ]) {
        HttpDenied
    } else if has(&[
        "http error 404",
        "http error 410",
        "http 404",
        "http 410",
        "video unavailable",
        "media is unavailable",
        "video has been removed",
        "media has been removed",
    ]) {
        Unavailable
    } else if has(&["unsupported url", "not a supported url"]) {
        Unsupported
    } else if has(&["drm-protected", "drm protected", "has drm"]) {
        Drm
    } else if has(&[
        "timed out",
        "timeout",
        "connection refused",
        "connection reset",
        "connection aborted",
        "name resolution",
        "getaddrinfo",
        "network is unreachable",
        "certificate verify failed",
        "unable to download webpage",
        "http error 500",
        "http error 502",
        "http error 503",
    ]) {
        Network
    } else if has(&[
        "unable to extract",
        "failed to extract",
        "unable to parse",
        "failed to parse",
        "invalid json",
        "jsondecodeerror",
    ]) {
        Parsing
    } else {
        Unknown
    }
}

pub fn message(text: &str) -> String {
    use ExtractionError::*;
    match classify(text) {
        SourceUnavailable=>"The selected source format is unavailable after refreshing the link. Inspect the link again and choose an available source.",
        Filtered=>"This item was excluded because it is live, upcoming, processing, or DRM-protected.",
        RateLimited=>"The site is rate limiting requests. Wait before trying again.",
        BotChallenge=>"The site returned bot verification or a challenge page. ClipClipGO cannot resolve it.",
        MissingRuntime=>"The bundled JavaScript runtime or challenge component is missing or unavailable. Repair or reinstall ClipClipGO.",
        Authentication=>"The site requires authentication for this media. Login and cookie importing are not supported.",
        HttpDenied=>"The server denied the request (HTTP 403). Its access rules or request policy may prevent access.",
        Unavailable=>"This media is unavailable, removed, or no longer at this address.",
        Unsupported=>"The bundled extractor could not recognize media at this URL. The page may require unsupported embed or site-specific extraction.",
        Drm=>"DRM-protected media is not supported.",
        Network=>"The site could not be reached or its response could not be retrieved. Check the network and try again later.",
        Parsing=>"The site response could not be parsed by the bundled extractor. The page may have changed or returned an interstitial; see technical diagnostics.",
        Unknown=>"The site request could not be completed. See technical diagnostics for the engine's error.",
    }.into()
}
