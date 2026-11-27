use super::*;
fn work() -> tempfile::TempDir {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/pdf-tests");
    std::fs::create_dir_all(&root).unwrap();
    tempfile::tempdir_in(root).unwrap()
}
fn quiet(_: u16, _: u16) {}

#[test]
fn heic_and_conventional_image_pdf_uses_oriented_pixels_and_image_sized_defaults() {
    let dir = work();
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let heic = root.join("../tests/fixtures/heic/rotated.heic");
    let png = dir.path().join("landscape.png");
    image::RgbImage::from_pixel(100, 50, image::Rgb([0, 0, 255]))
        .save(&png)
        .unwrap();
    let output = dir.path().join("mixed.pdf");
    let c = Control::default();
    assert!(matches!(ImagePageSize::default(), ImagePageSize::Image));
    images_to_pdf(
        &[heic, png],
        &output,
        ImagePageSize::default(),
        &c,
        &mut quiet,
    )
    .unwrap();
    let artifacts = root.join("../.engine-cache/heic/verified");
    std::fs::create_dir_all(&artifacts).unwrap();
    std::fs::copy(&output, artifacts.join("mixed.pdf")).unwrap();
    let _lock = SERIAL.lock().unwrap();
    let doc = load(library().unwrap(), &output).unwrap();
    assert_eq!(doc.pages().len(), 2);
    for (i, (w, h)) in [(48.0, 64.0), (100.0, 50.0)].into_iter().enumerate() {
        let page = doc.pages().get(i as i32).unwrap();
        assert!((page.width().value - w * 72.0 / 150.0).abs() < 0.01);
        assert!((page.height().value - h * 72.0 / 150.0).abs() < 0.01);
        let rendered = page
            .render_with_config(&PdfRenderConfig::new().set_target_size(w as i32, h as i32))
            .unwrap()
            .as_image()
            .unwrap()
            .to_rgb8();
        rendered
            .save(artifacts.join(format!("pdf-page-{}.png", i + 1)))
            .unwrap();
        if i == 0 {
            // Rotated top-left quadrant was originally green, not red.
            let p = rendered.get_pixel(8, 8);
            assert!(p[1] > 200 && p[0] < 40, "{p:?}");
        } else {
            assert!(rendered.get_pixel(50, 25)[2] > 220);
        }
    }
}

// Real PDF objects with inherited/shared resources, colliding object IDs across
// documents, rotated pages, URI and same-document page links. No fixture tools.
fn merge_fixture(path: &Path, marker: &str, font: &str) {
    let stream = |s: String| format!("<< /Length {} >>\nstream\n{s}\nendstream", s.len());
    let objects = vec![
        "<< /Type /Catalog /Pages 2 0 R >>".into(),
        "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /Resources << /Font << /F1 5 0 R >> /XObject << /Mark 8 0 R >> >> >>".into(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 450] /Contents 6 0 R /Annots [9 0 R 10 0 R] >>".into(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 620 340] /Rotate 90 /Contents 7 0 R >>".into(),
        format!("<< /Type /Font /Subtype /Type1 /BaseFont /{font} >>"),
        stream(format!("BT /F1 20 Tf 20 200 Td ({marker} One) Tj ET q /Mark Do Q")),
        stream(format!("BT /F1 20 Tf 20 200 Td ({marker} Two) Tj ET q /Mark Do Q")),
        { let s="0.2 0.5 0.8 rg 20 20 100 100 re f"; format!("<< /Type /XObject /Subtype /Form /BBox [0 0 200 200] /Length {} >>\nstream\n{s}\nendstream",s.len()) },
        "<< /Type /Annot /Subtype /Link /Rect [20 180 180 220] /A << /S /URI /URI (https://example.test/pdf) >> >>".into(),
        "<< /Type /Annot /Subtype /Link /Rect [20 140 180 170] /Dest [4 0 R /Fit] >>".into(),
    ];
    let mut data = String::from("%PDF-1.7\n");
    let mut offsets = Vec::new();
    for (i, obj) in objects.iter().enumerate() {
        offsets.push(data.len());
        data.push_str(&format!("{} 0 obj\n{obj}\nendobj\n", i + 1));
    }
    let xref = data.len();
    data.push_str(&format!(
        "xref\n0 {}\n0000000000 65535 f \n",
        objects.len() + 1
    ));
    for offset in offsets {
        data.push_str(&format!("{offset:010} 00000 n \n"));
    }
    data.push_str(&format!(
        "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF",
        objects.len() + 1
    ));
    std::fs::write(path, data).unwrap();
}

#[test]
fn merge_retains_order_sizes_rotation_content_shared_resources_and_annotations() {
    let dir = work();
    let a = dir.path().join("alpha.pdf");
    let b = dir.path().join("beta.PDF");
    merge_fixture(&a, "Alpha", "Helvetica");
    merge_fixture(&b, "Beta", "Courier");
    let out = dir.path().join("merged.pdf");
    let control = Control::default();
    let mut progress = Vec::new();
    merge_pdfs(
        &[b.clone(), a.clone()],
        &out,
        &control,
        &mut |n, t| progress.push((n, t)),
        &mut |_| {},
    )
    .unwrap();
    assert_eq!(progress, vec![(0, 4), (2, 4), (4, 4)]);
    let _lock = SERIAL.lock().unwrap();
    let pdf = library().unwrap();
    let merged = load(pdf, &out).unwrap();
    assert_eq!(merged.pages().len(), 4);
    for (offset, path, marker) in [(0, &b, "Beta"), (2, &a, "Alpha")] {
        let source = load(pdf, path).unwrap();
        for i in 0..2 {
            let original = source.pages().get(i).unwrap();
            let page = merged.pages().get(offset + i).unwrap();
            assert_eq!(page.width(), original.width());
            assert_eq!(page.height(), original.height());
            assert_eq!(page.rotation().unwrap(), original.rotation().unwrap());
            assert!(page
                .text()
                .unwrap()
                .all()
                .contains(&format!("{marker} {}", if i == 0 { "One" } else { "Two" })));
            assert_eq!(page.annotations().len(), original.annotations().len());
            if i == 0 {
                let links = page.links();
                let action = links.get(0).unwrap().action().unwrap();
                match action {
                    PdfAction::Uri(uri) => {
                        assert_eq!(uri.uri().unwrap(), "https://example.test/pdf")
                    }
                    _ => panic!("Direct URI link was not retained"),
                }
                // PDFium retains this annotation but drops its page destination.
                // Keep this known limitation explicit rather than claiming link fidelity.
                assert_eq!(
                    original
                        .links()
                        .get(1)
                        .unwrap()
                        .destination()
                        .unwrap()
                        .page_index()
                        .unwrap(),
                    1
                );
                assert!(links.get(1).unwrap().destination().is_none());
            }
            // Compare actual rendering: catches broken imported fonts, streams,
            // inherited resources and Form XObject cross-document references.
            let render = |p: &PdfPage| {
                p.render_with_config(&PdfRenderConfig::new().set_target_width(300))
                    .unwrap()
                    .as_image()
                    .unwrap()
                    .to_rgb8()
            };
            assert_eq!(render(&page), render(&original));
        }
    }
}

#[test]
fn merge_invalid_inputs_collisions_limits_cancellation_and_cleanup() {
    let dir = work();
    let a = dir.path().join("a.pdf");
    let b = dir.path().join("b.pdf");
    merge_fixture(&a, "Alpha", "Helvetica");
    merge_fixture(&b, "Beta", "Courier");
    let inputs = vec![a.clone(), b.clone()];
    let original = std::fs::read(&b).unwrap();
    let merge = |paths: &[PathBuf], output: &Path, c: &Control| {
        merge_pdfs(paths, output, c, &mut quiet, &mut |_| {})
    };
    let out = dir.path().join("out.pdf");
    assert!(merge(&[a.clone()], &out, &Control::default()).is_err());
    assert!(merge(&inputs, &b, &Control::default()).is_err());
    assert_eq!(std::fs::read(&b).unwrap(), original);
    std::fs::write(&out, b"existing").unwrap();
    assert!(merge(&inputs, &out, &Control::default()).is_err());
    assert_eq!(std::fs::read(&out).unwrap(), b"existing");
    let bad = dir.path().join("bad.pdf");
    std::fs::write(&bad, b"not a PDF").unwrap();
    let failed = dir.path().join("failed.pdf");
    for invalid in [bad.clone(), dir.path().join("missing.pdf")] {
        assert!(merge(&[a.clone(), invalid], &failed, &Control::default()).is_err());
        assert!(!failed.exists());
    }
    assert!(merge(&vec![a.clone(); 101], &failed, &Control::default()).is_err());
    assert!(merge(&vec![a.clone(); 100], &failed, &Control::default()).is_ok());
    // A valid source expanded beyond the combined page budget must fail whole.
    let over_limit = dir.path().join("over-limit.pdf");
    assert!(
        merge(&vec![failed.clone(); 3], &over_limit, &Control::default())
            .unwrap_err()
            .contains("500")
    );
    assert!(!over_limit.exists());
    let large = dir.path().join("large.pdf");
    std::fs::File::create(&large)
        .unwrap()
        .set_len(MAX_PDF)
        .unwrap();
    assert!(merge(&[a.clone(), large], &over_limit, &Control::default())
        .unwrap_err()
        .contains("128 MiB"));
    for boundary in ["writing", "verifying", "publishing"] {
        let cancelled = dir.path().join(format!("cancel-{boundary}.pdf"));
        let c = Control::default();
        assert_eq!(
            merge_pdfs(
                &inputs,
                &cancelled,
                &c,
                &mut quiet,
                &mut |stage| if stage == boundary {
                    c.cancel()
                }
            )
            .unwrap_err(),
            crate::process::CANCELLED
        );
        assert!(!cancelled.exists());
        assert!(!std::fs::read_dir(dir.path()).unwrap().any(|e| e
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".clip-clip-go-")));
    }
    let c = Control::default();
    let cancelled = dir.path().join("cancel-import.pdf");
    assert_eq!(
        merge_pdfs(
            &inputs,
            &cancelled,
            &c,
            &mut |n, _| if n > 0 {
                c.cancel()
            },
            &mut |_| {}
        )
        .unwrap_err(),
        crate::process::CANCELLED
    );
    assert!(!cancelled.exists());
    // Destination created after staging must survive publication unchanged.
    let race = dir.path().join("race.pdf");
    assert!(merge_pdfs(
        &inputs,
        &race,
        &Control::default(),
        &mut quiet,
        &mut |s| if s == "publishing" {
            std::fs::write(&race, b"rival").unwrap()
        }
    )
    .is_err());
    assert_eq!(std::fs::read(&race).unwrap(), b"rival");
    let invalid_output = dir.path().join("invalid-output.pdf");
    assert!(merge_pdfs(
        &inputs,
        &invalid_output,
        &Control::default(),
        &mut quiet,
        &mut |s| if s == "verifying" {
            let stage = std::fs::read_dir(dir.path())
                .unwrap()
                .map(|e| e.unwrap().path())
                .find(|p| {
                    p.file_name()
                        .unwrap()
                        .to_string_lossy()
                        .starts_with(".clip-clip-go-")
                })
                .unwrap();
            std::fs::write(stage, b"corrupt staged output").unwrap();
        }
    )
    .is_err());
    assert!(!invalid_output.exists());
    assert!(!std::fs::read_dir(dir.path()).unwrap().any(|e| e
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".clip-clip-go-")));
}
fn fixture(path: &Path, color: [u8; 4], w: u32, h: u32) {
    image::RgbaImage::from_pixel(w, h, image::Rgba(color))
        .save(path)
        .unwrap();
}

#[test]
fn text_pdf_unicode_pagination_and_reconstruction() {
    let dir = work();
    let input = dir.path().join("notes.TXT");
    let output = dir.path().join("notes.pdf");
    let control = Control::default();
    let marker = "café Ελληνικά Привет — <literal> & [brackets]";
    std::fs::write(
        &input,
        format!(
            "{marker}\n{}",
            (1..200)
                .map(|i| format!("Line {i}: {}\n", "wrapped content ".repeat(12)))
                .collect::<String>()
        ),
    )
    .unwrap();
    let mut progress = Vec::new();
    generate(&input, &output, &control, &mut |n, t| progress.push((n, t))).unwrap();
    let info = inspect(&output, &control).unwrap();
    assert!(info.pages > 3 && info.has_text);
    assert_eq!(progress.last(), Some(&(info.pages, info.pages)));
    let text = extract(&output, OutputFormat::Txt, &control, &mut quiet).unwrap();
    assert!(text.contains(marker), "{text}");
    assert!(text.contains("Line 199"));
    assert!(text.contains('\u{000c}'));
    let md = extract(&output, OutputFormat::Md, &control, &mut quiet).unwrap();
    assert!(md.contains("## Page 1"));
    assert!(md.contains("\\<literal\\>"));
    let html = extract(&output, OutputFormat::Html, &control, &mut quiet).unwrap();
    assert_eq!(html.matches("<section>").count(), info.pages as usize);
    assert!(html.contains("&lt;literal&gt;"));
    let _lock = SERIAL.lock().unwrap();
    let doc = load(library().unwrap(), &output).unwrap();
    let page = doc.pages().get(0).unwrap();
    assert!(page.fonts().iter().all(|f| f.is_embedded().unwrap()));
    for page in doc.pages().iter() {
        let text = page.text().unwrap();
        for c in text.chars().iter() {
            if let Ok(bounds) = c.loose_bounds() {
                assert!(
                    bounds.left().value >= 35.0 && bounds.right().value < 570.0,
                    "{bounds:?}"
                );
            }
        }
    }
}
#[test]
fn text_pdf_structure_assets_and_unsupported_glyphs() {
    let dir = work();
    let control = Control::default();
    let asset = dir.path().join("local.png");
    fixture(&asset, [255, 0, 0, 255], 30, 15);
    for (ext,source) in [("md","# Heading\n\n- First\n- Second\n\n[Link](https://example.test)\n\n```\nlet x = 1;\n```\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n![Local](local.png)"),("html","<h1>Heading</h1><ul><li>First</li><li>Second</li></ul><a href='https://example.test'>Link</a><pre><code>let x = 1;</code></pre><table><tr><td>A</td><td>B</td></tr></table><img src='local.png'>")] {
        let input=dir.path().join(format!("source.{ext}"));let output=dir.path().join(format!("{ext}.pdf"));std::fs::write(&input,source).unwrap();generate(&input,&output,&control,&mut quiet).unwrap();let text=extract(&output,OutputFormat::Txt,&control,&mut quiet).unwrap();for expected in ["Heading","First","Second","https://example.test","let x = 1;","A | B"]{assert!(text.contains(expected),"{expected}: {text}");}
    }
    let input = dir.path().join("bad.md");
    std::fs::write(&input, "![missing](missing.png)").unwrap();
    assert!(
        generate(&input, &dir.path().join("bad.pdf"), &control, &mut quiet)
            .unwrap_err()
            .contains("missing")
    );
    for source in ["漢字", "مرحبا", "e\u{301}", "🙂"] {
        std::fs::write(&input, source).unwrap();
        assert!(generate(
            &input,
            &dir.path().join("unsupported.pdf"),
            &control,
            &mut quiet
        )
        .is_err());
        assert!(!dir.path().join("unsupported.pdf").exists());
    }
}
#[test]
fn images_pdf_order_alpha_aspect_scanned_and_rendering() {
    let dir = work();
    let control = Control::default();
    let blue = dir.path().join("blue.png");
    let red = dir.path().join("red.png");
    let alpha = dir.path().join("alpha.png");
    fixture(&blue, [0, 0, 255, 255], 20, 40);
    fixture(&red, [255, 0, 0, 255], 40, 20);
    fixture(&alpha, [0, 0, 0, 0], 20, 20);
    let output = dir.path().join("images.pdf");
    let inputs = vec![blue, red, alpha];
    images_to_pdf(&inputs, &output, ImagePageSize::Image, &control, &mut quiet).unwrap();
    let info = inspect(&output, &control).unwrap();
    assert_eq!(info.pages, 3);
    assert!(!info.has_text);
    assert!(extract(&output, OutputFormat::Txt, &control, &mut quiet)
        .unwrap_err()
        .contains("OCR"));
    {
        let _lock = SERIAL.lock().unwrap();
        let doc = load(library().unwrap(), &output).unwrap();
        for (i, expected) in [[0u8, 0, 255], [255, 0, 0], [255, 255, 255]]
            .iter()
            .enumerate()
        {
            let page = doc.pages().get(i as i32).unwrap();
            let image = page
                .render_with_config(
                    &PdfRenderConfig::new()
                        .set_target_size(100, 100)
                        .set_clear_color(PdfColor::WHITE),
                )
                .unwrap()
                .as_image()
                .unwrap()
                .to_rgb8();
            let pixel = image.get_pixel(50, 50);
            for c in 0..3 {
                assert!(
                    (i16::from(pixel[c]) - i16::from(expected[c])).abs() < 8,
                    "{i} {pixel:?}"
                );
            }
        }
        assert!(doc.pages().get(0).unwrap().height() > doc.pages().get(0).unwrap().width());
    }
    for format in [OutputFormat::Png, OutputFormat::Jpg] {
        let folder = dir.path().join(format.extension());
        let mut progress = Vec::new();
        render_pages(
            &output,
            &folder,
            format,
            &PdfOptions {
                pages: Some("3,1-2,2".into()),
            },
            &control,
            &mut |n, t| progress.push((n, t)),
        )
        .unwrap();
        let files = std::fs::read_dir(&folder)
            .unwrap()
            .collect::<std::io::Result<Vec<_>>>()
            .unwrap();
        assert_eq!(files.len(), 3);
        assert_eq!(progress, vec![(1, 3), (2, 3), (3, 3)]);
        let first =
            image::open(folder.join(format!("images-page-001.{}", format.extension()))).unwrap();
        assert_eq!((first.width(), first.height()), (20, 40));
        let white = image::open(folder.join(format!("images-page-003.{}", format.extension())))
            .unwrap()
            .to_rgb8();
        assert!(white.get_pixel(5, 5)[0] > 245);
    }
    let a4 = dir.path().join("a4.pdf");
    images_to_pdf(&inputs, &a4, ImagePageSize::A4, &control, &mut quiet).unwrap();
    let _lock = SERIAL.lock().unwrap();
    let doc = load(library().unwrap(), &a4).unwrap();
    assert!((doc.pages().get(0).unwrap().width().value - 595.276).abs() < 0.1);
}
#[test]
fn ranges_cancellation_and_output_protection() {
    assert_eq!(page_range(Some("3,1-2,2"), 4).unwrap(), vec![0, 1, 2]);
    assert_eq!(page_range(None, 2).unwrap(), vec![0, 1]);
    for invalid in ["0", "5", "2-1", "1-", "1,,2", "1.5", "1-99", "-1", "1–2"] {
        assert!(page_range(Some(invalid), 4).is_err(), "{invalid}");
    }
    let dir = work();
    let input = dir.path().join("source.png");
    fixture(&input, [255, 0, 0, 255], 10, 10);
    let pdf = dir.path().join("source.pdf");
    images_to_pdf(
        &[input.clone(), input.clone()],
        &pdf,
        ImagePageSize::A4,
        &Control::default(),
        &mut quiet,
    )
    .unwrap();
    let folder = dir.path().join("cancelled");
    let control = Control::default();
    assert!(render_pages(
        &pdf,
        &folder,
        OutputFormat::Png,
        &PdfOptions::default(),
        &control,
        &mut |_, _| control.cancel()
    )
    .is_err());
    assert!(!folder.exists());
    assert!(std::fs::read_dir(dir.path()).unwrap().all(|f| !f
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".clip-clip-go")));
    let folder = dir.path().join("race");
    let result = render_pages(
        &pdf,
        &folder,
        OutputFormat::Png,
        &PdfOptions::default(),
        &Control::default(),
        &mut |n, total| {
            if n == total {
                std::fs::create_dir(&folder).unwrap();
                std::fs::write(folder.join("user.txt"), "preserve").unwrap();
            }
        },
    );
    assert!(result.is_err());
    assert_eq!(
        std::fs::read_to_string(folder.join("user.txt")).unwrap(),
        "preserve"
    );
    let existing = dir.path().join("existing.pdf");
    std::fs::write(&existing, "keep").unwrap();
    assert!(images_to_pdf(
        &[input],
        &existing,
        ImagePageSize::A4,
        &Control::default(),
        &mut quiet
    )
    .is_err());
    assert_eq!(std::fs::read_to_string(existing).unwrap(), "keep");
    assert!(render_pages(
        &pdf,
        dir.path(),
        OutputFormat::Png,
        &PdfOptions::default(),
        &Control::default(),
        &mut quiet
    )
    .is_err());
}
#[test]
fn corrupt_encrypted_and_image_validation() {
    let dir = work();
    let corrupt = dir.path().join("corrupt.pdf");
    std::fs::write(&corrupt, b"not PDF").unwrap();
    assert!(inspect(&corrupt, &Control::default()).is_err());
    // Generated valid PDF envelope with a standard password security dictionary.
    let objects=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>","<< /Filter /Standard /V 1 /R 2 /Length 40 /P -4 /O <0000000000000000000000000000000000000000000000000000000000000000> /U <0000000000000000000000000000000000000000000000000000000000000000> >>"];
    let mut pdf = String::from("%PDF-1.4\n");
    let mut offsets = vec![0];
    for (i, object) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.push_str(&format!("{} 0 obj\n{object}\nendobj\n", i + 1));
    }
    let xref = pdf.len();
    pdf.push_str("xref\n0 5\n0000000000 65535 f \n");
    for offset in offsets.iter().skip(1) {
        pdf.push_str(&format!("{offset:010} 00000 n \n"));
    }
    pdf.push_str(&format!("trailer\n<< /Size 5 /Root 1 0 R /Encrypt 4 0 R /ID [<00000000000000000000000000000000><00000000000000000000000000000000>] >>\nstartxref\n{xref}\n%%EOF"));
    let encrypted = dir.path().join("encrypted.pdf");
    std::fs::write(&encrypted, pdf).unwrap();
    assert!(inspect(&encrypted, &Control::default())
        .unwrap_err()
        .contains("password"));
    let valid = dir.path().join("valid.pdf");
    merge_fixture(&valid, "Valid", "Helvetica");
    let merged = dir.path().join("encrypted-merged.pdf");
    assert!(merge_pdfs(
        &[valid, encrypted],
        &merged,
        &Control::default(),
        &mut quiet,
        &mut |_| {}
    )
    .unwrap_err()
    .contains("password"));
    assert!(!merged.exists());
    let bad = dir.path().join("bad.png");
    std::fs::write(&bad, b"not image").unwrap();
    assert!(images_to_pdf(
        &[bad],
        &dir.path().join("bad.pdf"),
        ImagePageSize::A4,
        &Control::default(),
        &mut quiet
    )
    .is_err());
}

#[test]
fn rotation_exif_multipage_and_safe_boundary_cancellation() {
    let dir = work();
    let control = Control::default();
    let image = dir.path().join("oriented.jpg");
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 95)
        .encode_image(&image::DynamicImage::ImageRgb8(
            image::RgbImage::from_pixel(40, 20, image::Rgb([255, 0, 0])),
        ))
        .unwrap();
    let tiff = b"II*\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0\x06\0\0\0\0\0\0\0";
    let mut oriented = jpeg[..2].to_vec();
    oriented.extend([0xff, 0xe1]);
    oriented.extend(((tiff.len() + 8) as u16).to_be_bytes());
    oriented.extend(b"Exif\0\0");
    oriented.extend(tiff);
    oriented.extend(&jpeg[2..]);
    std::fs::write(&image, oriented).unwrap();
    let output = dir.path().join("oriented.pdf");
    images_to_pdf(
        &[image.clone()],
        &output,
        ImagePageSize::Image,
        &control,
        &mut quiet,
    )
    .unwrap();
    {
        let _lock = SERIAL.lock().unwrap();
        let doc = load(library().unwrap(), &output).unwrap();
        let page = doc.pages().get(0).unwrap();
        assert!(page.height() > page.width());
    }
    let rotated = dir.path().join("rotated.pdf");
    {
        let _lock = SERIAL.lock().unwrap();
        let pdf = library().unwrap();
        let doc = load(pdf, &output).unwrap();
        doc.pages()
            .get(0)
            .unwrap()
            .set_rotation(PdfPageRenderRotation::Degrees90);
        doc.save_to_file(&rotated).unwrap();
    }
    let folder = dir.path().join("rotated-pages");
    render_pages(
        &rotated,
        &folder,
        OutputFormat::Png,
        &PdfOptions::default(),
        &control,
        &mut quiet,
    )
    .unwrap();
    let rendered = image::open(folder.join("rotated-page-001.png")).unwrap();
    assert!(
        rendered.width() > rendered.height(),
        "{}x{}",
        rendered.width(),
        rendered.height()
    );
    let multipage = dir.path().join("multipage.tiff");
    {
        let mut writer =
            tiff::encoder::TiffEncoder::new(std::fs::File::create(&multipage).unwrap()).unwrap();
        for _ in 0..2 {
            writer
                .write_image::<tiff::encoder::colortype::RGB8>(2, 2, &[255; 12])
                .unwrap();
        }
    }
    assert!(images_to_pdf(
        &[multipage],
        &dir.path().join("reject.pdf"),
        ImagePageSize::A4,
        &control,
        &mut quiet
    )
    .unwrap_err()
    .contains("multipage"));
    let cancelled = Control::default();
    let destination = dir.path().join("cancel-image.pdf");
    assert!(images_to_pdf(
        &[image.clone(), image],
        &destination,
        ImagePageSize::A4,
        &cancelled,
        &mut |_, _| cancelled.cancel()
    )
    .is_err());
    assert!(!destination.exists());
    let input = dir.path().join("cancel-text.txt");
    std::fs::write(&input, "Text\n".repeat(400)).unwrap();
    let cancelled = Control::default();
    assert!(generate(
        &input,
        &dir.path().join("cancel-text.pdf"),
        &cancelled,
        &mut |_, _| cancelled.cancel()
    )
    .is_err());
    assert!(!dir.path().join("cancel-text.pdf").exists());
}

#[test]
fn image_page_presets_and_custom_dimensions_are_written_to_actual_pdfs() {
    let dir = work();
    let a = dir.path().join("landscape.png");
    let b = dir.path().join("portrait.png");
    fixture(&a, [255, 0, 0, 255], 80, 40);
    fixture(&b, [0, 0, 255, 255], 40, 80);
    for (i, size) in [
        ImagePageSize::A4,
        ImagePageSize::Letter,
        ImagePageSize::Legal,
        ImagePageSize::Image,
        ImagePageSize::Custom {
            width: 547.125,
            height: 845.9875,
        },
    ]
    .into_iter()
    .enumerate()
    {
        let output = dir.path().join(format!("size-{i}.pdf"));
        images_to_pdf(
            &[a.clone(), b.clone()],
            &output,
            size,
            &Control::default(),
            &mut quiet,
        )
        .unwrap();
        let _lock = SERIAL.lock().unwrap();
        let doc = load(library().unwrap(), &output).unwrap();
        assert_eq!(doc.pages().len(), 2);
        for (page_index, (w, h)) in [(80.0, 40.0), (40.0, 80.0)].into_iter().enumerate() {
            let (expected_w, expected_h) = match size {
                ImagePageSize::A4 => (595.2756, 841.8898),
                ImagePageSize::Letter => (612.0, 792.0),
                ImagePageSize::Legal => (612.0, 1008.0),
                ImagePageSize::Image => (w * 72.0 / 150.0, h * 72.0 / 150.0),
                ImagePageSize::Custom { .. } => (547.125, 845.9875),
            };
            let page = doc.pages().get(page_index as i32).unwrap();
            assert!((page.width().value - expected_w).abs() < 0.02);
            assert!((page.height().value - expected_h).abs() < 0.02);
        }
    }
    let custom: ImagePageSize =
        serde_json::from_str(r#"{"custom":{"width":612,"height":792}}"#).unwrap();
    assert_eq!(
        image_page_dimensions(custom, 1.0, 1.0).unwrap(),
        (612.0, 792.0, 36.0)
    );
}
#[test]
fn image_page_bounds_and_margins_reject_invalid_requests() {
    for value in [0.0, -1.0, f64::NAN, f64::INFINITY, 71.0, 14401.0] {
        assert!(image_page_dimensions(
            ImagePageSize::Custom {
                width: value,
                height: 792.0
            },
            1.0,
            1.0
        )
        .is_err());
        assert!(image_page_dimensions(
            ImagePageSize::Custom {
                width: 612.0,
                height: value
            },
            1.0,
            1.0
        )
        .is_err());
    }
    assert!(image_page_dimensions(
        ImagePageSize::Custom {
            width: 72.0,
            height: 792.0
        },
        1.0,
        1.0
    )
    .unwrap_err()
    .contains("Margins"));
    assert!(image_page_dimensions(
        ImagePageSize::Custom {
            width: 73.0,
            height: 14400.0
        },
        1.0,
        1.0
    )
    .is_ok());
}
