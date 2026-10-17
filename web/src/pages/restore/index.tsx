import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { App, Drawer } from "antd";
import { Link } from "react-router-dom";
import { presets, restorationPrompt } from "./presets";
import { Aperture, ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Check, ChevronRight, Clock3, FolderOpen, ImagePlus, Film, LoaderCircle, Settings2, ShieldCheck, WandSparkles } from "lucide-react";
import localforage from "localforage";
import { nanoid } from "nanoid";
import { saveAs } from "file-saver";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { requestEdit } from "@/services/api/image";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import { defaultBaseUrlForApiFormat, encodeChannelModel, modelOptionsFromChannels, resolveModelChannel, selectableModelsByCapability, useConfigStore, type ApiCallFormat, type ModelChannel } from "@/stores/use-config-store";
import { alignPhotoPreview, unchangedAlignment, type PreviewAlignment } from "./preview-alignment";


type Photo = { id: string; name: string; dataUrl: string; storageKey?: string; width: number; height: number; mimeType: string };
type Session = { original: Photo; result: Photo | null; preset: string; instructions: string; preserve: boolean };
type RecordItem = Session & { id: string; createdAt: number };
const sessionStore = localforage.createInstance({ name: "photo-restore", storeName: "session" });
const historyStore = localforage.createInstance({ name: "photo-restore", storeName: "history" });
const supportedTypes = ["image/jpeg", "image/png", "image/webp", "image/bmp"];

async function readPhoto(file: Blob | string, name: string): Promise<Photo> {
    const stored = await uploadImage(file);
    if (!stored.storageKey) throw new Error("已收到图片，但无法保存到本机。请检查服务商返回图片的下载权限。");
    return { id: nanoid(), name, dataUrl: stored.url, storageKey: stored.storageKey, width: stored.width, height: stored.height, mimeType: stored.mimeType };
}
async function hydratePhoto(photo: Photo) { return { ...photo, dataUrl: await resolveImageUrl(photo.storageKey, photo.dataUrl) }; }
function storedPhoto(photo: Photo): Photo { return { ...photo, dataUrl: photo.storageKey ? "" : photo.dataUrl }; }
function serialize(session: Session): Session { return { ...session, original: storedPhoto(session.original), result: session.result ? storedPhoto(session.result) : null }; }

export default function RestorePage() {
    const { message } = App.useApp();
    const config = useConfigStore(state => state.config);
    const fileInput = useRef<HTMLInputElement>(null);
    const projectInput = useRef<HTMLInputElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
    const [alignment, setAlignment] = useState<{ pair: string; transform: PreviewAlignment }>({ pair: "", transform: unchangedAlignment });
    const [original, setOriginal] = useState<Photo | null>(null);
    const [result, setResult] = useState<Photo | null>(null);
    const [preset, setPreset] = useState("restore");
    const [instructions, setInstructions] = useState("");
    const [preserve, setPreserve] = useState(true);
    const [loaded, setLoaded] = useState(false);
    const [running, setRunning] = useState(false);
    const [error, setError] = useState("");
    const [dragging, setDragging] = useState(false);
    const [split, setSplit] = useState(50);
    const [view, setView] = useState<"original" | "result" | "compare">("compare");
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [records, setRecords] = useState<RecordItem[]>([]);
    const [draft, setDraft] = useState<ModelChannel | null>(null);
    const [draftModel, setDraftModel] = useState("");
    const imageModels = selectableModelsByCapability(config, "image");
    const modelValue = config.imageModel;
    const selectedChannel = resolveModelChannel(config, modelValue);
    const configured = imageModels.includes(modelValue) && Boolean(selectedChannel.apiKey.trim() && selectedChannel.baseUrl.trim());
    const photoPair = original && result ? `${original.id}:${result.id}` : "";
    const alignmentReady = !result || alignment.pair === photoPair;
    const fittedScale = original ? Math.min(stageSize.width / original.width, stageSize.height / original.height) : 0;
    const photoFrameStyle = original && fittedScale > 0 ? { width: original.width * fittedScale, height: original.height * fittedScale } : { width: "100%", height: "100%" };

    useLayoutEffect(() => {
        const observer = new ResizeObserver(([entry]) => setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
        if (stageRef.current) observer.observe(stageRef.current);
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        if (!original || !result) return;
        let active = true;
        alignPhotoPreview(original.dataUrl, result.dataUrl).catch(() => unchangedAlignment).then(transform => {
            if (active) setAlignment({ pair: photoPair, transform });
        });
        return () => { active = false; };
    }, [photoPair, original?.dataUrl, result?.dataUrl]);

    function moveDivider(event: PointerEvent<HTMLDivElement>) {
        const bounds = event.currentTarget.getBoundingClientRect();
        if (bounds.width) setSplit(Math.max(0, Math.min(100, Math.round((event.clientX - bounds.left) / bounds.width * 100))));
    }

    useEffect(() => {
        let active = true;
        sessionStore.getItem<Session>("current").then(async saved => {
            if (!saved) return;
            const [source, restored] = await Promise.all([hydratePhoto(saved.original), saved.result ? hydratePhoto(saved.result) : null]);
            if (!active) return;
            setOriginal(source); setResult(restored); setPreset(saved.preset); setInstructions(saved.instructions); setPreserve(saved.preserve);
        }).catch(() => message.error("上次的修复项目未能读取，可重新导入照片。")).finally(() => { if (active) setLoaded(true); });
        return () => { active = false; };
    }, [message]);
    useEffect(() => {
        if (loaded && original) sessionStore.setItem("current", serialize({ original, result, preset, instructions, preserve })).catch(() => message.error("本地保存失败，请导出项目备份。"));
    }, [loaded, original, result, preset, instructions, preserve, message]);

    useEffect(() => {
        if (new URLSearchParams(window.location.search).get("api") === "1") openSettings();
    }, []);

    function openSettings() {
        setDraft({ ...selectedChannel, models: [...selectedChannel.models] });
        setDraftModel(selectedChannel.models.find(item => encodeChannelModel(selectedChannel.id, item.name) === modelValue)?.name || "");
        setSettingsOpen(true);
    }
    function saveSettings() {
        if (!draft || !draftModel.trim()) return message.warning("请填写图像模型名称。");
        try { const url = new URL(draft.baseUrl); if (!["https:", "http:"].includes(url.protocol)) throw new Error(); }
        catch { return message.warning("请填写以 https:// 或 http:// 开头的接口地址。"); }
        if (!draft.apiKey.trim()) return message.warning("请填写 API Key。");
        const next = { ...draft, baseUrl: draft.baseUrl.trim().replace(/\/+$/, ""), apiKey: draft.apiKey.trim(), models: [...draft.models.filter(item => item.name !== draftModel.trim()), { name: draftModel.trim(), capability: "image" as const }] };
        const channels = config.channels.some(item => item.id === next.id) ? config.channels.map(item => item.id === next.id ? next : item) : [...config.channels, next];
        useConfigStore.setState({ config: { ...config, channels, models: modelOptionsFromChannels(channels), imageModel: encodeChannelModel(next.id, draftModel), channelMode: "local" } });
        setSettingsOpen(false); message.success("API 设置已保存");
    }
    async function importPhoto(file?: File) {
        if (!file || running) return;
        setError("");
        if (!supportedTypes.includes(file.type)) return message.warning("请导入 JPG、PNG、WebP 或 BMP 照片。");
        try { setOriginal(await readPhoto(file, file.name)); setResult(null); setView("compare"); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "照片读取失败"); }
    }
    async function restore() {
        if (!original || running) return;
        if (!configured) { openSettings(); return; }
        const controller = new AbortController(); abortRef.current = controller;
        const source = original;
        const prompt = restorationPrompt(preset, instructions, preserve);
        setRunning(true); setError("");
        try {
            const snapshot = { ...config, channels: config.channels.map(channel => ({ ...channel, models: channel.models.map(model => ({ ...model, script: undefined })) })), model: modelValue, count: "1", size: "auto", background: "", systemPrompt: "" };
            const images = await requestEdit(snapshot, prompt, [{ id: source.id, name: source.name, type: source.mimeType, dataUrl: source.dataUrl, storageKey: source.storageKey }], { signal: controller.signal });
            if (!images[0]) throw new Error("API 没有返回修复后的照片。");
            const restored = await readPhoto(images[0].dataUrl, source.name.replace(/\.[^.]+$/, "") + "_修复.png");
            setResult(restored); setView("compare"); setSplit(50);
            const recordId = nanoid();
            await historyStore.setItem(recordId, { id: recordId, createdAt: Date.now(), ...serialize({ original: source, result: restored, preset, instructions, preserve }) });
            message.success("修复完成，拖动分界线查看效果。");
        } catch (cause) {
            setError(controller.signal.aborted ? "已停止等待。服务商可能仍在处理本次请求，请先确认结果再重试。" : cause instanceof Error ? cause.message : "修复失败，请检查 API 设置。");
        } finally { setRunning(false); abortRef.current = null; }
    }
    async function download() {
        if (!result) return;
        const blob = await (await fetch(result.dataUrl)).blob();
        const extension = blob.type.includes("jpeg") ? ".jpg" : blob.type.includes("webp") ? ".webp" : ".png";
        saveAs(blob, (original?.name || "照片").replace(/\.[^.]+$/, "") + "_修复" + extension);
    }
    async function exportProject() {
        if (!original) return;
        try {
            const session = serialize({ original, result, preset, instructions, preserve });
            const files: Record<string, Uint8Array> = { "project.json": strToU8(JSON.stringify({ version: 1, ...session })), "original.bin": new Uint8Array(await (await (await fetch(original.dataUrl)).blob()).arrayBuffer()) };
            if (result) files["result.bin"] = new Uint8Array(await (await (await fetch(result.dataUrl)).blob()).arrayBuffer());
            saveAs(new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: "application/zip" }), original.name.replace(/\.[^.]+$/, "") + ".photo-restore.zip");
        } catch { message.error("项目导出失败，请确认照片仍可读取。"); }
    }
    async function importProject(file?: File) {
        if (!file || running) return;
        try {
            const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
            const saved = JSON.parse(strFromU8(files["project.json"]));
            if (saved.version !== 1 || !files["original.bin"] || !supportedTypes.includes(saved.original?.mimeType)) throw new Error();
            const source = await readPhoto(new Blob([files["original.bin"] as BlobPart], { type: saved.original.mimeType }), saved.original.name);
            const restored = files["result.bin"] ? await readPhoto(new Blob([files["result.bin"] as BlobPart], { type: saved.result?.mimeType || "image/png" }), saved.result?.name || "修复.png") : null;
            setOriginal(source); setResult(restored); setPreset(presets.some(item => item.id === saved.preset) ? saved.preset : "restore"); setInstructions(typeof saved.instructions === "string" ? saved.instructions : ""); setPreserve(saved.preserve !== false); setView("compare"); setError("");
            message.success("修复项目已打开，可以继续修改。");
        } catch { message.error("无法打开该文件，请选择本软件导出的修复项目。"); }
    }
    async function showHistory() {
        try {
            const items: RecordItem[] = [];
            await historyStore.iterate<RecordItem, void>(item => { items.push(item); });
            setRecords(items.sort((a, b) => b.createdAt - a.createdAt)); setHistoryOpen(true);
        } catch { message.error("本地修复记录读取失败。"); }
    }
    async function openRecord(item: RecordItem) {
        try {
            setOriginal(await hydratePhoto(item.original)); setResult(item.result ? await hydratePhoto(item.result) : null);
            setPreset(item.preset); setInstructions(item.instructions); setPreserve(item.preserve); setView("compare"); setHistoryOpen(false); setError("");
        } catch { message.error("这条记录中的照片无法读取。"); }
    }

    return <div className="restore-app">
        <header className="restore-header">
            <div className="restore-brand"><Aperture size={25} strokeWidth={1.6} /><div><strong>照片修复</strong><span>PHOTO RESTORE</span></div></div>
            <nav aria-label="工作台操作">
                <Link className={"quiet-button" + (running ? " disabled-link" : "")} to="/restore/video"><Film size={16} />视频修复</Link>
                <button className="quiet-button" onClick={() => projectInput.current?.click()} disabled={running}><FolderOpen size={16} />打开项目</button>
                <button className="quiet-button" onClick={() => void showHistory()} disabled={running}><Clock3 size={16} />修复记录</button>
                <button className="api-button" onClick={openSettings} disabled={running}><span className={configured ? "status-dot ready" : "status-dot"} /><Settings2 size={15} />API 设置</button>
            </nav>
        </header>
        <main className="restore-main">
            <div className="restore-intro"><div><span className="eyebrow">修复细节，留住记忆</span><h1>让照片，重新清晰。</h1><p>导入照片，选择修复方式，再对比并保存。</p></div><span className="local-note"><ShieldCheck size={16} />本地保存 · 按需修复</span></div>
            <div className="restore-workspace">
                <aside className="restore-controls">
                    <section><h2><span>01</span>导入照片</h2>
                        <button className={"photo-import " + (original ? "has-photo" : "")} onClick={() => fileInput.current?.click()} disabled={running}>
                            {original ? <><img src={original.dataUrl} alt="当前原图缩略图" /><div><strong>{original.name}</strong><span>{original.width} × {original.height}<br />点击更换照片</span></div></> : <><ImagePlus size={25} strokeWidth={1.4} /><strong>选择一张照片</strong><span>JPG、PNG、WebP、BMP</span></>}
                        </button>
                    </section>
                    <section><h2><span>02</span>选择修复方式</h2><div className="preset-list" role="radiogroup" aria-label="修复方式">
                        {presets.map(item => <button key={item.id} role="radio" aria-checked={preset === item.id} className={"preset-button " + (preset === item.id ? "selected" : "")} onClick={() => setPreset(item.id)} disabled={running}><item.icon size={19} strokeWidth={1.5} /><div><strong>{item.title}</strong><span>{item.detail}</span></div><span className="preset-check">{preset === item.id && <Check size={12} />}</span></button>)}
                    </div></section>
                    <section><h2><span>03</span>补充要求<small>选填</small></h2><textarea aria-label="补充修复要求" placeholder="例如：保留黑白效果，只修复划痕。" value={instructions} onChange={event => setInstructions(event.target.value)} disabled={running} rows={3} /><label className="preserve-option"><input type="checkbox" checked={preserve} onChange={event => setPreserve(event.target.checked)} disabled={running} />尽量保留原貌</label></section>
                    {imageModels.length > 1 && <label className="model-label">修复模型<select aria-label="修复模型" value={modelValue} disabled={running} onChange={event => useConfigStore.getState().updateConfig("imageModel", event.target.value)}>{imageModels.map(value => { const channel = resolveModelChannel(config, value); return <option key={value} value={value}>{channel.name} · {value.split("::").slice(1).join("::")}</option>; })}</select></label>}
                    <button className="primary-button restore-start" onClick={() => void restore()} disabled={!original || running}>{running ? <LoaderCircle size={17} className="spin" /> : <WandSparkles size={17} />}{running ? "正在修复…" : "开始修复"}{!running && <ChevronRight size={16} />}</button>
                    <p className="api-hint">{configured ? "点击修复时，照片会发送至所选 API。" : "首次使用，请先在右上角配置修图 API。"}</p>
                    {error && <div role="alert" className="restore-error">{error}<button onClick={openSettings}>检查 API 设置</button></div>}
                </aside>
                <section className="restore-preview" aria-label="照片预览">
                    <div className="preview-toolbar"><span className="preview-heading">{result && !alignmentReady ? "正在对齐预览…" : "照片预览"}</span><div className="preview-tabs" aria-label="预览方式"><button className={view === "original" ? "active" : ""} disabled={!original || running} onClick={() => setView("original")}>原图</button><button className={view === "result" ? "active" : ""} disabled={!result || running || !alignmentReady} onClick={() => setView("result")}>修复后</button><button className={view === "compare" ? "active" : ""} disabled={!result || running || !alignmentReady} onClick={() => setView("compare")}><ArrowLeftRight size={13} />对比</button></div></div>
                    <div ref={stageRef} className={"photo-stage " + (dragging ? "drag-over" : "")} onDragOver={event => { event.preventDefault(); if (!running) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (running) return; const file = event.dataTransfer.files[0]; if (file?.name.endsWith(".zip")) void importProject(file); else void importPhoto(file); }}>
                        {!original ? <div className="preview-empty"><div className="empty-image-icon"><ImagePlus size={32} strokeWidth={1} /></div><h3>从一张照片开始</h3><p>把照片拖到这里，或从电脑中选择</p><button className="outline-button" onClick={() => fileInput.current?.click()}><ArrowUpFromLine size={15} />导入照片</button><span>原图会保留，修复结果单独保存</span></div> : <>
                            <div className="photo-frame" style={photoFrameStyle}>
                                <img className="stage-image" draggable={false} src={original.dataUrl} alt="修复前的原图" />
                                {result && alignmentReady && view !== "original" && <img className="stage-image restored-preview" draggable={false} src={result.dataUrl} style={{ transform: `translate(${alignment.transform.x * 100}%, ${alignment.transform.y * 100}%) scale(${alignment.transform.scale})` }} alt="修复后的照片" />}
                                {result && alignmentReady && view === "compare" && <><img className="stage-image compare-original" draggable={false} style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }} src={original.dataUrl} alt="对比中的原图" /><span className="compare-label before">原图</span><span className="compare-label after">修复后</span><div className="compare-divider" style={{ left: `${split}%` }}><span><ArrowLeftRight size={17} /></span></div>
                                    <div className="compare-slider" role="slider" tabIndex={0} aria-label="修复前后对比" aria-valuemin={0} aria-valuemax={100} aria-valuenow={split}
                                        onPointerDown={event => { event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId); moveDivider(event); }}
                                        onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) moveDivider(event); }}
                                        onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) { moveDivider(event); event.currentTarget.releasePointerCapture(event.pointerId); } }}
                                        onKeyDown={event => { const next = event.key === "Home" ? 0 : event.key === "End" ? 100 : event.key === "ArrowLeft" ? split - 1 : event.key === "ArrowRight" ? split + 1 : null; if (next !== null) { event.preventDefault(); setSplit(Math.max(0, Math.min(100, next))); } }} />
                                </>}
                                {(!result || view === "original") && <span className="compare-label before">原图</span>}
                            </div>
                        </>}
                        {running && <div className="repair-progress" role="status"><LoaderCircle size={28} className="spin" /><strong>正在修复照片</strong><span>请稍候，原图会完整保留</span><button className="quiet-button" onClick={() => abortRef.current?.abort()}>停止等待</button></div>}
                    </div>
                    <div className="preview-bottom"><span>{result ? "修复完成 · 可继续精修" : original ? `${original.width} × ${original.height} · 原图已保留` : "等待导入照片"}</span><div>{result && <button className="quiet-button" disabled={running} onClick={() => { setOriginal(result); setResult(null); setError(""); }}>继续精修</button>}<button className="quiet-button" disabled={!original || running} onClick={() => void exportProject()}><FolderOpen size={15} />保存项目</button><button className="outline-button" disabled={!result || running} onClick={() => void download().catch(() => message.error("照片下载失败，请重试。"))}><ArrowDownToLine size={15} />保存照片</button></div></div>
                </section>
            </div>
            <footer className="restore-footer"><span>基于 Infinite Canvas · 专注照片修复</span><span>未修复时不连接外部服务</span></footer>
        </main>
        <input ref={fileInput} type="file" accept={supportedTypes.join(",")} hidden onChange={event => { void importPhoto(event.target.files?.[0]); event.target.value = ""; }} />
        <input ref={projectInput} type="file" accept=".zip" hidden onChange={event => { void importProject(event.target.files?.[0]); event.target.value = ""; }} />
        <Drawer title="修图 API 设置" open={settingsOpen} onClose={() => setSettingsOpen(false)} width={440} className="restore-drawer">
            {draft && <form className="api-form" onSubmit={event => { event.preventDefault(); saveSettings(); }}>
                <p>用于照片修复和视频逐帧修复，不连接社区、插件或同步服务。</p>
                {config.channels.length > 1 && <label>已保存的接口<select value={draft.id} onChange={event => { const channel = config.channels.find(item => item.id === event.target.value)!; setDraft({ ...channel }); setDraftModel(channel.models.find(item => item.capability === "image")?.name || ""); }}>{config.channels.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
                <label>接口类型<select value={draft.apiFormat} onChange={event => { const apiFormat = event.target.value as ApiCallFormat; setDraft({ ...draft, apiFormat, baseUrl: defaultBaseUrlForApiFormat(apiFormat) }); setDraftModel(apiFormat === "openai" ? "gpt-image-2" : ""); }}><option value="openai">OpenAI / OpenAI 兼容接口</option><option value="gemini">Google Gemini</option></select></label>
                <label>接口名称<input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="我的修图接口" /></label>
                <label>接口地址<input type="url" required value={draft.baseUrl} onChange={event => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="https://api.openai.com" /></label>
                <label>API Key<input type="password" autoComplete="off" required value={draft.apiKey} onChange={event => setDraft({ ...draft, apiKey: event.target.value })} placeholder="填写你自己的 API Key" /></label>
                <label>图像模型名称<input required value={draftModel} onChange={event => setDraftModel(event.target.value)} placeholder={draft.apiFormat === "openai" ? "例如 gpt-image-2" : "填写支持图片编辑的 Gemini 模型"} /></label>
                <p>请使用支持图片编辑的模型。密钥保存在此浏览器本地，导出修复项目时不会包含密钥。</p>
                <button className="primary-button" type="submit"><Check size={16} />保存设置</button>
            </form>}
        </Drawer>
        <Drawer title="本地修复记录" open={historyOpen} onClose={() => setHistoryOpen(false)} width={440} className="restore-drawer">
            {!records.length ? <div className="history-empty"><Clock3 size={25} /><strong>还没有修复记录</strong><p>完成修复后，原图和结果会保存在这里。</p></div> : <div className="history-list">{records.map(item => <button key={item.id} onClick={() => void openRecord(item)}><div><strong>{item.original.name}</strong><span>{presets.find(p => p.id === item.preset)?.title || "照片修复"} · {new Date(item.createdAt).toLocaleString("zh-CN")}</span></div><ChevronRight size={16} /></button>)}</div>}
        </Drawer>
    </div>;
}
