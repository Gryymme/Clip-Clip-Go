//! Compiled-in UTF-8 Markdown/HTML/text conversion. Parsers have no network or scripting API.
use crate::{
    conversion::stage_output,
    engine::OutputFormat,
    process::{Control, Result},
};
use base64::{prelude::BASE64_STANDARD, Engine};
use image::ImageDecoder;
use markup5ever_rcdom::{Node, NodeData};
use pulldown_cmark::{html, Event, Options, Parser, Tag, TagEnd};
use std::{
    fs::File,
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    rc::Rc,
};
const MAX_INPUT: u64 = 4 * 1024 * 1024;
const MAX_OUTPUT: usize = 32 * 1024 * 1024;
const MAX_ASSETS: usize = 16 * 1024 * 1024;

pub fn input_kind(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "md" | "markdown" => Some("md"),
        "html" | "htm" => Some("html"),
        "txt" => Some("txt"),
        _ => None,
    }
}
pub fn route(path: &Path, output: OutputFormat) -> bool {
    matches!(
        (input_kind(path), output),
        (Some("md"), OutputFormat::Html | OutputFormat::Txt)
            | (Some("html"), OutputFormat::Md | OutputFormat::Txt)
            | (Some("txt"), OutputFormat::Md | OutputFormat::Html)
    )
}
fn read_text(path: &Path, control: &Control) -> Result<String> {
    control.check()?;
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(|_| "The text file is missing or inaccessible.")?
        .take(MAX_INPUT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read the text file.")?;
    if bytes.len() as u64 > MAX_INPUT {
        return Err("Text input exceeds the 4 MiB limit.".into());
    }
    let text =
        String::from_utf8(bytes).map_err(|_| "Use a UTF-8 encoded Markdown, HTML or text file.")?;
    if text.contains('\0') {
        return Err("This is not a supported text file (NUL bytes found).".into());
    }
    Ok(text
        .trim_start_matches('\u{feff}')
        .replace("\r\n", "\n")
        .replace('\r', "\n"))
}
pub fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
pub fn literal_md(s: &str) -> String {
    s.split('\n')
        .map(|line| {
            let mut result = String::new();
            let mut leading = true;
            for c in line.chars() {
                if leading && (c == ' ' || c == '\t') {
                    result.push_str(if c == ' ' { "&#32;" } else { "&#9;" });
                    continue;
                }
                leading = false;
                if c.is_ascii_punctuation() {
                    result.push('\\')
                }
                result.push(c)
            }
            result
        })
        .collect::<Vec<_>>()
        .join("  \n")
}
fn safe_link(link: &str) -> Result<()> {
    if link.starts_with('#') {
        return Ok(());
    }
    let url=tauri::Url::parse(link).map_err(|_|"Relative hyperlinks are not supported; use an absolute HTTP(S) or mailto link, or a fragment.")?;
    if !matches!(url.scheme(), "http" | "https" | "mailto") {
        return Err("This link uses an unsupported or active URL scheme.".into());
    }
    Ok(())
}
struct Assets<'a> {
    input: &'a Path,
    control: &'a Control,
    bytes: usize,
}
impl Assets<'_> {
    fn image(&mut self, src: &str) -> Result<String> {
        self.control.check()?;
        let png = if let Some(data) = src.strip_prefix("data:image/png;base64,") {
            let bytes = BASE64_STANDARD
                .decode(data)
                .map_err(|_| "Invalid embedded PNG asset.")?;
            crate::images::single_image(
                &mut Cursor::new(&bytes),
                image::ImageFormat::Png,
                bytes.len() as u64,
                self.control,
            )?;
            let mut reader =
                image::ImageReader::with_format(Cursor::new(&bytes), image::ImageFormat::Png);
            let mut limits = image::Limits::default();
            limits.max_image_width = Some(16384);
            limits.max_image_height = Some(16384);
            limits.max_alloc = Some(128 * 1024 * 1024);
            reader.limits(limits);
            let decoder = reader
                .into_decoder()
                .map_err(|_| "Invalid or oversized embedded PNG asset.")?;
            let (w, h) = decoder.dimensions();
            if u64::from(w) * u64::from(h) > 16_000_000 || decoder.total_bytes() > 128 * 1024 * 1024
            {
                return Err("Embedded PNG exceeds image safety limits.".into());
            }
            let image = image::DynamicImage::from_decoder(decoder)
                .map_err(|_| "Embedded PNG could not be decoded.")?;
            let mut output = Cursor::new(Vec::new());
            image
                .write_to(&mut output, image::ImageFormat::Png)
                .map_err(|_| "Could not encode the embedded asset.")?;
            output.into_inner()
        } else {
            let lower = src.to_ascii_lowercase();
            if src.is_empty()
                || src.contains(':')
                || src.starts_with(['/', '\\'])
                || ["%5c", "%2f", "%3a"].iter().any(|s| lower.contains(s))
            {
                return Err(format!("Blocked image reference: {src}. Use a relative local image inside the input folder."));
            }
            let base = self
                .input
                .parent()
                .ok_or("Input folder unavailable.")?
                .canonicalize()
                .map_err(|_| "Input folder unavailable.")?;
            let base_url =
                tauri::Url::from_directory_path(&base).map_err(|_| "Invalid input folder.")?;
            let url = base_url
                .join(src)
                .map_err(|_| "Invalid relative image reference.")?;
            if url.scheme() != base_url.scheme()
                || url.host_str() != base_url.host_str()
                || !url.path().starts_with(base_url.path())
            {
                return Err("Image reference escapes the input folder.".into());
            }
            let local = url
                .to_file_path()
                .map_err(|_| "Only relative local images are supported.")?;
            let file = local
                .canonicalize()
                .map_err(|_| format!("Missing local image asset: {src}"))?;
            if !file.starts_with(&base) {
                return Err(
                    "Image reference escapes the input folder. Copy assets inside that folder."
                        .into(),
                );
            }
            if std::fs::metadata(&file)
                .map_err(|_| "Image asset unavailable.")?
                .len()
                > 8 * 1024 * 1024
            {
                return Err("Image asset exceeds 8 MiB.".into());
            }
            let decoded = crate::images::decode(&file, self.control)?;
            let mut output = Cursor::new(Vec::new());
            image::DynamicImage::ImageRgba8(decoded.pixels)
                .write_to(&mut output, image::ImageFormat::Png)
                .map_err(|_| "Could not embed image asset.")?;
            output.into_inner()
        };
        self.bytes += png.len();
        if self.bytes > MAX_ASSETS {
            return Err("Combined embedded images exceed 16 MiB.".into());
        }
        Ok(format!(
            "data:image/png;base64,{}",
            BASE64_STANDARD.encode(png)
        ))
    }
}
fn md_html(md: &str, assets: &mut Assets) -> Result<String> {
    let mut events = Vec::new();
    let mut depth = 0usize;
    for event in Parser::new_ext(md, Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH) {
        assets.control.check()?;
        let event = match event {
            Event::Start(Tag::Image {
                link_type,
                dest_url,
                title,
                id,
            }) => Event::Start(Tag::Image {
                link_type,
                dest_url: assets.image(&dest_url)?.into(),
                title,
                id,
            }),
            Event::Start(Tag::Link {
                link_type,
                dest_url,
                title,
                id,
            }) => {
                safe_link(&dest_url)?;
                Event::Start(Tag::Link {
                    link_type,
                    dest_url,
                    title,
                    id,
                })
            }
            Event::Html(raw) | Event::InlineHtml(raw) => Event::Text(raw), // Raw HTML is visibly escaped, never executed.
            other => other,
        };
        if matches!(event, Event::Start(_)) {
            depth += 1;
            if depth > 128 {
                return Err("Markdown nesting exceeds 128 levels.".into());
            }
        }
        if matches!(event, Event::End(_)) {
            depth = depth.saturating_sub(1)
        }
        events.push(event);
        if events.len() > 100_000 {
            return Err("Markdown is too complex (100,000 event limit).".into());
        }
    }
    let mut body = String::new();
    html::push_html(&mut body, events.into_iter());
    Ok(body)
}
fn clean_dom(
    node: &Rc<Node>,
    assets: &mut Assets,
    depth: usize,
    count: &mut usize,
) -> Result<String> {
    assets.control.check()?;
    *count += 1;
    if depth > 128 || *count > 100_000 {
        return Err("HTML exceeds nesting or complexity limits.".into());
    }
    if let NodeData::Text { contents } = &node.data {
        return Ok(escape_html(&contents.borrow()));
    }
    let mut prefix = String::new();
    let mut suffix = String::new();
    if let NodeData::Element { name, attrs, .. } = &node.data {
        let tag = name.local.as_ref();
        if matches!(tag, "head" | "script" | "style" | "link" | "meta" | "title") {
            return Ok(String::new());
        }
        if matches!(
            tag,
            "iframe"
                | "object"
                | "embed"
                | "video"
                | "audio"
                | "svg"
                | "canvas"
                | "base"
                | "form"
                | "input"
                | "button"
                | "textarea"
                | "select"
        ) {
            return Err(format!("Unsupported HTML element <{tag}>. Export a static document with local raster images."));
        }
        let attrs = attrs.borrow();
        let attr = |key: &str| {
            attrs
                .iter()
                .find(|a| a.name.local.as_ref() == key)
                .map(|a| a.value.as_ref())
                .unwrap_or("")
        };
        if tag == "img" {
            let src = assets.image(attr("src"))?;
            return Ok(format!(
                "<img src=\"{}\" alt=\"{}\">",
                src,
                escape_html(attr("alt"))
            ));
        }
        if tag == "a" && !attr("href").is_empty() {
            safe_link(attr("href"))?;
            prefix = format!("<a href=\"{}\">", escape_html(attr("href")));
            suffix = "</a>".into();
        } else if matches!(
            tag,
            "p" | "h1"
                | "h2"
                | "h3"
                | "h4"
                | "h5"
                | "h6"
                | "ul"
                | "ol"
                | "li"
                | "blockquote"
                | "pre"
                | "code"
                | "strong"
                | "em"
                | "b"
                | "i"
                | "del"
                | "s"
                | "table"
                | "thead"
                | "tbody"
                | "tr"
                | "th"
                | "td"
                | "br"
                | "hr"
        ) {
            prefix = format!("<{tag}>");
            if !matches!(tag, "br" | "hr") {
                suffix = format!("</{tag}>");
            }
        }
    }
    for child in node.children.borrow().iter() {
        prefix.push_str(&clean_dom(child, assets, depth + 1, count)?);
        if prefix.len() > MAX_OUTPUT {
            return Err("Converted document exceeds 32 MiB.".into());
        }
    }
    prefix.push_str(&suffix);
    Ok(prefix)
}
fn plain(md: &str) -> String {
    let mut text = String::new();
    let mut links = Vec::new();
    let mut lists: Vec<Option<u64>> = Vec::new();
    for event in Parser::new_ext(md, Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH) {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                text.push_str(&"#".repeat(level as usize));
                text.push(' ');
            }
            Event::Start(Tag::List(start)) => lists.push(start),
            Event::End(TagEnd::List(_)) => {
                lists.pop();
            }
            Event::Start(Tag::Item) => {
                if let Some(Some(number)) = lists.last_mut() {
                    text.push_str(&format!("{number}. "));
                    *number += 1;
                } else {
                    text.push_str("- ");
                }
            }
            Event::Start(Tag::Link { dest_url, .. }) => links.push(dest_url.to_string()),
            Event::End(TagEnd::Link) => {
                if let Some(url) = links.pop() {
                    text.push_str(&format!(" ({url})"));
                }
            }
            Event::Text(s) | Event::Code(s) => text.push_str(&s),
            Event::SoftBreak | Event::HardBreak => text.push('\n'),
            Event::End(
                TagEnd::Paragraph
                | TagEnd::Heading(_)
                | TagEnd::Item
                | TagEnd::CodeBlock
                | TagEnd::TableRow
                | TagEnd::TableHead,
            ) => text.push('\n'),
            Event::End(TagEnd::TableCell) => text.push('\t'),
            _ => {}
        }
    }
    text
}
fn converter() -> htmd::HtmlToMarkdown {
    // Preserve basic headerless tables too; the upstream default can flatten
    // their cells into unrelated paragraphs. Markdown requires a header row.
    htmd::HtmlToMarkdown::builder().add_handler(vec!["table"], |handlers: &dyn htmd::element_handler::Handlers, element: htmd::Element| {
        fn rows(node:&Rc<Node>,handlers:&dyn htmd::element_handler::Handlers,result:&mut Vec<Vec<String>>){
            if let NodeData::Element{name,..}=&node.data {
                if name.local.as_ref()=="tr" {
                    let cells=node.children.borrow().iter().filter(|cell|matches!(&cell.data,NodeData::Element{name,..} if matches!(name.local.as_ref(),"td"|"th"))).map(|cell|handlers.walk_children(cell).content.trim().replace('|',"\\|").replace('\n'," ")).collect::<Vec<_>>();
                    if !cells.is_empty(){result.push(cells);}return;
                }
            }
            for child in node.children.borrow().iter(){rows(child,handlers,result);}
        }
        let mut values=Vec::new();rows(element.node,handlers,&mut values);let width=values.iter().map(Vec::len).max().unwrap_or(0);if width==0{return None;}
        let mut output=String::from("\n\n");for (i,row) in values.iter().enumerate(){output.push('|');for col in 0..width{output.push(' ');output.push_str(row.get(col).map(String::as_str).unwrap_or(""));output.push_str(" |");}output.push('\n');if i==0{output.push('|');output.push_str(&" --- |".repeat(width));output.push('\n');}}
        output.push('\n');Some(output.into())
    }).build()
}
pub fn render(input: &Path, format: OutputFormat, control: &Control) -> Result<String> {
    if !route(input, format) {
        return Err("Choose a supported, different text output format.".into());
    }
    render_inner(input, format, control)
}
// Internal normalized HTML reuses the same inert parser and explicit asset checks.
pub fn for_pdf(input: &Path, control: &Control) -> Result<String> {
    let html = render_inner(input, OutputFormat::Html, control)?;
    html.split_once("<body>\n")
        .and_then(|(_, body)| body.strip_suffix("</body></html>\n"))
        .map(str::to_owned)
        .ok_or("Could not normalize the PDF document body.".into())
}
fn render_inner(input: &Path, format: OutputFormat, control: &Control) -> Result<String> {
    let source = read_text(input, control)?;
    let mut assets = Assets {
        input,
        control,
        bytes: 0,
    };
    let converter = converter();
    let (markdown, body) = match input_kind(input).unwrap() {
        "md" => {
            let body = md_html(&source, &mut assets)?;
            (source, body)
        }
        "html" => {
            let tree = converter
                .html_to_tree(&source)
                .map_err(|_| "HTML could not be parsed.")?;
            let mut pending = vec![(tree.clone(), 0usize)];
            let mut nodes = 0;
            while let Some((node, depth)) = pending.pop() {
                control.check()?;
                nodes += 1;
                if depth > 128 || nodes > 100_000 {
                    return Err("HTML exceeds nesting or complexity limits.".into());
                }
                if let NodeData::Element { name, .. } = &node.data {
                    if name.local.as_ref() == "base" {
                        return Err("HTML base URLs are not supported. Use local image references relative to the input file.".into());
                    }
                }
                for child in node.children.borrow().iter() {
                    pending.push((child.clone(), depth + 1));
                }
            }
            let body = clean_dom(&tree, &mut assets, 0, &mut 0)?;
            let md = converter
                .convert(&body)
                .map_err(|_| "HTML could not be converted to Markdown.")?;
            (md, body)
        }
        _ => {
            let md = literal_md(&source);
            let body = md_html(&md, &mut assets)?;
            (md, body)
        }
    };
    control.check()?;
    let result=match format {
        OutputFormat::Html=>format!("<!doctype html>\n<html><head><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'none'; base-uri 'none'; form-action 'none'\"><title>Converted document</title></head><body>\n{body}</body></html>\n"),
        OutputFormat::Md=>markdown,
        OutputFormat::Txt=>{
            // HTML-derived Markdown includes embedded assets. Text output deliberately retains alt text only.
            let clean=if input_kind(input)==Some("md"){converter.convert(&body).map_err(|_|"Could not normalize Markdown for text output.")?}else{markdown};plain(&clean)
        },_=>unreachable!()
    };
    if result.len() > MAX_OUTPUT {
        return Err("Converted document exceeds 32 MiB.".into());
    }
    Ok(result)
}
pub fn publish(
    text: String,
    input: &Path,
    chosen: &Path,
    format: OutputFormat,
    control: &Control,
    stage: impl Fn(&str),
) -> Result<PathBuf> {
    let mut output = stage_output(input, chosen, format, control)?;
    stage("writing");
    control.check()?;
    output
        .file
        .take()
        .ok_or("Staging file unavailable.")?
        .write_all(text.as_bytes())
        .map_err(|_| "Could not write the document. Check free disk space.")?;
    stage("verifying");
    control.check()?;
    let bytes =
        std::fs::read(&output.path).map_err(|_| "Could not validate the staged document.")?;
    if bytes != text.as_bytes() || std::str::from_utf8(&bytes).is_err() {
        return Err("Document output validation failed; nothing was published.".into());
    }
    if format == OutputFormat::Html && !text.starts_with("<!doctype html>") {
        return Err("HTML structure validation failed.".into());
    }
    stage("publishing");
    control.check()?;
    output.publish()
}

#[cfg(test)]
mod tests;
