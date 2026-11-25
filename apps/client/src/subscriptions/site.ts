import { isTauri, invoke } from "@tauri-apps/api/core";
export async function openSite(raw: string) {
	const url = new URL(raw);
	if (url.protocol !== "https:" || url.username || url.password)
		throw Error("url");
	if (isTauri()) await invoke("library_site", { url: url.href });
	else window.open(url.href, "_blank", "noopener,noreferrer");
}
