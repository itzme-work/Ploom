use serde_json::{json, Value};
use std::time::Duration;
use subscription_http::Url;

// Build only the supported native schema. Never forward arbitrary user JSON to libbox.
pub(crate) async fn outbound(raw: &str, lan_endpoint: Option<String>) -> Result<Value, String> {
    if raw.len() > 8192 || raw.contains('\\') || raw.chars().any(char::is_control) {
        return Err("invalid".into());
    }
    let u = Url::parse(raw).map_err(|_| "invalid")?;
    let host = u.host_str().ok_or("address")?;
    let port = u
        .port_or_known_default()
        .or_else(|| matches!(u.scheme(), "hy2" | "hysteria2").then_some(443))
        .ok_or("port")?;
    let mut out = configuration(&u)?;
    let literal = host
        .trim_matches(&['[', ']'][..])
        .parse::<std::net::IpAddr>()
        .ok();
    if let Some(ip) = literal.filter(|ip| match ip {
        std::net::IpAddr::V4(v) => v.is_private(),
        std::net::IpAddr::V6(v) => v.is_unique_local(),
    }) {
        let endpoint = std::net::SocketAddr::new(ip, port).to_string();
        if lan_endpoint.as_deref() != Some(endpoint.as_str()) {
            return Err(format!("lan:{endpoint}"));
        }
        out["server"] = json!(ip.to_string());
    } else {
        let addresses = tokio::time::timeout(
            Duration::from_secs(8),
            super::subscriptions::resolve(host, port),
        )
        .await
        .map_err(|_| "dns")??;
        out["server"] = json!(addresses[0].ip().to_string());
    }
    out["server_port"] = json!(port);
    Ok(out)
}

fn configuration(u: &Url) -> Result<Value, String> {
    use std::collections::BTreeMap;
    if !matches!(u.path(), "" | "/") {
        return Err("options".into());
    }
    let mut args = BTreeMap::new();
    for (k, v) in u.query_pairs() {
        if args.insert(k.into_owned(), v.into_owned()).is_some() {
            return Err("options".into());
        }
    }
    let decode = |s: &str| {
        percent_encoding::percent_decode_str(s)
            .decode_utf8()
            .map(|v| v.into_owned())
            .map_err(|_| "credentials")
    };
    let user = decode(u.username())?;
    let pass = u.password().map(decode).transpose()?;
    let kind = match u.scheme() {
        "http" | "https" => "http",
        "socks5" => "socks",
        "ss" => "shadowsocks",
        "hy2" | "hysteria2" => "hysteria2",
        "trojan" => "trojan",
        "tuic" => "tuic",
        "vless" => "vless",
        "vmess" => "vmess",
        _ => return Err("protocol".into()),
    };
    let mut out = json!({"type":kind,"tag":"provider"});
    match kind {
        "shadowsocks" => {
            use base64::{
                engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD},
                Engine,
            };
            let (method, password) = if let Some(password) = pass {
                (user, password)
            } else {
                let bytes = URL_SAFE_NO_PAD
                    .decode(&user)
                    .or_else(|_| URL_SAFE.decode(&user))
                    .map_err(|_| "credentials")?;
                let value = String::from_utf8(bytes).map_err(|_| "credentials")?;
                let (method, password) = value.split_once(':').ok_or("credentials")?;
                (method.to_owned(), password.to_owned())
            };
            if !matches!(
                method.as_str(),
                "aes-128-gcm" | "aes-256-gcm" | "chacha20-ietf-poly1305"
            ) {
                return Err("options".into());
            }
            if password.is_empty() || password.chars().any(char::is_control) {
                return Err("credentials".into());
            }
            out["method"] = json!(method);
            out["password"] = json!(password);
        }
        "socks" | "http" => {
            if !user.is_empty() || pass.is_some() {
                out["username"] = json!(user);
                out["password"] = json!(pass.unwrap_or_default());
            }
        }
        "trojan" | "hysteria2" => {
            if user.is_empty() || pass.is_some() {
                return Err("credentials".into());
            }
            out["password"] = json!(user);
        }
        _ => {
            if uuid::Uuid::parse_str(&user).is_err() {
                return Err("credentials".into());
            }
            out["uuid"] = json!(user);
            if kind == "tuic" {
                out["password"] = json!(pass.ok_or("credentials")?);
            } else if pass.is_some() {
                return Err("credentials".into());
            }
        }
    }
    let secure = match u.scheme() {
        "https" | "trojan" | "tuic" | "hy2" | "hysteria2" => "tls",
        _ => "none",
    };
    let security = if matches!(kind, "vless" | "vmess" | "trojan") {
        args.remove("security").unwrap_or_else(|| secure.into())
    } else {
        secure.into()
    };
    if security == "tls" || security == "reality" {
        if security == "reality" && kind != "vless" {
            return Err("options".into());
        }
        let mut tls = json!({"enabled":true,"server_name":args.remove("sni").unwrap_or_else(||u.host_str().unwrap_or_default().trim_matches(&['[',']'][..]).into())});
        if let Some(alpn) = args.remove("alpn") {
            tls["alpn"] = json!(alpn.split(',').collect::<Vec<_>>());
        }
        if let Some(fp) = args.remove("fp") {
            tls["utls"] = json!({"enabled":true,"fingerprint":fp});
        }
        if security == "reality" {
            tls["reality"] = json!({"enabled":true,"public_key":args.remove("pbk").ok_or("options")?,"short_id":args.remove("sid").unwrap_or_default()});
            if tls.get("utls").is_none() {
                tls["utls"] = json!({"enabled":true,"fingerprint":"chrome"});
            }
        }
        out["tls"] = tls;
    } else if security != "none" || secure == "tls" {
        return Err("options".into());
    }
    if kind == "vless" {
        if args.remove("encryption").is_some_and(|v| v != "none") {
            return Err("options".into());
        }
        if let Some(flow) = args.remove("flow") {
            if flow != "xtls-rprx-vision" || security == "none" {
                return Err("options".into());
            }
            out["flow"] = json!(flow);
        }
    }
    if matches!(kind, "vless" | "trojan" | "vmess") {
        match args.remove("type").as_deref().unwrap_or("tcp") {
            "tcp" => (),
            ty @ ("ws" | "httpupgrade") => {
                let mut transport = json!({"type":ty});
                if let Some(path) = args.remove("path") {
                    transport["path"] = json!(path);
                }
                if let Some(host) = args.remove("host") {
                    if ty == "ws" {
                        transport["headers"] = json!({"Host":host});
                    } else {
                        transport["host"] = json!(host);
                    }
                }
                out["transport"] = transport;
            }
            "grpc" => {
                out["transport"] = json!({"type":"grpc","service_name":args.remove("serviceName").unwrap_or_default()});
            }
            _ => return Err("options".into()),
        }
    }
    if !args.is_empty() {
        return Err("options".into());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shadowsocks_sip002_preserves_password_and_rejects_unhandled_plugins() {
        let uri = "ss://YWVzLTI1Ni1nY206YTpi@example.invalid:443";
        let out = configuration(&Url::parse(uri).unwrap()).unwrap();
        assert_eq!(out["method"], "aes-256-gcm");
        assert_eq!(out["password"], "a:b");
        assert!(configuration(&Url::parse(&format!("{uri}?plugin=unsupported")).unwrap()).is_err());
    }
    #[test]
    fn preserves_reality_identity_and_rejects_unknown_security_options() {
        let base="vless://00000000-0000-4000-8000-000000000001@fixture.invalid:443?security=reality&pbk=fixture&sid=01&sni=fixture.invalid&fp=chrome&flow=xtls-rprx-vision";
        let out = configuration(&Url::parse(base).unwrap()).unwrap();
        assert_eq!(out["tls"]["reality"]["short_id"], "01");
        assert_eq!(out["flow"], "xtls-rprx-vision");
        for suffix in ["&allowInsecure=1", "&fp=firefox", "&unknown=1"] {
            assert!(configuration(&Url::parse(&(base.to_owned() + suffix)).unwrap()).is_err());
        }
    }
}

pub(crate) fn tun(outbound: Value) -> Value {
    json!({"log":{"disabled":true},
        "dns":{"servers":[{"type":"tls","tag":"resolver","server":"9.9.9.9","server_port":853,
             "tls":{"enabled":true,"server_name":"dns.quad9.net"},"detour":"provider"}]},
        "inbounds":[{"type":"tun","tag":"vpn","address":["172.19.0.1/30","fd65:706c:6f6f::1/126"],
             "mtu":1400,"auto_route":true,"strict_route":true,"stack":"gvisor"}],
        "outbounds":[outbound],"route":{"auto_detect_interface":true,"final":"provider",
             "rules":[{"port":53,"action":"hijack-dns"}]}})
}
