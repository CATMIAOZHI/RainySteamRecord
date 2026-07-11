#[cfg(windows)]
use std::os::windows::io::AsRawHandle;
use std::process::Child;

#[cfg(windows)]
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
#[cfg(windows)]
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

pub struct ProcessJob {
    #[cfg(windows)]
    handle: HANDLE,
}

impl ProcessJob {
    pub fn assign(child: &Child) -> Result<Self, String> {
        #[cfg(windows)]
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return Err(format!(
                    "Failed to create process job: {}",
                    std::io::Error::last_os_error()
                ));
            }
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of_val(&info) as u32,
            ) == 0
            {
                let error = std::io::Error::last_os_error();
                CloseHandle(handle);
                return Err(format!("Failed to configure process job: {}", error));
            }
            let process = child.as_raw_handle() as HANDLE;
            if AssignProcessToJobObject(handle, process) == 0 {
                let error = std::io::Error::last_os_error();
                CloseHandle(handle);
                return Err(format!("Failed to manage child process: {}", error));
            }
            Ok(Self { handle })
        }

        #[cfg(not(windows))]
        {
            let _ = child;
            Ok(Self {})
        }
    }
}

#[cfg(windows)]
unsafe impl Send for ProcessJob {}

impl Drop for ProcessJob {
    fn drop(&mut self) {
        #[cfg(windows)]
        unsafe {
            CloseHandle(self.handle);
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::ProcessJob;
    use std::process::Command;
    use std::time::{Duration, Instant};

    #[test]
    fn closing_job_terminates_child() {
        let mut child = Command::new("powershell.exe")
            .args(["-NoProfile", "-Command", "Start-Sleep -Seconds 30"])
            .spawn()
            .expect("failed to spawn test child");
        let job = ProcessJob::assign(&child).expect("failed to assign test child");
        let started = Instant::now();
        drop(job);
        child.wait().expect("failed to wait for test child");
        assert!(started.elapsed() < Duration::from_secs(5));
    }
}
