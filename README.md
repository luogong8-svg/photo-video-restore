# 照片与视频修复

白色极简的本地修复工作台，基于 [Infinite Canvas](https://github.com/basketikun/infinite-canvas) 定制。支持接入自己的图像编辑 API，修复照片，也可以把视频逐帧修复后合成为 MP4。

## 功能

- 老照片修复、清晰增强、仅提升清晰度、人像修复、黑白上色；可补充修改要求并继续精修。
- 原图与结果对比、拖动分界线、本地位置与比例对齐、照片下载。
- 导出和重新打开 .photo-restore.zip 项目，继续修改已有照片。
- 视频在本机拆帧，依次调用图像编辑 API；支持暂停、断点继续、手动重试、进度记录和 MP4 下载，原音轨转为 AAC 合成。
- OpenAI / OpenAI 兼容图像编辑接口，以及 Google Gemini 原生图像接口。模型必须支持图片输入与图片输出，普通文本聊天模型不能直接修图。
- 固定白色界面，停用社区、远程提示词同步、远程插件、WebDAV、Agent、统计和更新入口。

“仅提升清晰度”通过提示词要求保持原色，实际结果由所选模型决定；逐帧处理可能出现闪烁。每帧都会产生一次 API 调用，例如 10 秒、30 帧/秒的视频约需 300 次调用，建议先用短片确认效果和费用。失败或中断的帧可能已计费，程序不会自动重试收费请求。

## 快速开始（Windows）

1. 安装 [Bun](https://bun.sh/docs/installation)（本项目已验证版本：1.4.3）。
2. 从 [FFmpeg 官方下载页](https://ffmpeg.org/download.html) 获取 Windows 构建（已验证 FFmpeg 7.1），把 ffmpeg.exe 放入项目的 runtime 文件夹，或加入系统 PATH。Bun 也可使用 runtime/bun.exe 便携版本。
3. 下载并解压源码，在项目文件夹打开 PowerShell，安装依赖并构建：

~~~powershell
cd web
bun install --frozen-lockfile
bun run build
cd ..
powershell -ExecutionPolicy Bypass -File .\Launch.ps1
~~~

如果使用便携 Bun，请在 web 文件夹用 ..\runtime\bun.exe 代替上面的 bun 命令。首次构建需要联网下载依赖，之后启动和本地文件操作不需要外部服务。

启动脚本会打开浏览器窗口。本地地址为 http://127.0.0.1:31873/restore 。首次使用点击 **API 设置**，填写服务地址、API Key 和支持图片编辑的模型。视频修复沿用同一组图像 API 设置，无需 fal Key。

也可以在项目根目录执行 bun run server.mjs，再手动用浏览器打开上述地址。服务仅监听本机回环地址。不要把该服务直接映射到公网。

源码仓库不包含运行时二进制、编译产物或已安装版本的 EXE。launcher.mjs 是便携 EXE 启动器源码；它对应的目录结构为根目录启动器、server.mjs、video-jobs.mjs、web/dist 以及 runtime/bun.exe 和 runtime/ffmpeg.exe。编译启动器的命令：

~~~powershell
bun build .\launcher.mjs --compile --target=bun-windows-x64 --outfile .\InfiniteCanvas.exe --windows-icon=.\app.ico
~~~

## 本地数据与验证

API Key 保存在当前浏览器本地，由前端直接请求所选服务；修复时照片或视频帧会发送到该服务，返回的图片链接也可能需要下载。照片记录在浏览器本地，视频任务、原视频和中间帧在 video-jobs/，启动日志在 logs/。请备份重要项目，这些内容均不随源码上传。

已验证生产构建、本机模拟 OpenAI/Gemini 请求、暂停恢复、失败重试、MP4 下载、变帧率和无音轨视频。未调用真实收费 API 验证修复质量。完整 TypeScript 检查仍有上游 model-script-editor.tsx 的 Ant Design styles.content 类型错误；不影响已验证的生产构建。

详细操作见 [使用说明](docs/使用说明.md)。前端运行的是修复专用路由，保留的部分上游源文件未在本界面启用。

## 来源与许可

原项目由 **basketikun** 开发：[basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas)，定制基础为 v0.20.0、提交 3a6b64b602ad062b29fac66902ed18a7ef5fd9dc。本仓库是本地定制衍生版，保留原作者署名和 [MIT LICENSE](LICENSE)，并非原项目官方发行版。

FFmpeg 独立安装，其许可证取决于所选构建。已验证的 Gyan FFmpeg 7.1 构建采用 GPL v3 或更新版本；参考 [第三方说明](docs/THIRD_PARTY.md)。
