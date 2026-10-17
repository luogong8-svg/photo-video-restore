export type PreviewAlignment = { x: number; y: number; scale: number };
export const unchangedAlignment: PreviewAlignment = { x: 0, y: 0, scale: 1 };

// Register low-resolution luminance samples locally. The API image and saved file stay intact.
export function findPreviewAlignment(original: Float32Array, restored: Float32Array, width: number, height: number): PreviewAlignment {
    const cx = (width - 1) / 2, cy = (height - 1) / 2;
    const margin = Math.ceil(Math.max(width, height) * 0.1);
    function correlation(scale: number, dx: number, dy: number) {
        let a = 0, b = 0, aa = 0, bb = 0, ab = 0, count = 0;
        for (let y = margin; y < height - margin; y += 2) {
            const ry = (y - cy - dy) / scale + cy, iy = Math.floor(ry), fy = ry - iy;
            if (iy < 0 || iy >= height - 1) continue;
            for (let x = margin; x < width - margin; x += 2) {
                const rx = (x - cx - dx) / scale + cx, ix = Math.floor(rx), fx = rx - ix;
                if (ix < 0 || ix >= width - 1) continue;
                const top = restored[iy * width + ix] * (1 - fx) + restored[iy * width + ix + 1] * fx;
                const bottom = restored[(iy + 1) * width + ix] * (1 - fx) + restored[(iy + 1) * width + ix + 1] * fx;
                const av = original[y * width + x], bv = top * (1 - fy) + bottom * fy;
                a += av; b += bv; aa += av * av; bb += bv * bv; ab += av * bv; count++;
            }
        }
        const denominator = Math.sqrt((count * aa - a * a) * (count * bb - b * b));
        return denominator > 0 ? (count * ab - a * b) / denominator : -1;
    }
    const baseline = correlation(1, 0, 0);
    let best = { scale: 1, dx: 0, dy: 0, score: baseline };
    function check(scale: number, dx: number, dy: number) {
        const score = correlation(scale, dx, dy);
        if (score > best.score) best = { scale, dx, dy, score };
    }
    for (let s = -3; s <= 3; s++) for (let x = -4; x <= 4; x += 2) for (let y = -4; y <= 4; y += 2) check(1 + s * 0.02, x, y);
    const coarse = { ...best };
    for (let s = -2; s <= 2; s++) for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) check(coarse.scale + s * 0.005, coarse.dx + x * 0.5, coarse.dy + y * 0.5);
    if (best.score < 0.65 || best.score - baseline < 0.004) return unchangedAlignment;
    return { x: best.dx / width, y: best.dy / height, scale: best.scale };
}

export async function alignPhotoPreview(originalUrl: string, restoredUrl: string): Promise<PreviewAlignment> {
    const images = await Promise.all([originalUrl, restoredUrl].map(async url => {
        const image = new Image(); image.src = url; await image.decode(); return image;
    }));
    const ratio = 128 / Math.max(images[0].naturalWidth, images[0].naturalHeight);
    const width = Math.max(1, Math.round(images[0].naturalWidth * ratio));
    const height = Math.max(1, Math.round(images[0].naturalHeight * ratio));
    const samples = images.map(image => {
        const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true })!;
        context.filter = "blur(0.5px)";
        context.drawImage(image, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height).data;
        return Float32Array.from({ length: width * height }, (_, i) => 0.299 * pixels[i * 4] + 0.587 * pixels[i * 4 + 1] + 0.114 * pixels[i * 4 + 2]);
    });
    return findPreviewAlignment(samples[0], samples[1], width, height);
}
