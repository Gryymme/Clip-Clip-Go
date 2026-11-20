//! Local PDF generation, extraction and page rendering. No forms/JS/network APIs.
use crate::{
    conversion::stage_output,
    engine::OutputFormat,
    process::{Control, Result},
};
use base64::{prelude::BASE64_STANDARD, Engine};
use pdfium_render::prelude::*;

use serde::{Deserialize, Serialize};
use std::{
    io::{Cursor, Write},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

const MAX_PAGES: u16 = 500;
const MAX_PDF: u64 = 128 * 1024 * 1024;
const MAX_TEXT: usize = 32 * 1024 * 1024;
const MAX_IMAGE_TOTAL: u64 = 100_000_000;
const ENCRYPTED: &str = "Encrypted or password-protected PDFs are unsupported. Export an unencrypted copy first; password handling is not available.";
static PDF: OnceLock<Result<Pdfium>> = OnceLock::new();
static SERIAL: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfInfo {
    pub pages: u16,
    pub has_text: bool,
}
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PdfOptions {
    pub pages: Option<String>,
}
#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImagePageSize {
    #[default]
    A4,
    Letter,
    Legal,
    Image,
    Custom {
        width: f64,
        height: f64,
    },
}

fn err(e: impl std::fmt::Debug) -> String {
    format!("PDF processing failed ({e:?}). The input may be corrupt or unsupported.")
}
fn assets() -> Result<PathBuf> {
    #[cfg(test)]
    {
        return Ok(Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/pdf"));
    }
    #[cfg(not(test))]
    {
        Ok(std::env::current_exe()
            .map_err(err)?
            .parent()
            .ok_or("Cannot resolve PDF resources.")?
            .join("pdf"))
    }
}
fn library() -> Result<&'static Pdfium> {
    PDF.get_or_init(|| {
        let root=assets()?;
        let manifest: serde_json::Value=serde_json::from_str(include_str!("../../scripts/pdf-manifest.json").trim_start_matches('\u{feff}')).map_err(err)?;
        for (file,hash) in [("pdfium.dll",manifest["pdfium"]["dllSha256"].as_str()),("NotoSans-Regular.ttf",manifest["font"]["sha256"].as_str())] {
            if !crate::engine_integrity::verify(&root.join(file),hash.ok_or("PDF manifest is incomplete.")?).unwrap_or(false) { return Err("Bundled PDF resources are missing or damaged. Repair/reinstall the app (developers: npm run pdf:prepare).".into()); }
        }
        Pdfium::bind_to_library(root.join("pdfium.dll")).map(Pdfium::new).map_err(err)
    }).as_ref().map_err(Clone::clone)
}
pub fn is_input(path: &Path) -> bool {
    path.extension()
        .is_some_and(|s| s.eq_ignore_ascii_case("pdf"))
}
pub fn route(input: &Path, format: OutputFormat) -> bool {
    (is_input(input)
        && matches!(
            format,
            OutputFormat::Txt
                | OutputFormat::Md
                | OutputFormat::Html
                | OutputFormat::Png
                | OutputFormat::Jpg
        ))
        || (crate::text::input_kind(input).is_some() && format == OutputFormat::Pdf)
}
fn load<'a>(pdf: &'a Pdfium, input: &Path) -> Result<PdfDocument<'a>> {
    if std::fs::metadata(input)
        .map_err(|_| "The PDF is missing or inaccessible.")?
        .len()
        > MAX_PDF
    {
        return Err("PDF input exceeds 128 MiB.".into());
    }
    // Reader API is seekable/lazy and handles Unicode Windows paths.
    let doc = pdf
        .load_pdf_from_reader(std::fs::File::open(input).map_err(err)?, None)
        .map_err(|e| {
            if format!("{e:?}").contains("Password") {
                ENCRYPTED.into()
            } else {
                err(e)
            }
        })?;
    if doc.permissions().security_handler_revision().ok()
        != Some(PdfSecurityHandlerRevision::Unprotected)
    {
        return Err(ENCRYPTED.into());
    }
    if doc.pages().is_empty() || doc.pages().len() > i32::from(MAX_PAGES) {
        return Err("PDF must contain 1–500 pages.".into());
    }
    Ok(doc)
}
pub fn inspect(input: &Path, control: &Control) -> Result<PdfInfo> {
    let _lock = SERIAL.lock().unwrap();
    control.check()?;
    let doc = load(library()?, input)?;
    let mut has_text = false;
    for page in doc.pages().iter() {
        control.check()?;
        let text = page.text().map_err(err)?;
        if text.len() > 2_000_000 {
            return Err("A PDF page exceeds the two million character limit.".into());
        }
        if text
            .all()
            .chars()
            .any(|c| !c.is_whitespace() && !c.is_control())
        {
            has_text = true;
            break;
        }
    }
    Ok(PdfInfo {
        pages: doc.pages().len() as u16,
        has_text,
    })
}
pub fn page_range(value: Option<&str>, count: u16) -> Result<Vec<u16>> {
    if count == 0 || count > MAX_PAGES {
        return Err("PDF must contain 1–500 pages.".into());
    }
    let value = value.unwrap_or("").trim();
    if value.is_empty() {
        return Ok((0..count).collect());
    }
    if value.len() > 2048 {
        return Err("Page range is too long.".into());
    }
    let mut pages = std::collections::BTreeSet::new();
    for part in value.split(',') {
        let fields = part.trim().split('-').map(str::trim).collect::<Vec<_>>();
        if fields.len() > 2
            || fields
                .iter()
                .any(|s| s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()))
        {
            return Err("Use page numbers or ranges such as 1–3, 5 (type a hyphen).".into());
        }
        let first = fields[0]
            .parse::<u16>()
            .map_err(|_| "Invalid page number.")?;
        let last = if fields.len() == 2 {
            fields[1]
                .parse::<u16>()
                .map_err(|_| "Invalid page number.")?
        } else {
            first
        };
        if first == 0 || last < first || last > count {
            return Err(format!(
                "Choose pages between 1 and {count}, with each range in ascending order."
            ));
        }
        pages.extend(first - 1..last);
    }
    Ok(pages.into_iter().collect())
}
pub fn extract(
    input: &Path,
    format: OutputFormat,
    control: &Control,
    progress: &mut dyn FnMut(u16, u16),
) -> Result<String> {
    let _lock = SERIAL.lock().unwrap();
    control.check()?;
    let doc = load(library()?, input)?;
    let mut pages = Vec::new();
    let mut bytes = 0;
    for (i, page) in doc.pages().iter().enumerate() {
        control.check()?;
        let text_page = page.text().map_err(err)?;
        if text_page.len() > 2_000_000 {
            return Err("A PDF page exceeds the two million character limit.".into());
        }
        let text = text_page.all().replace("\r\n", "\n").replace('\r', "\n");
        bytes += text.len();
        if bytes > MAX_TEXT {
            return Err("Extracted PDF text exceeds 32 MiB.".into());
        }
        pages.push(text);
        progress(i as u16 + 1, doc.pages().len() as u16);
    }
    if pages.iter().all(|s| s.trim().is_empty()) {
        return Err("This PDF has no extractable text. It may contain scanned images; OCR is not supported yet. You can render its pages as PNG or JPEG.".into());
    }
    let output=match format {
        OutputFormat::Txt=>pages.join("\n\n\u{000c}\n\n"),
        OutputFormat::Md=>pages.iter().enumerate().map(|(i,t)|format!("## Page {}\n\n{}\n",i+1,crate::text::literal_md(t))).collect::<Vec<_>>().join("\n"),
        OutputFormat::Html=>format!("<!doctype html><html><head><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'\"><title>Reconstructed PDF text</title></head><body>{}</body></html>",pages.iter().enumerate().map(|(i,t)|format!("<section><h2>Page {}</h2><pre>{}</pre></section>",i+1,crate::text::escape_html(t))).collect::<String>()),
        _=>return Err("Choose TXT, Markdown or HTML for PDF text extraction.".into())
    };
    if output.len() > MAX_TEXT * 2 {
        return Err("Reconstructed PDF text exceeds output limits.".into());
    }
    Ok(output)
}

enum Block {
    Text(String, f32),
    Image(Vec<u8>),
}
fn blocks(html: &str) -> Result<Vec<Block>> {
    use markup5ever_rcdom::{Node, NodeData};
    use std::rc::Rc;
    struct Layout {
        out: Vec<Block>,
        text: String,
        size: f32,
        lists: Vec<Option<u64>>,
        pre: bool,
        nodes: usize,
    }
    impl Layout {
        fn flush(&mut self) {
            if !self.text.trim().is_empty() {
                self.out
                    .push(Block::Text(std::mem::take(&mut self.text), self.size));
            } else {
                self.text.clear();
            }
        }
        fn walk(&mut self, node: &Rc<Node>, depth: usize) -> Result<()> {
            self.nodes += 1;
            if depth > 128 || self.nodes > 100_000 {
                return Err("Document exceeds PDF layout complexity limits.".into());
            }
            if let NodeData::Text { contents } = &node.data {
                let value = contents.borrow();
                if self.pre {
                    self.text.push_str(&value);
                } else {
                    for c in value.chars() {
                        if c.is_whitespace() {
                            if !self.text.is_empty() && !self.text.ends_with([' ', '\n']) {
                                self.text.push(' ');
                            }
                        } else {
                            self.text.push(c);
                        }
                    }
                }
                return Ok(());
            }
            let tag = if let NodeData::Element { name, .. } = &node.data {
                name.local.as_ref()
            } else {
                ""
            };
            if matches!(tag, "head" | "script" | "style" | "title" | "meta" | "link") {
                return Ok(());
            }
            let attribute = |key: &str| -> String {
                if let NodeData::Element { attrs, .. } = &node.data {
                    attrs
                        .borrow()
                        .iter()
                        .find(|a| a.name.local.as_ref() == key)
                        .map(|a| a.value.to_string())
                        .unwrap_or_default()
                } else {
                    String::new()
                }
            };
            if tag == "img" {
                self.flush();
                let source = attribute("src");
                let encoded = source
                    .strip_prefix("data:image/png;base64,")
                    .ok_or("Unsupported PDF image asset.")?;
                let bytes = BASE64_STANDARD.decode(encoded).map_err(err)?;
                if bytes.len() > 16 * 1024 * 1024 {
                    return Err("PDF asset exceeds 16 MiB.".into());
                }
                self.out.push(Block::Image(bytes));
                return Ok(());
            }
            let block = matches!(
                tag,
                "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "li" | "pre" | "tr" | "blockquote"
            );
            if block {
                self.flush();
            }
            let old_size = self.size;
            let old_pre = self.pre;
            self.size = match tag {
                "h1" => 22.0,
                "h2" => 18.0,
                "h3" | "h4" | "h5" | "h6" => 14.0,
                "pre" => 10.0,
                _ => self.size,
            };
            if tag == "pre" {
                self.pre = true;
            }
            if tag == "ul" {
                self.lists.push(None);
            }
            if tag == "ol" {
                self.lists.push(Some(1));
            }
            if tag == "li" {
                self.text
                    .push_str(&"  ".repeat(self.lists.len().saturating_sub(1)));
                if let Some(Some(n)) = self.lists.last_mut() {
                    self.text.push_str(&format!("{n}. "));
                    *n += 1;
                } else {
                    self.text.push_str("• ");
                }
            }
            if tag == "br" {
                self.text.push('\n');
            }
            if tag == "hr" {
                self.flush();
                self.out.push(Block::Text("---".into(), 11.0));
            }
            for child in node.children.borrow().iter() {
                self.walk(child, depth + 1)?;
            }
            if tag == "a" {
                let link = attribute("href");
                if !link.is_empty() {
                    self.text.push_str(&format!(" ({link})"));
                }
            }
            if matches!(tag, "td" | "th") {
                self.text.push_str(" | ");
            }
            if block {
                self.flush();
            }
            if matches!(tag, "ul" | "ol") {
                self.lists.pop();
            }
            self.size = old_size;
            self.pre = old_pre;
            Ok(())
        }
    }
    let tree = htmd::HtmlToMarkdown::new()
        .html_to_tree(html)
        .map_err(err)?;
    let mut layout = Layout {
        out: Vec::new(),
        text: String::new(),
        size: 11.0,
        lists: Vec::new(),
        pre: false,
        nodes: 0,
    };
    layout.walk(&tree, 0)?;
    layout.flush();
    Ok(layout.out)
}
fn char_width(face: &ttf_parser::Face, c: char, size: f32) -> Result<f32> {
    // No silent fallback, bidi reordering or unimplemented complex-script shaping.
    if c == '\t' {
        return Ok(size * 2.0);
    }
    if c.is_control()
        || c == '\u{fffd}'
        || matches!(c as u32,0x0300..=0x036f|0x0590..=0x1cff|0x1dc0..=0x1dff|0x200b..=0x200f|0x202a..=0x202e|0x2066..=0x2069|0x20d0..=0x20ff|0xfb1d..=0xfdff|0xfe00..=0xfe2f|0xfe70..=0xfeff)
    {
        return Err(format!("PDF generation cannot shape character U+{:04X} in this milestone. Use precomposed Latin, Greek or Cyrillic text; complex scripts/combining sequences are unsupported.",c as u32));
    }
    let glyph=face.glyph_index(c).ok_or_else(||format!("The bundled PDF font has no glyph for U+{:04X} ({c}). That script or symbol is unsupported; no PDF was published.",c as u32))?;
    Ok(f32::from(face.glyph_hor_advance(glyph).unwrap_or(0)) * size
        / f32::from(face.units_per_em()))
}
fn wrap(face: &ttf_parser::Face, text: &str, size: f32, width: f32) -> Result<Vec<String>> {
    let mut lines = Vec::new();
    for paragraph in text.split('\n') {
        let mut line = String::new();
        let mut current = 0.0;
        for word in paragraph.split_inclusive(char::is_whitespace) {
            let word_width = word
                .chars()
                .map(|c| char_width(face, c, size))
                .collect::<Result<Vec<_>>>()?
                .iter()
                .sum::<f32>();
            if current + word_width > width && !line.is_empty() {
                lines.push(line.trim_end().into());
                line.clear();
                current = 0.0;
            }
            for c in word.chars() {
                let w = char_width(face, c, size)?;
                if current + w > width && !line.is_empty() {
                    lines.push(std::mem::take(&mut line));
                    current = 0.0;
                }
                if c == '\t' {
                    line.push_str("    ");
                } else {
                    line.push(c);
                }
                current += w;
            }
        }
        lines.push(line.trim_end().into());
    }
    Ok(lines)
}
fn white(pixels: image::RgbaImage, control: &Control) -> Result<image::RgbImage> {
    let mut out = image::RgbImage::new(pixels.width(), pixels.height());
    for (i, (src, dst)) in pixels.pixels().zip(out.pixels_mut()).enumerate() {
        if i % 65536 == 0 {
            control.check()?;
        }
        let a = u32::from(src[3]);
        for c in 0..3 {
            dst[c] = ((u32::from(src[c]) * a + 255 * (255 - a) + 127) / 255) as u8;
        }
    }
    Ok(out)
}
fn add_image<'a>(
    doc: &PdfDocument<'a>,
    page: &mut PdfPage<'a>,
    pixels: image::RgbaImage,
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    control: &Control,
) -> Result<()> {
    let rgb = white(pixels, control)?;
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 90)
        .encode_image(&image::DynamicImage::ImageRgb8(rgb))
        .map_err(err)?;
    control.check()?;
    let mut object =
        PdfPageImageObject::new_from_jpeg_reader(doc, Cursor::new(jpeg)).map_err(err)?;
    object.scale(w, h).map_err(err)?;
    object
        .translate(PdfPoints::new(x), PdfPoints::new(y))
        .map_err(err)?;
    page.objects_mut().add_image_object(object).map_err(err)?;
    Ok(())
}
fn validate_pdf(path: &Path, pages: u16, control: &Control) -> Result<()> {
    control.check()?;
    if std::fs::metadata(path).map_err(err)?.len() == 0 {
        return Err("PDF output is empty.".into());
    }
    let doc = load(library()?, path)?;
    if doc.pages().len() != i32::from(pages) {
        return Err("PDF output page count did not match. No output published.".into());
    }
    for page in doc.pages().iter() {
        control.check()?;
        if !page.width().value.is_finite()
            || page.width().value <= 0.0
            || page.height().value <= 0.0
        {
            return Err("Invalid PDF output page size.".into());
        }
        page.objects().len();
    }
    Ok(())
}
pub fn generate(
    input: &Path,
    chosen: &Path,
    control: &Control,
    progress: &mut dyn FnMut(u16, u16),
) -> Result<PathBuf> {
    let html = crate::text::for_pdf(input, control)?;
    let blocks = blocks(&html)?;
    let _lock = SERIAL.lock().unwrap();
    control.check()?;
    let pdf = library()?;
    let mut doc = pdf.create_new_pdf().map_err(err)?;
    let font_bytes = std::fs::read(assets()?.join("NotoSans-Regular.ttf")).map_err(err)?;
    let face = ttf_parser::Face::parse(&font_bytes, 0).map_err(err)?;
    let font = doc
        .fonts_mut()
        .load_true_type_from_bytes(&font_bytes, true)
        .map_err(err)?;
    // Layout first, then write: counts are actual pages rather than guessed percent.
    enum Item {
        Text(String, f32, f32),
        Image(Vec<u8>, f32, f32, f32),
    }
    let mut pages: Vec<Vec<Item>> = vec![Vec::new()];
    let mut y = 800.0;
    let mut pixels_total = 0u64;
    for block in blocks {
        control.check()?;
        match block {
            Block::Text(text, size) => {
                for line in wrap(&face, &text, size, 515.0)? {
                    if y - size * 1.5 < 42.0 {
                        pages.push(Vec::new());
                        y = 800.0;
                    }
                    pages.last_mut().unwrap().push(Item::Text(line, size, y));
                    y -= size * 1.5;
                }
                y -= 6.0;
            }
            Block::Image(bytes) => {
                let image = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
                    .map_err(err)?;
                pixels_total += u64::from(image.width()) * u64::from(image.height());
                if pixels_total > MAX_IMAGE_TOTAL {
                    return Err("PDF assets exceed the 100 million total pixel budget.".into());
                }
                let scale = (515.0 / image.width() as f32)
                    .min(700.0 / image.height() as f32)
                    .min(1.0);
                let w = image.width() as f32 * scale;
                let h = image.height() as f32 * scale;
                if y - h < 42.0 {
                    pages.push(Vec::new());
                    y = 800.0;
                }
                y -= h;
                pages.last_mut().unwrap().push(Item::Image(bytes, w, h, y));
                y -= 12.0;
            }
        }
        if pages.len() > usize::from(MAX_PAGES) {
            return Err("Generated PDF exceeds 500 pages.".into());
        }
    }
    let count = pages.len() as u16;
    for (i, items) in pages.into_iter().enumerate() {
        control.check()?;
        let mut page = doc
            .pages_mut()
            .create_page_at_end(PdfPagePaperSize::a4())
            .map_err(err)?;
        for item in items {
            control.check()?;
            match item {
                Item::Text(line, size, y) => {
                    if !line.is_empty() {
                        let mut object =
                            PdfPageTextObject::new(&doc, &line, font, PdfPoints::new(size))
                                .map_err(err)?;
                        object
                            .translate(PdfPoints::new(40.0), PdfPoints::new(y))
                            .map_err(err)?;
                        page.objects_mut().add_text_object(object).map_err(err)?;
                    }
                }
                Item::Image(bytes, w, h, y) => {
                    let image =
                        image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
                            .map_err(err)?;
                    add_image(&doc, &mut page, image.to_rgba8(), 40.0, y, w, h, control)?;
                }
            }
        }
        progress(i as u16 + 1, count);
    }
    let mut output = stage_output(input, chosen, OutputFormat::Pdf, control)?;
    let mut file = output.file.take().ok_or("Missing staging file.")?;
    doc.save_to_writer(&mut file).map_err(err)?;
    file.flush().map_err(err)?;
    file.sync_all().map_err(err)?;
    drop(file);
    drop(doc);
    validate_pdf(&output.path, count, control)?;
    output.publish()
}
pub fn image_page_dimensions(size: ImagePageSize, w: f32, h: f32) -> Result<(f32, f32, f32)> {
    let (pw, ph, margin) = match size {
        ImagePageSize::A4 => (210.0 / 25.4 * 72.0, 297.0 / 25.4 * 72.0, 36.0),
        ImagePageSize::Letter => (612.0, 792.0, 36.0),
        ImagePageSize::Legal => (612.0, 1008.0, 36.0),
        ImagePageSize::Image => return Ok((w * 72.0 / 150.0, h * 72.0 / 150.0, 0.0)),
        ImagePageSize::Custom { width, height } => (width, height, 36.0),
    };
    if !pw.is_finite() || !ph.is_finite() || pw < 72.0 || ph < 72.0 || pw > 14400.0 || ph > 14400.0
    {
        return Err("Page dimensions must be finite and between 1 and 200 inches.".into());
    }
    if (pw as f32) <= 2.0 * (margin as f32) || (ph as f32) <= 2.0 * (margin as f32) {
        return Err(
            "Margins must leave a positive usable page area; use dimensions greater than 1 inch."
                .into(),
        );
    }
    Ok((pw as f32, ph as f32, margin as f32))
}
pub fn images_to_pdf(
    inputs: &[PathBuf],
    chosen: &Path,
    size: ImagePageSize,
    control: &Control,
    progress: &mut dyn FnMut(u16, u16),
) -> Result<PathBuf> {
    if inputs.is_empty() || inputs.len() > 100 {
        return Err("Choose between 1 and 100 still images.".into());
    }
    let _lock = SERIAL.lock().unwrap();
    control.check()?;
    let pdf = library()?;
    let mut doc = pdf.create_new_pdf().map_err(err)?;
    let mut total = 0u64;
    for (i, input) in inputs.iter().enumerate() {
        control.check()?;
        let image = crate::images::decode(input, control).map_err(|message| {
            format!(
                "{}: {message}",
                input.file_name().unwrap_or_default().to_string_lossy()
            )
        })?;
        let w = image.info.width as f32;
        let h = image.info.height as f32;
        total += u64::from(image.info.width) * u64::from(image.info.height);
        if total > MAX_IMAGE_TOTAL {
            return Err(
                "Images exceed the 100 million combined pixel budget. Use fewer/smaller images."
                    .into(),
            );
        }
        let (pw, ph, margin) = image_page_dimensions(size, w, h)?;
        let scale = ((pw - 2.0 * margin) / w).min((ph - 2.0 * margin) / h);
        let (iw, ih) = (w * scale, h * scale);
        let mut page = doc
            .pages_mut()
            .create_page_at_end(PdfPagePaperSize::new_custom(
                PdfPoints::new(pw),
                PdfPoints::new(ph),
            ))
            .map_err(err)?;
        add_image(
            &doc,
            &mut page,
            image.pixels,
            (pw - iw) / 2.0,
            (ph - ih) / 2.0,
            iw,
            ih,
            control,
        )?;
        progress(i as u16 + 1, inputs.len() as u16);
    }
    let mut output = stage_output(&inputs[0], chosen, OutputFormat::Pdf, control)?;
    let mut file = output.file.take().ok_or("Missing PDF staging handle.")?;
    doc.save_to_writer(&mut file).map_err(err)?;
    file.flush().map_err(err)?;
    file.sync_all().map_err(err)?;
    drop(file);
    drop(doc);
    validate_pdf(&output.path, inputs.len() as u16, control)?;
    output.publish()
}

#[cfg(windows)]
fn publish_directory(from: &Path, to: &Path) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(from: *const u16, to: *const u16, flags: u32) -> i32;
    }
    let a = from
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let b = to
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    if unsafe { MoveFileExW(a.as_ptr(), b.as_ptr(), 0) } == 0 {
        return Err(
            "Could not publish the output folder; it may already exist. Choose a new folder name."
                .into(),
        );
    }
    Ok(())
}
#[cfg(not(windows))]
fn publish_directory(_from: &Path, _to: &Path) -> Result<()> {
    Err("Windows x64 is required.".into())
}
pub fn render_pages(
    input: &Path,
    chosen: &Path,
    format: OutputFormat,
    options: &PdfOptions,
    control: &Control,
    progress: &mut dyn FnMut(u16, u16),
) -> Result<PathBuf> {
    if !matches!(format, OutputFormat::Png | OutputFormat::Jpg) {
        return Err("Choose PNG or JPEG page images.".into());
    }
    let parent = chosen
        .parent()
        .ok_or("Choose a new output folder name.")?
        .canonicalize()
        .map_err(err)?;
    let destination = parent.join(chosen.file_name().ok_or("Choose a folder name.")?);
    if std::fs::symlink_metadata(&destination).is_ok() {
        return Err("That output folder already exists. Choose a new name; existing contents are never overwritten.".into());
    }
    let _lock = SERIAL.lock().unwrap();
    control.check()?;
    let doc = load(library()?, input)?;
    let range = page_range(options.pages.as_deref(), doc.pages().len() as u16)?;
    let dir = tempfile::Builder::new()
        .prefix(".clip-clip-go-pages-")
        .tempdir_in(&parent)
        .map_err(err)?;
    *control.temporary_directory.lock().unwrap() = Some(dir.path().into());
    let result = (|| {
        let stem = input
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .chars()
            .take(100)
            .collect::<String>();
        let mut disk = 0u64;
        for (done, index) in range.iter().enumerate() {
            control.check()?;
            let page = doc.pages().get(i32::from(*index)).map_err(err)?;
            let w = (page.width().value * 150.0 / 72.0).ceil();
            let h = (page.height().value * 150.0 / 72.0).ceil();
            if !w.is_finite()
                || !h.is_finite()
                || w < 1.0
                || h < 1.0
                || w > 16384.0
                || h > 16384.0
                || w * h > 16_000_000.0
            {
                return Err(
                    "A PDF page exceeds the 16 million pixel render limit at 150 DPI.".into(),
                );
            }
            let image = page
                .render_with_config(
                    &PdfRenderConfig::new()
                        .set_target_size(w as i32, h as i32)
                        .set_clear_color(PdfColor::WHITE)
                        .render_form_data(false)
                        .limit_render_image_cache_size(true),
                )
                .map_err(err)?
                .as_image()
                .map_err(err)?;
            control.check()?;
            let path = dir.path().join(format!(
                "{stem}-page-{:03}.{}",
                index + 1,
                format.extension()
            ));
            let rgb = white(image.to_rgba8(), control)?;
            let file = std::fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&path)
                .map_err(err)?;
            let mut writer = std::io::BufWriter::new(file);
            match format {
                OutputFormat::Jpg => {
                    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut writer, 90)
                        .encode_image(&image::DynamicImage::ImageRgb8(rgb))
                        .map_err(err)?
                }
                _ => image::DynamicImage::ImageRgb8(rgb)
                    .write_to(&mut writer, image::ImageFormat::Png)
                    .map_err(err)?,
            };
            writer.flush().map_err(err)?;
            writer.get_ref().sync_all().map_err(err)?;
            drop(writer);
            let verified = crate::images::decode(&path, control)?;
            if verified.info.width != w as u32
                || verified.info.height != h as u32
                || verified.info.format != format
            {
                return Err("Rendered page validation failed.".into());
            }
            disk += std::fs::metadata(&path).map_err(err)?.len();
            if disk > 512 * 1024 * 1024 {
                return Err("Rendered pages exceed the 512 MiB output budget.".into());
            }
            progress(done as u16 + 1, range.len() as u16);
        }
        let _publication = control.publication.lock().unwrap();
        control.check()?;
        publish_directory(dir.path(), &destination)?;
        control.temporary_directory.lock().unwrap().take();
        Ok(destination)
    })();
    // Only this job's unique staging directory is ever removed.
    control.temporary_directory.lock().unwrap().take();
    drop(dir);
    result
}

#[cfg(test)]
#[path = "pdf/tests.rs"]
mod tests;
