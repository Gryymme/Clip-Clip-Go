pub mod assets;
pub mod setup;
pub mod shared;
pub mod windows;
use serde::Serialize;
use setup::Registry;
use shared::*;
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
};
#[derive(Default)]
struct Inner {
    pending: Option<Candidate>,
    last_seen: u64,
    origin: Option<String>,
}
#[derive(Default, Clone)]
pub struct Runtime {
    inner: Arc<Mutex<Inner>>,
    stop: Arc<AtomicBool>,
    error: Arc<Mutex<Option<String>>>,
    waiting: Arc<AtomicBool>,
    wait_until: Arc<AtomicU64>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub phase: String,
    pub message: String,
    pub candidate: Option<Candidate>,
    pub published: bool,
    pub browser_choice: setup::BrowserChoice,
    pub extension_id: Option<String>,
    pub bridge_present: bool,
    pub extension_folder: Option<assets::ExtensionFolder>,
}
fn desktop() -> Result<PathBuf> {
    std::env::current_exe().map_err(|_| "Cannot locate ClipClipGO.".into())
}
pub fn production_root() -> Result<PathBuf> {
    let root =
        std::env::var_os("LOCALAPPDATA").ok_or("Cannot locate per-user application data.")?;
    Ok(PathBuf::from(root).join("ClipClipGO/BrowserBridge/chrome"))
}
fn development_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../.browser-companion/chrome")
}
fn active_root() -> Result<PathBuf> {
    #[cfg(debug_assertions)]
    if setup::ChromeRegistry.get()?.is_some_and(|value| {
        setup::same_path(Path::new(&value), &development_root().join(setup::MANIFEST))
    }) {
        return development_root()
            .canonicalize()
            .map_err(|_| "Cannot locate development registration.".into());
    }
    production_root()
}
fn extension_folder() -> Result<assets::ExtensionFolder> {
    let app = desktop()?;
    #[cfg(debug_assertions)]
    let project =
        Some(Path::new(env!("CARGO_MANIFEST_DIR")).join("../browser-companion/extension"));
    #[cfg(not(debug_assertions))]
    let project: Option<PathBuf> = None;
    assets::resolve(&app, project.as_deref())
}
fn trusted_config() -> Result<(setup::HostConfig, PathBuf)> {
    let root = active_root()?;
    let c = setup::config(&root)?;
    setup::validate_manifest(&root, &c)?;
    if c.desktop_path.canonicalize().ok() != desktop()?.canonicalize().ok() {
        return Err("Bridge belongs to another ClipClipGO installation.".into());
    }
    let registered = setup::ChromeRegistry
        .get()?
        .ok_or("Native host is not registered.")?;
    if !setup::same_path(Path::new(&registered), &root.join(setup::MANIFEST)) {
        return Err("Another native-host registration is active.".into());
    }
    Ok((c, root))
}
impl Runtime {
    fn begin_waiting(&self) {
        let mut i = self.inner.lock().unwrap();
        i.last_seen = 0;
        i.origin = None;
        self.wait_until.store(now() + 60_000, Ordering::SeqCst);
        self.waiting.store(true, Ordering::SeqCst);
    }
    pub fn start(&self, app: tauri::AppHandle) -> Result<()> {
        let runtime = self.clone();
        let stop = self.stop.clone();
        windows::serve(windows::pipe_name()?, stop, move |message, client| {
            let request = &message.request;
            let trusted = trusted_config().and_then(|(c, root)| {
                if sender_id(&message.origin)? != c.extension_id
                    || client.and_then(|p| p.canonicalize().ok())
                        != root.join(setup::HOST_EXE).canonicalize().ok()
                {
                    return Err("Bridge sender identity was rejected.".into());
                }
                Ok(())
            });
            if trusted.is_err() {
                return Reply::new(
                    request,
                    false,
                    "rejected",
                    "Bridge identity was rejected. Repair the ClipClipGO native-host registration.",
                );
            }
            let candidate = matches!(message.request, Request::Candidate { .. });
            let reply = runtime.accept(message);
            if candidate && reply.ok {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            reply
        })?;
        Ok(())
    }
    pub fn record_start_error(&self, e: String) {
        *self.error.lock().unwrap() = Some(e);
    }
    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
        let mut inner = self.inner.lock().unwrap();
        inner.pending = None;
        inner.last_seen = 0;
    }
    pub fn accept(&self, message: Envelope) -> Reply {
        let request = &message.request;
        if let Err(e) = request.validate(now()) {
            return Reply::new(
                request,
                false,
                if e.contains("expired") {
                    "expired"
                } else {
                    "rejected"
                },
                &e,
            );
        }
        let mut inner = self.inner.lock().unwrap();
        inner.last_seen = now();
        self.waiting.store(false, Ordering::SeqCst);
        inner.origin = Some(message.origin);
        if inner
            .pending
            .as_ref()
            .is_some_and(|c| c.expires_at <= now())
        {
            inner.pending = None;
        }
        match request {
            Request::Hello { .. } => {
                Reply::new(request, true, "connected", "Connected to ClipClipGO.")
            }
            Request::Candidate { candidate, .. } => {
                if let Some(p) = &inner.pending {
                    if p.id == candidate.id {
                        return Reply::new(
                            request,
                            true,
                            "accepted",
                            "Source already received. Review it in ClipClipGO.",
                        );
                    }
                    return Reply::new(
                        request,
                        false,
                        "busy",
                        "Review or dismiss the previous browser source in ClipClipGO first.",
                    );
                }
                inner.pending = Some(candidate.clone());
                Reply::new(
                    request,
                    true,
                    "accepted",
                    "Source received. Review it in ClipClipGO before downloading.",
                )
            }
        }
    }
    pub fn take(&self, id: &str) -> Result<Candidate> {
        let mut inner = self.inner.lock().unwrap();
        let c = inner
            .pending
            .as_ref()
            .filter(|c| c.id == id)
            .ok_or("This browser source is no longer pending.")?;
        c.validate(now())?;
        Ok(inner.pending.take().unwrap())
    }
    pub fn pending(&self, id: &str) -> Result<Candidate> {
        let inner = self.inner.lock().unwrap();
        let c = inner
            .pending
            .as_ref()
            .filter(|c| c.id == id)
            .ok_or("This browser source is no longer pending.")?;
        c.validate(now())?;
        Ok(c.clone())
    }
    pub fn status(
        &self,
        configured: bool,
        ready: bool,
        choice: setup::BrowserChoice,
        id: Option<String>,
    ) -> Status {
        let mut i = self.inner.lock().unwrap();
        if i.pending.as_ref().is_some_and(|c| c.expires_at <= now()) {
            i.pending = None;
        }
        let (phase, message) = if let Some(e) = self.error.lock().unwrap().clone() {
            ("unavailable", e)
        } else if ready
            && id.as_ref().is_some_and(|id| {
                i.origin.as_deref() == Some(format!("chrome-extension://{id}/").as_str())
            })
            && i.last_seen > 0
            && now().saturating_sub(i.last_seen) < 25_000
        {
            (
                "connected",
                "Connected through an extension handshake.".into(),
            )
        } else if self.waiting.load(Ordering::SeqCst)
            && now() < self.wait_until.load(Ordering::SeqCst)
        {
            ("waiting","Bridge ready. Open the extension popup and click Connect. Waiting for a real handshake…".into())
        } else if ready {
            (
                "ready",
                "Bridge ready. Open the extension popup and click Connect; no current handshake has been confirmed.".into(),
            )
        } else {
            (
                "id-needed",
                "Load the unpacked extension, then paste its Chrome extension ID to finish setup."
                    .into(),
            )
        };
        Status {
            phase: phase.into(),
            message,
            candidate: i.pending.clone(),
            published: configured,
            browser_choice: choice,
            bridge_present: ready || id.is_some(),
            extension_id: id,
            extension_folder: None,
        }
    }
}
#[tauri::command]
pub async fn companion_status(state: tauri::State<'_, Runtime>) -> Result<Status> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let c = trusted_config().ok();
        let mut status = runtime.status(
            setup::Distribution::bundled().published().is_ok(),
            c.is_some(),
            setup::browser_choice(),
            c.map(|(c, _)| c.extension_id),
        );
        status.extension_folder = extension_folder().ok();
        status.bridge_present = active_root().is_ok_and(|root| root.join(setup::CONFIG).exists());
        if status.bridge_present && status.extension_id.is_none() && status.phase != "unavailable" {
            status.phase = "unavailable".into();
            status.message =
                "Desktop bridge needs repair. Run setup again or remove the owned bridge.".into();
        }
        Ok(status)
    })
    .await
    .map_err(|_| "Could not check browser companion setup.")?
}
#[tauri::command]
pub async fn connect_browser_companion(
    state: tauri::State<'_, Runtime>,
    extension_id: String,
) -> Result<Status> {
    let id = extension_id.trim().to_owned();
    if !shared::extension_id(&id) {
        return Err(
            "Enter the 32 lowercase letters (a–p) shown as the extension ID in Chrome.".into(),
        );
    }
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let folder = extension_folder()?;
        let app = desktop()?;
        let host = app
            .parent()
            .ok_or("Cannot locate the native host.")?
            .join(setup::HOST_EXE);
        let root = active_root()?;
        setup::register(&root, &app, &host, &id, &setup::ChromeRegistry)?;
        runtime.begin_waiting();
        let mut status = runtime.status(
            setup::Distribution::bundled().published().is_ok(),
            true,
            setup::browser_choice(),
            Some(id),
        );
        status.extension_folder = Some(folder);
        Ok(status)
    })
    .await
    .map_err(|_| "Could not prepare the browser bridge.")?
}
#[tauri::command]
pub async fn browser_companion_action(
    window: tauri::WebviewWindow,
    action: assets::Action,
) -> Result<()> {
    let operation = match action {
        assets::Action::OpenExtensions => assets::Operation::ChromeExtensions,
        assets::Action::CopyAddress => assets::Operation::Clipboard("chrome://extensions/".into()),
        action => assets::plan(action, &extension_folder()?),
    };
    match operation {
        assets::Operation::ChromeExtensions => {
            let chrome = windows::chrome_path().ok_or(
                "Chrome could not be located. Copy chrome://extensions/ and open it in Chrome.",
            )?;
            use std::os::windows::process::CommandExt;
            std::process::Command::new(chrome).arg("chrome://extensions/").creation_flags(0x08000000).spawn().map_err(|_|"Chrome could not open the page. Copy chrome://extensions/ and paste it in Chrome.")?;
            Ok(())
        }
        assets::Operation::Folder(path) => windows::open_extension_folder(&path),
        assets::Operation::Clipboard(text) => windows::copy_setup_text(
            window
                .hwnd()
                .map_err(|_| "Cannot access the app window for copying.")?
                .0 as _,
            &text,
        ),
    }
}

#[tauri::command]
pub fn dismiss_browser_source(state: tauri::State<'_, Runtime>, id: String) {
    let mut i = state.inner.lock().unwrap();
    if i.pending.as_ref().is_some_and(|c| c.id == id) {
        i.pending = None;
    }
}
#[tauri::command]
pub async fn setup_browser_companion(
    state: tauri::State<'_, Runtime>,
    browser: String,
) -> Result<Status> {
    if browser != "chrome" {
        return Err("Chrome is the initial browser target. Other browsers are unsupported.".into());
    }
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let d = setup::Distribution::bundled();
        let (id, listing) = d.published()?;
        let chrome = windows::chrome_path()
            .ok_or("Chrome was not found. Choose a supported installation.")?;
        let app = desktop()?;
        let host = app
            .parent()
            .ok_or("Cannot locate native host.")?
            .join(setup::HOST_EXE);
        let root = production_root()?;
        setup::register(&root, &app, &host, id, &setup::ChromeRegistry)?;
        // Only the validated store listing and a canonical registered Chrome executable are launched.
        use std::os::windows::process::CommandExt;
        std::process::Command::new(chrome)
            .arg(listing)
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|_| {
                "Setup ready, but Chrome could not open. Open its official store listing manually."
            })?;
        runtime.begin_waiting();
        Ok(runtime.status(true, true, setup::browser_choice(), Some(id.into())))
    })
    .await
    .map_err(|_| "Browser setup could not complete.")?
}
#[tauri::command]
pub async fn remove_browser_bridge(state: tauri::State<'_, Runtime>) -> Result<()> {
    let runtime = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        setup::remove(&active_root()?, &desktop()?, &setup::ChromeRegistry)?;
        let mut i = runtime.inner.lock().unwrap();
        i.pending = None;
        i.last_seen = 0;
        runtime.waiting.store(false, Ordering::SeqCst);
        Ok(())
    })
    .await
    .map_err(|_| "Bridge removal could not complete.")?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn handoff_is_bounded_and_expired_or_protected_sources_are_rejected() {
        let runtime = Runtime::default();
        let source = shared::tests::candidate();
        let envelope = |c| Envelope {
            origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop/".into(),
            request: Request::Candidate {
                v: 1,
                request_id: "handoff".into(),
                candidate: c,
            },
        };
        assert!(runtime.accept(envelope(source.clone())).ok);
        assert!(runtime.accept(envelope(source.clone())).ok);
        let mut second = source.clone();
        second.id = "second".into();
        assert_eq!(runtime.accept(envelope(second)).code, "busy");
        assert_eq!(
            runtime.pending(&source.id).unwrap().media_url,
            source.media_url
        );
        runtime
            .inner
            .lock()
            .unwrap()
            .pending
            .as_mut()
            .unwrap()
            .expires_at = now() - 1;
        let status = runtime.status(
            false,
            false,
            setup::choose_browser(0, false, false, false),
            None,
        );
        assert!(status.candidate.is_none());
        assert!(runtime.take(&source.id).is_err());
        let mut expired = source.clone();
        expired.expires_at = now() - 1;
        assert_eq!(runtime.accept(envelope(expired)).code, "expired");
        let mut protected = source;
        protected.drm = Some(true);
        assert_eq!(runtime.accept(envelope(protected)).code, "rejected");
    }
    #[test]
    fn installation_is_unknown_until_handshake_and_disconnect_expires_it() {
        let r = Runtime::default();
        let choice = setup::choose_browser(0, false, false, true);
        let id = Some("abcdefghijklmnopabcdefghijklmnop".to_string());
        assert_eq!(
            r.status(true, false, choice.clone(), None).phase,
            "id-needed"
        );
        r.begin_waiting();
        assert_eq!(
            r.status(true, true, choice.clone(), id.clone()).phase,
            "waiting"
        );
        let q = Request::Hello {
            v: 1,
            request_id: "hello".into(),
        };
        assert!(
            r.accept(Envelope {
                origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop/".into(),
                request: q
            })
            .ok
        );
        assert_eq!(
            r.status(true, true, choice.clone(), id.clone()).phase,
            "connected"
        );
        assert_ne!(
            r.status(
                true,
                true,
                choice.clone(),
                Some("pppppppppppppppppppppppppppppppp".into())
            )
            .phase,
            "connected"
        );
        r.inner.lock().unwrap().last_seen = now() - 30_000;
        assert_ne!(
            r.status(true, true, choice.clone(), id.clone()).phase,
            "connected"
        );
        r.wait_until.store(now() - 1, Ordering::SeqCst);
        assert_eq!(r.status(true, true, choice, id).phase, "ready");
    }
}
