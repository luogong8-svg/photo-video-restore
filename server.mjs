import { resolve, sep } from 'node:path';
import { createVideoHandler } from './video-jobs.mjs';

const root = resolve(import.meta.dir, 'web/dist');
const appId = 'infinite-canvas-local-3a6b64b';
const bundledFfmpeg = resolve(import.meta.dir, 'runtime/ffmpeg.exe');
const ffmpeg = process.env.FFMPEG_PATH || (await Bun.file(bundledFfmpeg).exists() ? bundledFfmpeg : 'ffmpeg');
const videoHandler = createVideoHandler({ directory: resolve(import.meta.dir, 'video-jobs'), ffmpeg });
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 31873,
  maxRequestBodySize: Number.MAX_SAFE_INTEGER,
  async fetch(request, server) {
    const url = new URL(request.url);
    if (url.pathname === '/__infinite_canvas_health') {
      return Response.json({ application: appId, version: 'v0.20.0', videoFrames: true });
    }
    if (!['127.0.0.1:31873', 'localhost:31873'].includes(url.host)) return new Response('Forbidden', { status: 403 });
    if (url.pathname.startsWith('/__video/')) server.timeout(request, 0);
    const videoResponse = await videoHandler(request);
    if (videoResponse) return videoResponse;
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { return new Response('Bad path', { status: 400 }); }
    const target = resolve(root, '.' + pathname);
    if (target !== root && !target.startsWith(root + sep)) return new Response('Forbidden', { status: 403 });
    let file = Bun.file(target);
    if (target === root || !(await file.exists())) {
      if (pathname.startsWith('/assets/')) return new Response('Not found', { status: 404 });
      file = Bun.file(resolve(root, 'index.html'));
    }
    const headers = { 'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' };
    if (request.method === 'HEAD') return new Response(null, { headers: { ...headers, 'Content-Type': file.type } });
    return new Response(file, { headers });
  }
});
console.log(`Infinite Canvas v0.20.0: ${server.url}`);
