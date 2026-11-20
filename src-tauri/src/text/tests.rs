use super::*;
fn dir() -> tempfile::TempDir {
    let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/text-tests");
    std::fs::create_dir_all(&p).unwrap();
    tempfile::tempdir_in(p).unwrap()
}
#[test]
fn routes_and_unicode_structure() {
    let d = dir();
    let p = d.path().join("input.MARKDOWN");
    let source="# 測試 café\n\nA paragraph with [link](https://example.com).\n\n- first\n- second\n\n```rust\nlet x = 1;\n```\n\n| A | B |\n|---|---|\n| α | β |\n";
    std::fs::write(&p, source).unwrap();
    let c = Control::default();
    let html = render(&p, OutputFormat::Html, &c).unwrap();
    for s in [
        "<h1>",
        "測試 café",
        "<ul>",
        "<pre><code",
        "<table>",
        "https://example.com",
    ] {
        assert!(html.contains(s), "{s}");
    }
    let h = d.path().join("input.html");
    std::fs::write(&h, &html).unwrap();
    let md = render(&h, OutputFormat::Md, &c).unwrap();
    for s in [
        "# 測試 café",
        "first",
        "```",
        "https://example.com",
        "α",
        "β",
    ] {
        assert!(md.contains(s), "{s}: {md}");
    }
    let txt = render(&p, OutputFormat::Txt, &c).unwrap();
    assert!(txt.contains("測試 café"));
    assert!(txt.contains("let x = 1;"));
    assert!(txt.contains("https://example.com"));
    assert!(txt.contains("- first"));
    assert!(!route(&p, OutputFormat::Md));
    assert!(!route(Path::new("office.docx"), OutputFormat::Md));
    assert!(!route(Path::new("a.pdf"), OutputFormat::Txt));
}
#[test]
fn txt_is_literal_and_html_is_inert() {
    let d = dir();
    let p = d.path().join("literal.txt");
    let original="# heading\n* list [x](https://example.com)\n<script>alert(1)</script>\n    indented\nUnicode 中文";
    std::fs::write(&p, original).unwrap();
    let c = Control::default();
    let md = render(&p, OutputFormat::Md, &c).unwrap();
    let intermediate = d.path().join("literal.md");
    std::fs::write(&intermediate, &md).unwrap();
    let h = render(&intermediate, OutputFormat::Html, &c).unwrap();
    assert!(h.contains("&lt;script&gt;"));
    assert!(!h.contains("<script>"));
    assert!(!h.contains("<h1>"));
    assert!(!h.contains("<li>"));
    let direct = render(&p, OutputFormat::Html, &c).unwrap();
    assert!(direct.contains("# heading"));
    assert!(direct.contains("&lt;script&gt;"));
    assert!(!direct.contains("<h1>"));
    assert!(md.contains("\\#"));
    let p = d.path().join("raw.md");
    std::fs::write(&p, "<script>alert(1)</script>\n\n[bad](javascript:alert)").unwrap();
    assert!(render(&p, OutputFormat::Html, &c).is_err());
    std::fs::write(&p, "<script>alert(1)</script>").unwrap();
    assert!(!render(&p, OutputFormat::Html, &c)
        .unwrap()
        .contains("<script>"));
    let p = d.path().join("raw.html");
    std::fs::write(&p,"<h1>Title</h1><link rel='stylesheet' href='http://127.0.0.1:9/style.css'><script>fetch('http://127.0.0.1:9/')</script><p>Body</p>").unwrap();
    let md = render(&p, OutputFormat::Md, &c).unwrap();
    assert!(md.contains("Title"));
    assert!(!md.contains("fetch"));
    assert!(!md.contains("style.css"));
    let txt = render(&p, OutputFormat::Txt, &c).unwrap();
    assert!(txt.contains("Title") && txt.contains("Body"));
    assert!(!txt.contains("fetch") && !txt.contains("style.css"));
    std::fs::write(&p,"<table><tr><td>Column A</td><td>Column B</td></tr><tr><td>one</td><td>two</td></tr></table>").unwrap();
    let md = render(&p, OutputFormat::Md, &c).unwrap();
    assert!(md.contains("| Column A | Column B |"));
    assert!(md.contains("| one | two |"));
    let txt = render(&p, OutputFormat::Txt, &c).unwrap();
    assert!(txt.contains("Column A\tColumn B"));
    assert!(txt.contains("one\ttwo"));
}
#[test]
fn images_are_embedded_or_fail_explicitly() {
    let d = dir();
    let p = d.path().join("images.md");
    let c = Control::default();
    for src in [
        "https://example.com/a.png",
        "//server/share/a.png",
        "../escape.png",
        "missing.png",
    ] {
        std::fs::write(&p, format!("![Alt]({src})")).unwrap();
        assert!(render(&p, OutputFormat::Html, &c).is_err());
    }
    let image = d.path().join("local.png");
    image::RgbaImage::from_pixel(2, 2, image::Rgba([255, 0, 0, 128]))
        .save(&image)
        .unwrap();
    std::fs::write(&p, "![Alt](local.png)").unwrap();
    let html = render(&p, OutputFormat::Html, &c).unwrap();
    assert!(html.contains("data:image/png;base64,"));
    assert!(!html.contains("src=\"local.png"));
    let h = d.path().join("embedded.html");
    std::fs::write(&h, &html).unwrap();
    let md = render(&h, OutputFormat::Md, &c).unwrap();
    assert!(md.contains("data:image/png;base64,"));
    assert!(render(&p, OutputFormat::Txt, &c).unwrap().contains("Alt"));
}

#[test]
fn encoded_traversal_active_html_and_excessive_nesting_are_rejected() {
    let d = dir();
    let p = d.path().join("input.md");
    let c = Control::default();
    for src in [
        "%2e%2e/outside.png",
        "%5c%5cserver/file.png",
        "C%3A/private.png",
    ] {
        std::fs::write(&p, format!("![x]({src})")).unwrap();
        assert!(render(&p, OutputFormat::Html, &c).is_err());
    }
    let p = d.path().join("input.html");
    for html in [
        "<base href='https://example.com'><img src='x.png'>",
        "<form><input value='lost'></form>",
        "<a href='jav&#97;script:alert(1)'>bad</a>",
    ] {
        std::fs::write(&p, html).unwrap();
        assert!(render(&p, OutputFormat::Md, &c).is_err());
    }
    std::fs::write(
        &p,
        format!("{}text{}", "<div>".repeat(140), "</div>".repeat(140)),
    )
    .unwrap();
    assert!(render(&p, OutputFormat::Md, &c).is_err());
}

#[test]
fn native_provider_does_not_fetch_styles_scripts_images_or_links() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let d = dir();
    let p = d.path().join("external.html");
    std::fs::write(&p,format!("<html><head><link rel='stylesheet' href='{origin}/style.css'><script>fetch('{origin}/script')</script></head><body><h1>測試</h1><a href='{origin}/link'>Link</a></body></html>")).unwrap();
    let md = render(&p, OutputFormat::Md, &Control::default()).unwrap();
    assert!(md.contains("測試"));
    assert!(!md.contains("style.css"));
    assert!(!md.contains("fetch"));
    assert!(md.contains("/link"));
    let p = d.path().join("external.md");
    std::fs::write(&p, format!("![Alt]({origin}/image.png)")).unwrap();
    assert!(render(&p, OutputFormat::Html, &Control::default())
        .unwrap_err()
        .contains("Blocked image"));
    assert_eq!(
        listener.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock
    );
}
#[test]
fn bounds_cancellation_and_publication() {
    let d = dir();
    let p = d.path().join("a.md");
    std::fs::write(&p, "# Hello").unwrap();
    let c = Control::default();
    let text = render(&p, OutputFormat::Html, &c).unwrap();
    let dest = d.path().join("new.wrong");
    let output = publish(text.clone(), &p, &dest, OutputFormat::Html, &c, |_| {}).unwrap();
    assert_eq!(output.extension().unwrap(), "html");
    assert!(publish(text.clone(), &p, &dest, OutputFormat::Html, &c, |_| {}).is_err());
    for step in ["writing", "verifying", "publishing"] {
        let c = Control::default();
        let dest = d.path().join(format!("{step}.html"));
        assert!(
            publish(text.clone(), &p, &dest, OutputFormat::Html, &c, |s| {
                if s == step {
                    c.cancel()
                }
            })
            .is_err()
        );
        assert!(!dest.exists());
    }
    let c = Control::default();
    c.cancel();
    assert!(render(&p, OutputFormat::Html, &c).is_err());
    let bad = d.path().join("bad.md");
    std::fs::write(&bad, [255, 0, 1]).unwrap();
    assert!(render(&bad, OutputFormat::Html, &Control::default()).is_err());
    let file = File::create(&bad).unwrap();
    file.set_len(MAX_INPUT + 1).unwrap();
    drop(file);
    assert!(render(&bad, OutputFormat::Html, &Control::default()).is_err());
    assert!(std::fs::read_dir(d.path()).unwrap().all(|f| !f
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".clip-clip-go-")));
}
