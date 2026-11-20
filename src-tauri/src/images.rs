//! Compiled-in, bounded single-image conversion. No subprocesses or engine discovery.
use crate::{
    conversion::stage_output,
    engine::OutputFormat,
    process::{Control, Result},
};
use image::{
    metadata::Orientation, DynamicImage, ImageDecoder, ImageEncoder, ImageFormat, ImageReader,
    Limits,
};
use serde::Serialize;
use std::{
    fs::File,
    io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};

pub const MAX_SIDE: u32 = 16_384;
pub const MAX_PIXELS: u64 = 16_000_000;
pub const MAX_BYTES: u64 = 128 * 1024 * 1024;
const LIMIT_MESSAGE: &str = "Image exceeds the safety limits: 16 million pixels, 16,384 pixels per side, or 128 MiB of input/decoded pixel data. Choose a smaller image.";
const SINGLE_MESSAGE: &str =
    "Animated or multipage images are not supported yet. Select a single still image.";
const CORRUPT: &str = "Could not decode this image. It may be corrupt, truncated or use an unsupported image variant.";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageInfo {
    pub width: u32,
    pub height: u32,
    pub format: OutputFormat,
    pub has_alpha: bool,
    pub orientation_applied: bool,
}
pub struct Decoded {
    pub pixels: image::RgbaImage,
    pub info: ImageInfo,
}
pub fn is_image_input(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "jpg" | "jpeg" | "png" | "webp" | "bmp" | "tif" | "tiff"
    )
}
fn error(error: image::ImageError) -> String {
    match error {
        image::ImageError::Limits(_) => LIMIT_MESSAGE.into(),
        _ => CORRUPT.into(),
    }
}
fn format_from_image(format: ImageFormat) -> Result<OutputFormat> {
    match format {
        ImageFormat::Jpeg => Ok(OutputFormat::Jpg),
        ImageFormat::Png => Ok(OutputFormat::Png),
        ImageFormat::WebP => Ok(OutputFormat::Webp),
        ImageFormat::Bmp => Ok(OutputFormat::Bmp),
        ImageFormat::Tiff => Ok(OutputFormat::Tiff),
        _ => Err("This file is not a supported JPEG, PNG, WebP, BMP or TIFF image.".into()),
    }
}
fn limits() -> Limits {
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_SIDE);
    limits.max_image_height = Some(MAX_SIDE);
    limits.max_alloc = Some(MAX_BYTES);
    limits
}
fn check_size(width: u32, height: u32, bytes: u64) -> Result<()> {
    if width == 0
        || height == 0
        || width > MAX_SIDE
        || height > MAX_SIDE
        || u64::from(width) * u64::from(height) > MAX_PIXELS
        || bytes > MAX_BYTES
    {
        return Err(LIMIT_MESSAGE.into());
    }
    Ok(())
}
fn read<const N: usize>(reader: &mut impl Read) -> Result<[u8; N]> {
    let mut bytes = [0; N];
    reader
        .read_exact(&mut bytes)
        .map_err(|_| CORRUPT.to_string())?;
    Ok(bytes)
}
fn seek(reader: &mut impl Seek, position: u64) -> Result<()> {
    reader
        .seek(SeekFrom::Start(position))
        .map_err(|_| CORRUPT.to_string())?;
    Ok(())
}
fn u16_at(bytes: [u8; 2], little: bool) -> u16 {
    if little {
        u16::from_le_bytes(bytes)
    } else {
        u16::from_be_bytes(bytes)
    }
}
fn u32_at(bytes: [u8; 4], little: bool) -> u32 {
    if little {
        u32::from_le_bytes(bytes)
    } else {
        u32::from_be_bytes(bytes)
    }
}
fn u64_at(bytes: [u8; 8], little: bool) -> u64 {
    if little {
        u64::from_le_bytes(bytes)
    } else {
        u64::from_be_bytes(bytes)
    }
}

// Bounded structural checks supplement the image decoder, which otherwise reads
// only the default frame/page. They scan chunk headers, not entire pixel payloads.
fn single_image(
    reader: &mut (impl Read + Seek),
    format: ImageFormat,
    length: u64,
    control: &Control,
) -> Result<()> {
    match format {
        ImageFormat::Png | ImageFormat::WebP => {
            let webp = format == ImageFormat::WebP;
            let mut position = if webp { 12 } else { 8 };
            if webp {
                seek(reader, 4)?;
                if u64::from(u32::from_le_bytes(read(reader)?)) + 8 != length {
                    return Err(CORRUPT.into());
                }
            }
            for _ in 0..65_536 {
                control.check()?;
                if position + 8 > length {
                    break;
                }
                seek(reader, position)?;
                let first = read::<4>(reader)?;
                let second = read::<4>(reader)?;
                let (kind, size) = if webp {
                    (first, u32::from_le_bytes(second))
                } else {
                    (second, u32::from_be_bytes(first))
                };
                if kind == *b"acTL" || kind == *b"ANIM" || kind == *b"ANMF" {
                    return Err(SINGLE_MESSAGE.into());
                }
                if webp && kind == *b"VP8X" && size > 0 && read::<1>(reader)?[0] & 2 != 0 {
                    return Err(SINGLE_MESSAGE.into());
                }
                let next =
                    position + 8 + u64::from(size) + if webp { u64::from(size % 2) } else { 4 };
                if next > length {
                    return Err(CORRUPT.into());
                }
                if !webp && kind == *b"IEND" {
                    return Ok(());
                }
                position = next;
                if webp && position == length {
                    return Ok(());
                }
            }
            return Err(CORRUPT.into());
        }
        ImageFormat::Tiff => {
            seek(reader, 0)?;
            let endian = read::<2>(reader)?;
            let little = match &endian {
                b"II" => true,
                b"MM" => false,
                _ => return Err(CORRUPT.into()),
            };
            let magic = u16_at(read(reader)?, little);
            let big = magic == 43;
            let first = if big {
                if u16_at(read(reader)?, little) != 8 || u16_at(read(reader)?, little) != 0 {
                    return Err(CORRUPT.into());
                }
                u64_at(read(reader)?, little)
            } else if magic == 42 {
                u64::from(u32_at(read(reader)?, little))
            } else {
                return Err(CORRUPT.into());
            };
            if first == 0 || first >= length {
                return Err(CORRUPT.into());
            }
            seek(reader, first)?;
            let count = if big {
                u64_at(read(reader)?, little)
            } else {
                u64::from(u16_at(read(reader)?, little))
            };
            if count > 4096 {
                return Err("This TIFF directory is too complex (more than 4,096 entries). Select a simpler image.".into());
            }
            let count_bytes = if big { 8 } else { 2 };
            let entry_bytes = if big { 20 } else { 12 };
            let next_position = first + count_bytes + count * entry_bytes;
            if next_position + if big { 8 } else { 4 } > length {
                return Err(CORRUPT.into());
            }
            for entry in 0..count {
                control.check()?;
                seek(reader, first + count_bytes + entry * entry_bytes)?;
                if u16_at(read(reader)?, little) == 330 {
                    return Err(SINGLE_MESSAGE.into());
                } // SubIFDs also contain additional images.
            }
            seek(reader, next_position)?;
            let next = if big {
                u64_at(read(reader)?, little)
            } else {
                u64::from(u32_at(read(reader)?, little))
            };
            if next != 0 {
                return Err(SINGLE_MESSAGE.into());
            }
        }
        ImageFormat::Jpeg => {
            let mut position = 2;
            for _ in 0..65_536 {
                control.check()?;
                if position + 2 > length {
                    return Err(CORRUPT.into());
                }
                seek(reader, position)?;
                if read::<1>(reader)?[0] != 0xff {
                    return Err(CORRUPT.into());
                }
                let mut marker = read::<1>(reader)?[0];
                position += 2;
                while marker == 0xff {
                    marker = read::<1>(reader)?[0];
                    position += 1;
                }
                if marker == 0xda || marker == 0xd9 {
                    return Ok(());
                }
                if marker == 0x01 || (0xd0..=0xd7).contains(&marker) {
                    continue;
                }
                let size = u64::from(u16::from_be_bytes(read(reader)?));
                if size < 2 || position + size > length {
                    return Err(CORRUPT.into());
                }
                if marker == 0xe2 && size >= 6 && read::<4>(reader)? == *b"MPF\0" {
                    return Err(SINGLE_MESSAGE.into());
                }
                position += size;
            }
            return Err(LIMIT_MESSAGE.into());
        }
        _ => {}
    }
    Ok(())
}

pub fn decode(path: &Path, control: &Control) -> Result<Decoded> {
    control.check()?;
    let file = File::open(path)
        .map_err(|_| "The image is missing or inaccessible. Select it again.".to_string())?;
    let metadata = file.metadata().map_err(|_| CORRUPT.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_BYTES {
        return Err(LIMIT_MESSAGE.into());
    }
    let mut reader = BufReader::new(file);
    let magic = read::<12>(&mut reader)?;
    if magic.starts_with(b"BA") {
        return Err(SINGLE_MESSAGE.into());
    }
    let format = image::guess_format(&magic).map_err(error)?;
    let output = format_from_image(format)?;
    single_image(&mut reader, format, metadata.len(), control)?;
    seek(&mut reader, 0)?;
    let mut reader = ImageReader::with_format(reader, format);
    reader.limits(limits());
    let mut decoder = reader.into_decoder().map_err(error)?;
    let (width, height) = decoder.dimensions();
    check_size(width, height, decoder.total_bytes())?;
    let orientation = decoder.orientation().map_err(error)?;
    control.check()?;
    let decoded = DynamicImage::from_decoder(decoder);
    control.check()?;
    let mut image = decoded.map_err(error)?;
    let has_alpha = image.color().has_alpha();
    image.apply_orientation(orientation);
    control.check()?;
    let pixels = image.into_rgba8();
    let info = ImageInfo {
        width: pixels.width(),
        height: pixels.height(),
        format: output,
        has_alpha,
        orientation_applied: orientation != Orientation::NoTransforms,
    };
    Ok(Decoded { pixels, info })
}

fn white_rgb(pixels: image::RgbaImage, control: &Control) -> Result<image::RgbImage> {
    let mut rgb = image::RgbImage::new(pixels.width(), pixels.height());
    for (row, (source, destination)) in pixels.rows().zip(rgb.rows_mut()).enumerate() {
        if row % 64 == 0 {
            control.check()?;
        }
        for (source, destination) in source.zip(destination) {
            let alpha = u32::from(source[3]);
            for channel in 0..3 {
                destination[channel] =
                    ((u32::from(source[channel]) * alpha + 255 * (255 - alpha) + 127) / 255) as u8;
            }
        }
    }
    Ok(rgb)
}

// The stage callback is real feedback and a deterministic cancellation boundary in tests.
pub fn convert_to(
    decoded: Decoded,
    input: &Path,
    chosen: &Path,
    format: OutputFormat,
    control: &Control,
    stage: impl Fn(&str),
) -> Result<PathBuf> {
    if !format.image() {
        return Err("Image inputs offer image outputs only.".into());
    }
    let expected = (decoded.info.width, decoded.info.height);
    let mut staged = stage_output(input, chosen, format, control)?;
    stage("encoding");
    control.check()?;
    {
        let mut writer = BufWriter::new(
            staged
                .file
                .take()
                .ok_or("The staging file is unavailable.")?,
        );
        let (width, height) = expected;
        let result = match format {
            OutputFormat::Jpg => {
                let rgb = white_rgb(decoded.pixels, control)?;
                image::codecs::jpeg::JpegEncoder::new_with_quality(&mut writer, 90).encode(
                    &rgb,
                    width,
                    height,
                    image::ExtendedColorType::Rgb8,
                )
            }
            OutputFormat::Png => image::codecs::png::PngEncoder::new_with_quality(
                &mut writer,
                image::codecs::png::CompressionType::Default,
                image::codecs::png::FilterType::Adaptive,
            )
            .write_image(
                &decoded.pixels,
                width,
                height,
                image::ExtendedColorType::Rgba8,
            ),
            OutputFormat::Webp => image::codecs::webp::WebPEncoder::new_lossless(&mut writer)
                .write_image(
                    &decoded.pixels,
                    width,
                    height,
                    image::ExtendedColorType::Rgba8,
                ),
            OutputFormat::Bmp => image::codecs::bmp::BmpEncoder::new(&mut writer).encode(
                &decoded.pixels,
                width,
                height,
                image::ExtendedColorType::Rgba8,
            ),
            OutputFormat::Tiff => image::codecs::tiff::TiffEncoder::new(&mut writer).write_image(
                &decoded.pixels,
                width,
                height,
                image::ExtendedColorType::Rgba8,
            ),
            _ => unreachable!(),
        };
        control.check()?;
        result.map_err(|_| "The image could not be encoded. Check the destination permissions and available disk space.".to_string())?;
        writer.flush().map_err(|_| {
            "Could not finish writing the image. Check available disk space.".to_string()
        })?;
    }
    control.check()?;
    stage("verifying");
    control.check()?;
    let output = decode(&staged.path, control)?;
    validate_output(&output.info, format, expected)?;
    drop(output);
    stage("publishing");
    control.check()?;
    staged.publish()
}
fn validate_output(info: &ImageInfo, format: OutputFormat, dimensions: (u32, u32)) -> Result<()> {
    if info.format != format || (info.width, info.height) != dimensions || info.orientation_applied
    {
        return Err(
            "Encoded image format or dimensions did not match. No destination file was published."
                .into(),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests;
