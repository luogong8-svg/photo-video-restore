import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';

// Only local media work happens here. API credentials and API calls stay in the browser.
export function createVideoHandler({ directory, ffmpeg }) {
  const active = new Set();
  const frameName = index => `${String(index + 1).padStart(8, '0')}.png`;
  const folder = id => join(directory, id);
  const manifest = id => join(folder(id), 'job.json');
  const load = async id => JSON.parse(await readFile(manifest(id), 'utf8'));
  const save = async job => {
    await writeFile(manifest(job.id) + '.tmp', JSON.stringify(job));
    await rename(manifest(job.id) + '.tmp', manifest(job.id));
  };
  const publicJob = ({ times, durations, ...job }) => job;
  async function run(args, onLine) {
    const child = Bun.spawn([ffmpeg, '-hide_banner', '-nostdin', '-y', ...args], { stdout: 'ignore', stderr: 'pipe', windowsHide: true });
    let buffer = '', errors = '';
    for await (const chunk of child.stderr) {
      const text = new TextDecoder().decode(chunk);
      errors = (errors + text).slice(-16000);
      buffer += text;
      const lines = buffer.split(/[\r\n]+/); buffer = lines.pop() || '';
      for (const line of lines) onLine?.(line);
    }
    if (buffer) onLine?.(buffer);
    if (await child.exited !== 0) throw new Error(errors || '本地视频处理失败');
  }
  async function extract(job) {
    active.add(job.id);
    try {
      job.times = []; job.durations = [];
      await run(['-protocol_whitelist', 'file,pipe', '-i', join(folder(job.id), 'source'), '-map', '0:v:0', '-an', '-vf', 'scale=trunc(iw*sar):ih,setsar=1,showinfo,setpts=PTS-STARTPTS', '-fps_mode', 'passthrough', '-pix_fmt', 'rgb24', join(folder(job.id), 'frames', '%08d.png')], line => {
        const mediaDuration = line.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
        if (mediaDuration) job.duration = Number(mediaDuration[1]) * 3600 + Number(mediaDuration[2]) * 60 + Number(mediaDuration[3]);
        const sourceRate = line.match(/Video:.*?,\s*([\d.]+) fps/);
        if (sourceRate && Number(sourceRate[1]) > 0) job.frameRate = sourceRate[1];
        if (!line.includes('showinfo')) return;
        const rate = line.match(/frame_rate:\s*(\d+)\/(\d+)/);
        if (rate && Number(rate[1]) > 0 && Number(rate[2]) > 0) job.frameRate = `${rate[1]}/${rate[2]}`;
        const frame = line.match(/\bn:\s*(\d+).*?pts_time:([\d.eE+-]+)/);
        if (!frame) return;
        const index = Number(frame[1]); job.times[index] = Number(frame[2]);
        const duration = line.match(/duration_time:([\d.eE+-]+)/);
        if (duration) job.durations[index] = Number(duration[1]);
        const size = line.match(/\bs:(\d+)x(\d+)/);
        if (size) { job.width = Number(size[1]); job.height = Number(size[2]); }
      });
      if (!job.times.length || job.times.some(time => !Number.isFinite(time))) throw new Error('视频中没有可读取的完整画面。');
      const start = job.times[0]; job.times = job.times.map(time => time - start); job.videoOffset = Math.max(0, start);
      job.total = job.times.length;
      const [n, d = 1] = (job.frameRate || '0/1').split('/').map(Number);
      const lastDuration = job.durations.at(-1) || (job.total > 1 ? job.times.at(-1) - job.times.at(-2) : d / n);
      if (!(lastDuration > 0)) throw new Error('无法确定视频帧的播放时长。');
      job.duration = Math.max(job.duration || 0, job.videoOffset + job.times.at(-1) + (job.durations.at(-1) || 0));
      if (!(job.duration > job.videoOffset + job.times.at(-1))) job.duration = job.videoOffset + job.times.at(-1) + lastDuration;
      if (!job.frameRate) job.frameRate = String(job.total / job.duration);
      job.status = 'ready'; job.error = '';
    } catch (error) {
      await writeFile(join(folder(job.id), 'error.log'), String(error.stack || error)).catch(() => undefined);
      job.status = 'error'; job.error = '视频拆帧失败。请检查本机磁盘空间，或将原视频转换为常见 MP4 格式后重新导入。';
    }
    finally { active.delete(job.id); await save(job); }
  }
  async function compose(job) {
    active.add(job.id);
    try {
      const lines = ['ffconcat version 1.0'];
      for (let i = 0; i < job.total; i++) {
        const duration = i + 1 < job.total ? job.times[i + 1] - job.times[i] : job.duration - job.videoOffset - job.times[i];
        lines.push(`file 'restored/${frameName(i)}'`, 'option framerate 1000000', `duration ${duration.toFixed(9)}`);
      }
      lines.push(`file 'restored/${frameName(job.total - 1)}'`, 'option framerate 1000000');
      await writeFile(join(folder(job.id), 'frames.ffconcat'), lines.join('\n') + '\n');
      const lastDuration = Math.round((job.duration - job.videoOffset - job.times.at(-1)) * 1000000);
      await run(['-protocol_whitelist', 'file,pipe', '-safe', '0', '-f', 'concat', '-itsoffset', String(job.videoOffset), '-i', join(folder(job.id), 'frames.ffconcat'), '-protocol_whitelist', 'file,pipe', '-i', join(folder(job.id), 'source'), '-map', '0:v:0', '-map', '1:a?', '-map_metadata', '-1', '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-bf', '0', '-pix_fmt', 'yuv420p', '-fps_mode', 'vfr', '-enc_time_base', '1:1000000', '-video_track_timescale', '1000000', '-bsf:v', `setts=duration=${lastDuration}`, '-c:a', 'aac', '-t', String(job.duration), '-movflags', '+faststart', join(folder(job.id), 'result.mp4')]);
      job.status = 'done'; job.error = '';
    } catch (error) {
      await writeFile(join(folder(job.id), 'error.log'), String(error.stack || error)).catch(() => undefined);
      job.status = 'ready'; job.error = '视频合成失败，已修复的帧仍保留。请检查本机磁盘空间，再点击合成；无需重新调用修图 API。';
    }
    finally { active.delete(job.id); await save(job); }
  }
  async function recover(job) {
    if (job.pending !== null && !active.has(job.id) && await Bun.file(join(folder(job.id), 'restored', frameName(job.completed))).exists()) {
      job.completed++; job.pending = null; await save(job);
    }
    if (['extracting', 'composing'].includes(job.status) && !active.has(job.id)) {
      job.status = job.total ? 'ready' : 'error';
      job.error = job.total ? '本地处理曾中断，可继续合成。' : '拆帧曾中断，请重新导入原视频。';
      await save(job);
    }
    return job;
  }
  async function streamFile(request, path, mime, name) {
    const file = Bun.file(path);
    if (!await file.exists()) return new Response('文件不存在', { status: 404 });
    const headers = { 'Content-Type': mime, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
    if (name) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(name)}`;
    const range = request.headers.get('range')?.match(/^bytes=(\d+)-(\d*)$/);
    if (range) {
      const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), file.size - 1) : file.size - 1;
      if (start > end || start >= file.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${file.size}` } });
      return new Response(file.slice(start, end + 1), { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${file.size}`, 'Content-Length': String(end - start + 1) } });
    }
    return new Response(file, { headers });
  }
  return async function handle(request) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/__video/')) return null;
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) return new Response('仅限本地页面使用', { status: 403 });
    if (request.headers.get('sec-fetch-site') === 'cross-site') return new Response('禁止跨站访问', { status: 403 });
    const reply = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
    try {
      if (url.pathname === '/__video/jobs') {
        await mkdir(directory, { recursive: true });
        if (request.method === 'GET') {
          const jobs = [];
          for (const item of await readdir(directory, { withFileTypes: true })) {
            if (!item.isDirectory() || !/^[a-f\d-]{36}$/.test(item.name)) continue;
            try { jobs.push(publicJob(await recover(await load(item.name)))); } catch { /* A partial upload has no manifest. */ }
          }
          return reply(jobs.sort((a, b) => b.createdAt - a.createdAt));
        }
        if (request.method === 'POST') {
          const id = crypto.randomUUID();
          await mkdir(join(folder(id), 'frames'), { recursive: true });
          await mkdir(join(folder(id), 'restored'), { recursive: true });
          await pipeline(Readable.fromWeb(request.body), createWriteStream(join(folder(id), 'source')));
          const job = { id, name: decodeURIComponent(request.headers.get('x-video-name') || 'video.mp4'), createdAt: Date.now(), status: 'extracting', total: 0, completed: 0, pending: null, error: '' };
          await save(job); void extract(job);
          return reply(publicJob(job), 201);
        }
      }
      const match = url.pathname.match(/^\/__video\/jobs\/([a-f\d-]{36})(?:\/(original|result|settings|begin|compose|frames\/\d+|restored\/\d+))?$/);
      if (!match) return reply({ error: '未知视频请求' }, 404);
      const [, id, action] = match;
      const job = await recover(await load(id));
      if (!action && request.method === 'GET') return reply(publicJob(job));
      if (request.method === 'GET') {
        if (action === 'original') return streamFile(request, join(folder(id), 'source'), 'video/mp4');
        if (action === 'result' && job.status === 'done') return streamFile(request, join(folder(id), 'result.mp4'), 'video/mp4', url.searchParams.has('download') ? job.name.replace(/\.[^.]+$/, '') + '_逐帧修复.mp4' : undefined);
        const frame = action?.match(/^(frames|restored)\/(\d+)$/);
        if (frame && Number(frame[2]) < (frame[1] === 'restored' ? job.completed : job.total)) return streamFile(request, join(folder(id), frame[1], frameName(Number(frame[2]))), 'image/png');
      }
      if (request.method !== 'POST') return reply({ error: '不支持的请求' }, 405);
      if (active.has(id)) return reply({ error: '本地视频正在处理中，请稍候。' }, 409);
      if (action === 'settings') {
        const { preset, instructions, model, preserve } = await request.json();
        if (![preset, instructions, model].every(value => typeof value === 'string') || typeof preserve !== 'boolean') return reply({ error: '修复设置无效' }, 400);
        const settings = { preset, instructions, model, preserve };
        if ((job.completed || job.pending !== null) && JSON.stringify(settings) !== JSON.stringify(job.settings)) return reply({ error: '已开始的任务请保持原修复设置；更改方式时请重新导入视频。' }, 409);
        job.settings = settings; await save(job); return reply(publicJob(job));
      }
      if (action === 'begin') {
        if (!job.settings || job.completed >= job.total || job.status !== 'ready') return reply({ error: '当前任务无法开始修复。' }, 409);
        job.pending = job.completed; job.error = ''; await save(job); return reply(publicJob(job));
      }
      const frame = action?.match(/^restored\/(\d+)$/);
      if (frame) {
        const index = Number(frame[1]);
        if (index !== job.completed || index !== job.pending || index >= job.total) return reply({ error: '帧顺序不一致，请刷新任务后继续。' }, 409);
        active.add(id);
        try {
          const pending = join(folder(id), 'pending-image');
          await pipeline(Readable.fromWeb(request.body), createWriteStream(pending));
          const normalized = join(folder(id), 'pending-normalized.png');
          await run(['-protocol_whitelist', 'file,pipe', '-i', pending, '-frames:v', '1', '-vf', `scale=${job.width}:${job.height},setsar=1`, '-pix_fmt', 'rgb24', normalized]);
          await rename(normalized, join(folder(id), 'restored', frameName(index)));
          job.completed++; job.pending = null; await save(job); return reply(publicJob(job));
        } finally { active.delete(id); }
      }
      if (action === 'compose') {
        if (!job.total || job.completed !== job.total) return reply({ error: '还有未修复的帧，不能合成。' }, 409);
        job.status = 'composing'; job.error = ''; await save(job); void compose(job); return reply(publicJob(job));
      }
      return reply({ error: '未知视频操作' }, 404);
    } catch (error) { return reply({ error: error.code === 'ENOENT' ? '本地视频任务不存在。' : String(error.message) }, error.code === 'ENOENT' ? 404 : 500); }
  };
}
