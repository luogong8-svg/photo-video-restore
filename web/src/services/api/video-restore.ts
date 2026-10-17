export type VideoRestoreSettings = { preset: string; instructions: string; model: string; preserve: boolean };
export type VideoRestoreJob = {
    id: string; name: string; createdAt: number; status: "extracting" | "ready" | "composing" | "done" | "error";
    total: number; completed: number; pending: number | null; error: string;
    width?: number; height?: number; duration?: number; frameRate?: string; settings?: VideoRestoreSettings;
};

export const videoJobUrl = (id: string, action = "") => `/__video/jobs/${encodeURIComponent(id)}${action ? `/${action}` : ""}`;

export async function localVideoRequest<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(path, options);
    const type = response.headers.get("content-type") || "";
    if (!type.includes("application/json")) throw new Error("视频处理服务尚未更新。请关闭软件后重新从桌面图标打开。");
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || "本地视频处理失败。");
    return value as T;
}

export function videoJobAction(id: string, action: string, value?: unknown) {
    return localVideoRequest<VideoRestoreJob>(videoJobUrl(id, action), { method: "POST", ...(value === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) }) });
}
