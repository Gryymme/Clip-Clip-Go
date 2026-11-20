use super::*;
use std::fs;
const FORMATS: [OutputFormat; 5] = [
    OutputFormat::Jpg,
    OutputFormat::Png,
    OutputFormat::Webp,
    OutputFormat::Bmp,
    OutputFormat::Tiff,
];
fn dir() -> tempfile::TempDir {
    let parent = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/image-tests");
    fs::create_dir_all(&parent).unwrap();
    tempfile::tempdir_in(parent).unwrap()
}
fn pixels() -> image::RgbaImage {
    image::RgbaImage::from_raw(
        2,
        3,
        vec![
            255, 0, 0, 0, 0, 255, 0, 128, 0, 0, 255, 255, 123, 45, 67, 100, 2, 3, 4, 255, 245, 246,
            247, 0,
        ],
    )
    .unwrap()
}
fn fixture(path: &Path) {
    DynamicImage::ImageRgba8(pixels())
        .save_with_format(path, ImageFormat::Png)
        .unwrap();
}
fn run(input: &Path, output: &Path, format: OutputFormat) -> PathBuf {
    let control = Control::default();
    convert_to(
        decode(input, &control).unwrap(),
        input,
        output,
        format,
        &control,
        |_| {},
    )
    .unwrap()
}
fn crc(bytes: &[u8]) -> u32 {
    let mut c = 0xffff_ffffu32;
    for b in bytes {
        c ^= u32::from(*b);
        for _ in 0..8 {
            c = (c >> 1) ^ if c & 1 != 0 { 0xedb8_8320 } else { 0 };
        }
    }
    !c
}
fn chunk(kind: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let mut bytes = (data.len() as u32).to_be_bytes().to_vec();
    bytes.extend(kind);
    bytes.extend(data);
    bytes.extend(crc(&bytes[4..]).to_be_bytes());
    bytes
}
fn exif(orientation: u16) -> Vec<u8> {
    // Little endian TIFF, one SHORT orientation entry.
    let mut exif = b"II\x2a\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0".to_vec();
    exif.extend(orientation.to_le_bytes());
    exif.extend([0; 6]);
    exif
}
#[test]
fn every_image_input_to_every_image_output_is_decoded_and_validated() {
    let dir = dir();
    let source = dir.path().join("source.png");
    fixture(&source);
    let original = fs::read(&source).unwrap();
    for input in FORMATS {
        let input_path = dir.path().join(format!("input.{}", input.extension()));
        run(&source, &input_path, input);
        let before = fs::read(&input_path).unwrap();
        for output in FORMATS {
            let output_path = dir.path().join(format!(
                "{}-{}.wrong",
                input.extension(),
                output.extension()
            ));
            let result = run(&input_path, &output_path, output);
            assert_eq!(result.extension().unwrap(), output.extension());
            let decoded = decode(&result, &Control::default()).unwrap();
            assert_eq!(decoded.info.format, output);
            assert_eq!((decoded.info.width, decoded.info.height), (2, 3));
        }
        assert_eq!(fs::read(&input_path).unwrap(), before);
    }
    assert_eq!(fs::read(source).unwrap(), original);
}
#[test]
fn alpha_survives_png_webp_bmp_tiff_and_jpeg_is_composited_on_white() {
    let dir = dir();
    let source = dir.path().join("alpha.png");
    fixture(&source);
    for format in [
        OutputFormat::Png,
        OutputFormat::Webp,
        OutputFormat::Bmp,
        OutputFormat::Tiff,
    ] {
        let dest = dir
            .path()
            .join(format!("alpha-copy.{}", format.extension()));
        run(&source, &dest, format);
        assert_eq!(
            decode(&dest, &Control::default()).unwrap().pixels,
            pixels(),
            "{format:?}"
        );
    }
    let flattened = white_rgb(pixels(), &Control::default()).unwrap();
    assert_eq!(flattened.get_pixel(0, 0).0, [255, 255, 255]);
    assert_eq!(flattened.get_pixel(1, 0).0, [127, 255, 127]);
    // A uniform transparent image avoids JPEG chroma/edge artifacts in this assertion.
    DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
        8,
        8,
        image::Rgba([12, 34, 56, 0]),
    ))
    .save(&source)
    .unwrap();
    let output = run(&source, &dir.path().join("white.jpg"), OutputFormat::Jpg);
    assert!(decode(&output, &Control::default())
        .unwrap()
        .pixels
        .pixels()
        .all(|p| p.0 == [255, 255, 255, 255]));
}
#[test]
fn all_eight_exif_orientations_are_applied_once_and_metadata_is_removed() {
    let dir = dir();
    let source = dir.path().join("orientation.png");
    fixture(&source);
    let base = fs::read(&source).unwrap();
    let orders = [
        vec![0, 1, 2, 3, 4, 5],
        vec![1, 0, 3, 2, 5, 4],
        vec![5, 4, 3, 2, 1, 0],
        vec![4, 5, 2, 3, 0, 1],
        vec![0, 2, 4, 1, 3, 5],
        vec![4, 2, 0, 5, 3, 1],
        vec![5, 3, 1, 4, 2, 0],
        vec![1, 3, 5, 0, 2, 4],
    ];
    for orientation in 1..=8 {
        let mut bytes = base[..33].to_vec();
        bytes.extend(chunk(b"eXIf", &exif(orientation)));
        bytes.extend(&base[33..]);
        fs::write(&source, bytes).unwrap();
        let decoded = decode(&source, &Control::default()).unwrap();
        let dims = if orientation >= 5 { (3, 2) } else { (2, 3) };
        assert_eq!((decoded.info.width, decoded.info.height), dims);
        let values: Vec<_> = pixels().pixels().map(|p| p.0).collect();
        let expected: Vec<_> = orders[orientation as usize - 1]
            .iter()
            .map(|i| values[*i])
            .collect();
        assert_eq!(
            decoded.pixels.pixels().map(|p| p.0).collect::<Vec<_>>(),
            expected
        );
        let dest = run(
            &source,
            &dir.path().join(format!("oriented-{orientation}.png")),
            OutputFormat::Png,
        );
        let output = decode(&dest, &Control::default()).unwrap();
        assert!(!output.info.orientation_applied);
        assert_eq!(
            output.pixels.pixels().map(|p| p.0).collect::<Vec<_>>(),
            expected
        );
    }
}
#[test]
fn jpeg_webp_and_tiff_exif_orientation_are_read() {
    let dir = dir();
    let source = dir.path().join("source.png");
    fixture(&source);
    for format in [OutputFormat::Jpg, OutputFormat::Webp] {
        let path = run(
            &source,
            &dir.path().join(format!("oriented.{}", format.extension())),
            format,
        );
        let base = fs::read(&path).unwrap();
        let mut bytes;
        if format == OutputFormat::Jpg {
            let mut data = b"Exif\0\0".to_vec();
            data.extend(exif(6));
            bytes = base[..2].to_vec();
            bytes.extend([0xff, 0xe1]);
            bytes.extend(((data.len() + 2) as u16).to_be_bytes());
            bytes.extend(data);
            bytes.extend(&base[2..]);
        } else {
            // WebP extended container with alpha and EXIF flags; preserve the lossless bitstream.
            bytes = b"RIFF\0\0\0\0WEBP".to_vec();
            let mut vp8x = vec![0x18, 0, 0, 0];
            vp8x.extend([1, 0, 0, 2, 0, 0]);
            let riff_chunk = |kind: &[u8; 4], data: &[u8]| {
                let mut c = kind.to_vec();
                c.extend((data.len() as u32).to_le_bytes());
                c.extend(data);
                if data.len() % 2 != 0 {
                    c.push(0)
                }
                c
            };
            bytes.extend(riff_chunk(b"VP8X", &vp8x));
            bytes.extend(&base[12..]);
            bytes.extend(riff_chunk(b"EXIF", &exif(6)));
            let len = (bytes.len() - 8) as u32;
            bytes[4..8].copy_from_slice(&len.to_le_bytes());
        }
        fs::write(&path, bytes).unwrap();
        let decoded = decode(&path, &Control::default()).unwrap();
        assert_eq!((decoded.info.width, decoded.info.height), (3, 2));
        assert!(decoded.info.orientation_applied);
    }
    let path = dir.path().join("oriented.tiff");
    let mut file = File::create(&path).unwrap();
    let mut encoder = tiff::encoder::TiffEncoder::new(&mut file).unwrap();
    let mut image = encoder
        .new_image::<tiff::encoder::colortype::RGBA8>(2, 3)
        .unwrap();
    image
        .encoder()
        .write_tag(tiff::tags::Tag::Orientation, 6u16)
        .unwrap();
    image.write_data(pixels().as_raw()).unwrap();
    drop(encoder);
    drop(file);
    let decoded = decode(&path, &Control::default()).unwrap();
    assert_eq!((decoded.info.width, decoded.info.height), (3, 2));
    assert!(decoded.info.orientation_applied);
}
#[test]
fn animation_and_multiple_pages_are_rejected_before_silent_frame_loss() {
    let dir = dir();
    let png = dir.path().join("animated.png");
    fixture(&png);
    let original = fs::read(&png).unwrap();
    let mut apng = original[..33].to_vec();
    let mut control = 1u32.to_be_bytes().to_vec();
    control.extend(0u32.to_be_bytes());
    apng.extend(chunk(b"acTL", &control));
    // A valid one-frame APNG still has an animation container and is explicitly excluded.
    let mut fc = 0u32.to_be_bytes().to_vec();
    fc.extend(2u32.to_be_bytes());
    fc.extend(3u32.to_be_bytes());
    fc.extend([0; 8]);
    fc.extend([0, 1, 0, 10, 0, 0]);
    apng.extend(chunk(b"fcTL", &fc));
    apng.extend(&original[33..]);
    fs::write(&png, apng).unwrap();
    assert!(decode(&png, &Control::default())
        .err()
        .unwrap()
        .contains("Animated or multipage"));
    let webp = dir.path().join("animated.webp");
    let mut bytes = b"RIFF\x16\0\0\0WEBPVP8X\x0a\0\0\0\x02\0\0\0\x01\0\0\x02\0\0".to_vec();
    let len = (bytes.len() - 8) as u32;
    bytes[4..8].copy_from_slice(&len.to_le_bytes());
    fs::write(&webp, bytes).unwrap();
    assert!(decode(&webp, &Control::default())
        .err()
        .unwrap()
        .contains("Animated or multipage"));
    let tiff = dir.path().join("pages.tiff");
    let mut file = File::create(&tiff).unwrap();
    let mut encoder = tiff::encoder::TiffEncoder::new(&mut file).unwrap();
    for _ in 0..2 {
        encoder
            .write_image::<tiff::encoder::colortype::RGBA8>(2, 3, pixels().as_raw())
            .unwrap();
    }
    drop(encoder);
    drop(file);
    assert!(decode(&tiff, &Control::default())
        .err()
        .unwrap()
        .contains("Animated or multipage"));
    let jpeg = dir.path().join("pictures.jpg");
    fs::write(&jpeg, b"\xff\xd8\xff\xe2\0\x08MPF\0\0\0\xff\xd9").unwrap();
    assert!(decode(&jpeg, &Control::default())
        .err()
        .unwrap()
        .contains("Animated or multipage"));
}
#[test]
fn actual_content_is_validated_and_safety_limits_fail_without_large_allocations() {
    let dir = dir();
    let source = dir.path().join("really-png.JPEG");
    fixture(&source);
    assert_eq!(
        decode(&source, &Control::default()).unwrap().info.format,
        OutputFormat::Png
    );
    assert!(is_image_input(&source));
    assert!(is_image_input(Path::new("alias.TIF")));
    for data in [
        b"corrupt image bytes".as_slice(),
        b"\x89PNG\r\n\x1a\ntruncated",
    ] {
        fs::write(&source, data).unwrap();
        assert!(decode(&source, &Control::default()).is_err());
    }
    let sparse = File::create(&source).unwrap();
    sparse.set_len(MAX_BYTES + 1).unwrap();
    drop(sparse);
    assert!(decode(&source, &Control::default())
        .err()
        .unwrap()
        .contains("safety limits"));
    for (width, height) in [(MAX_SIDE + 1, 1u32), (4000, 4001)] {
        fixture(&source);
        let mut bytes = fs::read(&source).unwrap();
        bytes[16..20].copy_from_slice(&width.to_be_bytes());
        bytes[20..24].copy_from_slice(&height.to_be_bytes());
        let c = crc(&bytes[12..29]);
        bytes[29..33].copy_from_slice(&c.to_be_bytes());
        fs::write(&source, bytes).unwrap();
        assert!(decode(&source, &Control::default())
            .err()
            .unwrap()
            .contains("safety limits"));
    }
    assert!(check_size(1, 1, MAX_BYTES + 1).is_err());
    for alias in ["jpeg", "jpg"] {
        assert_eq!(
            serde_json::from_str::<OutputFormat>(&format!("\"{alias}\"")).unwrap(),
            OutputFormat::Jpg
        );
    }
    assert_eq!(
        serde_json::from_str::<OutputFormat>("\"tif\"").unwrap(),
        OutputFormat::Tiff
    );
}
#[test]
fn cancellation_and_output_races_never_publish_or_remove_unrelated_files() {
    let dir = dir();
    let input = dir.path().join("original.png");
    fixture(&input);
    let original = fs::read(&input).unwrap();
    let unrelated = dir.path().join("unrelated.txt");
    fs::write(&unrelated, b"keep").unwrap();
    for boundary in ["encoding", "verifying", "publishing"] {
        let control = Control::default();
        let dest = dir.path().join(format!("cancel-{boundary}.png"));
        let result = convert_to(
            decode(&input, &control).unwrap(),
            &input,
            &dest,
            OutputFormat::Png,
            &control,
            |stage| {
                if stage == boundary {
                    control.cancel();
                }
            },
        );
        assert_eq!(result.unwrap_err(), crate::process::CANCELLED);
        assert!(!dest.exists());
    }
    let control = Control::default();
    control.cancel();
    assert_eq!(
        decode(&input, &control).err().unwrap(),
        crate::process::CANCELLED
    );
    let destination = dir.path().join("raced.png");
    let control = Control::default();
    let result = convert_to(
        decode(&input, &control).unwrap(),
        &input,
        &destination,
        OutputFormat::Png,
        &control,
        |stage| {
            if stage == "publishing" {
                fs::write(&destination, b"other application's file").unwrap();
            }
        },
    );
    assert!(result.is_err());
    assert_eq!(fs::read(&destination).unwrap(), b"other application's file");
    assert!(convert_to(
        decode(&input, &control).unwrap(),
        &input,
        &input,
        OutputFormat::Png,
        &control,
        |_| {}
    )
    .is_err());
    assert!(convert_to(
        decode(&input, &control).unwrap(),
        &input,
        &destination,
        OutputFormat::Png,
        &control,
        |_| {}
    )
    .is_err());
    assert!(convert_to(
        decode(&input, &control).unwrap(),
        &input,
        &dir.path().join("invalid.mp3"),
        OutputFormat::Mp3,
        &control,
        |_| {}
    )
    .is_err());
    assert_eq!(fs::read(&input).unwrap(), original);
    assert_eq!(fs::read(&unrelated).unwrap(), b"keep");
    assert!(fs::read_dir(dir.path()).unwrap().all(|f| !f
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".clip-clip-go-")));
}
#[test]
fn cancelling_an_open_writer_cannot_recreate_an_unowned_staging_file() {
    let dir = dir();
    let input = dir.path().join("input.png");
    fixture(&input);
    let control = Control::default();
    let mut output = stage_output(
        &input,
        &dir.path().join("output.png"),
        OutputFormat::Png,
        &control,
    )
    .unwrap();
    let path = output.path.clone();
    let mut writer = output.file.take().unwrap();
    writer.write_all(b"encoding").unwrap();
    control.cancel();
    writer
        .write_all(b"still encoding after cancellation")
        .unwrap();
    drop(writer);
    assert!(!path.exists());
    assert!(output.publish().is_err());
}
#[test]
fn wrong_output_format_and_dimensions_are_not_success() {
    let info = ImageInfo {
        width: 2,
        height: 3,
        format: OutputFormat::Png,
        has_alpha: true,
        orientation_applied: false,
    };
    assert!(validate_output(&info, OutputFormat::Jpg, (2, 3)).is_err());
    assert!(validate_output(&info, OutputFormat::Png, (3, 2)).is_err());
    let mut bad = info;
    bad.orientation_applied = true;
    assert!(validate_output(&bad, OutputFormat::Png, (2, 3)).is_err());
}

#[test]
fn corrupted_or_replaced_staged_output_is_never_published() {
    let dir = dir();
    let input = dir.path().join("source.png");
    fixture(&input);
    for variant in ["wrong-format", "wrong-dimensions", "corrupt"] {
        let control = Control::default();
        let destination = dir.path().join(format!("{variant}.png"));
        let result = convert_to(
            decode(&input, &control).unwrap(),
            &input,
            &destination,
            OutputFormat::Png,
            &control,
            |stage| {
                if stage != "verifying" {
                    return;
                }
                let path = control
                    .temporary
                    .lock()
                    .unwrap()
                    .as_ref()
                    .unwrap()
                    .to_path_buf();
                match variant {
                    "wrong-format" => DynamicImage::ImageRgb8(image::RgbImage::new(2, 3))
                        .save_with_format(path, ImageFormat::Jpeg)
                        .unwrap(),
                    "wrong-dimensions" => DynamicImage::ImageRgba8(image::RgbaImage::new(3, 2))
                        .save_with_format(path, ImageFormat::Png)
                        .unwrap(),
                    _ => fs::write(path, b"corrupted output").unwrap(),
                }
            },
        );
        assert!(result.is_err());
        assert!(!destination.exists());
    }
    assert!(fs::read_dir(dir.path()).unwrap().all(|f| !f
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".clip-clip-go-")));
}
