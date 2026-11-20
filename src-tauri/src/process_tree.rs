//! Windows kill-on-close job: all descendants share the engine's lifetime.
#[cfg(windows)]
mod windows {
    use std::{ffi::c_void, os::windows::io::AsRawHandle, process::Child};
    type Handle = *mut c_void;
    #[repr(C)]
    #[derive(Default)]
    struct Basic {
        process_time: i64,
        job_time: i64,
        flags: u32,
        min_working: usize,
        max_working: usize,
        active: u32,
        affinity: usize,
        priority: u32,
        scheduling: u32,
    }
    #[repr(C)]
    #[derive(Default)]
    struct Limits {
        basic: Basic,
        io: [u64; 6],
        process_memory: usize,
        job_memory: usize,
        peak_process: usize,
        peak_job: usize,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateJobObjectW(attributes: Handle, name: *const u16) -> Handle;
        fn SetInformationJobObject(job: Handle, class: u32, data: *const c_void, len: u32) -> i32;
        fn AssignProcessToJobObject(job: Handle, process: Handle) -> i32;
        fn CloseHandle(handle: Handle) -> i32;
    }
    #[link(name = "ntdll")]
    extern "system" {
        fn NtResumeProcess(process: Handle) -> i32;
    }
    pub struct Tree(Handle);
    unsafe impl Send for Tree {}
    impl Tree {
        pub fn attach(child: &mut Child) -> Result<Self, String> {
            unsafe {
                let handle = CreateJobObjectW(std::ptr::null_mut(), std::ptr::null());
                if handle.is_null() {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("Could not create the engine process group.".into());
                }
                let tree = Self(handle);
                let mut limits = Limits::default();
                limits.basic.flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                if SetInformationJobObject(
                    handle,
                    9,
                    &limits as *const _ as _,
                    std::mem::size_of::<Limits>() as u32,
                ) == 0
                    || AssignProcessToJobObject(handle, child.as_raw_handle()) == 0
                    || NtResumeProcess(child.as_raw_handle()) < 0
                {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("Could not contain the engine process tree.".into());
                }
                Ok(tree)
            }
        }
    }
    impl Drop for Tree {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}
#[cfg(windows)]
pub use windows::Tree;
