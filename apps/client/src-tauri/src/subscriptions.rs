use std::{
    net::{IpAddr, SocketAddr},
    time::{Duration, Instant},
};
use subscription_http::{redirect::Policy, Client, Url};
use tokio::{
    net::{lookup_host, TcpStream},
    sync::Semaphore,
    time::timeout,
};
const LIMIT: usize = 4 * 1024 * 1024;
static REQUESTS: Semaphore = Semaphore::const_new(4);

fn public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            let [a, b, c, _] = v.octets();
            !(a == 0
                || a == 10
                || a == 127
                || a >= 224
                || (a == 100 && (64..128).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..32).contains(&b))
                || (a == 192 && (b == 168 || b == 0 || (b == 88 && c == 99)))
                || (a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
                || (a == 203 && b == 0 && c == 113))
        }
        IpAddr::V6(v) => {
            let s = v.segments();
            s[0] & 0xe000 == 0x2000
                && s[0] != 0x2002
                && !(s[0] == 0x2001 && (s[1] < 0x200 || s[1] == 0xdb8))
                && s[0] != 0x3fff
        }
    }
}
async fn resolve(host: &str, port: u16) -> Result<Vec<SocketAddr>, String> {
    let host = host.trim_start_matches('[').trim_end_matches(']');
    if host.is_empty() || host.len() > 253 || port == 0 {
        return Err("address".into());
    }
    let ips: Vec<_> = lookup_host((host, port))
        .await
        .map_err(|_| "dns")?
        .collect();
    if ips.is_empty() || ips.iter().any(|s| !public(s.ip())) {
        return Err("address".into());
    }
    Ok(ips)
}
async fn client_for(host: String, port: u16) -> Result<Client, String> {
    let ips = resolve(&host, port).await?;
    Client::builder()
        .no_proxy()
        .redirect(Policy::none())
        .resolve_to_addrs(&host, &ips)
        .build()
        .map_err(|_| "network".into())
}
async fn download<F, Fut>(raw: String, client_for: F) -> Result<serde_json::Value, String>
where
    F: Fn(String, u16) -> Fut,
    Fut: std::future::Future<Output = Result<Client, String>>,
{
    if raw.len() > 8192 {
        return Err("url".into());
    }
    let mut url = Url::parse(&raw).map_err(|_| "url")?;
    let origin = url.origin();
    for _ in 0..5 {
        if url.scheme() != "https"
            || url.origin() != origin
            || !url.username().is_empty()
            || url.password().is_some()
            || url.fragment().is_some()
        {
            return Err("url".into());
        }
        let host = url.host_str().ok_or("url")?;
        let client = client_for(host.to_owned(), url.port_or_known_default().ok_or("url")?).await?;
        let mut resp = client
            .get(url.clone())
            .send()
            .await
            .map_err(|_| "network")?;
        if resp.status().is_redirection() {
            url = url
                .join(
                    resp.headers()
                        .get("location")
                        .and_then(|v| v.to_str().ok())
                        .ok_or("redirect")?,
                )
                .map_err(|_| "redirect")?;
            continue;
        }
        if !resp.status().is_success() {
            return Err("http".into());
        }
        if resp.content_length().unwrap_or(0) > LIMIT as u64 {
            return Err("size".into());
        }
        let header = |k: &str| {
            resp.headers()
                .get(k)
                .and_then(|v| v.to_str().ok())
                .filter(|v| v.len() < 2048)
                .unwrap_or("")
                .to_owned()
        };
        let (traffic, site, title) = (
            header("subscription-userinfo"),
            header("profile-web-page-url"),
            header("profile-title"),
        );
        let mut bytes = Vec::new();
        while let Some(chunk) = resp.chunk().await.map_err(|_| "network")? {
            if chunk.len() > LIMIT - bytes.len() {
                return Err("size".into());
            }
            bytes.extend_from_slice(&chunk)
        }
        let text = String::from_utf8(bytes).map_err(|_| "encoding")?;
        return Ok(serde_json::json!({"text":text,"traffic":traffic,"site":site,"title":title}));
    }
    Err("redirect".into())
}
#[tauri::command]
pub async fn subscription_fetch(url: String) -> Result<serde_json::Value, String> {
    let _permit = REQUESTS.try_acquire().map_err(|_| "busy")?;
    timeout(Duration::from_secs(25), download(url, client_for))
        .await
        .map_err(|_| "timeout")?
}
#[tauri::command]
pub async fn subscription_probe(host: String, port: u16, seconds: u64) -> Result<u64, String> {
    let _permit = REQUESTS.try_acquire().map_err(|_| "busy")?;
    timeout(Duration::from_secs(seconds.clamp(1, 15)), async {
        let ips = resolve(&host, port).await?;
        let start = Instant::now();
        let _stream = TcpStream::connect(ips.as_slice())
            .await
            .map_err(|_| "tcp")?;
        Ok(start.elapsed().as_millis() as u64)
    })
    .await
    .map_err(|_| "timeout")?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn blocks_reserved_destinations() {
        for s in [
            "127.0.0.1",
            "10.0.0.1",
            "169.254.169.254",
            "100.64.1.1",
            "::1",
            "::ffff:127.0.0.1",
            "fd00::1",
            "2002::1",
        ] {
            assert!(!public(s.parse().unwrap()))
        }
        assert!(public("1.1.1.1".parse().unwrap()))
    }
}

#[cfg(test)]
mod transport_tests {
    use super::*;
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio_rustls::{
        rustls::{self, pki_types::PrivatePkcs8KeyDer},
        TlsAcceptor,
    };
    #[tokio::test]
    async fn verifies_tls_limits_and_redirect_origin() {
        let name = "subscription.example.invalid";
        let cert = rcgen::generate_simple_self_signed(vec![name.to_owned()]).unwrap();
        let der = cert.cert.der().clone();
        let config = rustls::ServerConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(
            vec![der.clone()],
            PrivatePkcs8KeyDer::from(cert.key_pair.serialize_der()).into(),
        )
        .unwrap();
        let accept = TlsAcceptor::from(Arc::new(config));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let accept = accept.clone();
                tokio::spawn(async move {
                    let Ok(mut tls) = accept.accept(stream).await else {
                        return;
                    };
                    let mut buf = [0; 2048];
                    let Ok(n) = tls.read(&mut buf).await else {
                        return;
                    };
                    let path = std::str::from_utf8(&buf[..n])
                        .unwrap_or("")
                        .split_whitespace()
                        .nth(1)
                        .unwrap_or("");
                    let reply=match path{
                "/redirect"=>"302 Found\r\nLocation: /feed\r\nContent-Length: 0\r\n\r\n",
                "/cross"=>"302 Found\r\nLocation: https://other.invalid/secret\r\nContent-Length: 0\r\n\r\n",
                "/large"=>"200 OK\r\nContent-Length: 4194305\r\n\r\n",
                "/feed"=>"200 OK\r\nSubscription-Userinfo: total=128\r\nContent-Length: 2\r\n\r\nok",
                _=>"503 Unavailable\r\nContent-Length: 0\r\n\r\n"
              };
                    let _ = tls.write_all(format!("HTTP/1.1 {reply}").as_bytes()).await;
                    let _ = tls.shutdown().await;
                });
            }
        });
        let url = |path: &str| format!("https://{name}:{}{path}", addr.port());
        for (path, trust, want) in [
            ("/feed", false, "network"),
            ("/cross", true, "url"),
            ("/large", true, "size"),
            ("/bad", true, "http"),
            ("/redirect", true, "ok"),
        ] {
            let mut builder = Client::builder()
                .no_proxy()
                .redirect(Policy::none())
                .resolve(name, addr);
            if trust {
                builder = builder
                    .add_root_certificate(subscription_http::Certificate::from_der(&der).unwrap())
            }
            let client = builder.build().unwrap();
            let result = download(url(path), |host, _| {
                assert_eq!(host, name);
                std::future::ready(Ok(client.clone()))
            })
            .await;
            if want == "ok" {
                let feed = result.unwrap();
                assert_eq!(feed["text"], "ok");
                assert_eq!(feed["traffic"], "total=128")
            } else {
                assert_eq!(result.unwrap_err(), want)
            }
        }
        task.abort();
    }
}

#[tauri::command]
pub async fn subscription_dns(host: String, seconds: u64) -> Result<usize, String> {
    let _permit = REQUESTS.try_acquire().map_err(|_| "busy")?;
    timeout(
        Duration::from_secs(seconds.clamp(1, 15)),
        resolve(&host, 443),
    )
    .await
    .map_err(|_| "timeout")?
    .map(|ips| ips.len())
}

#[tauri::command]
pub async fn library_site(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let url = Url::parse(&url).map_err(|_| "url")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("url".into());
    }
    #[cfg(target_os = "android")]
    {
        use tauri::{plugin::PluginHandle, Manager};
        return app
            .state::<PluginHandle<tauri::Wry>>()
            .run_mobile_plugin_async("openProvider", serde_json::json!({"expected":url.as_str()}))
            .await
            .map_err(|_| "Browser unavailable".into());
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        let text: Vec<u16> = url.as_str().encode_utf16().chain(Some(0)).collect();
        let status = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                std::ptr::null(),
                text.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1,
            )
        } as isize;
        if status <= 32 {
            return Err("Browser unavailable".into());
        }
    }
    let _ = app;
    Ok(())
}
