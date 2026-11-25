import type { Server } from "./parser";
export type Entry = Server & {
	id: string;
	alias?: string;
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
	enabled: boolean;
	interval: number;
	updated: number;
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
	const endpoint = (s: Server) =>
		JSON.stringify([s.protocol, s.host, s.port, s.name]);
	const matches = new Map<string, Entry | null>(),
		counts = new Map<string, number>();
	for (const s of old) {
		const k = endpoint(s);
		matches.set(k, matches.has(k) ? null : s);
	}
	for (const s of incoming) {
		const k = endpoint(s);
		counts.set(k, (counts.get(k) ?? 0) + 1);
	}
	const merged: Entry[] = incoming.map((s) => {
		const k = endpoint(s),
			prev = raw.get(s.raw) ?? (counts.get(k) === 1 ? matches.get(k) : null);
		return {
			...(prev ?? { id: crypto.randomUUID(), added: Date.now() }),
			...s,
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
