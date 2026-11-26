//! HEVC stills use the already bundled, hash-verified FFmpeg (including tiled HEIF).
//! Container preflight is deliberately conservative: unsupported color/alpha variants
//! fail instead of silently losing HDR, a gain map, transparency or essential properties.
use super::*;
use crate::process::{NativeRunner, Runner};
use serde_json::Value;
use std::{collections::HashMap, time::Duration};

pub(super) const CORRUPT: &str = "Could not decode this HEIC image. It may be corrupt or truncated. Export a fresh standard SDR HEIC, PNG or JPEG from the source app.";
const VARIANT: &str = "This HEIC variant is unsupported. Use an 8-bit SDR HEVC still image, or export PNG/JPEG from the source app. HDR, wide-gamut/ICC color, alpha/gain maps and image sequences are not supported.";
const MAX_META: u64 = 8 * 1024 * 1024;

#[derive(Clone, Copy)]
struct Atom<'a> {
    kind: &'a [u8],
    data: &'a [u8],
}
// All offsets are checked before slicing. Bound both box count and nesting (call sites).
fn atoms(mut data: &[u8]) -> Result<Vec<Atom<'_>>> {
    let mut result = Vec::new();
    while !data.is_empty() {
        if data.len() < 8 || result.len() >= 65_536 {
            return Err(CORRUPT.into());
        }
        let size = u32::from_be_bytes(data[..4].try_into().unwrap()) as usize;
        let (size, header) = match size {
            0 => (data.len(), 8),
            1 if data.len() >= 16 => (
                usize::try_from(u64::from_be_bytes(data[8..16].try_into().unwrap()))
                    .map_err(|_| CORRUPT)?,
                16,
            ),
            1 => return Err(CORRUPT.into()),
            n => (n, 8),
        };
        if size < header || size > data.len() {
            return Err(CORRUPT.into());
        }
        result.push(Atom {
            kind: &data[4..8],
            data: &data[header..size],
        });
        data = &data[size..];
    }
    Ok(result)
}
struct Cursor<'a>(&'a [u8]);
impl<'a> Cursor<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        if n > self.0.len() {
            return Err(CORRUPT.into());
        }
        let (a, b) = self.0.split_at(n);
        self.0 = b;
        Ok(a)
    }
    fn number(&mut self, n: usize) -> Result<u32> {
        Ok(self
            .take(n)?
            .iter()
            .fold(0, |a, b| (a << 8) | u32::from(*b)))
    }
}
struct Container {
    primary: u32,
    properties: Vec<(Vec<u8>, Vec<u8>)>,
    associations: HashMap<u32, Vec<(usize, bool)>>,
}
fn container(reader: &mut (impl Read + Seek), length: u64, control: &Control) -> Result<Container> {
    let mut position = 0u64;
    let mut meta = None;
    let mut brand = false;
    for _ in 0..65_536 {
        control.check()?;
        if position == length {
            break;
        }
        if length - position < 8 {
            return Err(CORRUPT.into());
        }
        seek(reader, position)?;
        let header = read::<8>(reader)?;
        let short = u32::from_be_bytes(header[..4].try_into().unwrap());
        let (size, head) = match short {
            0 => (length - position, 8),
            1 => (u64::from_be_bytes(read(reader)?), 16),
            n => (u64::from(n), 8),
        };
        if size < head || size > length - position {
            return Err(CORRUPT.into());
        }
        match &header[4..8] {
            b"ftyp" | b"meta" => {
                let limit = if &header[4..8] == b"meta" {
                    MAX_META
                } else {
                    4096
                };
                if size - head > limit {
                    return Err(LIMIT_MESSAGE.into());
                }
                let mut data = vec![0; (size - head) as usize];
                reader.read_exact(&mut data).map_err(|_| CORRUPT)?;
                if &header[4..8] == b"meta" {
                    if meta.replace(data).is_some() {
                        return Err(CORRUPT.into());
                    }
                } else {
                    if data.len() < 8 || data.len() % 4 != 0 {
                        return Err(CORRUPT.into());
                    }
                    let brands = std::iter::once(&data[..4]).chain(data[8..].chunks_exact(4));
                    for b in brands {
                        if matches!(b, b"hevc" | b"hevx" | b"msf1") {
                            return Err(VARIANT.into());
                        }
                        brand |= matches!(b, b"heic" | b"heix");
                    }
                }
            }
            b"moov" => return Err(VARIANT.into()),
            _ => {}
        }
        position += size;
    }
    if position != length || !brand {
        return Err(CORRUPT.into());
    }
    let meta = meta.ok_or(CORRUPT)?;
    if !meta.starts_with(&[0, 0, 0, 0]) {
        return Err(VARIANT.into());
    }
    let children = atoms(&meta[4..])?;
    let one = |kind: &[u8]| -> Result<&[u8]> {
        let a = children
            .iter()
            .filter(|a| a.kind == kind)
            .collect::<Vec<_>>();
        if a.len() != 1 {
            return Err(CORRUPT.into());
        }
        Ok(a[0].data)
    };
    let mut pitm = Cursor(one(b"pitm")?);
    let version = pitm.number(1)?;
    pitm.take(3)?;
    if version > 1 {
        return Err(VARIANT.into());
    }
    let primary = pitm.number(if version == 0 { 2 } else { 4 })?;
    let iprp = atoms(one(b"iprp")?)?;
    let mut properties = None;
    let mut associations = HashMap::new();
    for a in iprp {
        if a.kind == b"ipco" {
            if properties.is_some() {
                return Err(CORRUPT.into());
            }
            properties = Some(
                atoms(a.data)?
                    .iter()
                    .map(|p| (p.kind.to_vec(), p.data.to_vec()))
                    .collect(),
            );
        } else if a.kind == b"ipma" {
            let mut c = Cursor(a.data);
            let version = c.number(1)?;
            let flags = c.number(3)?;
            if version > 1 || flags > 1 {
                return Err(VARIANT.into());
            }
            let count = c.number(4)?;
            if count > 65_536 {
                return Err(LIMIT_MESSAGE.into());
            }
            for _ in 0..count {
                let id = c.number(if version == 0 { 2 } else { 4 })?;
                let n = c.number(1)?;
                let entries = associations.entry(id).or_insert_with(Vec::new);
                for _ in 0..n {
                    let v = c.number(if flags == 0 { 1 } else { 2 })?;
                    let essential = if flags == 0 { 128 } else { 32768 };
                    entries.push(((v & (essential - 1)) as usize, v & essential != 0));
                }
            }
            if !c.0.is_empty() {
                return Err(CORRUPT.into());
            }
        }
    }
    let properties: Vec<(Vec<u8>, Vec<u8>)> = properties.ok_or(CORRUPT)?;
    // Auxiliary depth/thumbnail items are ignored. Alpha and gain maps cannot be
    // discarded silently by this RGB normalization path, even in separate items.
    for (kind, data) in &properties {
        if kind == b"ispe" {
            let mut c = Cursor(data);
            c.take(4)?;
            let w = c.number(4)?;
            let h = c.number(4)?;
            check_size(w, h, (u64::from(w) * u64::from(h)).saturating_mul(4))?;
        }
        if kind == b"auxC" {
            let value = String::from_utf8_lossy(data).to_ascii_lowercase();
            if value.contains("alpha")
                || value.contains("auxid:1")
                || value.contains("gain")
                || value.contains("hdr")
            {
                return Err(VARIANT.into());
            }
        }
    }
    Ok(Container {
        primary,
        properties,
        associations,
    })
}
impl Container {
    fn validate(&self, id: u32) -> Result<()> {
        let mut last_transform = 0;
        for &(index, essential) in self.associations.get(&id).ok_or(CORRUPT)? {
            if index == 0 {
                continue;
            }
            let (kind, data) = self.properties.get(index - 1).ok_or(CORRUPT)?;
            // The pinned decoder composes crop, rotation, then mirror. Other
            // association orders (or repeated transforms) must not be misrendered.
            let transform = match kind.as_slice() {
                b"clap" => 1,
                b"irot" => 2,
                b"imir" => 3,
                _ => 0,
            };
            if transform != 0 {
                if transform <= last_transform {
                    return Err(VARIANT.into());
                }
                last_transform = transform;
            }
            match kind.as_slice() {
                b"ispe" => {
                    let mut c = Cursor(data);
                    c.take(4)?;
                    let w = c.number(4)?;
                    let h = c.number(4)?;
                    check_size(w, h, (u64::from(w) * u64::from(h)).saturating_mul(4))?;
                }
                b"pixi" => {
                    if data.len() < 5 || data.len() != 5 + data[4] as usize {
                        return Err(CORRUPT.into());
                    }
                    if data[5..].iter().any(|&d| d != 8) {
                        return Err(VARIANT.into());
                    }
                }
                b"colr" => {
                    if data.len() != 11 || &data[..4] != b"nclx" {
                        return Err(VARIANT.into());
                    }
                    let u = |i| u16::from_be_bytes([data[i], data[i + 1]]);
                    if ![1, 2].contains(&u(4))
                        || ![1, 2, 6, 13].contains(&u(6))
                        || ![1, 2, 5, 6].contains(&u(8))
                    {
                        return Err(VARIANT.into());
                    }
                }
                b"hvcC" | b"irot" | b"imir" | b"clap" => {}
                _ if essential => return Err(VARIANT.into()),
                _ => {}
            }
        }
        Ok(())
    }
}
fn id(value: &Value) -> Result<u32> {
    let s = value["id"].as_str().ok_or(CORRUPT)?;
    u32::from_str_radix(s.strip_prefix("0x").unwrap_or(s), 16).map_err(|_| CORRUPT.into())
}
fn size(value: &Value, w: &str, h: &str) -> Result<()> {
    let n = |k| {
        value[k]
            .as_u64()
            .and_then(|v| u32::try_from(v).ok())
            .ok_or(CORRUPT)
    };
    let (w, h) = (n(w)?, n(h)?);
    check_size(w, h, (u64::from(w) * u64::from(h)).saturating_mul(4))
}
fn stream(value: &Value, meta: &Container) -> Result<()> {
    meta.validate(id(value)?)?;
    if value["codec_name"] != "hevc"
        || value["nb_frames"] != "1"
        || !matches!(
            value["pix_fmt"].as_str(),
            Some("yuv420p" | "yuvj420p" | "yuv422p" | "yuvj422p" | "yuv444p" | "yuvj444p" | "gray")
        )
    {
        return Err(VARIANT.into());
    }
    size(value, "width", "height")?;
    size(value, "coded_width", "coded_height")?;
    for key in ["color_transfer", "color_primaries"] {
        let allowed = if key == "color_transfer" {
            &["unknown", "bt709", "smpte170m", "iec61966-2-1"][..]
        } else {
            &["unknown", "bt709"][..]
        };
        if value[key].as_str().is_some_and(|v| !allowed.contains(&v)) {
            return Err(VARIANT.into());
        }
    }
    Ok(())
}
fn selection(probe: &Value, meta: &Container) -> Result<(String, bool)> {
    meta.validate(meta.primary)?;
    let streams = probe["streams"].as_array().ok_or(CORRUPT)?;
    let groups = probe["stream_groups"].as_array().ok_or(CORRUPT)?;
    if streams.len() > 256 || groups.len() > 256 {
        return Err(LIMIT_MESSAGE.into());
    }
    // Check every exposed stream/grid's size before FFmpeg constructs any filters.
    let mut total = 0u64;
    for s in streams {
        size(s, "width", "height")?;
        size(s, "coded_width", "coded_height")?;
        total += s["coded_width"].as_u64().unwrap() * s["coded_height"].as_u64().unwrap() * 4;
    }
    if total > MAX_BYTES {
        return Err(LIMIT_MESSAGE.into());
    }
    for group in groups {
        if group["type"] != "Tile Grid" {
            return Err(VARIANT.into());
        }
        for component in group["components"].as_array().ok_or(CORRUPT)? {
            size(component, "width", "height")?;
            size(component, "coded_width", "coded_height")?;
        }
    }
    if let Some(group) = groups.iter().find(|g| id(g).ok() == Some(meta.primary)) {
        // Filter input group syntax selects the assembled primary image; -map g
        // alone would instead map individual tile streams.
        let members = group["streams"].as_array().ok_or(CORRUPT)?;
        if members.is_empty() {
            return Err(CORRUPT.into());
        }
        for s in members {
            stream(s, meta)?;
        }
        let index = group["index"].as_u64().ok_or(CORRUPT)?;
        Ok((format!("[0:g:{index}]null[primary]"), true))
    } else {
        let s = streams
            .iter()
            .find(|s| id(s).ok() == Some(meta.primary))
            .ok_or(VARIANT)?;
        stream(s, meta)?;
        Ok((format!("0:{}", s["index"].as_u64().ok_or(CORRUPT)?), false))
    }
}
pub(super) fn decode(
    path: &Path,
    reader: &mut (impl Read + Seek),
    length: u64,
    control: &Control,
) -> Result<Decoded> {
    let meta = container(reader, length, control)?;
    control.check()?;
    #[cfg(test)]
    let (ffmpeg, ffprobe) = crate::bundled::test_sidecars()?;
    #[cfg(not(test))]
    let (ffmpeg, ffprobe) = crate::bundled::resolve()?;
    let common = [
        "-v",
        "error",
        "-max_alloc",
        "134217728",
        "-max_pixels",
        "16000000",
        "-threads",
        "1",
        "-protocol_whitelist",
        "file",
        "-f",
        "mov",
    ];
    let mut args = common.map(String::from).to_vec();
    args.extend(["-show_streams", "-show_stream_groups", "-of", "json", "-i"].map(String::from));
    args.push(path.to_string_lossy().into_owned());
    let probe = NativeRunner.run(
        &ffprobe,
        &args,
        control,
        Some(Duration::from_secs(15)),
        None,
    )?;
    if !probe.success {
        return Err(CORRUPT.into());
    }
    let probe: Value = serde_json::from_slice(&probe.stdout).map_err(|_| CORRUPT)?;
    let (map, group) = selection(&probe, &meta)?;
    let output=tempfile::Builder::new().prefix("clipclipgo-heic-").suffix(".png").tempfile().map_err(|_|"Could not create HEIC decode staging. Check temporary-folder permissions and disk space.")?.into_temp_path();
    let mut args = common.map(String::from).to_vec();
    args.extend(
        [
            "-nostdin",
            "-y",
            "-xerror",
            "-err_detect",
            "explode",
            "-filter_threads",
            "1",
            "-filter_complex_threads",
            "1",
            "-i",
        ]
        .map(String::from),
    );
    args.push(path.to_string_lossy().into_owned());
    if group {
        args.extend([
            "-filter_complex".into(),
            map,
            "-map".into(),
            "[primary]".into(),
        ]);
    } else {
        args.extend(["-map".into(), map]);
    }
    args.extend(
        [
            "-frames:v",
            "1",
            "-an",
            "-sn",
            "-dn",
            "-map_metadata",
            "-1",
            "-c:v",
            "png",
            "-threads",
            "1",
            "-pix_fmt",
            "rgba",
            "-fs",
            "134217728",
            "-f",
            "image2",
            "-update",
            "1",
        ]
        .map(String::from),
    );
    args.push(output.to_string_lossy().into_owned());
    let result = NativeRunner.run(&ffmpeg, &args, control, Some(Duration::from_secs(60)), None)?;
    if !result.success {
        return Err(CORRUPT.into());
    }
    control.check()?;
    // Decode the same normalized raster used for conversion and thumbnails. FFmpeg
    // owns HEIF crop/rotation/mirror; no subsequent EXIF transform is applied.
    let mut decoded = super::decode(&output, control)?;
    decoded.info.format = "heic".into();
    decoded.info.has_alpha = false; // Alpha-bearing containers were explicitly rejected.
    decoded.info.orientation_applied = meta
        .properties
        .iter()
        .any(|(k, _)| k == b"irot" || k == b"imir");
    Ok(decoded)
}
