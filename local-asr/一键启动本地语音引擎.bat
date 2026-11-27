@echo off
chcp 65001 >nul
title EchoSub 本地离线语音引擎 (零 API 费用)
cd /d "%~dp0"

echo ============================================================
echo   EchoSub 纯本地离线语音转写服务 (无需账号 / 永久免费)
echo ============================================================
echo.

where python >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 Python，请先前往 https://www.python.org/downloads/ 安装 Python 3.10+
    echo        安装时记得勾选 "Add Python to PATH"。
    pause
    exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
    echo [1/3] 首次运行：正在创建独立 Python 虚拟环境 (.venv)...
    python -m venv .venv
    if errorlevel 1 (
        echo [错误] 虚拟环境创建失败。
        pause
        exit /b 1
    )
)

echo [2/3] 正在检查依赖（已自动切换清华国内源加速）...
.venv\Scripts\pip.exe install -q -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
if errorlevel 1 (
    echo [提示] 清华源失败，尝试默认 PyPI 源...
    .venv\Scripts\pip.exe install -q -r requirements.txt
)

echo [3/3] 正在启动本地语音识别服务（首次会自动通过国内镜像下载约 150MB 轻量模型）...
set HF_ENDPOINT=https://hf-mirror.com
.venv\Scripts\python.exe server.py --model base --port 8765
pause
