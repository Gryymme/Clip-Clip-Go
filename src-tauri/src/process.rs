//! Owned, cancellable child processes. No shell, inherited stdin, or unbounded output buffers.
use std::{
    io::Read,
    path::Path,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, Instant},
};

pub type Result<T> = std::result::Result<T, String>;
pub const CANCELLED: &str = "Conversion cancelled.";
pub type LineHandler = Box<dyn FnMut(&str) + Send>;

#[derive(Default)]
pub struct Control {
    pub cancelled: AtomicBool,
    pub publication: Mutex<()>,
    pub temporary: Mutex<Option<tempfile::TempPath>>,
    pub temporary_directory: Mutex<Option<std::path::PathBuf>>,
    child: Mutex<Option<Child>>,
}

impl Control {
    pub fn check(&self) -> Result<()> {
        if self.cancelled.load(Ordering::SeqCst) {
            Err(CANCELLED.into())
        } else {
            Ok(())
        }
    }
    pub fn cancel(&self) {
        let _publication = self.publication.lock().unwrap();
        self.cancelled.store(true, Ordering::SeqCst);
        self.reap();
        self.cleanup();
    }
    pub fn cleanup(&self) {
        self.temporary.lock().unwrap().take();
        let mut directory = self.temporary_directory.lock().unwrap();
        if let Some(path) = directory.as_ref() {
            if std::fs::remove_dir_all(path).is_ok() || !path.exists() {
                directory.take();
            }
        }
    }
    fn reap(&self) {
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
impl Drop for Control {
    fn drop(&mut self) {
        self.reap();
        self.cleanup();
    }
}

pub struct Captured {
    pub stdout: Vec<u8>,
    pub stderr: String,
    pub success: bool,
}
pub trait Runner: Send + Sync {
    fn run(
        &self,
        executable: &Path,
        args: &[String],
        control: &Control,
        timeout: Option<Duration>,
        progress: Option<LineHandler>,
    ) -> Result<Captured>;
}
pub struct NativeRunner;

fn drain(
    mut pipe: impl Read,
    limit: Option<usize>,
    mut handler: Option<LineHandler>,
) -> (Vec<u8>, bool) {
    let mut captured = Vec::new();
    let mut overflow = false;
    let mut line = Vec::new();
    let mut buffer = [0u8; 4096];
    loop {
        let count = match pipe.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(count) => count,
        };
        if let Some(limit) = limit {
            let room = limit.saturating_sub(captured.len());
            captured.extend_from_slice(&buffer[..count.min(room)]);
            overflow |= count > room;
        }
        if let Some(handler) = handler.as_mut() {
            for &byte in &buffer[..count] {
                if byte == b'\n' {
                    handler(&String::from_utf8_lossy(&line));
                    line.clear();
                } else if line.len() < 8192 {
                    line.push(byte);
                }
            }
        }
    }
    (captured, overflow)
}

impl Runner for NativeRunner {
    fn run(
        &self,
        executable: &Path,
        args: &[String],
        control: &Control,
        timeout: Option<Duration>,
        progress: Option<LineHandler>,
    ) -> Result<Captured> {
        control.check()?;
        let mut command = Command::new(executable);
        command
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        // Serialize spawn/registration with cancellation so shutdown cannot miss a newly spawned child.
        let spawn_guard = control.publication.lock().unwrap();
        control.check()?;
        let mut child = command.spawn().map_err(|_| {
            "Could not start the bundled engine. Repair or reinstall Clip-Clip-Go.".to_string()
        })?;
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let stdout_limit = if progress.is_some() {
            None
        } else {
            Some(2 * 1024 * 1024)
        };
        let out_reader = thread::spawn(move || drain(stdout, stdout_limit, progress));
        let err_reader = thread::spawn(move || drain(stderr, Some(64 * 1024), None));
        *control.child.lock().unwrap() = Some(child);
        drop(spawn_guard);
        let started = Instant::now();
        let outcome = loop {
            if let Err(error) = control.check() {
                control.reap();
                break Err(error);
            }
            if timeout.is_some_and(|limit| started.elapsed() > limit) {
                control.reap();
                break Err(
                    "The engine inspection timed out. Check the executables or try another file."
                        .into(),
                );
            }
            let status = {
                let mut slot = control.child.lock().unwrap();
                match slot.as_mut() {
                    Some(child) => match child.try_wait() {
                        Ok(Some(status)) => {
                            slot.take();
                            Some(Ok(status.success()))
                        }
                        Ok(None) => None,
                        Err(_) => {
                            Some(Err("Could not read the engine process result.".to_string()))
                        }
                    },
                    None => Some(Err(CANCELLED.to_string())),
                }
            };
            if let Some(status) = status {
                break status;
            }
            thread::sleep(Duration::from_millis(40));
        };
        control.reap();
        let (stdout, overflow) = out_reader
            .join()
            .map_err(|_| "Could not read engine output.".to_string())?;
        let (stderr, _) = err_reader
            .join()
            .map_err(|_| "Could not read engine diagnostics.".to_string())?;
        let success = outcome?;
        control.check()?;
        if overflow {
            return Err("The engine returned an unexpectedly large inspection result.".into());
        }
        Ok(Captured {
            stdout,
            stderr: String::from_utf8_lossy(&stderr).into_owned(),
            success,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    #[ignore = "Child-process fixture invoked explicitly by the parent cancellation test"]
    fn waiting_child() {
        println!("out_time_us=100000");
        thread::sleep(Duration::from_secs(60));
    }

    #[test]
    fn native_child_is_cancelled_and_reaped() {
        let control = Arc::new(Control::default());
        let other = control.clone();
        let canceller = thread::spawn(move || {
            thread::sleep(Duration::from_millis(200));
            other.cancel();
        });
        let result = NativeRunner.run(
            &std::env::current_exe().unwrap(),
            &[
                "--exact".into(),
                "process::tests::waiting_child".into(),
                "--ignored".into(),
                "--nocapture".into(),
            ],
            &control,
            Some(Duration::from_secs(5)),
            None,
        );
        canceller.join().unwrap();
        assert_eq!(result.err().unwrap(), CANCELLED);
        assert!(control.child.lock().unwrap().is_none());
    }

    #[test]
    fn capture_is_bounded_and_progress_lines_are_parsed_independently() {
        let text = b"out_time_us=500000\nprogress=continue\n";
        let lines = Arc::new(Mutex::new(Vec::new()));
        let captured = lines.clone();
        let (bytes, overflow) = drain(
            &text[..],
            Some(5),
            Some(Box::new(move |line| {
                captured.lock().unwrap().push(line.to_string())
            })),
        );
        assert_eq!(bytes.len(), 5);
        assert!(overflow);
        assert_eq!(lines.lock().unwrap().len(), 2);
    }
}
