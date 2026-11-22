use super::{shared::*, windows};
use serde::{Deserialize, Serialize};
use std::{
    io::Read,
    path::{Path, PathBuf},
};
pub const KEY: &str = r"Software\Google\Chrome\NativeMessagingHosts\com.clipclipgo.companion";
pub const MANIFEST: &str = "com.clipclipgo.companion.json";
pub const CONFIG: &str = "host-config.json";
pub const HOST_EXE: &str = "clipclipgo-native-host.exe";
pub fn same_path(a: &Path, b: &Path) -> bool {
    let normalize = |p: &Path| {
        p.canonicalize()
            .unwrap_or_else(|_| p.to_owned())
            .to_string_lossy()
            .trim_start_matches(r"\\?\")
            .replace('/', "\\")
            .to_lowercase()
    };
    normalize(a) == normalize(b)
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostConfig {
    pub owner: String,
    pub version: u8,
    pub extension_id: String,
    pub desktop_path: PathBuf,
    pub host_sha256: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NativeManifest {
    name: String,
    description: String,
    path: PathBuf,
    #[serde(rename = "type")]
    kind: String,
    allowed_origins: Vec<String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Distribution {
    pub chrome: Listing,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Listing {
    pub extension_id: Option<String>,
    pub store_url: Option<String>,
}
impl Distribution {
    pub fn bundled() -> Self {
        serde_json::from_str(include_str!("../../../browser-companion/distribution.json"))
            .expect("Invalid distribution config")
    }
    pub fn published(&self) -> Result<(&str, &str)> {
        let id = self
            .chrome
            .extension_id
            .as_deref()
            .ok_or("Development setup only: the Chrome Web Store listing is not configured.")?;
        let listing = self
            .chrome
            .store_url
            .as_deref()
            .ok_or("Development setup only: the Chrome Web Store listing is not configured.")?;
        let url = http_url(listing)?;
        if !extension_id(id)
            || url.scheme() != "https"
            || url.host_str() != Some("chromewebstore.google.com")
            || url.port().is_some()
            || !url.path().starts_with("/detail/")
            || url.path_segments().and_then(|mut p| p.next_back()) != Some(id)
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err("Invalid Chrome Web Store distribution configuration.".into());
        }
        Ok((id, listing))
    }
}
pub fn digest(path: &Path) -> Result<String> {
    use sha2::{Digest, Sha256};
    let mut f = std::fs::File::open(path).map_err(|_| "Cannot read bridge executable.")?;
    if f.metadata()
        .map_err(|_| "Cannot inspect bridge executable.")?
        .len()
        > 64 * 1024 * 1024
    {
        return Err("Bridge executable exceeds the allowed size.".into());
    }
    let mut h = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = f
            .read(&mut buf)
            .map_err(|_| "Cannot verify bridge executable.")?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}
fn regular(path: &Path) -> Result<()> {
    let m =
        std::fs::symlink_metadata(path).map_err(|_| "Bridge setup is missing. Repair setup.")?;
    if !m.is_file() || m.file_type().is_symlink() || m.len() > 128 * 1024 {
        return Err("Invalid bridge setup file.".into());
    }
    Ok(())
}
pub fn config(root: &Path) -> Result<HostConfig> {
    regular(&root.join(CONFIG))?;
    let c: HostConfig = serde_json::from_slice(
        &std::fs::read(root.join(CONFIG)).map_err(|_| "Cannot read bridge setup.")?,
    )
    .map_err(|_| "Invalid bridge setup.")?;
    if c.owner != HOST || c.version != 1 || !extension_id(&c.extension_id) {
        return Err("Bridge ownership or extension identity is invalid.".into());
    }
    windows::executable(&c.desktop_path, "clip-clip-go.exe")?;
    if digest(&windows::executable(&root.join(HOST_EXE), HOST_EXE)?)? != c.host_sha256 {
        return Err("Native host is damaged. Repair setup.".into());
    }
    Ok(c)
}
pub fn validate_manifest(root: &Path, c: &HostConfig) -> Result<()> {
    regular(&root.join(MANIFEST))?;
    let m: NativeManifest = serde_json::from_slice(
        &std::fs::read(root.join(MANIFEST)).map_err(|_| "Cannot read native-host manifest.")?,
    )
    .map_err(|_| "Invalid native-host manifest.")?;
    if m.name != HOST
        || m.kind != "stdio"
        || m.description.len() > 256
        || !same_path(&m.path, &root.join(HOST_EXE))
        || m.allowed_origins != [format!("chrome-extension://{}/", c.extension_id)]
    {
        return Err("Native-host manifest identity or paths do not match this setup.".into());
    }
    Ok(())
}
pub trait Registry {
    fn get(&self) -> Result<Option<String>>;
    fn set(&self, value: &str) -> Result<()>;
    fn remove(&self) -> Result<()>;
}
pub struct ChromeRegistry;
impl Registry for ChromeRegistry {
    fn get(&self) -> Result<Option<String>> {
        windows::registry_get(windows_sys::Win32::System::Registry::HKEY_CURRENT_USER, KEY)
    }
    fn set(&self, value: &str) -> Result<()> {
        windows::registry_set(KEY, value)
    }
    fn remove(&self) -> Result<()> {
        windows::registry_remove(KEY)
    }
}
fn ownership(root: &Path, desktop: &Path, registry: &impl Registry) -> Result<()> {
    let manifest = root.join(MANIFEST);
    if let Some(current) = registry.get()? {
        if !same_path(Path::new(&current), &manifest) {
            return Err("Another registration owns this Chrome native-host name. It will not be overwritten.".into());
        }
    }
    if root.exists() {
        if std::fs::symlink_metadata(root)
            .map_err(|_| "Cannot inspect setup directory.")?
            .file_type()
            .is_symlink()
        {
            return Err("Bridge directory must not be a link.".into());
        }
        let entries = std::fs::read_dir(root)
            .map_err(|_| "Cannot inspect setup directory.")?
            .count();
        if entries > 0 {
            regular(&root.join(CONFIG))?;
            let c: HostConfig = serde_json::from_slice(
                &std::fs::read(root.join(CONFIG)).map_err(|_| "Cannot read bridge ownership.")?,
            )
            .map_err(|_| "Bridge directory is not ClipClipGO-owned.")?;
            if c.owner != HOST || c.version != 1 || !same_path(&c.desktop_path, desktop) {
                return Err("Bridge directory belongs to another application installation.".into());
            }
            for item in std::fs::read_dir(root).map_err(|_| "Cannot inspect bridge files.")? {
                let item = item.map_err(|_| "Cannot inspect bridge files.")?;
                if ![CONFIG, MANIFEST, HOST_EXE]
                    .iter()
                    .any(|n| item.file_name() == *n)
                {
                    return Err(
                        "Unexpected file in the bridge directory; setup will not replace it."
                            .into(),
                    );
                }
            }
        }
    }
    Ok(())
}
fn write_owned(path: &Path, data: &[u8]) -> Result<()> {
    if path.exists()
        && std::fs::symlink_metadata(path)
            .map_err(|_| "Cannot inspect bridge file.")?
            .file_type()
            .is_symlink()
    {
        return Err("Bridge files must not be links.".into());
    }
    let mut temp =
        tempfile::NamedTempFile::new_in(path.parent().ok_or("Invalid bridge directory.")?)
            .map_err(|_| "Cannot stage bridge setup.")?;
    use std::io::Write;
    temp.write_all(data)
        .map_err(|_| "Cannot stage bridge setup.")?;
    temp.persist(path).map_err(|_| {
        "Cannot update bridge files. Close the companion connection and try repair again."
    })?;
    Ok(())
}
pub fn register(
    root: &Path,
    desktop: &Path,
    host: &Path,
    id: &str,
    registry: &impl Registry,
) -> Result<()> {
    if !root.is_absolute() || !extension_id(id) {
        return Err("Use an absolute setup directory and the actual Chrome extension ID.".into());
    }
    let desktop = windows::executable(desktop, "clip-clip-go.exe")?;
    let host = windows::executable(host, HOST_EXE)?;
    ownership(root, &desktop, registry)?;
    std::fs::create_dir_all(root).map_err(|_| "Cannot create app-owned bridge directory.")?;
    let sha = digest(&host)?;
    let target = root.join(HOST_EXE);
    if !target.exists() || digest(&target)? != sha {
        write_owned(
            &target,
            &std::fs::read(&host).map_err(|_| "Cannot stage native host.")?,
        )?;
    }
    let c = HostConfig {
        owner: HOST.into(),
        version: 1,
        extension_id: id.into(),
        desktop_path: desktop,
        host_sha256: sha,
    };
    write_owned(&root.join(CONFIG), &serde_json::to_vec_pretty(&c).unwrap())?;
    let manifest = serde_json::json!({"name":HOST,"description":"ClipClipGO browser companion","path":target,"type":"stdio","allowed_origins":[format!("chrome-extension://{id}/")]});
    write_owned(
        &root.join(MANIFEST),
        &serde_json::to_vec_pretty(&manifest).unwrap(),
    )?;
    registry.set(&root.join(MANIFEST).to_string_lossy())
}
pub fn remove(root: &Path, desktop: &Path, registry: &impl Registry) -> Result<()> {
    if !root.exists() {
        if registry.get()?.is_none() {
            return Ok(());
        }
        return Err("Bridge files are missing; ownership could not be verified.".into());
    }
    ownership(
        root,
        &desktop
            .canonicalize()
            .map_err(|_| "Cannot identify this installation.")?,
        registry,
    )?;
    if registry.get()?.is_some() {
        registry.remove()?;
    }
    for name in [MANIFEST, HOST_EXE, CONFIG] {
        let p = root.join(name);
        if p.exists() {
            std::fs::remove_file(p).map_err(|_|"Registration removed, but a bridge file is in use. Close the companion connection and retry removal.")?;
        }
    }
    let _ = std::fs::remove_dir(root);
    Ok(())
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserChoice {
    pub recommended: Option<String>,
    pub browsers: Vec<String>,
    pub explanation: String,
}
pub fn preferred_family(
    open: &[&str],
    default: Option<&str>,
    supported: &[&str],
    ambiguous: bool,
) -> Option<String> {
    if ambiguous {
        return None;
    }
    let families = open
        .iter()
        .copied()
        .filter(|f| supported.contains(f))
        .collect::<std::collections::BTreeSet<_>>();
    if families.len() == 1 {
        return families.first().map(|s| s.to_string());
    }
    default.filter(|f| supported.contains(f)).map(String::from)
}
pub fn choose_browser(
    normal_chrome_windows: usize,
    ambiguous: bool,
    default_chrome: bool,
    installed: bool,
) -> BrowserChoice {
    let windows = vec!["chrome"; normal_chrome_windows];
    let recommended = preferred_family(
        &windows,
        default_chrome.then_some("chrome"),
        if installed { &["chrome"] } else { &[] },
        ambiguous,
    );
    BrowserChoice {
        recommended,
        browsers: if installed {
            vec!["chrome".into()]
        } else {
            vec![]
        },
        explanation: if !installed {
            "Chrome was not found. Chrome is the initial supported browser."
        } else if ambiguous {
            "Browser identification is ambiguous. Choose Chrome to continue."
        } else if normal_chrome_windows > 0 {
            "Chrome has an open normal window. The profile cannot be selected automatically."
        } else if default_chrome {
            "Chrome is the Windows default browser. The profile cannot be selected automatically."
        } else {
            "Choose a browser. The default browser is unsupported or could not be identified."
        }
        .into(),
    }
}
pub fn browser_choice() -> BrowserChoice {
    let Some(chrome) = windows::chrome_path() else {
        return choose_browser(0, false, false, false);
    };
    let (n, a) = windows::chrome_windows(&chrome);
    let default = windows::default_browser()
        .and_then(|p| p.canonicalize().ok())
        .is_some_and(|p| p == chrome);
    choose_browser(n, a, default, true)
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    #[derive(Default)]
    struct Mock(RefCell<Option<String>>);
    impl Registry for Mock {
        fn get(&self) -> Result<Option<String>> {
            Ok(self.0.borrow().clone())
        }
        fn set(&self, v: &str) -> Result<()> {
            *self.0.borrow_mut() = Some(v.into());
            Ok(())
        }
        fn remove(&self) -> Result<()> {
            *self.0.borrow_mut() = None;
            Ok(())
        }
    }
    #[test]
    fn browser_decisions_and_store_configuration() {
        assert_eq!(
            preferred_family(
                &["chrome", "edge"],
                Some("edge"),
                &["chrome", "edge"],
                false
            )
            .as_deref(),
            Some("edge")
        );
        assert_eq!(
            preferred_family(
                &["chrome", "chrome"],
                Some("unsupported"),
                &["chrome"],
                false
            )
            .as_deref(),
            Some("chrome")
        );
        assert!(preferred_family(
            &["chrome", "edge"],
            Some("unsupported"),
            &["chrome", "edge"],
            false
        )
        .is_none());
        assert_eq!(
            choose_browser(2, false, false, true).recommended.as_deref(),
            Some("chrome")
        );
        assert!(choose_browser(0, false, false, true).recommended.is_none());
        assert!(choose_browser(1, true, true, true).recommended.is_none());
        assert!(choose_browser(0, false, true, true).recommended.is_some());
        assert!(choose_browser(0, false, false, false).browsers.is_empty());
        assert!(Distribution::bundled().published().is_err());
        let d = Distribution {
            chrome: Listing {
                extension_id: Some("abcdefghijklmnopabcdefghijklmnop".into()),
                store_url: Some(
                    "https://example.test/detail/abcdefghijklmnopabcdefghijklmnop".into(),
                ),
            },
        };
        assert!(d.published().is_err());
        let mut d = d;
        d.chrome.store_url = Some(
            "https://chromewebstore.google.com/detail/test/abcdefghijklmnopabcdefghijklmnop".into(),
        );
        assert!(d.published().is_ok());
        d.chrome.extension_id = Some("pppppppppppppppppppppppppppppppp".into());
        assert!(d.published().is_err());
    }
    #[test]
    fn registration_ownership_idempotent_repair_and_removal_use_only_mock_registry() {
        let parent = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/companion-tests");
        std::fs::create_dir_all(&parent).unwrap();
        let d = tempfile::tempdir_in(parent).unwrap();
        let app = d.path().join("clip-clip-go.exe");
        let host = d.path().join(HOST_EXE);
        std::fs::write(&app, b"MZ fixture").unwrap();
        std::fs::write(&host, b"MZ host").unwrap();
        let root = d.path().join("owned");
        let r = Mock::default();
        let id = "abcdefghijklmnopabcdefghijklmnop";
        assert!(register(&root, &app, &host, "invalid", &r).is_err());
        assert!(!root.exists());
        assert!(r.get().unwrap().is_none());
        register(&root, &app, &host, id, &r).unwrap();
        assert!(same_path(&root, &root.canonicalize().unwrap()));
        register(&root, &app, &host, id, &r).unwrap();
        validate_manifest(&root, &config(&root).unwrap()).unwrap();
        std::fs::write(root.join(HOST_EXE), b"damaged").unwrap();
        assert!(config(&root).is_err());
        register(&root, &app, &host, id, &r).unwrap();
        config(&root).unwrap();
        let replacement = "pppppppppppppppppppppppppppppppp";
        register(&root, &app, &host, replacement, &r).unwrap();
        let c = config(&root).unwrap();
        assert_eq!(c.extension_id, replacement);
        validate_manifest(&root, &c).unwrap();
        let m: serde_json::Value =
            serde_json::from_slice(&std::fs::read(root.join(MANIFEST)).unwrap()).unwrap();
        assert_eq!(
            m["allowed_origins"],
            serde_json::json!([format!("chrome-extension://{replacement}/")])
        );
        *r.0.borrow_mut() = Some("C:\\OtherApp\\host.json".into());
        assert!(register(&root, &app, &host, id, &r).is_err());
        assert!(remove(&root, &app, &r).is_err());
        r.set(&root.join(MANIFEST).to_string_lossy()).unwrap();
        remove(&root, &app, &r).unwrap();
        assert!(r.get().unwrap().is_none());
        remove(&root, &app, &r).unwrap();
        assert!(app.exists());
    }
}
