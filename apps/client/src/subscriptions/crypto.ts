import { empty, type Library } from "./library";
export type Box = { v: 1; salt: string; iv: string; body: string };
const encode = (b: Uint8Array) => {
	let s = "";
	for (let i = 0; i < b.length; i += 8192)
		s += String.fromCharCode(...b.subarray(i, i + 8192));
	return btoa(s);
};
const decode = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function key(password: string, salt: Uint8Array<ArrayBuffer>) {
	const root = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(password),
		"PBKDF2",
		false,
		["deriveKey"],
	);
	return crypto.subtle.deriveKey(
		{ name: "PBKDF2", hash: "SHA-256", iterations: 600000, salt },
		root,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
}
export async function seal(data: Library, password: string): Promise<Box> {
	const salt = crypto.getRandomValues(new Uint8Array(16)),
		iv = crypto.getRandomValues(new Uint8Array(12));
	const bytes = new TextEncoder().encode(JSON.stringify(data));
	if (bytes.length > 32 * 1024 * 1024) throw Error("size");
	const encrypted = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		await key(password, salt),
		bytes,
	);
	return {
		v: 1,
		salt: encode(salt),
		iv: encode(iv),
		body: encode(new Uint8Array(encrypted)),
	};
}
export async function open(box: Box, password: string): Promise<Library> {
	if (
		box.v !== 1 ||
		typeof box.body !== "string" ||
		box.body.length > 45 * 1024 * 1024 ||
		box.iv?.length !== 16 ||
		box.salt?.length !== 24
	)
		throw Error("format");
	const clear = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: decode(box.iv) },
		await key(password, decode(box.salt)),
		decode(box.body),
	);
	const data = JSON.parse(new TextDecoder().decode(clear));
	if (
		data.version !== 1 ||
		!Array.isArray(data.subscriptions) ||
		typeof data.selected !== "string"
	)
		throw Error("format");
	const identifiers = new Set<string>();
	for (const s of data.subscriptions) {
		if (
			!s ||
			typeof s.id !== "string" ||
			typeof s.name !== "string" ||
			typeof s.url !== "string" ||
			typeof s.enabled !== "boolean" ||
			![0, -1, 15, 60, 360, 720, 1440].includes(s.interval) ||
			!Number.isFinite(s.updated) ||
			typeof s.traffic !== "string" ||
			typeof s.site !== "string" ||
			!Array.isArray(s.entries) ||
			s.entries.length > 12000
		)
			throw Error("format");
		if (identifiers.has(s.id)) throw Error("duplicate");
		identifiers.add(s.id);
		for (const e of s.entries) {
			if (
				!e ||
				[
					"id",
					"name",
					"protocol",
					"host",
					"raw",
					"security",
					"country",
					"transport",
				].some((k) => typeof e[k] !== "string") ||
				!Number.isInteger(e.port) ||
				e.port < 1 ||
				e.port > 65535 ||
				!Number.isFinite(e.added) ||
				identifiers.has(e.id) ||
				(e.hidden !== undefined && typeof e.hidden !== "boolean") ||
				(e.favorite !== undefined && typeof e.favorite !== "boolean") ||
				(e.rank !== undefined && !Number.isFinite(e.rank)) ||
				(e.diagnosis !== undefined &&
					(!e.diagnosis ||
						!Number.isFinite(e.diagnosis.at) ||
						typeof e.diagnosis.result !== "string" ||
						(e.diagnosis.ms !== undefined &&
							!Number.isFinite(e.diagnosis.ms)))) ||
				(e.note !== undefined &&
					(typeof e.note !== "string" || e.note.length > 2048)) ||
				(e.alias !== undefined && typeof e.alias !== "string")
			)
				throw Error("format");
			identifiers.add(e.id);
		}
	}
	return data;
}
