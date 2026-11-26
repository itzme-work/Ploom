import type { Server } from "./parser";
// Android WebView before Chromium 92 lacks randomUUID but supports Web Crypto.
export function newEntryId(): string {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
    return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join("-");
}
export type Entry = Server & {
	id: string;
	alias?: string;
	note?: string;
	favorite?: boolean;
	hidden?: boolean;
	rank?: number;
	added: number;
	diagnosis?: { at: number; result: string; ms?: number };
};
export type Subscription = {
	id: string;
	name: string;
	url: string;
	entries: Entry[];
	removed?: { entry: Entry; at: number }[];
	enabled: boolean;
	interval: number;
	updated: number;
	profile?: { format: string; source: string };
	etag?: string;
	modified?: string;
	traffic: string;
	site: string;
};
export type Library = {
	version: 1;
	subscriptions: Subscription[];
	selected: string;
};
export const empty = (): Library => ({
	version: 1,
	subscriptions: [],
	selected: "",
});
export function reconcile(old: Entry[], incoming: Server[]): Entry[] {
	const raw = new Map(old.map((s) => [s.raw, s]));
	const used = new Set<string>(),
		matched: (Entry | undefined)[] = incoming.map((s) => {
			const entry = raw.get(s.raw);
			if (entry) used.add(entry.id);
			return entry;
		});
	// Match a changed record only when its endpoint is unique on both sides.
	for (const signature of [(s: Server) => [s.protocol, s.host, s.port]]) {
		const choices = new Map<string, Entry | null>(),
			counts = new Map<string, number>();
		for (const e of old) {
			if (used.has(e.id)) continue;
			const k = JSON.stringify(signature(e));
			choices.set(k, choices.has(k) ? null : e);
		}
		for (let i = 0; i < incoming.length; i++) {
			if (matched[i]) continue;
			const k = JSON.stringify(signature(incoming[i]));
			counts.set(k, (counts.get(k) ?? 0) + 1);
		}
		for (let i = 0; i < incoming.length; i++) {
			if (matched[i]) continue;
			const k = JSON.stringify(signature(incoming[i])),
				entry = choices.get(k);
			if (entry && counts.get(k) === 1) {
				matched[i] = entry;
				used.add(entry.id);
			}
		}
	}
	const merged: Entry[] = incoming.map((s, i) => {
		const prev = matched[i];
		return {
			...(prev ?? { id: newEntryId(), added: Date.now() }),
			...s,
			diagnosis:
				prev?.host === s.host &&
				prev.port === s.port &&
				prev.transport === s.transport
					? prev.diagnosis
					: undefined,
		};
	});
	return old.some((e) => e.rank !== undefined)
		? merged.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity))
		: merged;
}
export function usage(line: string) {
	const out: Record<string, number> = {};
	for (const part of line.split(";")) {
		const m = part.trim().match(/^(upload|download|total|expire)=(\d+)$/i);
		if (m && Number.isSafeInteger(Number(m[2])))
			out[m[1].toLowerCase()] = Number(m[2]);
	}
	const used =
		out.upload !== undefined && out.download !== undefined
			? out.upload + out.download
			: undefined;
	return {
		used,
		total: out.total,
		remaining:
			used !== undefined && out.total !== undefined
				? Math.max(0, out.total - used)
				: undefined,
		expire: out.expire,
	};
}

// Only exact original configurations can reclaim edits from an absent server.
export function refreshEntries(
	sub: Subscription,
	incoming: Server[],
	now = Date.now(),
) {
	const rows = reconcile(sub.entries, incoming);
	const activeIds = new Set(sub.entries.map((e) => e.id));
	const currentIds = new Set(rows.map((e) => e.id));
	const archive = new Map(
		(sub.removed ?? [])
			.filter((r) => r.at >= now - 30 * 86400000)
			.map((r) => [r.entry.raw, r]),
	);
	for (const old of sub.entries) {
		if (
			!currentIds.has(old.id) &&
			(old.alias ||
				old.favorite ||
				old.hidden ||
				old.note ||
				old.rank !== undefined)
		)
			archive.set(old.raw, { entry: old, at: now });
	}
	for (const row of rows) {
		const prior = archive.get(row.raw);
		if (prior && !activeIds.has(row.id) && !currentIds.has(prior.entry.id)) {
			const history = prior.entry;
			Object.assign(row, {
				id: history.id,
				added: history.added,
				alias: history.alias,
				note: history.note,
				favorite: history.favorite,
				hidden: history.hidden,
				rank: history.rank,
			});
			currentIds.add(history.id);
		}
		archive.delete(row.raw);
	}
	if (rows.some((e) => e.rank !== undefined))
		rows.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
	return {
		entries: rows,
		removed: [...archive.values()].sort((a, b) => b.at - a.at).slice(0, 250),
	};
}
