//! Small newline-delimited engine records. Never serialize the full site info dictionary.
use super::*;
pub const PROGRESS_TEMPLATE:&str="download:CCG:%(progress.{status,downloaded_bytes,total_bytes,total_bytes_estimate,fragment_index,fragment_count,speed,eta})j";
pub const COMPLETION_TEMPLATE: &str = "after_move:CCG_DONE:%(.{filepath,format_id})j";
pub type Notify = Arc<dyn Fn(&str, &str, Option<DownloadProgress>) + Send + Sync>;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub stage: String,
    pub engine: String,
    pub exit_code: Option<i32>,
    pub selected_ids: Vec<String>,
    pub detail: String,
}

pub fn sanitized(text: &str) -> String {
    text.lines()
        .filter(|l| !l.starts_with("CCG:") && !l.starts_with("CCG_DONE:"))
        .take(20)
        .map(|line| {
            let clean = line
                .split_whitespace()
                .map(|word| {
                    if word.contains("://")
                        || word.contains('?')
                        || word.contains('=')
                        || word.contains(":\\")
                        || word.starts_with('/')
                    {
                        "[redacted]".to_string()
                    } else {
                        word.chars().filter(|c| !c.is_control()).take(200).collect()
                    }
                })
                .collect::<Vec<String>>()
                .join(" ");
            let lower = clean.to_ascii_lowercase();
            if [
                "cookie",
                "authorization",
                "credential",
                "password",
                "bearer ",
            ]
            .iter()
            .any(|key| lower.contains(key))
            {
                "[private diagnostic omitted]".into()
            } else {
                clean
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
        .chars()
        .take(1600)
        .collect()
}

pub struct ReportRunner<'a> {
    pub runner: &'a dyn Runner,
    pub stage: &'a str,
    pub ids: &'a [String],
    pub notify: Notify,
}
impl Runner for ReportRunner<'_> {
    fn run(
        &self,
        exe: &Path,
        args: &[String],
        control: &Control,
        timeout: Option<Duration>,
        progress: Option<LineHandler>,
    ) -> Result<crate::process::Captured> {
        let result = self.runner.run(exe, args, control, timeout, progress);
        let engine = if exe
            .file_name()
            .is_some_and(|n| n.to_string_lossy().starts_with("yt-dlp"))
        {
            "yt-dlp"
        } else if exe
            .file_name()
            .is_some_and(|n| n.to_string_lossy().starts_with("ffprobe"))
        {
            "FFprobe"
        } else {
            "FFmpeg"
        };
        let (exit_code, detail) = match &result {
            Ok(r) => (r.exit_code, sanitized(&r.stderr)),
            Err(e) => (None, sanitized(e)),
        };
        (self.notify)(
            self.stage,
            "",
            Some(DownloadProgress {
                diagnostic: Some(Diagnostic {
                    stage: self.stage.into(),
                    engine: engine.into(),
                    exit_code,
                    selected_ids: self.ids.to_vec(),
                    detail,
                }),
                ..Default::default()
            }),
        );
        result
    }
}

#[derive(Default)]
pub struct Completion {
    records: Vec<(String, Option<String>)>,
}
impl Completion {
    pub fn line(&mut self, line: &str) {
        let Some(raw) = line.strip_prefix("CCG_DONE:") else {
            return;
        };
        if self.records.len() >= 2 {
            return;
        }
        if let Ok(v) = serde_json::from_str::<Value>(raw) {
            if let Some(path) = v["filepath"].as_str() {
                self.records
                    .push((path.into(), v["format_id"].as_str().map(String::from)));
            }
        }
    }
    pub fn file(&self, workspace: &Path, selected_id: &str) -> Result<PathBuf> {
        if self.records.len() != 1 {
            return Err(
                "Download completion could not be confirmed. No file was published.".into(),
            );
        }
        let (raw, id) = &self.records[0];
        if id.as_deref().is_some_and(|id| id != selected_id) {
            return Err("The site's streams changed: yt-dlp completed a different format. Inspect the link again.".into());
        }
        let path = Path::new(raw);
        let owner = workspace
            .canonicalize()
            .map_err(|_| "Cannot resolve download workspace.")?;
        if !path.is_absolute()
            || path.parent().and_then(|p| p.canonicalize().ok()).as_deref() != Some(owner.as_path())
        {
            return Err("The completed source file is outside this job's workspace.".into());
        }
        let meta =
            std::fs::symlink_metadata(path).map_err(|_| "The completed source file is missing.")?;
        if !meta.is_file() || meta.file_type().is_symlink() || meta.len() == 0 {
            return Err("The completed source file is empty or invalid.".into());
        }
        let path = path
            .canonicalize()
            .map_err(|_| "Cannot resolve completed source file.")?;
        if path.parent() != Some(owner.as_path()) {
            return Err("The completed source file is outside this job's workspace.".into());
        }
        Ok(path)
    }
}
