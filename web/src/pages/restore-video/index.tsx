import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Aperture, ArrowDownToLine, Check, Clock3, Film, FolderOpen, Image as ImageIcon, LoaderCircle, Pause, Play, Settings2, ShieldCheck } from "lucide-react";
import { requestEdit } from "@/services/api/image";
import { localVideoRequest, videoJobAction, videoJobUrl, type VideoRestoreJob } from "@/services/api/video-restore";
import { resolveModelChannel, selectableModelsByCapability, useConfigStore } from "@/stores/use-config-store";
import { presets, restorationPrompt } from "@/pages/restore/presets";

const seconds = (value = 0) => `${value.toFixed(2)} 秒`;

export default function RestoreVideoPage() {
    const config = useConfigStore(state => state.config);
    const models = selectableModelsByCapability(config, "image");
    const input = useRef<HTMLInputElement>(null);
    const pause = useRef(false);
    const pendingImage = useRef<{ job: string; index: number; blob: Blob } | null>(null);
    const [job, setJob] = useState<VideoRestoreJob | null>(null);
    const [records, setRecords] = useState<VideoRestoreJob[]>([]);
    const [showRecords, setShowRecords] = useState(false);
    const [preset, setPreset] = useState("clarity-only");
    const [instructions, setInstructions] = useState("");
    const [model, setModel] = useState(config.imageModel);
    const [running, setRunning] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [pauseRequested, setPauseRequested] = useState(false);
    const [error, setError] = useState("");
    const busy = running || uploading || job?.status === "extracting" || job?.status === "composing";
    const locked = busy || Boolean(job?.settings && (job.completed || job.pending !== null));
    const channel = resolveModelChannel(config, model);
    const configured = models.includes(model) && Boolean(channel.apiKey.trim() && channel.baseUrl.trim());

    function selectJob(next: VideoRestoreJob) {
        setJob(next); setError(""); setShowRecords(false);
        localStorage.setItem("photo-restore:last-video-job", next.id);
        setPreset(next.settings?.preset || "clarity-only");
        setInstructions(next.settings?.instructions || "");
        setModel(next.settings?.model || config.imageModel);
    }
    useEffect(() => {
        let active = true;
        localVideoRequest<VideoRestoreJob[]>("/__video/jobs").then(items => {
            if (!active) return;
            setRecords(items);
            const last = items.find(item => item.id === localStorage.getItem("photo-restore:last-video-job")) || items[0];
            if (last) selectJob(last);
        }).catch(cause => { if (active) setError(cause.message); });
        return () => { active = false; pause.current = true; };
    }, []);
    useEffect(() => {
        if (!job || !["extracting", "composing"].includes(job.status)) return;
        let active = true;
        const timer = window.setInterval(() => {
            localVideoRequest<VideoRestoreJob>(videoJobUrl(job.id)).then(next => { if (active) setJob(next); }).catch(cause => { if (active) setError(cause.message); });
        }, 2500);
        return () => { active = false; window.clearInterval(timer); };
    }, [job?.id, job?.status]);
    useEffect(() => {
        if (!running) return;
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [running]);

    async function importVideo(file?: File) {
        if (!file || busy) return;
        setUploading(true); setError("");
        try {
            if (!/\.(mp4|mov|mkv|webm|m4v|avi)$/i.test(file.name)) throw new Error("请选择 MP4、MOV、MKV、WebM、M4V 或 AVI 视频。");
            const next = await localVideoRequest<VideoRestoreJob>("/__video/jobs", { method: "POST", headers: { "X-Video-Name": encodeURIComponent(file.name) }, body: file });
            pendingImage.current = null; selectJob(next);
        } catch (cause) { setError(cause instanceof Error ? cause.message : "视频导入失败。"); }
        finally { setUploading(false); }
    }
    async function restoreFrames() {
        if (!job || busy || job.status !== "ready") return;
        if (!configured) { setError("请先到照片修复中的 API 设置，配置支持图片编辑的模型。"); return; }
        setRunning(true); setError(""); pause.current = false; setPauseRequested(false);
        try {
            let current = await videoJobAction(job.id, "settings", { preset, instructions, model, preserve: true });
            const snapshot = { ...config, channels: config.channels.map(item => ({ ...item, models: item.models.map(entry => ({ ...entry, script: undefined })) })), model, count: "1", size: "auto", background: "", systemPrompt: "" };
            const prompt = restorationPrompt(preset, instructions, true, true);
            while (current.completed < current.total && !pause.current) {
                const index = current.completed;
                let cached = pendingImage.current;
                if (!cached || cached.job !== current.id || cached.index !== index) {
                    current = await videoJobAction(current.id, "begin"); setJob(current);
                    const frameUrl = new URL(videoJobUrl(current.id, `frames/${index}`), window.location.origin).href;
                    const images = await requestEdit(snapshot, prompt, [{ id: `${current.id}:${index}`, name: `frame_${index + 1}.png`, type: "image/png", dataUrl: frameUrl }]);
                    if (!images[0]) throw new Error(`第 ${index + 1} 帧没有返回图片。`);
                    const response = await fetch(images[0].dataUrl);
                    if (!response.ok) throw new Error(`第 ${index + 1} 帧的结果下载失败。`);
                    const blob = await response.blob();
                    try { const image = await createImageBitmap(blob); image.close(); }
                    catch { throw new Error(`第 ${index + 1} 帧返回的内容不是可读取的图片。已暂停，请检查模型或重试。`); }
                    cached = { job: current.id, index, blob }; pendingImage.current = cached;
                }
                current = await localVideoRequest<VideoRestoreJob>(videoJobUrl(current.id, `restored/${index}`), { method: "POST", body: cached.blob });
                pendingImage.current = null; setJob(current);
            }
            if (current.completed === current.total) setJob(await videoJobAction(current.id, "compose"));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "逐帧修复失败，已完成的帧仍保留。");
        } finally { setRunning(false); setPauseRequested(false); }
    }
    async function showHistory() {
        try { setRecords(await localVideoRequest<VideoRestoreJob[]>("/__video/jobs")); setShowRecords(!showRecords); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "记录读取失败。"); }
    }
    const remaining = job ? job.total - job.completed : 0;
    const progress = job?.total ? Math.round(job.completed / job.total * 100) : 0;
    const label = job?.status === "extracting" ? "正在本机拆帧…" : job?.status === "composing" ? "正在合成视频与原音轨…" : running ? `正在修复第 ${(job?.completed || 0) + 1} 帧` : job?.status === "done" ? "视频修复完成" : job?.completed ? "已暂停，可继续修复" : "等待开始修复";

    return <div className="restore-app">
        <header className="restore-header"><div className="restore-brand"><Aperture size={25} strokeWidth={1.6} /><div><strong>照片修复</strong><span>PHOTO RESTORE</span></div></div><nav aria-label="工作台操作"><Link className={"quiet-button" + (busy ? " disabled-link" : "")} to="/restore"><ImageIcon size={16} />照片修复</Link><button className="quiet-button" onClick={() => void showHistory()} disabled={busy}><Clock3 size={16} />视频记录</button><Link className={"api-button" + (busy ? " disabled-link" : "")} to="/restore?api=1"><Settings2 size={15} />API 设置</Link></nav></header>
        <main className="restore-main">
            <div className="restore-intro"><div><span className="eyebrow">逐帧修复，保留声音</span><h1>让视频，重新清晰。</h1><p>使用现有修图 API，每一帧单独修复，再合成为 MP4。</p></div><span className="local-note"><ShieldCheck size={16} />本机拆帧 · 按需调用</span></div>
            {showRecords && <section className="video-records" aria-label="视频修复记录"><h2>本机视频记录</h2>{!records.length ? <p>还没有视频记录。</p> : <div className="history-list">{records.map(item => <button key={item.id} onClick={() => selectJob(item)}><div><strong>{item.name}</strong><span>{item.completed} / {item.total} 帧 · {item.status === "done" ? "已完成" : "可打开查看"} · {new Date(item.createdAt).toLocaleString("zh-CN")}</span></div><FolderOpen size={16} /></button>)}</div>}</section>}
            <div className="restore-workspace">
                <aside className="restore-controls">
                    <section><h2><span>01</span>导入视频</h2><button className="photo-import" onClick={() => input.current?.click()} disabled={busy}><Film size={25} strokeWidth={1.4} /><strong>{job?.name || "选择一个视频"}</strong><span>{job?.total ? `${job.width} × ${job.height} · ${seconds(job.duration)} · ${job.total} 帧` : "MP4、MOV、MKV、WebM、M4V、AVI"}</span></button></section>
                    <section><h2><span>02</span>修复方式</h2><div className="preset-list" role="radiogroup" aria-label="视频修复方式">{presets.map(item => <button key={item.id} className={"preset-button " + (preset === item.id ? "selected" : "")} role="radio" aria-checked={preset === item.id} onClick={() => setPreset(item.id)} disabled={locked}><item.icon size={19} strokeWidth={1.5} /><div><strong>{item.title.replace("照片", "视频")}</strong><span>{item.detail}</span></div><span className="preset-check">{preset === item.id && <Check size={12} />}</span></button>)}</div></section>
                    <section><h2><span>03</span>补充要求<small>选填</small></h2><textarea aria-label="视频补充修复要求" value={instructions} onChange={event => setInstructions(event.target.value)} placeholder="例如：保留黑白效果，只改善清晰度。" disabled={locked} rows={3} /></section>
                    <label className="model-label">修复模型<select aria-label="视频修复模型" value={model} disabled={locked} onChange={event => setModel(event.target.value)}>{!models.includes(model) && <option value={model}>{model || "请先配置修图 API"}</option>}{models.map(value => <option key={value} value={value}>{resolveModelChannel(config, value).name} · {value.split("::").slice(1).join("::")}</option>)}</select></label>
                    {job?.total ? <div className="video-call-note"><strong>已保存 {job.completed} / {job.total} 帧</strong><progress aria-label="逐帧修复进度" value={job.completed} max={job.total} /><span>剩余预计 {remaining} 次图片编辑调用。费用按所选 API 计费。</span><span>逐帧生成可能出现细节闪烁；先用短视频确认效果。拆帧文件会占用本机磁盘。</span></div> : null}
                    {job?.pending !== null && job?.pending !== undefined && !running && <p className="video-pending" role="status">第 {job.pending + 1} 帧尚未确认保存。上次调用可能已计费，重试可能再次计费。</p>}
                    {running ? <button className="primary-button restore-start" onClick={() => { pause.current = true; setPauseRequested(true); }} disabled={pauseRequested}><Pause size={16} />{pauseRequested ? "本帧保存后暂停…" : "本帧完成后暂停"}</button> : job?.total && job.completed === job.total && job.status === "ready" ? <button className="primary-button restore-start" onClick={() => void videoJobAction(job.id, "compose").then(setJob).catch(cause => setError(cause.message))}><Film size={16} />合成已修复视频</button> : <button className="primary-button restore-start" onClick={() => void restoreFrames()} disabled={!job || job.status !== "ready" || busy}><Play size={16} />{job?.status === "done" ? "已完成逐帧修复" : job?.pending !== null && job?.pending !== undefined ? "重试未完成帧" : job?.completed ? "继续逐帧修复" : "开始逐帧修复"}{job?.total && job.status === "ready" ? `（${remaining} 次调用）` : ""}</button>}
                    <p className="api-hint">{configured ? "只在开始或继续修复时向所选 API 发送视频帧。" : "沿用照片修复的图像 API，请先完成 API 设置。"}</p>
                    {(error || job?.error) && <div className="restore-error" role="alert">{error || job?.error}</div>}
                    {locked && !busy && <p className="api-hint">已开始的任务沿用原修复方式。更改要求时，请重新导入原视频。</p>}
                </aside>
                <section className="restore-preview" aria-label="视频预览">
                    <div className="preview-toolbar"><span className="preview-heading">视频预览</span><span className="preview-heading" role="status">{(busy || uploading) && <LoaderCircle size={13} className="spin" />} {uploading ? "正在保存原视频…" : label}</span></div>
                    {!job ? <div className="photo-stage"><div className="preview-empty"><div className="empty-image-icon"><Film size={32} strokeWidth={1} /></div><h3>从一段短视频开始</h3><p>原视频保留，修复结果单独保存</p><button className="outline-button" onClick={() => input.current?.click()} disabled={busy}>导入视频</button></div></div> : <div className="video-preview-grid"><figure><figcaption>原视频</figcaption><video controls preload="metadata" src={videoJobUrl(job.id, "original")} aria-label="原视频" /></figure><figure><figcaption>{job.status === "done" ? "修复后" : "最近修复的画面"}</figcaption>{job.status === "done" ? <video controls preload="metadata" src={videoJobUrl(job.id, "result")} aria-label="修复后的视频" /> : job.completed ? <img src={videoJobUrl(job.id, `restored/${job.completed - 1}`)} alt={`已保存的第 ${job.completed} 帧`} /> : <div className="video-result-empty"><Film size={30} strokeWidth={1} /><span>{label}</span></div>}</figure></div>}
                    <div className="preview-bottom"><span>{job?.total ? `${progress}% · ${job.completed} / ${job.total} 帧已保存到本机` : "拆帧与合成在本机完成，不调用外部服务"}</span>{job?.status === "done" && <a className="outline-button" href={videoJobUrl(job.id, "result?download=1")} download><ArrowDownToLine size={15} />保存视频</a>}</div>
                </section>
            </div>
            <footer className="restore-footer"><span>基于 Infinite Canvas · 照片与视频修复</span><span>暂停或刷新后，可从视频记录继续</span></footer>
        </main>
        <input ref={input} type="file" accept=".mp4,.mov,.mkv,.webm,.m4v,.avi" hidden onChange={event => { void importVideo(event.target.files?.[0]); event.target.value = ""; }} />
    </div>;
}
