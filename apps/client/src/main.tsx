import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { House, Layers, Server, Settings, Power } from "lucide-react";
import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import semver from "semver";
import { choices, useSettings } from "./store";
import { checkRelease, current } from "./releases";
import "./style.css";
import { Subscriptions, Servers, download } from "./subscriptions/Screens";
import { usage } from "./subscriptions/library";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { startLibrary, useLibrary } from "./subscriptions/manager";
function App() {
	const library = useLibrary((s) => s.data);
	const selectedSub = library.subscriptions.find(
		(s) => s.enabled && s.entries.some((e) => e.id === library.selected),
	);
	const selectedServer = selectedSub?.entries.find(
		(e) => e.id === library.selected,
	);
	useEffect(startLibrary, []);

	const { prefs: p, set } = useSettings(),
		[page, nav] = useState(0),
		[message, msg] = useState(""),
		[result, show] = useState(""),
		[busy, loading] = useState(false);
	const ru =
			p.language === "Русский" ||
			(p.language === "System" && navigator.language.startsWith("ru")),
		t = (a: string, b: string) => (ru ? a : b);
	const [downloading, setDownloading] = useState(false);
	const android = isTauri() && /Android/.test(navigator.userAgent);
	const [tunnel, setTunnel] = useState("idle");
    const [requesting, request] = useState(false);
    useEffect(() => {
        if (!android) return;
        let alive=true;
        const poll=()=>invoke<{state:string}>("tunnel_state").then(({state})=>{if(alive)setTunnel(state)}).catch(()=>{if(alive)setTunnel("unavailable")});
        void poll();
        const id=setInterval(poll,1500);
        return ()=>{alive=false;clearInterval(id)};
    }, [android]);
    async function toggleTunnel() {
        if (!android || tunnel==="unavailable" || !selectedServer && tunnel!=="tunnel-open") {
            msg(t("Подключение запланировано на следующее крупное обновление.", "VPN support is planned for the next major update."));
            return;
        }
        request(true);
        try {
            if (tunnel==="tunnel-open" || tunnel==="starting") await invoke("tunnel_stop");
            else await invoke("tunnel_start",{raw:selectedServer?.raw});
            msg("");
        } catch(reason) {
            const code=String(reason);
            msg(code==="protocol"||code==="options" ? t("Протокол или параметры пока не поддерживаются.","Protocol or options are not supported yet.") :
                t("Не удалось запустить VPN. Проверьте адрес и системное разрешение.","VPN startup failed. Check the endpoint and system permission."));
        } finally {request(false)}
    }
    const [available, offer] = useState("");
	const pages = [
		t("Главная", "Home"),
		t("Подписки", "Subscriptions"),
		t("Серверы", "Servers"),
		t("Настройки", "Settings"),
	];
	async function check() {
		if (busy) return;
		loading(true);
		show(t("Проверка обновлений…", "Checking for updates…"));
		offer("");
		try {
			const r = await checkRelease(p.channel === "Beta");
			if (r && semver.gt(r.version, current)) offer(r.version);
			localStorage.setItem("ploom.lastCheck", new Date().toISOString());
			show(
				!r
					? t("Релизов пока нет", "No published releases")
					: semver.gt(r.version, current)
						? r.version + " · " + r.notes
						: t("Установлена последняя версия Ploom", "Ploom is up to date"),
			);
		} catch {
			show(t("Не удалось проверить обновления", "Update check failed"));
		} finally {
			loading(false);
		}
	}
	useEffect(() => {
		if (p.automatic === "On") void check();
	}, []);
	useEffect(() => {
		document.documentElement.lang = ru ? "ru" : "en";
		document.documentElement.style.colorScheme =
			p.mode === "System" ? "light dark" : p.mode.toLowerCase();
	}, [p.mode, ru]);
	const labels = [
		"Стиль",
		"Тема",
		"Язык",
		"Акцент",
		"Масштаб",
		"Шрифт",
		"Эффекты",
		"Прозрачность",
		"Анимации",
		"Звуки",
		"Громкость",
		"Набор звуков",
		"Канал",
		"Автопроверка",
	];
	const values: Record<string, string> = {
		System: "Системный",
		Light: "Светлая",
		Dark: "Тёмная",
		Iris: "Ирис",
		Mint: "Мята",
		Amber: "Янтарь",
		Mono: "Моноширинный",
		High: "Высокое",
		Low: "Низкое",
		On: "Вкл.",
		Off: "Выкл.",
		Soft: "Мягкий",
		Stable: "Стабильный",
		Beta: "Бета",
	};
	const [incoming, setIncoming] = useState("");
	useEffect(() => {
		if (!isTauri()) return;
		let alive = true,
			off: (() => void) | undefined;
		const receive = (urls: string[]) => {
			if (!alive) return;
			for (const raw of urls) {
				try {
					if (raw.length > 8192) continue;
					const u = new URL(raw),
						source = u.searchParams.get("url");
					if (
						u.protocol === "ploom:" &&
						u.hostname === "import" &&
						source &&
						new URL(source).protocol === "https:"
					) {
						setIncoming(source);
						nav(1);
						break;
					}
				} catch {
					/* Ignore unknown deep links. */
				}
			}
		};
		void onOpenUrl(receive)
			.then((fn) => {
				if (alive) off = fn;
				else fn();
			})
			.catch(() => {});
		void getCurrent()
			.then((urls) => receive(urls ?? []))
			.catch(() => {});
		return () => {
			alive = false;
			off?.();
		};
	}, []);
	const icons = [House, Layers, Server, Settings];
	return (
		<main
			data-style={p.style}
			data-effects={p.effects}
			data-clear={p.transparency}
			data-motion={p.motion}
			style={
				{
					"--accent": { Mint: "#19745f", Amber: "#885219", Iris: "#6252bb" }[
						p.accent
					],
					fontSize: p.scale,
					fontFamily:
						p.font === "Mono" || p.style === "ASCII" ? "monospace" : undefined,
				} as React.CSSProperties
			}
		>
			<aside>
				<header>
					<img src={new URL("./logo.svg", import.meta.url).href} alt="" />
					Ploom
				</header>
				<nav>
					{pages.map((name, i) => {
						const Icon = icons[i];
						return (
							<button
								key={i}
								aria-current={page === i ? "page" : undefined}
								onClick={() => {
									nav(i);
									msg("");
								}}
							>
								<Icon size={19} />
								{name}
							</button>
						);
					})}
				</nav>
			</aside>
			<article
				className={page === 1 || page === 2 ? "library-layout" : undefined}
			>
				<h1>{pages[page]}</h1>
				{page === 0 ? (
					<>
						<section className="hero">
							<button
								className="power"
								aria-label={tunnel==="tunnel-open" ? t("Отключить","Disconnect") : t("Подключиться","Connect")}
                                disabled={requesting}
                                onClick={()=>void toggleTunnel()}
							>
								<Power size={46} />
							</button>
							<h2>{requesting ? t("Запрос разрешения","Requesting permission") : tunnel==="tunnel-open" ? t("TUN открыт · связь не проверена","TUN open · connectivity unverified") : tunnel==="starting" ? t("Подготовка","Preparing") : tunnel==="error" || tunnel==="revoked" ? t("Ошибка VPN","VPN error") : t("Отключено", "Disconnected")}</h2>
							<p>
								{selectedServer
									? [
											selectedSub?.name,
											selectedServer.alias ?? selectedServer.name,
											selectedServer.protocol,
											selectedServer.diagnosis?.ms != null
												? "TCP " + selectedServer.diagnosis.ms + " ms"
												: "",
										]
											.filter(Boolean)
											.join(" · ")
									: t("Сервер не выбран", "No server selected")}
							</p>
							{selectedSub &&
								usage(selectedSub.traffic).remaining !== undefined && (
									<p>
										{t("Осталось байт", "Remaining bytes")} ·{" "}
										{usage(selectedSub.traffic).remaining}
									</p>
								)}
							<output>{message}</output>
						</section>
						<div className="links">
							{[2, 1].map((i) => (
								<button key={i} onClick={() => nav(i)}>
									{pages[i]} ↗
								</button>
							))}
						</div>
					</>
				) : page === 1 ? (
					<Subscriptions
						ru={ru}
						incoming={incoming}
						consumed={() => setIncoming("")}
					/>
				) : page === 2 ? (
					<Servers ru={ru} />
				) : (
					<>
						<section>
							{(Object.keys(choices) as (keyof typeof choices)[]).map(
								(k, i) => (
									<label key={k}>
										{ru ? labels[i] : k}
										<select
											disabled={k === "channel" && busy}
											value={p[k]}
											onChange={(e) => {
												if (k === "channel") {
													offer("");
													show("");
												}
												set(k, e.target.value);
											}}
										>
											{choices[k].map((v) => (
												<option key={v} value={v}>
													{ru ? (values[v] ?? v) : v}
												</option>
											))}
										</select>
									</label>
								),
							)}
						</section>
						<section>
							<h2>{t("Обновления", "Updates")}</h2>
							<button
								onClick={() =>
									void download(
										"ploom-settings.json",
										JSON.stringify({ version: 1, preferences: p }, null, 2),
									).catch(() => show(t("Ошибка экспорта", "Export failed")))
								}
							>
								{t("Экспорт настроек", "Export preferences")}
							</button>
							<p>
								Ploom {current} · {p.channel}
							</p>
							<p>
								{t("Последняя проверка", "Last checked")} ·{" "}
								{localStorage.getItem("ploom.lastCheck") ?? "—"}
							</p>
							<button disabled={busy} onClick={() => void check()}>
								{busy ? "…" : t("Проверить обновления", "Check for updates")}
							</button>
							<p role="status">{result}</p>
							{available &&
								isTauri() &&
								/Windows|Android/.test(navigator.userAgent) && (
									<button
										disabled={busy}
										onClick={async () => {
											loading(true);
											try {
												setDownloading(true);
												show(t("Загрузка", "Downloading"));
												const progress = new Channel<
													[string, number, number | null]
												>();
												progress.onmessage = ([phase, n, total]) => {
													setDownloading(phase === "download");
													show(
														phase === "verify"
															? t("Проверка подписи", "Verifying signature")
															: phase === "install"
																? t("Установка", "Installing")
																: t("Загрузка", "Downloading") +
																	" · " +
																	(total
																		? Math.floor((100 * n) / total) + "%"
																		: Math.ceil(n / 1024) + " KiB"),
													);
												};
												await invoke("install_update", {
													channel: p.channel,
													expected: available,
													progress,
												});
												show(
													t(
														"Ожидается подтверждение системы",
														"Awaiting system confirmation",
													),
												);
											} catch (error) {
												const detail = String(error);
												if (/Allow installation from Ploom/i.test(detail)) {
													show(
														t(
															"Разрешите установку из Ploom в настройках Android и нажмите «Обновить Ploom» ещё раз.",
															"Allow installs from Ploom in Android settings, then tap Update Ploom again.",
														),
													);
												} else if (
													/signer rejected|signature|unsigned/i.test(detail)
												) {
													show(
														t(
															"Установка остановлена: подпись обновления не прошла проверку.",
															"Installation stopped because the update signature could not be verified.",
														),
													);
												} else if (/Download canceled/i.test(detail)) {
													show(
														t(
															"Загрузка отменена. Можно повторить обновление.",
															"Download canceled. You can retry the update.",
														),
													);
												} else if (/Not enough storage|ENOSPC/i.test(detail)) {
													show(
														t(
															"Недостаточно места. Освободите память и повторите загрузку.",
															"Storage is full. Free some space and retry.",
														),
													);
												} else if (
													/Incomplete APK|Invalid APK|Invalid download size/i.test(
														detail,
													)
												) {
													show(
														t(
															"Файл APK неполный или повреждён. Повторите загрузку.",
															"The APK is incomplete or damaged. Download it again.",
														),
													);
												} else if (
													/Network or file read failed|Download HTTP/i.test(
														detail,
													)
												) {
													show(
														t(
															"Не удалось скачать APK. Проверьте сеть и повторите загрузку.",
															"Could not download the APK. Check the network and retry.",
														),
													);
												} else if (/Incompatible APK version/i.test(detail)) {
													show(
														t(
															"Пакет или версия не подходят для обновления.",
															"This package or version cannot update the installed app.",
														),
													);
												} else if (/signing is not configured/i.test(detail)) {
													show(
														t(
															"Эта сборка не настроена для подписанных обновлений.",
															"This build is not configured for signed updates.",
														),
													);
												} else {
													show(
														t(
															"Не удалось установить обновление. ",
															"Update failed. ",
														) + detail,
													);
												}
											} finally {
												setDownloading(false);
												loading(false);
											}
										}}
									>
										{t("Обновить Ploom", "Update Ploom")}
									</button>
								)}
							{android && downloading && (
								<button
									onClick={() =>
										invoke("cancel_download").catch(() =>
											show(
												t(
													"Не удалось отменить загрузку",
													"Could not cancel download",
												),
											),
										)
									}
								>
									{t("Отменить загрузку", "Cancel download")}
								</button>
							)}
							{android && available && !busy && (
								<button
									onClick={() =>
										invoke("open_update_browser", {
											expected: available,
										}).catch(() =>
											show(
												t(
													"Не удалось открыть браузер",
													"Could not open browser",
												),
											),
										)
									}
								>
									{t("Скачать APK через браузер", "Download APK in browser")}
								</button>
							)}
							<details>
								<summary>{t("Что нового", "What’s new")}</summary>
								{current} · Foundation · Apache-2.0
							</details>
						</section>
					</>
				)}
			</article>
		</main>
	);
}
createRoot(document.getElementById("root")!).render(<App />);
