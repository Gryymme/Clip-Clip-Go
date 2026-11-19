//! Resolve only Tauri sidecars beside the application (never PATH or a user folder).
use crate::{engine_integrity, process::Result};
use std::path::{Path, PathBuf};

const MANIFEST: &str = include_str!("../../scripts/ffmpeg-manifest.json");
const REPAIR: &str = "Bundled conversion engines are missing or damaged. Repair or reinstall Clip-Clip-Go, then check again.";

fn pair_at(directory: &Path, development: bool) -> Result<(PathBuf, PathBuf)> {
    let manifest: serde_json::Value = serde_json::from_str(MANIFEST).map_err(|_| REPAIR)?;
    let resolve = |name: &str| -> Result<PathBuf> {
        let filename = if development {
            format!("{name}-x86_64-pc-windows-msvc.exe")
        } else {
            format!("{name}.exe")
        };
        let file = directory.join(filename);
        if !engine_integrity::verify(
            &file,
            manifest["binaries"][name]["sha256"]
                .as_str()
                .ok_or(REPAIR)?,
        )
        .unwrap_or(false)
        {
            return Err(REPAIR.into());
        }
        Ok(file)
    };
    Ok((resolve("ffmpeg")?, resolve("ffprobe")?))
}

pub fn resolve() -> Result<(PathBuf, PathBuf)> {
    resolve_beside(&std::env::current_exe().map_err(|_| REPAIR)?)
}

fn resolve_beside(executable: &Path) -> Result<(PathBuf, PathBuf)> {
    let directory = executable.parent().ok_or(REPAIR)?;
    // tauri-build copies target-suffixed sources to unsuffixed names beside the app.
    pair_at(directory, false)
}

#[cfg(test)]
pub fn test_sidecars() -> Result<(PathBuf, PathBuf)> {
    pair_at(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries"),
        true,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_and_damaged_sidecars_never_fall_back_to_path() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/bundled-tests");
        std::fs::create_dir_all(&root).unwrap();
        let dir = tempfile::tempdir_in(root).unwrap();
        assert!(pair_at(dir.path(), false)
            .unwrap_err()
            .contains("Repair or reinstall"));
        std::fs::write(dir.path().join("ffmpeg.exe"), b"damaged").unwrap();
        std::fs::write(dir.path().join("ffprobe.exe"), b"damaged").unwrap();
        assert!(pair_at(dir.path(), false).is_err());
    }
    #[test]
    fn packaged_names_resolve_from_explicit_directory_without_path_search() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/bundled-tests");
        std::fs::create_dir_all(&root).unwrap();
        let dir = tempfile::tempdir_in(root).unwrap();
        let (ffmpeg, ffprobe) = test_sidecars().unwrap();
        std::fs::copy(ffmpeg, dir.path().join("ffmpeg.exe")).unwrap();
        std::fs::copy(ffprobe, dir.path().join("ffprobe.exe")).unwrap();
        let pair = resolve_beside(&dir.path().join("clip-clip-go.exe")).unwrap();
        assert_eq!(pair.0, dir.path().join("ffmpeg.exe"));
        assert_eq!(pair.1, dir.path().join("ffprobe.exe"));
    }
}
