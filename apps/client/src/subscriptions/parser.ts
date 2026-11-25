import { parseDocument, visit, isAlias, isNode } from "yaml";

export const MAX_BYTES = 4 * 1024 * 1024;
export const MAX_ROWS = 12000;
export type Server = {
	name: string;
	protocol: string;
	host: string;
	port: number;
	transport: string;
	security: string;
	country: string;
	raw: string;
};
export type Preview = {
	format: string;
	servers: Server[];
	invalid: number;
	duplicates: number;
};
const protocols = new Set([
	"vless",
	"vmess",
	"trojan",
	"ss",
	"socks5",
	"http",
	"https",
	"hysteria2",
	"tuic",
	"wireguard",
]);
function protocol(s: string) {
	return (
		(
			{
				shadowsocks: "ss",
				socks: "socks5",
				hy2: "hysteria2",
				wg: "wireguard",
			} as Record<string, string>
		)[s] ?? s
	);
}
function decode(s: string) {
	if (!/^[a-zA-Z0-9+/_=\s-]+$/.test(s)) throw Error();
	return new TextDecoder("utf-8", { fatal: true }).decode(
		Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
			c.charCodeAt(0),
		),
	);
}
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
	v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const str = (v: unknown) => (typeof v === "string" ? v : "");
function server(
	proto: string,
	host: unknown,
	port: unknown,
	name: unknown,
	raw: string,
	transport = "",
	security = "",
	country = "",
): Server {
	const h = str(host).toLowerCase(),
		n = Number(port);
	if (
		!protocols.has(proto) ||
		!h ||
		h.length > 253 ||
		/[\s/@?#\\]/.test(h) ||
		!Number.isInteger(n) ||
		n < 1 ||
		n > 65535
	)
		throw Error();
	new URL(
		"http://" + (h.includes(":") && !h.startsWith("[") ? "[" + h + "]" : h),
	);
	return {
		protocol: proto,
		host: h,
		port: n,
		name: str(name).slice(0, 256) || h,
		raw,
		transport,
		security,
		country,
	};
}
function uri(raw: string): Server {
	if (raw.length > 65536) throw Error();
	if (raw.startsWith("vmess://") && !raw.slice(8).includes("@")) {
		const v = obj(JSON.parse(decode(raw.slice(8))));
		if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(str(v.id)))
			throw Error();
		return server("vmess", v.add, v.port, v.ps, raw, str(v.net), str(v.tls));
	}
	let source = raw;
	if (raw.startsWith("ss://") && !raw.split("#")[0].includes("@")) {
		const [body, tag] = raw.slice(5).split("#");
		const decoded = decode(body),
			at = decoded.lastIndexOf("@");
		if (at < 0) throw Error();
		source =
			"ss://" +
			encodeURIComponent(decoded.slice(0, at)) +
			"@" +
			decoded.slice(at + 1) +
			(tag ? "#" + tag : "");
	}
	const u = new URL(source),
		p = protocol(u.protocol.slice(0, -1));
	if (
		["vless", "vmess"].includes(p) &&
		!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(u.username)
	)
		throw Error();
	if (p === "ss") {
		const auth =
			decodeURIComponent(u.username) +
			(u.password ? ":" + decodeURIComponent(u.password) : "");
		if (!/^[^:]+:.+$/s.test(auth.includes(":") ? auth : decode(auth)))
			throw Error();
	}
	if (
		["vless", "trojan", "ss", "vmess", "tuic", "hysteria2"].includes(p) &&
		!u.username
	)
		throw Error();
	return server(
		p,
		u.hostname,
		u.port ||
			(p === "http" ? 80 : p === "https" || p === "hysteria2" ? 443 : 0),
		decodeURIComponent(u.hash.slice(1)),
		raw,
		u.searchParams.get("type") ?? "",
		u.searchParams.get("security") ?? "",
	);
}
function boundedJson(s: string) {
	let depth = 0,
		quoted = false,
		escaped = false;
	for (const c of s) {
		if (quoted) {
			if (escaped) escaped = false;
			else if (c === "\\") escaped = true;
			else if (c === '"') quoted = false;
		} else if (c === '"') quoted = true;
		else if (c === "{" || c === "[") {
			if (++depth > 48) throw Error();
		} else if (c === "}" || c === "]") depth--;
	}
	return JSON.parse(s);
}
export function parseSubscription(text: string): Preview {
	if (new TextEncoder().encode(text).length > MAX_BYTES) throw Error("limit");
	let body = text.trim(),
		format = "URI",
		invalid = 0,
		duplicates = 0,
		count = 0;
	const servers: Server[] = [],
		seen = new Set<string>();
	function add(fn: () => Server) {
		if (++count > MAX_ROWS) throw Error("limit");
		try {
			const s = fn(),
				identity =
					s.raw.includes("://") && !s.raw.startsWith("{")
						? s.raw.split("#")[0]
						: s.raw;
			if (seen.has(identity)) {
				duplicates++;
				return;
			}
			seen.add(identity);
			servers.push(s);
		} catch {
			invalid++;
		}
	}
	if (/^[a-zA-Z0-9+/_=\s-]+$/.test(body) && body) {
		try {
			body = decode(body).trim();
			format = "Base64";
		} catch {
			/* possibly malformed text */
		}
	}
	if (/^\[Interface\]/im.test(body)) {
		format = "WireGuard";
		const [head, ...peers] = body.split(/^\[Peer\]\s*$/im);
		for (const peer of peers)
			add(() => {
				const endpoint = peer.match(/^Endpoint\s*=\s*(\S+)\s*$/im)?.[1];
				if (!endpoint || !/^PublicKey\s*=\s*\S+/im.test(peer)) throw Error();
				const u = new URL("tcp://" + endpoint);
				return server(
					"wireguard",
					u.hostname,
					u.port,
					"",
					head + "[Peer]\n" + peer,
				);
			});
	} else if (
		body.startsWith("{") ||
		body.startsWith("[") ||
		/^proxies\s*:/m.test(body)
	) {
		let root: unknown;
		if (/^[{[]/.test(body)) root = boundedJson(body);
		else {
			const doc = parseDocument(body, {
				schema: "core",
				strict: true,
				uniqueKeys: true,
			});
			if (doc.errors.length || doc.warnings.length) throw Error("yaml");
			let nodes = 0;
			visit(doc, (_k, node, path) => {
				if (
					++nodes > 180000 ||
					path.length > 48 ||
					isAlias(node) ||
					(isNode(node) && node.tag)
				)
					throw Error("yaml");
			});
			root = doc.toJS({ maxAliasCount: 0 });
		}
		const r = obj(root),
			rows = Array.isArray(root)
				? root
				: (r.proxies ??
					(Array.isArray(r.outbounds) || Array.isArray(r.endpoints)
						? [
								...(Array.isArray(r.outbounds) ? r.outbounds : []),
								...(Array.isArray(r.endpoints) ? r.endpoints : []),
							]
						: r.protocol || r.type
							? [r]
							: undefined));
		if (!Array.isArray(rows) || rows.length > MAX_ROWS) throw Error("format");
		format = r.proxies
			? "Clash/Mihomo"
			: rows.some((x) => obj(x).protocol)
				? "Xray JSON"
				: "sing-box JSON";
		for (const row of rows) {
			const v = obj(row),
				p = protocol(str(v.protocol ?? v.type)),
				settings = obj(v.settings);
			if (
				[
					"direct",
					"block",
					"dns",
					"freedom",
					"blackhole",
					"selector",
					"urltest",
				].includes(p)
			)
				continue;
			const endpoints = settings.vnext ?? settings.servers;
			const list = Array.isArray(endpoints) ? endpoints : [v];
			for (const ep of list)
				add(() => {
					const e = obj(ep),
						stream = obj(v.streamSettings);
					return server(
						p,
						e.address ?? e.server,
						e.port ?? e.server_port,
						v.name ?? v.tag,
						JSON.stringify(
							Array.isArray(endpoints)
								? {
										...v,
										settings: {
											...settings,
											[settings.vnext ? "vnext" : "servers"]: [ep],
										},
									}
								: v,
						),
						str(stream.network ?? v.network ?? obj(v.transport).type),
						str(stream.security) ||
							(v.tls === true || obj(v.tls).enabled ? "tls" : ""),
						str(v.country),
					);
				});
		}
	} else
		for (const line of body.split(/\r?\n/)) {
			const raw = line.trim();
			if (raw && !raw.startsWith("#")) add(() => uri(raw));
		}
	return { format, servers, invalid, duplicates };
}
