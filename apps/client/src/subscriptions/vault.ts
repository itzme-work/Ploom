import LibraryWorker from "./vault-worker.ts?worker&inline";
import { empty, type Library } from "./library";
import type { Box } from "./crypto";
function crypt<T>(
	op: string,
	value: Box | Library,
	password: string,
): Promise<T> {
	return new Promise((ok, no) => {
		const worker = new LibraryWorker();
		worker.onerror = () => {
			worker.terminate();
			no(Error("storage"));
		};
		worker.onmessage = (e) => {
			worker.terminate();
			if (e.data === null) no(Error("storage"));
			else ok(e.data);
		};
		worker.postMessage({ op, value, password });
	});
}
export const seal = (library: Library, password: string) =>
	crypt<Box>("seal", library, password);
export const open = (box: Box, password: string) =>
	crypt<Library>("open", box, password);
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
