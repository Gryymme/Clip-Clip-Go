use serde::Serialize;
use std::{io::ErrorKind, path::Path};
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaFile {
    name: String,
    path: String,
    size_bytes: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "code", rename_all = "camelCase")]
pub enum SelectionError {
    MissingFile,
    PermissionDenied,
    NotAFile,
    MetadataError,
}

fn file_metadata(path: &Path) -> Result<MediaFile, SelectionError> {
    let metadata = std::fs::metadata(path).map_err(|error| match error.kind() {
        ErrorKind::NotFound => SelectionError::MissingFile,
        ErrorKind::PermissionDenied => SelectionError::PermissionDenied,
        _ => SelectionError::MetadataError,
    })?;
    if !metadata.is_file() {
        return Err(SelectionError::NotAFile);
    }
    let name = path.file_name().ok_or(SelectionError::NotAFile)?;
    Ok(MediaFile {
        name: name.to_string_lossy().into_owned(),
        path: path.to_string_lossy().into_owned(),
        size_bytes: metadata.len().to_string(),
    })
}

#[tauri::command]
pub async fn select_images(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, crate::conversion::Runtime>,
) -> Result<Option<Vec<MediaFile>>, SelectionError> {
    let core = state.core.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let chosen = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Add still images to PDF (maximum 100)")
            .add_filter(
                "Still images",
                &["jpg", "jpeg", "png", "webp", "bmp", "tif", "tiff"],
            )
            .blocking_pick_files();
        chosen
            .map(|files| {
                if files.len() > 100 {
                    return Err(SelectionError::MetadataError);
                }
                files
                    .into_iter()
                    .map(|file| {
                        let path = file
                            .into_path()
                            .map_err(|_| SelectionError::MetadataError)?;
                        let info = file_metadata(&path)?;
                        core.remember(&path);
                        Ok(info)
                    })
                    .collect()
            })
            .transpose()
    })
    .await
    .map_err(|_| SelectionError::MetadataError)?
}

#[tauri::command]
pub async fn select_pdfs(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, crate::conversion::Runtime>,
) -> Result<Option<Vec<MediaFile>>, SelectionError> {
    let core = state.core.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let chosen = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Add PDFs to merge (maximum 100)")
            .add_filter(
                "PDF",
                &["pdf"],
            )
            .blocking_pick_files();
        chosen
            .map(|files| {
                if files.len() > 100 {
                    return Err(SelectionError::MetadataError);
                }
                files
                    .into_iter()
                    .map(|file| {
                        let path = file
                            .into_path()
                            .map_err(|_| SelectionError::MetadataError)?;
                        let info = file_metadata(&path)?;
                        core.remember(&path);
                        Ok(info)
                    })
                    .collect()
            })
            .transpose()
    })
    .await
    .map_err(|_| SelectionError::MetadataError)?
}

// No caller-supplied file path: stat only the file chosen in this native dialog.
#[tauri::command]
pub async fn select_media_file(
    window: tauri::WebviewWindow,
    extensions: Vec<String>,
    state: tauri::State<'_, crate::conversion::Runtime>,
) -> Result<Option<MediaFile>, SelectionError> {
    let core = state.core.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let extensions: Vec<&str> = extensions.iter().map(String::as_str).collect();
        let chosen = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Select a file")
            .add_filter("Video, audio, images and documents", &extensions)
            .blocking_pick_file();
        chosen
            .map(|file| {
                let path = file
                    .into_path()
                    .map_err(|_| SelectionError::MetadataError)?;
                let info = file_metadata(&path)?;
                core.remember(&path);
                Ok(info)
            })
            .transpose()
    })
    .await
    .map_err(|_| SelectionError::MetadataError)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_is_read_without_opening_file_contents() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");
        let result = file_metadata(&path).unwrap();
        assert_eq!(result.name, "Cargo.toml");
        assert_eq!(
            result.size_bytes,
            std::fs::metadata(path).unwrap().len().to_string()
        );
    }

    #[test]
    fn missing_files_and_directories_are_rejected() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"));
        assert_eq!(file_metadata(root).unwrap_err(), SelectionError::NotAFile);
        assert_eq!(
            file_metadata(&root.join("missing-test-file.mp4")).unwrap_err(),
            SelectionError::MissingFile
        );
    }
}

#[derive(Serialize)]
pub struct DropResult {
    files: Vec<MediaFile>,
    rejected: Vec<String>,
}
fn inspect_drop(
    paths: Vec<std::path::PathBuf>,
    images_only: bool,
    core: &crate::conversion::Core,
) -> DropResult {
    let mut result = DropResult {
        files: Vec::new(),
        rejected: Vec::new(),
    };
    for path in paths {
        let info = (|| {
            if !path.is_absolute() {
                return Err("Drop a local file, not a URL.".to_string());
            }
            let info = file_metadata(&path).map_err(|e| {
                match e {
                    SelectionError::MissingFile => "File is missing.",
                    SelectionError::NotAFile => {
                        "Directories and other non-file items are unsupported."
                    }
                    SelectionError::PermissionDenied => "File access was denied.",
                    _ => "File metadata could not be read.",
                }
                .to_string()
            })?;
            if images_only && !crate::images::is_image_input(&path) {
                return Err("Unsupported image format.".into());
            }
            core.remember(&path);
            Ok(info)
        })();
        match info {
            Ok(info) => result.files.push(info),
            Err(e) => result.rejected.push(format!(
                "{}: {e}",
                path.file_name().unwrap_or_default().to_string_lossy()
            )),
        }
    }
    result
}
fn consume_drop(
    pending: &mut Vec<std::path::PathBuf>,
    paths: &[std::path::PathBuf],
    images_only: bool,
    busy: bool,
) -> Result<(), String> {
    if busy {
        return Err("Finish or cancel the active conversion before changing files.".into());
    }
    if paths.is_empty() || paths.len() > 100 {
        return Err("Drop between 1 and 100 local files.".into());
    }
    if !images_only && paths.len() != 1 {
        return Err("Choose one file.".into());
    }
    if pending.as_slice() != paths {
        return Err(
            "Drop files onto the selection card again; this drop is no longer available.".into(),
        );
    }
    pending.clear();
    Ok(())
}
#[tauri::command]
pub async fn claim_drop(
    state: tauri::State<'_, crate::conversion::Runtime>,
    paths: Vec<std::path::PathBuf>,
    images_only: bool,
    pdfs_only: Option<bool>,
) -> Result<DropResult, String> {
    consume_drop(
        &mut state.drops.lock().unwrap(),
        &paths,
        images_only || pdfs_only.unwrap_or(false),
        false,
    )?;
    let core = state.core.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut result = inspect_drop(paths, images_only, &core);
        if pdfs_only.unwrap_or(false) {
            result.files.retain(|file| {
                if crate::pdf::is_input(Path::new(&file.path)) { true } else {
                    result.rejected.push(format!("{}: Merge PDF accepts PDFs only.", file.name)); false
                }
            });
        }
        result
    })
        .await
        .map_err(|_| "File metadata could not be read.".to_string())
}

#[cfg(test)]
mod drop_tests {
    use super::*;
    #[test]
    fn native_drop_capability_is_single_use_and_rejects_substitution_multiple_and_busy() {
        let paths = vec![std::path::PathBuf::from("C:/test.png")];
        let mut pending = paths.clone();
        assert!(consume_drop(&mut pending, &paths, false, true).is_err());
        assert_eq!(pending, paths);
        assert!(consume_drop(&mut pending, &["C:/other.png".into()], false, false).is_err());
        let multiple = vec![paths[0].clone(), "C:/two.png".into()];
        pending = multiple.clone();
        assert!(consume_drop(&mut pending, &multiple, false, false)
            .unwrap_err()
            .contains("Choose one"));
        assert!(consume_drop(&mut pending, &multiple, true, false).is_ok());
        assert!(consume_drop(&mut pending, &multiple, true, false).is_err());
    }
    #[test]
    fn drop_metadata_reports_rejections_and_keeps_valid_delivered_order() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/drop-tests");
        std::fs::create_dir_all(&root).unwrap();
        let dir = tempfile::tempdir_in(root).unwrap();
        let a = dir.path().join("a.png");
        let b = dir.path().join("b.jpg");
        std::fs::write(&a, b"fixture").unwrap();
        std::fs::write(&b, b"fixture").unwrap();
        let core = crate::conversion::Core::default();
        let result = inspect_drop(
            vec![
                a.clone(),
                dir.path().to_path_buf(),
                dir.path().join("missing.png"),
                b.clone(),
                "https://example.test/image.png".into(),
            ],
            true,
            &core,
        );
        assert_eq!(result.files.len(), 2);
        assert_eq!(result.files[0].name, "a.png");
        assert_eq!(result.files[1].name, "b.jpg");
        assert_eq!(result.rejected.len(), 3);
        assert!(core.authorize(a.to_str().unwrap()).is_ok());
        assert!(core.authorize(b.to_str().unwrap()).is_ok());
    }
}
