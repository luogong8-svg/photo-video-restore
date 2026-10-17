import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const appDir = dirname(process.execPath);
const baseUrl = 'http://127.0.0.1:31873';
const logDir = join(appDir, 'logs');
mkdirSync(logDir, { recursive: true });

async function ready() {
  try {
    const response = await fetch(baseUrl + '/__infinite_canvas_health', { signal: AbortSignal.timeout(1500) });
    return (await response.json()).application === 'infinite-canvas-local-3a6b64b';
  } catch { return false; }
}

function launch(executable, args, options = {}) {
  const child = spawn(executable, args, { cwd: appDir, detached: true, windowsHide: true, stdio: 'ignore', ...options });
  child.unref();
  return new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
}

try {
  if (!(await ready())) {
    await launch(join(appDir, 'runtime', 'bun.exe'), ['run', join(appDir, 'server.mjs')], {
      stdio: ['ignore', openSync(join(logDir, 'server.log'), 'a'), openSync(join(logDir, 'server-error.log'), 'a')]
    });
    for (let attempt = 0; attempt < 40 && !(await ready()); attempt++) await Bun.sleep(250);
    if (!(await ready())) throw new Error('本地服务未能启动，请查看安装目录 logs/server-error.log。');
  }
  const edge = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]
    .filter(Boolean).map(path => join(path, 'Microsoft', 'Edge', 'Application', 'msedge.exe')).find(existsSync);
  if (!edge) throw new Error('未找到 Microsoft Edge。请手动用浏览器打开：' + baseUrl + '/restore');
  await launch(edge, ['--app=' + baseUrl + '/restore'], { windowsHide: false });
} catch (error) {
  const errorFile = join(logDir, '启动错误.txt');
  writeFileSync(errorFile, '照片修复启动失败\r\n\r\n' + String(error) + '\r\n', 'utf8');
  await launch(join(process.env.WINDIR, 'System32', 'notepad.exe'), [errorFile], { windowsHide: false });
  process.exitCode = 1;
}
