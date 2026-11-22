//! Resolve only app-owned unpacked extension assets, never a path supplied over IPC.
use super::shared::*;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
pub const FILES: &[&str] = &[
    "manifest.json",
    "icons/icon-16.png",
    "icons/icon-24.png",
    "icons/icon-32.png",
    "icons/icon-48.png",
    "icons/icon-64.png",
    "icons/icon-128.png",
    "worker.js",
    "model.js",
    "detect.js",
    "popup.html",
    "popup.js",
    "popup-state.js",
    "popup-view.js",
    "popup.css",
    "fonts/Montserrat-Variable.ttf",
    "fonts/OFL.txt",
];
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionFolder {
    pub path: PathBuf,
    pub source: String,
}
pub fn validate(folder: &Path) -> Result<PathBuf> {
    if folder.file_name().is_none_or(|n| n != "extension") || !folder.is_absolute() {
        return Err("The app-owned extension folder is invalid.".into());
    }
    for name in FILES {
        let path = folder.join(name);
        let m = std::fs::symlink_metadata(&path)
            .map_err(|_| "The packaged extension is incomplete. Repair ClipClipGO.")?;
        if !m.is_file() || m.file_type().is_symlink() || m.len() == 0 {
            return Err("The packaged extension has invalid assets. Repair ClipClipGO.".into());
        }
    }
    let manifest: serde_json::Value = serde_json::from_slice(
        &std::fs::read(folder.join("manifest.json"))
            .map_err(|_| "Cannot read the extension manifest.")?,
    )
    .map_err(|_| "Invalid extension manifest.")?;
    if manifest["manifest_version"] != 3
        || manifest["background"]["service_worker"] != "worker.js"
        || manifest["action"]["default_popup"] != "popup.html"
    {
        return Err("Unexpected extension package.".into());
    }
    folder
        .canonicalize()
        .map(|p| super::windows::readable_path(&p))
        .map_err(|_| "Cannot resolve the extension folder.".into())
}
pub fn resolve(desktop: &Path, development: Option<&Path>) -> Result<ExtensionFolder> {
    let packaged = desktop
        .parent()
        .ok_or("Cannot locate the app installation directory.")?
        .join("extension");
    if packaged.exists() {
        return Ok(ExtensionFolder {
            path: validate(&packaged)?,
            source: "installation".into(),
        });
    }
    if let Some(folder) = development {
        return Ok(ExtensionFolder {
            path: validate(folder)?,
            source: "development".into(),
        });
    }
    Err("The extension folder is missing from this installation. Repair ClipClipGO.".into())
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    OpenExtensions,
    OpenFolder,
    CopyAddress,
    CopyFolder,
}
#[derive(Debug, PartialEq)]
pub enum Operation {
    ChromeExtensions,
    Folder(PathBuf),
    Clipboard(String),
}
pub fn plan(action: Action, folder: &ExtensionFolder) -> Operation {
    match action {
        Action::OpenExtensions => Operation::ChromeExtensions,
        Action::OpenFolder => Operation::Folder(folder.path.clone()),
        Action::CopyAddress => Operation::Clipboard("chrome://extensions/".into()),
        Action::CopyFolder => Operation::Clipboard(folder.path.to_string_lossy().into_owned()),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extension_paths_follow_actual_custom_installation_and_have_honest_dev_fallback() {
        let parent = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/companion-tests");
        std::fs::create_dir_all(&parent).unwrap();
        let root = tempfile::tempdir_in(parent).unwrap();
        let install = root.path().join("Custom user install");
        let extension = install.join("extension");
        std::fs::create_dir_all(extension.join("fonts")).unwrap();
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../browser-companion/extension");
        for name in FILES {
            std::fs::create_dir_all(extension.join(name).parent().unwrap()).unwrap();
            std::fs::copy(source.join(name), extension.join(name)).unwrap();
        }
        let app = install.join("clip-clip-go.exe");
        let found = resolve(&app, None).unwrap();
        assert_eq!(
            found.path,
            super::super::windows::readable_path(&extension.canonicalize().unwrap())
        );
        assert_eq!(found.source, "installation");
        assert_eq!(
            plan(Action::CopyFolder, &found),
            Operation::Clipboard(found.path.to_string_lossy().into_owned())
        );
        assert_eq!(
            plan(Action::OpenExtensions, &found),
            Operation::ChromeExtensions
        );
        let absent = root.path().join("absent/clip-clip-go.exe");
        assert!(resolve(&absent, None).is_err());
        assert_eq!(
            resolve(&absent, Some(&source)).unwrap().source,
            "development"
        );
        std::fs::remove_file(extension.join("popup.css")).unwrap();
        assert!(
            resolve(&app, Some(&source)).is_err(),
            "A broken installed package must not silently use project sources"
        );
    }
}
