import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
	change,
	fetchFeed,
	parse,
	refresh,
	unlock,
	useLibrary,
	type Feed,
} from "./manager";
import { reconcile, usage, type Entry, type Subscription } from "./library";
import { MAX_BYTES, type Preview } from "./parser";
import { open, seal } from "./vault";

type Props = { ru: boolean };
export async function download(name: string, text: string) {
	if (isTauri()) {
		await invoke("library_export", { name, text });
		return;
	}
	const url = URL.createObjectURL(
			new Blob([text], { type: "application/octet-stream" }),
		),
		a = document.createElement("a");
	a.href = url;
	a.download = name;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function qr(file: File) {
	if (file.size > MAX_BYTES) throw Error();
	const bitmap = await createImageBitmap(file);
	try {
		const ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height)),
			canvas = document.createElement("canvas");
		canvas.width = Math.ceil(bitmap.width * ratio);
		canvas.height = Math.ceil(bitmap.height * ratio);
		const ctx = canvas.getContext("2d")!;
		ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
		const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
		const code = (await import("jsqr")).default(
			pixels.data,
			pixels.width,
			pixels.height,
		);
		if (!code) throw Error();
		return code.data;
	} finally {
		bitmap.close();
	}
}
export function Subscriptions({
	ru,
	incoming,
	consumed,
}: Props & { incoming: string; consumed: () => void }) {
	const t = (r: string, e: string) => (ru ? r : e);
	const { data, unlocked, error } = useLibrary();
	const [text, setText] = useState(""),
		[url, setUrl] = useState(""),
		[name, setName] = useState(""),
		[pass, setPass] = useState(""),
		[msg, status] = useState(""),
		[busy, working] = useState(false);
	const [preview, setPreview] = useState<Preview>(),
		[feed, setFeed] = useState<Feed>(),
		[selected, select] = useState<Set<number>>(new Set()),
		[limit, more] = useState(100);
	useEffect(() => {
		if (incoming) {
			setUrl(incoming);
			setText("");
			setPreview(undefined);
			setFeed(undefined);
			consumed();
		}
	}, [incoming, consumed]);
	const run = async (f: () => Promise<void>) => {
		if (busy) return;
		working(true);
		status("");
		try {
			await f();
		} catch {
			status(
				t(
					"Операция не выполнена. Проверьте источник, пароль или доступную память.",
					"Operation failed. Check the source, password or available storage.",
				),
			);
		} finally {
			working(false);
		}
	};
	const update = (id: string, fn: (s: Subscription) => void) =>
		change((d) => {
			const s = d.subscriptions.find((x) => x.id === id);
			if (s) fn(s);
		});
	const inspect = async (input: string, remote: string) => {
		setPreview(undefined);
		const f = remote ? await fetchFeed(remote) : undefined,
			p = await parse(f?.text ?? input);
		setPreview(p);
		setFeed(f);
		select(new Set(p.servers.map((_, i) => i)));
		more(100);
		if (!name) setName(f?.title || (remote ? new URL(remote).hostname : ""));
	};
	const clear = () => {
		setPreview(undefined);
		setFeed(undefined);
	};
	return (
		<>
			<section>
				<h2>{t("Импорт подписки", "Import subscription")}</h2>
				{!unlocked && (
					<label>
						{t("Пароль библиотеки", "Library password")}
						<input
							type="password"
							value={pass}
							onChange={(e) => setPass(e.target.value)}
						/>
						<button
							disabled={busy}
							onClick={() =>
								run(async () => {
									if (isTauri()) await unlock();
									else {
										if (pass.length < 12) throw Error();
										await unlock(pass);
									}
									setPass("");
								})
							}
						>
							{t("Открыть", "Unlock")}
						</button>
					</label>
				)}
				<fieldset disabled={busy}>
					<label>
						{t("Название", "Name")}
						<input value={name} onChange={(e) => setName(e.target.value)} />
					</label>
					<label>
						{t("Ссылка подписки", "Subscription URL")}
						<input
							type="password"
							autoComplete="off"
							value={url}
							onChange={(e) => {
								setUrl(e.target.value);
								clear();
							}}
						/>
					</label>
					<label>
						{t("Конфигурации", "Configurations")}
						<textarea
							spellCheck={false}
							value={text}
							onChange={(e) => {
								setText(e.target.value);
								setUrl("");
								clear();
							}}
						/>
					</label>
					<button
						onClick={() =>
							run(async () => {
								const content = await navigator.clipboard.readText();
								clear();
								if (/^https:\/\/\S+$/.test(content.trim()))
									setUrl(content.trim());
								else {
									setText(content);
									setUrl("");
								}
							})
						}
					>
						{t("Вставить", "Paste")}
					</button>
					<label>
						{t("Файл или изображение QR", "File or QR image")}
						<input
							type="file"
							onChange={(e) => {
								const f = e.target.files?.[0];
								if (f)
									void run(async () => {
										if (f.size > MAX_BYTES) throw Error();
										const content = f.type.startsWith("image/")
											? await qr(f)
											: await f.text();
										clear();
										if (
											f.type.startsWith("image/") &&
											/^https:\/\/\S+$/.test(content.trim())
										) {
											setUrl(content.trim());
											setText("");
										} else {
											setText(content);
											setUrl("");
										}
									});
							}}
						/>
					</label>
					<button onClick={() => run(() => inspect(text, url))}>
						{t("Предпросмотр", "Preview")}
					</button>
					{preview && (
						<>
							<p>
								{preview.format} · {preview.servers.length}{" "}
								{t("корректных", "valid")} · {preview.invalid}{" "}
								{t("повреждённых", "invalid")} · {preview.duplicates}{" "}
								{t("дубликатов", "duplicates")}
							</p>
							<button
								onClick={() =>
									select(
										selected.size
											? new Set()
											: new Set(preview.servers.map((_, i) => i)),
									)
								}
							>
								{t("Выбрать все / снять", "Select all / clear")}
							</button>
							{preview.servers.slice(0, limit).map((s, i) => (
								<label key={i}>
									{s.name} · {s.protocol}
									<input
										type="checkbox"
										checked={selected.has(i)}
										onChange={() => {
											const next = new Set(selected);
											if (next.has(i)) next.delete(i);
											else next.add(i);
											select(next);
										}}
									/>
								</label>
							))}
							{limit < preview.servers.length && (
								<button onClick={() => more(limit + 100)}>
									{t("Ещё", "More")}
								</button>
							)}
							<button
								disabled={!unlocked || !selected.size}
								onClick={() =>
									run(async () => {
										const entries = reconcile(
											[],
											preview.servers.filter((_, i) => selected.has(i)),
										);
										await change((d) =>
											d.subscriptions.push({
												id: crypto.randomUUID(),
												entries,
												name:
													name.trim() ||
													t("Локальная подписка", "Local subscription"),
												url,
												enabled: true,
												interval: 0,
												updated: Date.now(),
												traffic: feed?.traffic ?? "",
												site: feed?.site ?? "",
											}),
										);
										clear();
										setUrl("");
										setText("");
										setName("");
									})
								}
							>
								{t("Импортировать", "Import")} ({selected.size})
							</button>
						</>
					)}
				</fieldset>
				<output>
					{msg ||
						(error
							? t("Ошибка хранилища или обновления", "Storage or refresh error")
							: "")}
				</output>
			</section>
			{data.subscriptions.length > 0 && (
				<section>
					<button
						disabled={busy}
						onClick={() =>
							run(async () => {
								let ok = 0,
									failed = 0;
								for (const s of data.subscriptions.filter(
									(x) => x.url && x.enabled,
								)) {
									try {
										await refresh(s);
										ok++;
									} catch {
										failed++;
									}
									status(ok + " ✓ · " + failed + " ×");
								}
							})
						}
					>
						{t("Обновить все подписки", "Refresh all subscriptions")}
					</button>
				</section>
			)}
			{data.subscriptions.map((s, i) => {
				const u = usage(s.traffic),
					na = t("Нет данных", "No data");
				return (
					<section key={s.id}>
						<h2>{s.name}</h2>
						<p>
							{s.entries.length} ·{" "}
							{s.enabled
								? t("Включена", "Enabled")
								: t("Отключена", "Disabled")}{" "}
							· {new Date(s.updated).toLocaleString()}
						</p>
						<p>
							{t(
								"Использовано / лимит / остаток (байт)",
								"Used / limit / remaining (bytes)",
							)}
							: {u.used ?? na} / {u.total ?? na} / {u.remaining ?? na}
						</p>
						<p>
							{t("Срок", "Expiry")}:{" "}
							{u.expire ? new Date(u.expire * 1000).toLocaleDateString() : na}
						</p>
						<fieldset disabled={busy}>
							<button
								disabled={!s.url || !s.enabled}
								onClick={() => run(() => refresh(s))}
							>
								{t("Обновить", "Refresh")}
							</button>
							<button
								onClick={() =>
									run(() =>
										update(s.id, (x) => {
											x.enabled = !x.enabled;
										}),
									)
								}
							>
								{s.enabled
									? t("Отключить", "Disable")
									: t("Включить", "Enable")}
							</button>
							<button
								disabled={!i}
								onClick={() =>
									run(() =>
										change((d) => {
											const a = d.subscriptions;
											a.splice(i - 1, 0, ...a.splice(i, 1));
										}),
									)
								}
							>
								↑
							</button>
							<details>
								<summary>
									{t("Сведения и управление", "Details and actions")}
								</summary>
								<label>
									{t("Название", "Name")}
									<input
										defaultValue={s.name}
										onBlur={(e) => {
											const v = e.target.value.trim();
											if (v && v !== s.name)
												void run(() =>
													update(s.id, (x) => {
														x.name = v;
													}),
												);
										}}
									/>
								</label>
								<label>
									{t("Новая ссылка HTTPS", "New HTTPS URL")}
									<input
										type="password"
										onBlur={(e) => {
											const v = e.target.value.trim();
											if (v)
												void run(async () => {
													if (new URL(v).protocol !== "https:") throw Error();
													await update(s.id, (x) => {
														x.url = v;
													});
												});
										}}
									/>
								</label>
								<label>
									{t("Обновление", "Refresh")}
									<select
										value={s.interval}
										onChange={(e) =>
											run(() =>
												update(s.id, (x) => {
													x.interval = Number(e.target.value);
												}),
											)
										}
									>
										{[0, -1, 15, 60, 360, 720, 1440].map((v) => (
											<option key={v} value={v}>
												{v === 0
													? t("Вручную", "Manual")
													: v === -1
														? t("При запуске", "On launch")
														: v + " min"}
											</option>
										))}
									</select>
								</label>
								{s.url && (
									<button
										onClick={() =>
											run(async () => {
												if (
													confirm(
														t(
															"Ссылка может содержать секрет. Копировать?",
															"This URL can contain credentials. Copy?",
														),
													)
												)
													await navigator.clipboard.writeText(s.url);
											})
										}
									>
										{t("Копировать ссылку", "Copy URL")}
									</button>
								)}
								{/^https:\/\//i.test(s.site) && (
									<a href={s.site} target="_blank" rel="noreferrer">
										{t("Сайт провайдера", "Provider website")}
									</a>
								)}
								<button
									onClick={() =>
										run(async () => {
											if (
												confirm(
													t(
														"Удалить подписку и её серверы?",
														"Delete the subscription and its servers?",
													),
												)
											)
												await change((d) => {
													d.subscriptions = d.subscriptions.filter(
														(x) => x.id !== s.id,
													);
												});
										})
									}
								>
									{t("Удалить", "Delete")}
								</button>
							</details>
						</fieldset>
					</section>
				);
			})}
			{unlocked && (
				<section>
					<details>
						<summary>{t("Резервная копия", "Backup")}</summary>
						<label>
							{t(
								"Отдельный пароль копии (12+ символов)",
								"Backup password (12+ characters)",
							)}
							<input
								type="password"
								value={pass}
								onChange={(e) => setPass(e.target.value)}
							/>
						</label>
						<button
							onClick={() =>
								run(async () => {
									if (pass.length < 12) throw Error();
									await download(
										"ploom-backup.json",
										JSON.stringify(await seal(data, pass)),
									);
									setPass("");
								})
							}
						>
							{t("Сохранить копию", "Save backup")}
						</button>
						<input
							type="file"
							aria-label={t("Восстановить копию", "Restore backup")}
							onChange={(e) => {
								const f = e.target.files?.[0];
								if (f)
									void run(async () => {
										if (f.size > 45 * 1024 * 1024) throw Error();
										const restored = await open(
											JSON.parse(await f.text()),
											pass,
										);
										if (
											confirm(
												t(
													"Заменить библиотеку этой копией?",
													"Replace the library with this backup?",
												),
											)
										)
											await change((d) => Object.assign(d, restored));
										setPass("");
									});
							}}
						/>
					</details>
				</section>
			)}
		</>
	);
}
export function Servers({ ru }: Props) {
	const t = (r: string, e: string) => (ru ? r : e);
	const { data } = useLibrary(),
		[query, search] = useState(""),
		[protocol, filter] = useState(""),
		[subId, group] = useState(""),
		[country, region] = useState(""),
		[fav, favorites] = useState(false),
		[availability, available] = useState(""),
		[sort, order] = useState("manual"),
		[limit, more] = useState(80),
		[msg, status] = useState(""),
		[seconds, timeout] = useState(4),
		[busy, working] = useState(false);
	const canceled = useRef(false);
	useEffect(
		() => () => {
			canceled.current = true;
		},
		[],
	);
	const all = data.subscriptions
		.filter((s) => s.enabled)
		.flatMap((sub) =>
			sub.entries.filter((e) => !e.hidden).map((e) => ({ e, sub })),
		);
	const rows = all.filter(
		({ e, sub }) =>
			(!fav || e.favorite) &&
			(!country || e.country === country) &&
			(!protocol || e.protocol === protocol) &&
			(!subId || sub.id === subId) &&
			(!availability || (e.diagnosis?.result ?? "unknown") === availability) &&
			[e.alias, e.name, e.country, e.protocol, sub.name, e.host]
				.join(" ")
				.toLowerCase()
				.includes(query.toLowerCase()),
	);
	if (sort !== "manual")
		rows.sort((a, b) =>
			sort === "name"
				? (a.e.alias ?? a.e.name).localeCompare(b.e.alias ?? b.e.name)
				: sort === "sub"
					? a.sub.name.localeCompare(b.sub.name)
					: sort === "date"
						? b.e.added - a.e.added
						: (a.e.diagnosis?.ms ?? Infinity) - (b.e.diagnosis?.ms ?? Infinity),
		);
	const act = async (f: () => Promise<unknown>) => {
		try {
			await f();
		} catch {
			status(t("Операция не выполнена", "Operation failed"));
		}
	};
	const edit = (sid: string, id: string, fn: (e: Entry) => void) =>
		change((d) => {
			const e = d.subscriptions
				.find((x) => x.id === sid)
				?.entries.find((x) => x.id === id);
			if (e) fn(e);
		});
	const udp = (e: Entry) =>
		["wireguard", "hysteria2", "tuic"].includes(e.protocol) ||
		["quic", "kcp", "mkcp"].includes(e.transport);
	async function probe(items: typeof rows) {
		if (busy || !isTauri()) return;
		working(true);
		canceled.current = false;
		let i = 0,
			done = 0;
		const results = new Map<string, NonNullable<Entry["diagnosis"]>>();
		try {
			await Promise.all(
				Array.from({ length: 3 }, async () => {
					while (!canceled.current && i < items.length) {
						const { e } = items[i++];
						let result = "unsupported",
							ms: number | undefined;
						if (!udp(e))
							try {
								ms = await invoke<number>("subscription_probe", {
									host: e.host,
									port: e.port,
									seconds,
								});
								result = "tcp";
							} catch (err) {
								result = ["address", "dns", "timeout", "tcp", "busy"].includes(
									String(err),
								)
									? "error-" + String(err)
									: "error";
							}
						results.set(e.id, { at: Date.now(), result, ms });
						status(++done + " / " + items.length);
					}
				}),
			);
			await change((d) => {
				for (const s of d.subscriptions)
					for (const e of s.entries) {
						const r = results.get(e.id);
						if (r) e.diagnosis = r;
					}
			});
		} finally {
			working(false);
		}
	}
	return (
		<>
			<section>
				<label>
					{t("Поиск", "Search")}
					<input
						value={query}
						onChange={(e) => {
							search(e.target.value);
							more(80);
						}}
					/>
				</label>
				{[
					[
						protocol,
						filter,
						all.map((x) => x.e.protocol),
						t("Протокол", "Protocol"),
					],
					[
						country,
						region,
						all.map((x) => x.e.country).filter(Boolean),
						t("Страна", "Country"),
					],
				].map((item, i) => {
					const [value, set, values, label] = item as [
						string,
						(s: string) => void,
						string[],
						string,
					];
					return (
						<label key={i}>
							{label}
							<select value={value} onChange={(e) => set(e.target.value)}>
								<option value="">{t("Все", "All")}</option>
								{[...new Set(values)].map((v) => (
									<option key={v}>{v}</option>
								))}
							</select>
						</label>
					);
				})}
				<label>
					{t("Подписка", "Subscription")}
					<select value={subId} onChange={(e) => group(e.target.value)}>
						<option value="">{t("Все", "All")}</option>
						{data.subscriptions.map((s) => (
							<option key={s.id} value={s.id}>
								{s.name}
							</option>
						))}
					</select>
				</label>
				<label>
					{t("Доступность", "Availability")}
					<select
						value={availability}
						onChange={(e) => available(e.target.value)}
					>
						{[
							"",
							"unknown",
							"tcp",
							"unsupported",
							"error-tcp",
							"error-dns",
							"error-timeout",
							"error-address",
						].map((v) => (
							<option key={v} value={v}>
								{v || t("Все", "All")}
							</option>
						))}
					</select>
				</label>
				<label>
					{t("Сортировка", "Sort")}
					<select value={sort} onChange={(e) => order(e.target.value)}>
						{["manual", "name", "latency", "date", "sub"].map((v, i) => (
							<option key={v} value={v}>
								{
									(ru
										? [
												"Вручную",
												"Название",
												"Задержка TCP",
												"Дата",
												"Подписка",
											]
										: [
												"Manual",
												"Name",
												"TCP latency",
												"Date",
												"Subscription",
											])[i]
								}
							</option>
						))}
					</select>
				</label>
				<label>
					{t("Избранные", "Favorites")}
					<input
						type="checkbox"
						checked={fav}
						onChange={(e) => favorites(e.target.checked)}
					/>
				</label>
				<label>
					{t("Таймаут TCP (с)", "TCP timeout (s)")}
					<input
						type="number"
						min={1}
						max={15}
						value={seconds}
						onChange={(e) =>
							timeout(Math.max(1, Math.min(15, Number(e.target.value))))
						}
					/>
				</label>
				<button
					disabled={!isTauri() || !rows.length}
					onClick={() =>
						busy ? (canceled.current = true) : void act(() => probe(rows))
					}
				>
					{busy ? t("Отменить", "Cancel") : t("Проверить TCP", "Test TCP")}
				</button>
				<output>{msg}</output>
			</section>
			{!all.length && (
				<section>
					<h2>{t("Список серверов пуст", "No servers yet")}</h2>
				</section>
			)}
			{rows.slice(0, limit).map(({ e, sub }) => (
				<section key={e.id}>
					<h2>{e.alias || e.name}</h2>
					<p>
						{sub.name} · {e.protocol} · {e.host}:{e.port}
					</p>
					<p>
						{[e.transport, e.security, e.country].filter(Boolean).join(" · ")}
					</p>
					<p>
						{e.diagnosis?.ms != null
							? "TCP " + e.diagnosis.ms + " ms"
							: (e.diagnosis?.result ?? t("Не проверен", "Untested"))}
					</p>
					<button
						aria-pressed={data.selected === e.id}
						onClick={() =>
							act(() =>
								change((d) => {
									d.selected = e.id;
								}),
							)
						}
					>
						{t("Выбрать", "Select")}
					</button>
					<button
						aria-pressed={!!e.favorite}
						onClick={() =>
							act(() =>
								edit(sub.id, e.id, (x) => {
									x.favorite = !x.favorite;
								}),
							)
						}
					>
						★
					</button>
					<details>
						<summary>{t("Сведения", "Details")}</summary>
						<label>
							{t("Своё название", "Custom name")}
							<input
								defaultValue={e.alias ?? ""}
								onBlur={(ev) => {
									const value = ev.target.value;
									void act(() =>
										edit(sub.id, e.id, (x) => {
											x.alias = value;
										}),
									);
								}}
							/>
						</label>
						<button
							onClick={() =>
								act(async () => {
									if (
										confirm(
											t(
												"Скопировать секретную конфигурацию?",
												"Copy confidential configuration?",
											),
										)
									)
										await navigator.clipboard.writeText(e.raw);
								})
							}
						>
							{t("Копировать", "Copy")}
						</button>
						<button
							onClick={() => {
								if (
									confirm(
										t(
											"Сохранить незашифрованную конфигурацию?",
											"Save an unencrypted configuration?",
										),
									)
								)
									void act(() => download("ploom-config.txt", e.raw));
							}}
						>
							{t("Экспорт", "Export")}
						</button>
						<button
							onClick={() =>
								act(() =>
									change((d) => {
										d.subscriptions.push({
											id: crypto.randomUUID(),
											name: t("Локальная копия", "Local copy"),
											url: "",
											enabled: true,
											interval: 0,
											updated: Date.now(),
											site: "",
											traffic: "",
											entries: [
												{ ...e, id: crypto.randomUUID(), added: Date.now() },
											],
										});
									}),
								)
							}
						>
							{t("Создать копию", "Make local copy")}
						</button>
						{!sub.url && (
							<label>
								{t("Редактировать конфигурацию", "Edit configuration")}
								<textarea
									defaultValue={e.raw}
									onBlur={(ev) => {
										const value = ev.target.value;
										if (value !== e.raw)
											void act(async () => {
												const p = await parse(value);
												if (p.invalid || p.servers.length !== 1) throw Error();
												await edit(sub.id, e.id, (x) =>
													Object.assign(x, p.servers[0], {
														diagnosis: undefined,
													}),
												);
											});
									}}
								/>
							</label>
						)}
						<button
							onClick={() =>
								act(() =>
									edit(sub.id, e.id, (x) => {
										x.hidden = true;
									}),
								)
							}
						>
							{t("Скрыть", "Hide")}
						</button>
					</details>
				</section>
			))}
			{rows.length > limit && (
				<button onClick={() => more(limit + 80)}>{t("Ещё", "More")}</button>
			)}
		</>
	);
}
