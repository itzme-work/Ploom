use serde_json::{json, Value};
use std::time::Duration;
use subscription_http::Url;

// Build only the supported native schema. Never forward arbitrary user JSON to libbox.
pub(crate) async fn outbound(raw: &str) -> Result<Value, String> {
    if raw.len() > 8192 || raw.contains('\\') || raw.chars().any(char::is_control) {
        return Err("invalid".into());
    }
    let u = Url::parse(raw).map_err(|_| "invalid")?;
    let kind = match u.scheme() {
        "http" | "https" => "http",
        "socks5" => "socks",
        _ => return Err("protocol".into()),
    };
    if u.query().is_some() || !matches!(u.path(), "" | "/") {
        return Err("options".into());
    }
    let host = u.host_str().ok_or("address")?;
    let port = u.port_or_known_default().ok_or("port")?;
    let addresses = tokio::time::timeout(
        Duration::from_secs(8),
        super::subscriptions::resolve(host, port),
    )
    .await
    .map_err(|_| "dns")??;
    let mut out = json!({"type":kind,"tag":"provider","server":addresses[0].ip().to_string(),"server_port":port});
    if !u.username().is_empty() || u.password().is_some() {
        for (field, input) in [
            ("username", u.username()),
            ("password", u.password().unwrap_or("")),
        ] {
            let value = percent_encoding::percent_decode_str(input)
                .decode_utf8()
                .map_err(|_| "credentials")?;
            out[field] = json!(value);
        }
    }
    if u.scheme() == "https" {
        out["tls"] = json!({"enabled":true,"server_name":host.trim_matches(&['[',']'][..])});
    }
    Ok(out)
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
