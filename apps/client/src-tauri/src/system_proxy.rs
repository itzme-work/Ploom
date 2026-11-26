// The guard owns the user's original values. EOF on its private stdin also restores
// them if the UI process crashes, independently of the WebView event loop.
use std::{
    fs::{File, OpenOptions},
    io::{self, BufRead, Read, Write},
    os::windows::fs::OpenOptionsExt,
    os::windows::process::CommandExt,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
};
use windows_sys::Win32::Networking::WinInet::{
    InternetSetOptionW, INTERNET_OPTION_REFRESH, INTERNET_OPTION_SETTINGS_CHANGED,
};
use winreg::{enums::*, RegKey};

fn refresh() {
    unsafe {
        for option in [INTERNET_OPTION_SETTINGS_CHANGED, INTERNET_OPTION_REFRESH] {
            InternetSetOptionW(std::ptr::null(), option, std::ptr::null(), 0);
        }
    }
}
fn settings() -> io::Result<RegKey> {
    RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(
        "Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
        KEY_READ | KEY_SET_VALUE,
    )
}
fn optional<T: winreg::types::FromRegValue>(key: &RegKey, name: &str) -> io::Result<Option<T>> {
    match key.get_value(name) {
        Ok(v) => Ok(Some(v)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}
fn restore(key: &RegKey, path: &Path) -> io::Result<()> {
    let bytes = match std::fs::read(path) {
        Ok(v) => v,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    let (port, server, enabled): (u16, Option<String>, Option<u32>) =
        serde_json::from_slice(&bytes)?;
    if optional::<String>(key, "ProxyServer")?.as_deref() == Some(&format!("127.0.0.1:{port}")) {
        if optional::<u32>(key, "ProxyEnable")? == Some(1) {
            if let Some(v) = enabled {
                key.set_value("ProxyEnable", &v)?;
            } else {
                key.delete_value("ProxyEnable")?;
            }
        }
        if let Some(v) = server {
            key.set_value("ProxyServer", &v)?;
        } else {
            key.delete_value("ProxyServer")?;
        }
        refresh();
    }
    std::fs::remove_file(path)
}
fn location() -> io::Result<PathBuf> {
    let dir = PathBuf::from(std::env::var_os("LOCALAPPDATA").ok_or(io::ErrorKind::NotFound)?)
        .join("work.itzme.ploom");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}
fn lock(dir: &Path) -> io::Result<File> {
    OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .share_mode(0)
        .open(dir.join("proxy.lock"))
}
pub fn recover() {
    if let Ok(dir) = location() {
        if let Ok(_lock) = lock(&dir) {
            if let Ok(key) = settings() {
                let _ = restore(&key, &dir.join("proxy-recovery.json"));
            }
        }
    }
}
pub fn guard() -> io::Result<()> {
    let mut input = io::stdin().lock();
    let mut line = String::new();
    input.read_line(&mut line)?;
    let port = line
        .trim()
        .parse::<u16>()
        .map_err(|_| io::ErrorKind::InvalidInput)?;
    if port == 0 {
        return Err(io::ErrorKind::InvalidInput.into());
    }
    let dir = location()?;
    let _lock = lock(&dir)?;
    let path = dir.join("proxy-recovery.json");
    let key = settings()?;
    restore(&key, &path)?;
    if optional::<String>(&key, "AutoConfigURL")?.is_some_and(|v| !v.is_empty()) {
        return Err(io::ErrorKind::AlreadyExists.into());
    }
    let server = optional::<String>(&key, "ProxyServer")?;
    let enabled = optional::<u32>(&key, "ProxyEnable")?;
    // Avoid persisting credentials from a nonstandard pre-existing proxy URI.
    if server.as_ref().is_some_and(|s| s.contains('@')) {
        return Err(io::ErrorKind::InvalidData.into());
    }
    let mut temp = tempfile::NamedTempFile::new_in(&dir)?;
    serde_json::to_writer(&mut temp, &(port, server, enabled))?;
    temp.as_file().sync_all()?;
    temp.persist(&path)?;
    let result = (|| -> io::Result<()> {
        key.set_value("ProxyServer", &format!("127.0.0.1:{port}"))?;
        key.set_value("ProxyEnable", &1u32)?;
        refresh();
        println!("ready");
        io::stdout().flush()?;
        let mut end = [0];
        input.read(&mut end)?;
        Ok(())
    })();
    restore(&key, &path)?;
    result
}
pub struct Guard(Child);
impl Guard {
    pub fn start(port: u16) -> io::Result<Self> {
        let mut child = Command::new(std::env::current_exe()?)
            .arg("--system-proxy-guard")
            .creation_flags(0x08000000)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;
        writeln!(child.stdin.as_mut().unwrap(), "{port}")?;
        let mut ready = String::new();
        io::BufReader::new(child.stdout.take().unwrap()).read_line(&mut ready)?;
        if ready.trim() != "ready" {
            let _ = child.wait();
            return Err(io::ErrorKind::PermissionDenied.into());
        }
        Ok(Self(child))
    }
}
impl Drop for Guard {
    fn drop(&mut self) {
        drop(self.0.stdin.take());
        let _ = self.0.wait();
    }
}
