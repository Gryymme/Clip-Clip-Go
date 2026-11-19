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

// No caller-supplied file path: stat only the file chosen in this native dialog.
#[tauri::command]
pub async fn select_media_file(
    window: tauri::WebviewWindow,
    extensions: Vec<String>,
) -> Result<Option<MediaFile>, SelectionError> {
    tauri::async_runtime::spawn_blocking(move || {
        let extensions: Vec<&str> = extensions.iter().map(String::as_str).collect();
        let chosen = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Select a video or audio file")
            .add_filter("Video and audio", &extensions)
            .blocking_pick_file();
        chosen
            .map(|file| {
                let path = file
                    .into_path()
                    .map_err(|_| SelectionError::MetadataError)?;
                file_metadata(&path)
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
