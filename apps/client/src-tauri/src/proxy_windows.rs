use sha2::{Digest, Sha256};
use std::{
    fs::OpenOptions,
    io::{self, Write},
    net::TcpListener,
    os::windows::{
        fs::OpenOptionsExt,
        io::{AsRawHandle, FromRawHandle, OwnedHandle},
        process::CommandExt,
    },
    process::{Child, Command, Stdio},
    sync::Mutex,
};
use tauri::Manager;
use windows_sys::Win32::System::JobObjects::*;

struct Session {
    child: Child,
    port: u16,
    _job: OwnedHandle,
    system: Option<super::system_proxy::Guard>,
}
static SESSION: Mutex<Option<Session>> = Mutex::new(None);

fn job() -> Result<OwnedHandle, String> {
    unsafe {
        let raw = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if raw.is_null() {
            return Err("supervisor".into());
        }
        let owner = OwnedHandle::from_raw_handle(raw);
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(
            raw,
            JobObjectExtendedLimitInformation,
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            std::mem::size_of_val(&limits) as u32,
        ) == 0
        {
            return Err("supervisor".into());
        }
        Ok(owner)
    }
}

#[tauri::command]
pub async fn proxy_start(
    app: tauri::AppHandle,
    raw: String,
    lan_endpoint: Option<String>,
    system: Option<bool>,
) -> Result<(), String> {
    let out = super::connection::outbound(&raw, lan_endpoint).await?;
    tauri::async_runtime::spawn_blocking(move || start(&app, out, system.unwrap_or(false)))
        .await
        .map_err(|_| "worker")?
}

fn start(app: &tauri::AppHandle, out: serde_json::Value, system: bool) -> Result<(), String> {
    let expected = option_env!("PLOOM_CORE_SHA256").ok_or("unavailable")?;
    let path = app
        .path()
        .resource_dir()
        .map_err(|_| "resources")?
        .join("engine")
        .join("sing-box.exe");
    let mut file = OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(&path)
        .map_err(|_| "unavailable")?;
    let mut hash = Sha256::new();
    io::copy(&mut file, &mut hash).map_err(|_| "integrity")?;
    if format!("{:x}", hash.finalize()) != expected {
        return Err("integrity".into());
    }
    let mut slot = SESSION.lock().map_err(|_| "state")?;
    if let Some(old) = slot.as_mut() {
        if old.child.try_wait().map_err(|_| "state")?.is_none() {
            return Err("busy".into());
        }
    }
    let port = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|_| "port")?
        .local_addr()
        .map_err(|_| "port")?
        .port();
    let config = serde_json::json!({"log":{"disabled":true},"inbounds":[{"type":"mixed","listen":"127.0.0.1","listen_port":port}],"outbounds":[out]});
    let owner = job()?;
    let mut child = Command::new(&path)
        .args(["run", "-c", "stdin"])
        .current_dir(path.parent().unwrap())
        .creation_flags(0x08000000)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "launch")?;
    if unsafe { AssignProcessToJobObject(owner.as_raw_handle(), child.as_raw_handle()) } == 0 {
        let _ = child.kill();
        let _ = child.wait();
        return Err("supervisor".into());
    }
    let mut input = child.stdin.take().ok_or("pipe")?;
    input
        .write_all(config.to_string().as_bytes())
        .map_err(|_| "launch")?;
    drop(input);
    let mut ready = false;
    for _ in 0..80 {
        if child.try_wait().map_err(|_| "state")?.is_some() {
            return Err("launch".into());
        }
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            ready = true;
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    if !ready {
        return Err("launch".into());
    }
    let system = if system {
        Some(super::system_proxy::Guard::start(port).map_err(|_| "system proxy")?)
    } else {
        None
    };
    *slot = Some(Session {
        system,
        child,
        port,
        _job: owner,
    });
    Ok(())
}
#[tauri::command]
pub fn proxy_stop() -> Result<(), String> {
    let mut slot = SESSION.lock().map_err(|_| "state")?;
    if let Some(mut s) = slot.take() {
        drop(s._job);
        s.child.wait().map_err(|_| "stop")?;
    }
    Ok(())
}
#[tauri::command]
pub fn proxy_state() -> Result<serde_json::Value, String> {
    let mut slot = SESSION.lock().map_err(|_| "state")?;
    if let Some(s) = slot.as_mut() {
        if s.child.try_wait().map_err(|_| "state")?.is_none() {
            return Ok(
                serde_json::json!({"state":"local-process","system":s.system.is_some(),"port":s.port}),
            );
        }
        *slot = None;
        return Ok(serde_json::json!({"state":"error"}));
    }
    Ok(
        serde_json::json!({"state":if option_env!("PLOOM_CORE_SHA256").is_some() {"idle"} else {"unavailable"}}),
    )
}

#[tauri::command]
pub async fn proxy_probe() -> Result<u64, String> {
    let port = {
        let mut slot = SESSION.lock().map_err(|_| "state")?;
        let session = slot.as_mut().ok_or("offline")?;
        if session.child.try_wait().map_err(|_| "state")?.is_some() {
            return Err("offline".into());
        }
        session.port
    };
    let client = subscription_http::Client::builder()
        .proxy(
            subscription_http::Proxy::all(format!("http://127.0.0.1:{port}"))
                .map_err(|_| "proxy")?,
        )
        .redirect(subscription_http::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|_| "client")?;
    let start = std::time::Instant::now();
    let res = client
        .get("https://connectivitycheck.gstatic.com/generate_204")
        .send()
        .await
        .map_err(|e| if e.is_timeout() { "timeout" } else { "network" })?;
    if res.status().as_u16() != 204 {
        return Err("response".into());
    }
    Ok(start.elapsed().as_millis() as u64)
}
