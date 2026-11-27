//! Owned, cancellable child processes. No shell, inherited stdin, or unbounded output buffers.
use std::{
    io::Read,
    path::Path,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
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
    pub working_directory: Mutex<Option<std::path::PathBuf>>,
    child: Mutex<Option<Child>>,
    #[cfg(windows)]
    tree: Mutex<Option<crate::process_tree::Tree>>,
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
        #[cfg(windows)]
        self.tree.lock().unwrap().take();
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
    pub exit_code: Option<i32>,
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

fn drain(pipe: impl Read, limit: Option<usize>, handler: Option<LineHandler>) -> (Vec<u8>, bool) {
    drain_signal(pipe, limit, handler, None)
}
fn drain_signal(
    mut pipe: impl Read,
    limit: Option<usize>,
    mut handler: Option<LineHandler>,
    signal: Option<Arc<AtomicBool>>,
) -> (Vec<u8>, bool) {
    let mut captured = Vec::new();
    let mut overflow = false;
    let mut line = Vec::new();
    let mut line_overflow = false;
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
            if overflow {
                if let Some(s) = &signal {
                    s.store(true, Ordering::SeqCst);
                }
            }
        }
        if let Some(handler) = handler.as_mut() {
            for &byte in &buffer[..count] {
                if byte == b'\n' {
                    if !line_overflow {
                        handler(String::from_utf8_lossy(&line).trim_end_matches('\r'));
                    }
                    line.clear();
                    line_overflow = false;
                } else if !line_overflow && line.len() < 8192 {
                    line.push(byte);
                } else {
                    line_overflow = true;
                }
            }
        }
    }
    if !line.is_empty() && !line_overflow {
        if let Some(handler) = handler.as_mut() {
            handler(String::from_utf8_lossy(&line).trim_end_matches('\r'));
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
        if let Some(directory) = control.working_directory.lock().unwrap().as_ref() {
            command.current_dir(directory);
            for (key, _) in std::env::vars_os() {
                if key.to_string_lossy().starts_with("DENO_") {
                    command.env_remove(key);
                }
            }
            command
                .env("DENO_DIR", directory.join("deno-cache"))
                .env("DENO_NO_UPDATE_CHECK", "1")
                .env("DENO_NO_PACKAGE_JSON", "1")
                .env("DENO_NO_PROMPT", "1")
                .env("TEMP", directory)
                .env("TMP", directory)
                .env("TMPDIR", directory);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000004); // CREATE_NO_WINDOW | CREATE_SUSPENDED
        }
        // Serialize spawn/registration with cancellation so shutdown cannot miss a newly spawned child.
        let spawn_guard = control.publication.lock().unwrap();
        control.check()?;
        let mut child = command.spawn().map_err(|_| {
            "Could not start the bundled engine. Repair or reinstall Clip-Clip-Go.".to_string()
        })?;
        #[cfg(windows)]
        {
            *control.tree.lock().unwrap() = Some(crate::process_tree::Tree::attach(&mut child)?);
        }
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let stdout_limit = if progress.is_some() {
            None
        } else {
            Some(2 * 1024 * 1024)
        };
        // Frame each pipe independently, and serialize complete callbacks only.
        // Engines can put progress on either pipe; both must keep draining.
        let shared = progress.map(|p| std::sync::Arc::new(Mutex::new(p)));
        let callback = |shared: Option<std::sync::Arc<Mutex<LineHandler>>>| -> Option<LineHandler> {
            shared.map(|handler| {
                Box::new(move |line: &str| (handler.lock().unwrap())(line)) as LineHandler
            })
        };
        let out_handler = callback(shared.clone());
        let err_handler = callback(shared);
        let exceeded = Arc::new(AtomicBool::new(false));
        let signal = exceeded.clone();
        let out_reader =
            thread::spawn(move || drain_signal(stdout, stdout_limit, out_handler, Some(signal)));
        let err_reader = thread::spawn(move || drain(stderr, Some(64 * 1024), err_handler));
        *control.child.lock().unwrap() = Some(child);
        drop(spawn_guard);
        let started = Instant::now();
        let outcome = loop {
            if let Err(error) = control.check() {
                control.reap();
                break Err(error);
            }
            if exceeded.load(Ordering::SeqCst) {
                control.reap();
                break Err("The engine's metadata exceeds the safe inspection limit (2 MiB after reduction). Try another link or report this item; no media-size or duration limit was reached.".into());
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
                            Some(Ok((status.success(), status.code())))
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
        let (success, exit_code) = outcome?;
        control.check()?;
        if overflow {
            return Err("The engine's metadata exceeds the safe inspection limit (2 MiB after reduction). Try another link or report this item; no media-size or duration limit was reached.".into());
        }
        Ok(Captured {
            stdout,
            stderr: String::from_utf8_lossy(&stderr).into_owned(),
            success,
            exit_code,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    #[test]
    #[ignore = "Owned output-overflow child invoked by its parent test"]
    fn overflowing_child() {
        use std::io::Write;
        let _descendant = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "process::tests::waiting_child",
                "--ignored",
                "--nocapture",
            ])
            .spawn()
            .unwrap();
        thread::spawn(|| {
            for _ in 0..64 {
                let _ = std::io::stderr().write_all(&[b'e'; 8192]);
            }
        });
        for _ in 0..400 {
            std::io::stdout().write_all(&[b'x'; 8192]).unwrap();
        }
        std::io::stdout().flush().unwrap();
        thread::sleep(Duration::from_secs(60));
    }
    #[test]
    fn output_overflow_reaps_tree_and_does_not_return_truncated_json() {
        let c = Control::default();
        let started = Instant::now();
        let error = NativeRunner
            .run(
                &std::env::current_exe().unwrap(),
                &[
                    "--exact".into(),
                    "process::tests::overflowing_child".into(),
                    "--ignored".into(),
                    "--nocapture".into(),
                ],
                &c,
                Some(Duration::from_secs(12)),
                None,
            )
            .err()
            .unwrap();
        assert!(error.contains("safe inspection limit"), "{error}");
        assert!(started.elapsed() < Duration::from_secs(10));
        assert!(c.child.lock().unwrap().is_none());
    }

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
    #[test]
    fn partial_reads_crlf_trailing_records_and_oversized_lines_are_framed() {
        struct Tiny(std::io::Cursor<Vec<u8>>);
        impl Read for Tiny {
            fn read(&mut self, b: &mut [u8]) -> std::io::Result<usize> {
                let n = b.len().min(3);
                self.0.read(&mut b[..n])
            }
        }
        let mut data = b"CCG:{\"downloaded_bytes\":10,\"total_bytes\":100}\r\n".to_vec();
        data.extend(vec![b'x'; 9000]);
        data.extend(b"\nCCG:{\"downloaded_bytes\":20,\"total_bytes\":100}");
        let lines = Arc::new(Mutex::new(Vec::new()));
        let got = lines.clone();
        drain(
            Tiny(std::io::Cursor::new(data)),
            None,
            Some(Box::new(move |line| {
                got.lock().unwrap().push(line.to_string())
            })),
        );
        let lines = lines.lock().unwrap();
        assert_eq!(lines.len(), 2);
        assert!(crate::downloader::progress(&lines[0]).is_some());
        assert!(crate::downloader::progress(&lines[1]).is_some());
        let first: serde_json::Value =
            serde_json::from_str(lines[0].strip_prefix("CCG:").unwrap()).unwrap();
        let second: serde_json::Value =
            serde_json::from_str(lines[1].strip_prefix("CCG:").unwrap()).unwrap();
        assert_eq!(first["downloaded_bytes"], 10);
        assert_eq!(second["downloaded_bytes"], 20);
    }

    #[test]
    #[ignore = "Owned descendant fixture invoked by process_tree_is_cancelled"]
    fn parent_with_descendant() {
        let _child = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "process::tests::waiting_child",
                "--ignored",
                "--nocapture",
            ])
            .spawn()
            .unwrap();
        println!("descendant_started=1");
        thread::sleep(Duration::from_secs(60));
    }
    #[test]
    fn process_tree_is_cancelled_and_timeout_reaps_pipes() {
        let started = Instant::now();
        let c = Arc::new(Control::default());
        let other = c.clone();
        let cancel = thread::spawn(move || {
            thread::sleep(Duration::from_millis(700));
            other.cancel();
        });
        let args = [
            "--exact",
            "process::tests::parent_with_descendant",
            "--ignored",
            "--nocapture",
        ]
        .map(String::from);
        assert_eq!(
            NativeRunner
                .run(
                    &std::env::current_exe().unwrap(),
                    &args,
                    &c,
                    Some(Duration::from_secs(5)),
                    None
                )
                .err()
                .unwrap(),
            CANCELLED
        );
        cancel.join().unwrap();
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "Descendant kept the stdout pipe open after cancellation"
        );
        let c = Control::default();
        let error = NativeRunner
            .run(
                &std::env::current_exe().unwrap(),
                &args,
                &c,
                Some(Duration::from_millis(500)),
                None,
            )
            .err()
            .unwrap();
        assert!(error.contains("timed out"));
        assert!(c.child.lock().unwrap().is_none());
    }
    #[test]
    #[ignore = "Pipe fixture invoked by both_pipes_deliver_incrementally_with_exit_status"]
    fn two_pipe_records() {
        use std::io::Write;
        for n in 1..=4 {
            print!("CCG:{{\"downloaded_bytes\":");
            std::io::stdout().flush().unwrap();
            eprintln!(
                "CCG:{{\"downloaded_bytes\":{},\"total_bytes\":100}}",
                n + 10
            );
            thread::sleep(Duration::from_millis(30));
            println!("{n},\"total_bytes\":100}}");
            std::io::stdout().flush().unwrap();
        }
        for _ in 0..3000 {
            eprintln!("bounded diagnostic filler to exercise concurrent pipe draining");
        }
        thread::sleep(Duration::from_millis(300));
        std::process::exit(17);
    }
    #[test]
    fn both_pipes_deliver_incrementally_with_exit_status() {
        let received = Arc::new(Mutex::new(Vec::new()));
        let capture = received.clone();
        let started = Instant::now();
        let callback: LineHandler = Box::new(move |line| {
            if crate::downloader::progress(line).is_some() {
                capture.lock().unwrap().push(Instant::now());
            }
        });
        let args = [
            "--exact",
            "process::tests::two_pipe_records",
            "--ignored",
            "--nocapture",
        ]
        .map(String::from);
        let output = NativeRunner
            .run(
                &std::env::current_exe().unwrap(),
                &args,
                &Control::default(),
                Some(Duration::from_secs(10)),
                Some(callback),
            )
            .unwrap();
        assert!(!output.success);
        assert_eq!(output.exit_code, Some(17));
        assert!(output.stderr.len() <= 64 * 1024);
        let points = received.lock().unwrap();
        assert_eq!(points.len(), 8);
        assert!(points[0] - started < started.elapsed() - Duration::from_millis(200));
    }
}
