# 第三方来源

## Infinite Canvas

- 原作者：basketikun
- 原项目：https://github.com/basketikun/infinite-canvas
- 基础版本：v0.20.0
- 基础提交：3a6b64b602ad062b29fac66902ed18a7ef5fd9dc
- 许可证：MIT，完整原文保留在根目录 LICENSE。

本定制版增加修复专用白色界面、可重新编辑的照片项目、对比对齐、保色清晰度预设和本地视频逐帧处理，停用与修复无关的联机入口。代码中保留的上游源文件及依赖继续保留其各自许可。

## Bun

- 项目及安装：https://bun.sh/docs/installation
- 源码及许可证：https://github.com/oven-sh/bun
- 本仓库不包含 Bun 二进制；已验证运行版本为 1.4.3。

## FFmpeg

- 项目：https://ffmpeg.org/
- 官方下载入口：https://ffmpeg.org/download.html
- 已验证 Windows 构建来源：https://www.gyan.dev/ffmpeg/builds/
- 已验证版本：FFmpeg 7.1 essentials，Gyan Windows 构建，GPL v3 或更新版本。
- 许可证参考：FFmpeg-GPL-3.0.txt。

本仓库不包含 FFmpeg 二进制。选择或再分发其他 FFmpeg 构建时，请保留并遵守该构建的许可证和来源说明。FFmpeg 仅用于本地拆帧、尺寸规范化和合成；本项目调用时禁用远程媒体协议。

## 前端依赖

依赖清单和锁定版本在 web/package.json 和 web/bun.lock。安装的第三方软件包适用各自的许可证。
