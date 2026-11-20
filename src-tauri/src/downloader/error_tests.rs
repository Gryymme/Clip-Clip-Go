use super::*;

#[test]
fn extraction_failure_messages_do_not_classify_sensitive_url_words() {
    let plain = metadata::site_error("ERROR: Unsupported URL: https://example.test/item");
    for url in [
        "https://example.test/item?filter=public",
        "https://example.test/private/clip?status=403",
        "https://example.test/removed?runtime=deno",
    ] {
        assert_eq!(
            metadata::site_error(&format!("ERROR: Unsupported URL: {url}")),
            plain
        );
    }
}

#[test]
fn extraction_parsing_http_denial_and_missing_runtime_have_distinct_messages() {
    let parse = metadata::site_error("ERROR: [imdb] 3232221721: Unable to extract next.js data");
    let network = metadata::site_error("ERROR: Unable to download webpage: Connection timed out");
    let denied = metadata::site_error("ERROR: HTTP Error 403: Forbidden");
    let auth = metadata::site_error("ERROR: Login required to view this video");
    let missing = metadata::site_error("ERROR: No supported JavaScript runtime could be found");
    assert_ne!(parse, network);
    assert_ne!(denied, auth);
    assert_ne!(missing, network);
}

#[test]
fn extraction_categories_use_specific_engine_evidence_and_keep_urls_private() {
    use errors::ExtractionError::*;
    for (text, category) in [
        ("Requested format is not available", SourceUnavailable),
        ("Item does not pass filter (!is_live)", Filtered),
        ("HTTP Error 429: Too Many Requests", RateLimited),
        ("Sign in to confirm you're not a bot", BotChallenge),
        (
            "No supported JavaScript runtime could be found",
            MissingRuntime,
        ),
        ("Login required to view this video", Authentication),
        (
            "Unable to download webpage: HTTP Error 403: Forbidden",
            HttpDenied,
        ),
        ("HTTP Error 404: Not Found", Unavailable),
        (
            "Unsupported URL: https://example.test/?filter=private&status=403",
            Unsupported,
        ),
        ("This video is DRM-protected", Drm),
        ("Unable to download webpage: Connection timed out", Network),
        ("[imdb] 3232221721: Unable to extract next.js data", Parsing),
        ("Unexpected extractor failure", Unknown),
    ] {
        let text = format!("ERROR: {text} https://private.example/token?secret=credential");
        assert_eq!(errors::classify(&text), category);
        let message = metadata::site_error(&text);
        for private in ["private.example", "credential", "secret=", "https://"] {
            assert!(!message.contains(private));
        }
    }
    assert_eq!(errors::classify("WARNING: No supported JavaScript runtime could be found\nERROR: Unsupported URL: https://example.test/"), Unsupported);
}
