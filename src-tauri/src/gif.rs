//! Two-pass palette GIF conversion through bundled engines; no full-clip frame buffer.
use crate::{
    conversion::{destination_path, stage_output},
    engine::{Engines, MediaInfo, OutputFormat},
    process::{Control, LineHandler, Result, Runner},
};
use serde::Deserialize;
use std::{
    fs::File,
    io::{BufReader, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GifOptions {
    pub max_edge: u32,
    pub fps: u32,
}
impl Default for GifOptions {
    fn default() -> Self {
        Self {
            max_edge: 480,
            fps: 10,
        }
    }
}
impl GifOptions {
    pub fn dimensions(self, media: &MediaInfo) -> Result<(u32, u32)> {
        if ![320, 480, 640, 960].contains(&self.max_edge) || ![10, 15, 20].contains(&self.fps) {
            return Err(
                "Choose a GIF maximum edge of 320, 480, 640 or 960 px and 10, 15 or 20 fps.".into(),
            );
        }
        let size = media
            .video_geometry
            .as_ref()
            .ok_or("Video display dimensions are unavailable for GIF output.")?;
        if media.video.is_none()
            || !size.width.is_finite()
            || !size.height.is_finite()
            || size.width <= 0.0
            || size.height <= 0.0
        {
            return Err(
                "A supported video stream with valid dimensions is required for GIF output.".into(),
            );
        }
        let scale = (f64::from(self.max_edge) / size.width.max(size.height)).min(1.0);
        Ok((
            (size.width * scale).round().max(1.0) as u32,
            (size.height * scale).round().max(1.0) as u32,
        ))
    }
}

pub fn args(
    input: &Path,
    output: &Path,
    palette: &Path,
    media: &MediaInfo,
    options: GifOptions,
    palette_pass: bool,
) -> Result<Vec<String>> {
    let (w, h) = options.dimensions(media)?;
    let index = media.video.as_ref().ok_or("No video stream found.")?.index;
    let mut args = [
        "-hide_banner",
        "-nostdin",
        "-y",
        "-v",
        "error",
        "-xerror",
        "-nostats",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        "mov,matroska,webm,mp3,wav,flac,ogg",
        "-i",
    ]
    .map(String::from)
    .to_vec();
    args.push(input.to_string_lossy().into_owned());
    let filter = format!("fps={},scale={w}:{h}:flags=lanczos,setsar=1", options.fps);
    if palette_pass {
        args.extend([
            "-map".into(),
            format!("0:{index}"),
            "-vf".into(),
            format!("{filter},palettegen=stats_mode=diff"),
            "-frames:v".into(),
            "1".into(),
        ]);
        args.extend(
            [
                "-an", "-sn", "-dn", "-c:v", "png", "-f", "image2", "-update", "1",
            ]
            .map(String::from),
        );
        args.push(palette.to_string_lossy().into_owned());
    } else {
        args.extend(["-progress", "pipe:1"].map(String::from));
        args.extend(
            [
                "-protocol_whitelist",
                "file,pipe",
                "-format_whitelist",
                "png_pipe",
                "-f",
                "png_pipe",
                "-i",
            ]
            .map(String::from),
        );
        args.push(palette.to_string_lossy().into_owned());
        args.extend([
            "-filter_complex".into(),
            format!("[0:{index}]{filter}[frames];[frames][1:v]paletteuse=dither=sierra2_4a[gif]"),
            "-map".into(),
            "[gif]".into(),
        ]);
        args.extend(
            [
                "-an",
                "-sn",
                "-dn",
                "-map_metadata",
                "-1",
                "-map_chapters",
                "-1",
                "-c:v",
                "gif",
                "-fps_mode",
                "vfr",
                "-loop",
                "0",
                "-f",
                "gif",
            ]
            .map(String::from),
        );
        args.push(output.to_string_lossy().into_owned());
    }
    Ok(args)
}

#[derive(Debug)]
pub struct GifInfo {
    pub width: u16,
    pub height: u16,
    pub frames: u64,
    pub centiseconds: u64,
    pub loops: Option<u16>,
}

// Inspect the actual GIF structure/timing/loop extension without loading the GIF
// into memory. FFmpeg separately decodes every frame before publication.
pub fn inspect(path: &Path, control: &Control) -> Result<GifInfo> {
    fn invalid(e: impl std::fmt::Display) -> String {
        format!("GIF output validation failed: {e}")
    }
    fn byte(r: &mut impl Read) -> std::io::Result<u8> {
        let mut b = [0];
        r.read_exact(&mut b)?;
        Ok(b[0])
    }
    fn blocks(r: &mut impl Read, control: &Control) -> Result<Vec<u8>> {
        let mut first = Vec::new();
        loop {
            control.check()?;
            let n = byte(r).map_err(invalid)?;
            if n == 0 {
                break;
            }
            let mut b = vec![0; n as usize];
            r.read_exact(&mut b).map_err(invalid)?;
            if first.is_empty() {
                first = b;
            }
        }
        Ok(first)
    }
    let mut r = BufReader::new(File::open(path).map_err(invalid)?);
    let mut header = [0; 13];
    r.read_exact(&mut header).map_err(invalid)?;
    if &header[..6] != b"GIF89a" && &header[..6] != b"GIF87a" {
        return Err(invalid("invalid GIF header"));
    }
    let mut info = GifInfo {
        width: u16::from_le_bytes([header[6], header[7]]),
        height: u16::from_le_bytes([header[8], header[9]]),
        frames: 0,
        centiseconds: 0,
        loops: None,
    };
    if header[10] & 128 != 0 {
        r.seek(SeekFrom::Current(3 * (1i64 << ((header[10] & 7) + 1))))
            .map_err(invalid)?;
    }
    let mut delay = 0;
    loop {
        control.check()?;
        match byte(&mut r).map_err(invalid)? {
            0x3b => break,
            0x21 => {
                let label = byte(&mut r).map_err(invalid)?;
                if label == 0xff {
                    let n = byte(&mut r).map_err(invalid)?;
                    let mut application = vec![0; n as usize];
                    r.read_exact(&mut application).map_err(invalid)?;
                    let data = blocks(&mut r, control)?;
                    if (application == b"NETSCAPE2.0" || application == b"ANIMEXTS1.0")
                        && data.len() == 3
                        && data[0] == 1
                    {
                        info.loops = Some(u16::from_le_bytes([data[1], data[2]]));
                    }
                    continue;
                }
                let data = blocks(&mut r, control)?;
                if label == 0xf9 {
                    if data.len() != 4 {
                        return Err(invalid("invalid frame control"));
                    }
                    delay = u16::from_le_bytes([data[1], data[2]]);
                }
            }
            0x2c => {
                let mut descriptor = [0; 9];
                r.read_exact(&mut descriptor).map_err(invalid)?;
                if descriptor[8] & 128 != 0 {
                    r.seek(SeekFrom::Current(3 * (1i64 << ((descriptor[8] & 7) + 1))))
                        .map_err(invalid)?;
                }
                byte(&mut r).map_err(invalid)?;
                blocks(&mut r, control)?;
                if delay == 0 {
                    return Err(invalid("zero frame delay"));
                }
                info.frames += 1;
                info.centiseconds += u64::from(delay);
                delay = 0;
            }
            _ => return Err(invalid("unsupported or corrupt GIF block")),
        }
    }
    Ok(info)
}

pub fn convert_to(
    engines: &Engines,
    input: &Path,
    chosen: &Path,
    media: &MediaInfo,
    options: GifOptions,
    control: &Control,
    runner: &dyn Runner,
    progress: Option<LineHandler>,
    mut stage: impl FnMut(&str),
) -> Result<PathBuf> {
    let (w, h) = options.dimensions(media)?;
    let destination = destination_path(input, chosen, OutputFormat::Gif)?;
    control.check()?;
    // Keep this owned directory alive until all child processes have exited.
    // Cancellation reaps the running engine; RAII then removes every intermediate.
    let work = tempfile::Builder::new()
        .prefix(".clip-clip-go-gif-")
        .tempdir_in(destination.parent().unwrap())
        .map_err(|_| "Cannot create GIF workspace beside the destination.")?;
    let palette = work.path().join("palette.png");
    let encoded = work.path().join("encoded.gif");
    let run = |args: &[String], progress: Option<LineHandler>| -> Result<()> {
        let result = runner.run(&engines.ffmpeg, args, control, None, progress)?;
        control.check()?;
        if !result.success {
            return Err(format!(
                "FFmpeg could not complete GIF processing: {}",
                result.stderr.chars().take(600).collect::<String>()
            ));
        }
        Ok(())
    };
    stage("palette");
    run(
        &args(input, &encoded, &palette, media, options, true)?,
        None,
    )?;
    control.check()?;
    stage("encoding");
    run(
        &args(input, &encoded, &palette, media, options, false)?,
        progress,
    )?;
    control.check()?;
    stage("verifying");
    let info = inspect(&encoded, control)?;
    if u32::from(info.width) != w
        || u32::from(info.height) != h
        || info.frames < 2
        || info.loops != Some(0)
    {
        return Err("GIF validation failed (dimensions, animation or continuous loop). The clip may be too short at the selected frame rate. Nothing was published.".into());
    }
    let average = f64::from(options.fps) * info.centiseconds as f64 / (100.0 * info.frames as f64);
    if (average - 1.0).abs() > 0.11 {
        return Err("GIF frame timing did not match the selection. Nothing was published.".into());
    }
    let mut decode = [
        "-v",
        "error",
        "-xerror",
        "-nostdin",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        "gif",
        "-ignore_loop",
        "1",
        "-i",
    ]
    .map(String::from)
    .to_vec();
    decode.push(encoded.to_string_lossy().into_owned());
    decode.extend(["-map", "0:v:0", "-an", "-f", "null", "-"].map(String::from));
    run(&decode, None)?;
    control.check()?;
    let mut output = stage_output(input, &destination, OutputFormat::Gif, control)?;
    let mut source = File::open(&encoded).map_err(|_| "The staged GIF is unavailable.")?;
    let file = output.file.as_mut().ok_or("Missing GIF staging handle.")?;
    let mut buffer = [0; 64 * 1024];
    loop {
        control.check()?;
        let n = source
            .read(&mut buffer)
            .map_err(|_| "Cannot read staged GIF.")?;
        if n == 0 {
            break;
        }
        file.write_all(&buffer[..n])
            .map_err(|_| "Cannot write staged GIF.")?;
    }
    file.sync_all().map_err(|_| "Cannot flush staged GIF.")?;
    drop(output.file.take());
    control.check()?;
    stage("publishing");
    output.publish()
}

#[cfg(test)]
mod tests;
