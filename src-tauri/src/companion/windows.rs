//! Windows OS boundary. Tests use isolated files/mocks, never register a browser.
use super::shared::*;
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    ptr::{null, null_mut},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::*,
    Security::{Authorization::*, *},
    Storage::FileSystem::*,
    System::{Pipes::*, Registry::*, RemoteDesktop::*, Threading::*},
    UI::{Shell::*, WindowsAndMessaging::*},
};
pub fn wide(s: impl AsRef<std::ffi::OsStr>) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    s.as_ref().encode_wide().chain(Some(0)).collect()
}
pub fn readable_path(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = text.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        path.to_owned()
    }
}
pub fn open_extension_folder(path: &Path) -> Result<()> {
    let path = path
        .canonicalize()
        .map_err(|_| "The extension folder is missing. Repair ClipClipGO.")?;
    if !path.is_dir() || path.file_name().is_none_or(|s| s != "extension") {
        return Err("Invalid extension folder.".into());
    }
    let result = unsafe {
        ShellExecuteW(
            null_mut(),
            wide("open").as_ptr(),
            wide(readable_path(&path)).as_ptr(),
            null(),
            null(),
            SW_SHOWNORMAL,
        )
    };
    if result as isize <= 32 {
        return Err("Could not open the extension folder. Use Copy folder path instead.".into());
    }
    Ok(())
}
pub fn copy_setup_text(owner: HWND, text: &str) -> Result<()> {
    use windows_sys::Win32::System::{DataExchange::*, Memory::*};
    if text.len() > 32768 || text.contains('\0') {
        return Err("Invalid setup text.".into());
    }
    unsafe {
        if OpenClipboard(owner) == 0 {
            return Err("Clipboard is busy. Try Copy again.".into());
        }
        struct Clipboard;
        impl Drop for Clipboard {
            fn drop(&mut self) {
                unsafe {
                    CloseClipboard();
                }
            }
        }
        let _clipboard = Clipboard;
        let data = wide(text);
        let memory = GlobalAlloc(GMEM_MOVEABLE, data.len() * 2);
        if memory.is_null() {
            return Err("Cannot allocate clipboard text.".into());
        }
        let target = GlobalLock(memory);
        if target.is_null() {
            GlobalFree(memory);
            return Err("Cannot prepare clipboard text.".into());
        }
        std::ptr::copy_nonoverlapping(data.as_ptr(), target as *mut u16, data.len());
        GlobalUnlock(memory);
        if EmptyClipboard() == 0 || SetClipboardData(13, memory).is_null() {
            GlobalFree(memory);
            return Err("Could not copy setup text. Try again.".into());
        }
        Ok(())
    }
}
pub struct Handle(pub HANDLE);
unsafe impl Send for Handle {}
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}
pub fn executable(path: &Path, name: &str) -> Result<PathBuf> {
    let p = path
        .canonicalize()
        .map_err(|_| "Executable is missing. Repair ClipClipGO or browser setup.")?;
    if !p.is_file()
        || !p
            .file_name()
            .is_some_and(|s| s.to_string_lossy().eq_ignore_ascii_case(name))
        || std::fs::symlink_metadata(path)
            .map_err(|_| "Cannot inspect executable.")?
            .file_type()
            .is_symlink()
    {
        return Err("Unexpected executable path.".into());
    }
    let mut f = std::fs::File::open(&p).map_err(|_| "Cannot read executable.")?;
    let mut mz = [0; 2];
    f.read_exact(&mut mz).map_err(|_| "Invalid executable.")?;
    if &mz != b"MZ" {
        return Err("Invalid Windows executable.".into());
    }
    Ok(p)
}
pub fn process_path(pid: u32) -> Option<PathBuf> {
    unsafe {
        let h = Handle(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid));
        if h.0.is_null() {
            return None;
        }
        let mut buf = vec![0u16; 32768];
        let mut n = buf.len() as u32;
        if QueryFullProcessImageNameW(h.0, 0, buf.as_mut_ptr(), &mut n) == 0 {
            return None;
        }
        Some(PathBuf::from(String::from_utf16_lossy(&buf[..n as usize])))
    }
}
pub fn user_sid() -> Result<String> {
    unsafe {
        let mut token = null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return Err("Cannot determine the current Windows user.".into());
        }
        let token = Handle(token);
        let mut len = 0;
        GetTokenInformation(token.0, TokenUser, null_mut(), 0, &mut len);
        let mut data = vec![0usize; (len as usize + 7) / 8];
        if GetTokenInformation(token.0, TokenUser, data.as_mut_ptr() as _, len, &mut len) == 0 {
            return Err("Cannot read the current Windows user.".into());
        }
        let user = &*(data.as_ptr() as *const TOKEN_USER);
        let mut sid = null_mut();
        if ConvertSidToStringSidW(user.User.Sid, &mut sid) == 0 {
            return Err("Cannot encode the current Windows user.".into());
        }
        let mut n = 0;
        while *sid.add(n) != 0 {
            n += 1;
        }
        let s = String::from_utf16_lossy(std::slice::from_raw_parts(sid, n));
        LocalFree(sid as _);
        Ok(s)
    }
}
pub fn pipe_name() -> Result<String> {
    let mut session = 0;
    unsafe {
        ProcessIdToSessionId(GetCurrentProcessId(), &mut session);
    };
    Ok(format!(
        r"\\.\pipe\ClipClipGO-companion-v1-{}-{session}",
        user_sid()?
    ))
}
pub struct Pipe {
    handle: Handle,
    deadline: Instant,
}
impl Read for Pipe {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        loop {
            let mut n = 0;
            let ok = unsafe {
                ReadFile(
                    self.handle.0,
                    buf.as_mut_ptr(),
                    buf.len().min(u32::MAX as usize) as u32,
                    &mut n,
                    null_mut(),
                )
            };
            if ok != 0 && n > 0 {
                return Ok(n as usize);
            }
            let error = unsafe { GetLastError() };
            if error != ERROR_NO_DATA && error != ERROR_PIPE_LISTENING {
                return if error == ERROR_BROKEN_PIPE {
                    Ok(0)
                } else {
                    Err(std::io::Error::from_raw_os_error(error as i32))
                };
            }
            if Instant::now() >= self.deadline {
                return Err(std::io::ErrorKind::TimedOut.into());
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}
impl Write for Pipe {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let mut n = 0;
        if unsafe {
            WriteFile(
                self.handle.0,
                buf.as_ptr(),
                buf.len() as u32,
                &mut n,
                null_mut(),
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error());
        }
        Ok(n as usize)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
#[allow(dead_code)] // Shared with the separate native-host binary; also used by integration tests.
pub fn exchange(name: &str, app: &Path, value: &Envelope) -> Result<Reply> {
    unsafe {
        let h = CreateFileW(
            wide(name).as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            0,
            null(),
            OPEN_EXISTING,
            0,
            null_mut(),
        );
        if h == INVALID_HANDLE_VALUE {
            return Err("Open ClipClipGO, then check the connection again.".into());
        }
        let mut pipe = Pipe {
            handle: Handle(h),
            deadline: Instant::now() + Duration::from_secs(4),
        };
        let mode = PIPE_NOWAIT;
        if SetNamedPipeHandleState(h, &mode, null(), null()) == 0 {
            return Err("Cannot configure desktop connection.".into());
        }
        let mut pid = 0;
        if GetNamedPipeServerProcessId(h, &mut pid) == 0
            || process_path(pid)
                .and_then(|p| p.canonicalize().ok())
                .as_deref()
                != app.canonicalize().ok().as_deref()
        {
            return Err("Desktop bridge identity mismatch. Repair setup.".into());
        }
        write_frame(&mut pipe, value)?;
        let reply = read_frame(&mut pipe)?.ok_or("Desktop disconnected.")?;
        pipe.write_all(&[1]).map_err(|_| "Desktop disconnected.")?;
        Ok(reply)
    }
}
pub fn serve(
    name: String,
    stop: Arc<AtomicBool>,
    handler: impl Fn(Envelope, Option<PathBuf>) -> Reply + Send + 'static,
) -> Result<std::thread::JoinHandle<()>> {
    unsafe {
        let sddl = wide(format!("D:P(A;;GA;;;{})", user_sid()?));
        let mut descriptor = null_mut();
        if ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            1,
            &mut descriptor,
            null_mut(),
        ) == 0
        {
            return Err("Cannot restrict bridge access to the current user.".into());
        }
        let sa = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor,
            bInheritHandle: 0,
        };
        let h = CreateNamedPipeW(
            wide(name).as_ptr(),
            PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_NOWAIT | PIPE_REJECT_REMOTE_CLIENTS,
            1,
            MAX_MESSAGE as u32 + 4,
            MAX_MESSAGE as u32 + 4,
            1000,
            &sa,
        );
        LocalFree(descriptor);
        if h == INVALID_HANDLE_VALUE {
            return Err("Another desktop bridge is active, or the pipe cannot be created.".into());
        }
        let handle = Handle(h);
        Ok(std::thread::spawn(move || {
            let mut pipe = Pipe {
                handle,
                deadline: Instant::now(),
            };
            while !stop.load(Ordering::SeqCst) {
                if ConnectNamedPipe(pipe.handle.0, null_mut()) == 0 {
                    let error = GetLastError();
                    if error == ERROR_NO_DATA || error == ERROR_BROKEN_PIPE {
                        DisconnectNamedPipe(pipe.handle.0);
                    }
                    if error != ERROR_PIPE_CONNECTED {
                        std::thread::sleep(Duration::from_millis(15));
                        continue;
                    }
                }
                pipe.deadline = Instant::now() + Duration::from_secs(3);
                let mut pid = 0;
                let client = if GetNamedPipeClientProcessId(pipe.handle.0, &mut pid) != 0 {
                    process_path(pid)
                } else {
                    None
                };
                if let Ok(Some(message)) = read_frame::<_, Envelope>(&mut pipe) {
                    let reply = handler(message, client);
                    if write_frame(&mut pipe, &reply).is_ok() {
                        let mut ack = [0];
                        let _ = pipe.read_exact(&mut ack);
                    }
                }
                DisconnectNamedPipe(pipe.handle.0);
            }
        }))
    }
}
pub fn registry_get(root: HKEY, key: &str) -> Result<Option<String>> {
    unsafe {
        let mut size = 0;
        let code = RegGetValueW(
            root,
            wide(key).as_ptr(),
            null(),
            RRF_RT_REG_SZ,
            null_mut(),
            null_mut(),
            &mut size,
        );
        if code == ERROR_FILE_NOT_FOUND {
            return Ok(None);
        }
        if code != 0 || size > 65536 {
            return Err("Cannot read browser registration.".into());
        }
        let mut buf = vec![0u16; (size as usize / 2) + 1];
        if RegGetValueW(
            root,
            wide(key).as_ptr(),
            null(),
            RRF_RT_REG_SZ,
            null_mut(),
            buf.as_mut_ptr() as _,
            &mut size,
        ) != 0
        {
            return Err("Cannot read browser registration.".into());
        }
        Ok(Some(String::from_utf16_lossy(
            &buf[..buf.iter().position(|c| *c == 0).unwrap_or(buf.len())],
        )))
    }
}
pub fn registry_set(key: &str, value: &str) -> Result<()> {
    unsafe {
        let mut h = null_mut();
        if RegCreateKeyExW(
            HKEY_CURRENT_USER,
            wide(key).as_ptr(),
            0,
            null(),
            0,
            KEY_SET_VALUE,
            null(),
            &mut h,
            null_mut(),
        ) != 0
        {
            return Err("Cannot create per-user Chrome bridge registration.".into());
        }
        let data = wide(value);
        let code = RegSetValueExW(
            h,
            null(),
            0,
            REG_SZ,
            data.as_ptr() as _,
            (data.len() * 2) as u32,
        );
        RegCloseKey(h);
        if code != 0 {
            return Err("Cannot write per-user Chrome bridge registration.".into());
        }
        Ok(())
    }
}
pub fn registry_remove(key: &str) -> Result<()> {
    unsafe {
        let code = RegDeleteKeyW(HKEY_CURRENT_USER, wide(key).as_ptr());
        if code == 0 || code == ERROR_FILE_NOT_FOUND {
            Ok(())
        } else {
            Err("Cannot remove per-user Chrome registration.".into())
        }
    }
}
pub fn chrome_path() -> Option<PathBuf> {
    for root in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        if let Ok(Some(p)) = registry_get(
            root,
            r"Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe",
        ) {
            if let Ok(p) = executable(Path::new(&p), "chrome.exe") {
                return Some(p);
            }
        }
    }
    default_browser().and_then(|p| executable(&p, "chrome.exe").ok())
}
pub fn default_browser() -> Option<PathBuf> {
    unsafe {
        let mut n = 0;
        AssocQueryStringW(
            ASSOCF_IS_PROTOCOL,
            ASSOCSTR_EXECUTABLE,
            wide("https").as_ptr(),
            null(),
            null_mut(),
            &mut n,
        );
        if n == 0 || n > 32768 {
            return None;
        }
        let mut buf = vec![0; n as usize];
        if AssocQueryStringW(
            ASSOCF_IS_PROTOCOL,
            ASSOCSTR_EXECUTABLE,
            wide("https").as_ptr(),
            null(),
            buf.as_mut_ptr(),
            &mut n,
        ) < 0
        {
            return None;
        }
        Some(PathBuf::from(String::from_utf16_lossy(
            &buf[..buf.iter().position(|c| *c == 0).unwrap_or(buf.len())],
        )))
    }
}
pub fn chrome_windows(chrome: &Path) -> (usize, bool) {
    struct Found {
        chrome: PathBuf,
        count: usize,
        ambiguous: bool,
    }
    unsafe extern "system" fn visit(hwnd: HWND, data: LPARAM) -> i32 {
        let found = &mut *(data as *mut Found);
        if IsWindowVisible(hwnd) == 0 || !GetWindow(hwnd, GW_OWNER).is_null() {
            return 1;
        }
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        if style & WS_CAPTION != WS_CAPTION || style & WS_SYSMENU == 0 || ex & WS_EX_TOOLWINDOW != 0
        {
            return 1;
        }
        let mut class = [0u16; 128];
        let n = GetClassNameW(hwnd, class.as_mut_ptr(), 128);
        if n == 0 || String::from_utf16_lossy(&class[..n as usize]) != "Chrome_WidgetWin_1" {
            return 1;
        }
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        match process_path(pid).and_then(|p| p.canonicalize().ok()) {
            Some(p) if p == found.chrome => found.count += 1,
            None => found.ambiguous = true,
            _ => {}
        }
        1
    }
    let mut found = Found {
        chrome: chrome.to_owned(),
        count: 0,
        ambiguous: false,
    };
    unsafe {
        if EnumWindows(Some(visit), &mut found as *mut _ as isize) == 0 {
            found.ambiguous = true;
        }
    }
    (found.count, found.ambiguous)
}
