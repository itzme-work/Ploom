import LibraryWorker from "./worker.ts?worker&inline";
import { create } from "zustand";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { empty, reconcile, type Library, type Subscription } from "./library";
import { load, save } from "./vault";
import type { Preview } from "./parser";
export const useLibrary = create<{
	data: Library;
	unlocked: boolean;
	error: boolean;
}>(() => ({ data: empty(), unlocked: false, error: false }));
let password = "",
	revision = 0,
	queue = Promise.resolve();
export async function unlock(secret?: string) {
	const key = secret ?? (await invoke<{ key: string }>("library_key")).key;
	const loaded = await load(key);
	password = key;
	revision = loaded.rev;
	useLibrary.setState({ data: loaded.data, unlocked: true, error: false });
}
export function change(fn: (data: Library) => void) {
	const op = queue.then(async () => {
		if (!password) throw Error("locked");
		const data = structuredClone(useLibrary.getState().data);
		fn(data);
		if (
			!data.subscriptions.some(
				(s) =>
					s.enabled &&
					s.entries.some((e) => e.id === data.selected && !e.hidden),
			)
		)
			data.selected = "";
		await save(data, password, revision);
		revision++;
		useLibrary.setState({ data });
	});
	queue = op.catch(() => {});
	return op;
}
export function parse(text: string): Promise<Preview> {
	return new Promise((ok, no) => {
		const worker = new LibraryWorker();
		const timer = setTimeout(() => {
			worker.terminate();
			no(Error("limit"));
		}, 15000);
		worker.onmessage = (e) => {
			clearTimeout(timer);
			worker.terminate();
			if (e.data) ok(e.data);
			else no(Error("format"));
		};
		worker.onerror = () => {
			clearTimeout(timer);
			worker.terminate();
			no(Error("format"));
		};
		worker.postMessage(text);
	});
}
export type Feed = {
	etag?: string;
	modified?: string;
	text: string;
	traffic: string;
	site: string;
	title: string;
};
export function fetchFeed(url: string) {
	return invoke<Feed>("subscription_fetch", { url });
}
const active = new Set<string>();
export async function refresh(s: Subscription) {
	if (active.has(s.id) || !s.url || !s.enabled) return;
	active.add(s.id);
	try {
		const feed = await invoke<Feed | { unchanged: true }>(
			"subscription_fetch",
			{ url: s.url, etag: s.etag, modified: s.modified },
		);
		if ("unchanged" in feed) {
			if (!s.etag && !s.modified) throw Error("http");
			await change((data) => {
				const current = data.subscriptions.find(
					(x) => x.id === s.id && x.enabled && x.url === s.url,
				);
				if (current) current.updated = Date.now();
			});
			return;
		}
		const preview = await parse(feed.text);
		if (!preview.servers.length || preview.invalid) throw Error("format");
		await change((data) => {
			const sub = data.subscriptions.find((x) => x.id === s.id);
			if (!sub || !sub.enabled || sub.url !== s.url) return;
			Object.assign(sub, {
				entries: reconcile(sub.entries, preview.servers),
				etag: feed.etag,
				modified: feed.modified,
				traffic: feed.traffic,
				site: feed.site,
				updated: Date.now(),
			});
		});
	} finally {
		active.delete(s.id);
	}
}
export function startLibrary() {
	if (!isTauri()) return () => {};
	let closed = false,
		running = false;
	const attempted = new Map<string, number>();
	async function tick(start = false) {
		if (closed || running || document.hidden) return;
		running = true;
		try {
			for (const s of useLibrary.getState().data.subscriptions) {
				if (closed) break;
				const due =
					s.interval === -1
						? start
						: s.interval > 0 &&
							Date.now() - Math.max(s.updated, attempted.get(s.id) ?? 0) >=
								s.interval * 60000;
				if (s.enabled && s.url && due) {
					attempted.set(s.id, Date.now());
					try {
						await refresh(s);
					} catch {
						useLibrary.setState({ error: true });
					}
				}
			}
		} finally {
			running = false;
		}
	}
	void unlock()
		.then(() => tick(true))
		.catch(() => useLibrary.setState({ error: true }));
	const resume = () => void tick();
	const timer = setInterval(resume, 60000);
	document.addEventListener("visibilitychange", resume);
	return () => {
		closed = true;
		clearInterval(timer);
		document.removeEventListener("visibilitychange", resume);
	};
}
