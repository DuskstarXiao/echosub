# EchoSub 本地离线语音引擎（零账号 / 零 API 费 / 永久免费）

不想注册任何第三方 API Key？使用本文件夹内的一键脚本，音频全程在你自己电脑本地完成识别，**零云端费用、保护隐私、支持纯 CPU 运行**。

## 使用方法（3 步）

1. **Windows 用户**：直接双击 `一键启动本地语音引擎.bat`（macOS / Linux 运行 `./start-local-asr.sh`）。
   - 首次运行会自动创建 `.venv`、通过清华源安装依赖，并通过国内镜像（`hf-mirror.com`）下载约 150MB 的 `faster-whisper base` 轻量模型。
2. 看到窗口提示 **`EchoSub Local Offline ASR Server is RUNNING!`** 后保持窗口最小化即可。
3. 打开浏览器 EchoSub 侧边栏 → **「一键配置」** → 点选 **「纯本地离线引擎（零注册 / 永久免费）」** → 点击 **「一键测通」**，变绿后即可永久免费看无字幕视频！

## 进阶参数

- 追求更高识别精度（显卡或较强 CPU）：把脚本里的 `--model base` 改成 `--model small`。
- 追求极致速度（低配笔记本）：改成 `--model tiny`。
