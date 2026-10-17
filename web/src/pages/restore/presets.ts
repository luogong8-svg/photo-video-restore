import { Aperture, Palette, ScanFace, Sparkles, WandSparkles } from "lucide-react";

export const presets = [
    { id: "restore", title: "老照片修复", detail: "修复划痕、污点与褪色", icon: WandSparkles, prompt: "修复照片的划痕、折痕、污点、破损和褪色，适度降低噪点并恢复自然层次。" },
    { id: "clarity", title: "清晰增强", detail: "改善模糊与噪点，保留细节", icon: Sparkles, prompt: "改善照片的模糊、噪点和压缩痕迹，适度增强真实细节和清晰度，避免过度锐化和塑料质感。" },
    { id: "clarity-only", title: "仅提升清晰度", detail: "只改善模糊，保留原有颜色", icon: Aperture, prompt: "仅改善照片的模糊、噪点和压缩痕迹，适度增强真实细节与清晰度，避免过度锐化。保留原图颜色、色相、饱和度、白平衡、整体明暗和对比度；黑白照片保持黑白，彩色照片保持原色。不调色、不上色、不美颜、不重绘或增加内容。" },
    { id: "portrait", title: "人像修复", detail: "自然还原面部，保留五官", icon: ScanFace, prompt: "修复照片中受损或模糊的人脸和皮肤细节，保留每个人的身份、五官比例、年龄、表情和自然皮肤纹理，不美颜、不换脸。" },
    { id: "color", title: "黑白上色", detail: "自然上色，保留年代感", icon: Palette, prompt: "为这张黑白照片进行自然、克制的彩色上色，选择符合时代和光照的合理色彩，保留明暗关系与年代感。颜色属于推测，不伪造可验证的历史细节。" },
];

export function restorationPrompt(preset: string, instructions: string, preserve: boolean, videoFrame = false) {
    const selected = presets.find(item => item.id === preset) || presets[0];
    return [
        "你正在修复用户上传的原始照片。请只返回修复后的照片。",
        selected.prompt,
        "保持原图构图、视角、宽高比、人物身份和文字内容，不增加人物或物件，不添加水印、边框或文字说明。",
        preserve || selected.id === "clarity-only" ? "以最小必要改动保留原貌，不做过度美化，对无法判断的细节保持克制。" : "在保留原始内容的前提下，可以更充分地修补受损细节。",
        instructions.trim(),
        selected.id === "clarity-only" ? "本次选择了仅提升清晰度：保留原色的要求优先于补充要求中任何调色、上色、改变光照或美化的描述，只执行清晰度增强。" : "",
        videoFrame ? "这是原视频中的一帧。保持物体位置、人物五官与原始运动细节，不移动、缩放、裁剪或重构画面。采用克制且一致的细节增强，避免帧间色彩和纹理跳变。" : "",
    ].filter(Boolean).join("\n");
}
