import { empty, type Library } from "./library";
type Box = { v: 1; salt: string; iv: string; body: string };
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
	for (const s of data.subscriptions) {
		if (
			!s ||
			typeof s.id !== "string" ||
			typeof s.name !== "string" ||
			typeof s.url !== "string" ||
			typeof s.enabled !== "boolean" ||
			!Number.isFinite(s.interval) ||
			!Number.isFinite(s.updated) ||
			typeof s.traffic !== "string" ||
			typeof s.site !== "string" ||
			!Array.isArray(s.entries) ||
			s.entries.length > 12000
		)
			throw Error("format");
		for (const e of s.entries)
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
				(e.alias !== undefined && typeof e.alias !== "string")
			)
				throw Error("format");
	}
	return data;
}
let connection: Promise<IDBDatabase> | undefined;
function db() {
	return (connection ??= new Promise<IDBDatabase>((ok, no) => {
		const r = indexedDB.open("ploom.library", 1);
		r.onupgradeneeded = () => r.result.createObjectStore("vault");
		r.onsuccess = () => ok(r.result);
		r.onerror = () => no(Error("storage"));
	}));
}
export async function load(password: string) {
	const database = await db();
	const row = await new Promise<{ rev: number; box: Box } | undefined>(
		(ok, no) => {
			const r = database
				.transaction("vault")
				.objectStore("vault")
				.get("library");
			r.onsuccess = () => ok(r.result);
			r.onerror = () => no(Error("storage"));
		},
	);
	return {
		rev: row?.rev ?? 0,
		data: row ? await open(row.box, password) : empty(),
	};
}
export async function save(data: Library, password: string, rev: number) {
	const box = await seal(data, password),
		database = await db();
	await new Promise<void>((ok, no) => {
		const tx = database.transaction("vault", "readwrite"),
			store = tx.objectStore("vault"),
			r = store.get("library");
		r.onsuccess = () => {
			if ((r.result?.rev ?? 0) !== rev) {
				tx.abort();
				return;
			}
			store.put({ rev: rev + 1, box }, "library");
		};
		tx.oncomplete = () => ok();
		tx.onabort = tx.onerror = () => no(Error("storage conflict"));
	});
}
