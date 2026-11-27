#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "============================================================"
echo "  EchoSub Local Offline ASR Server (Zero API Cost)"
echo "============================================================"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[Error] python3 not found. Please install Python 3.10+ first."
  exit 1
fi

if [ ! -d ".venv" ]; then
  echo "[1/3] Creating virtual environment (.venv)..."
  python3 -m venv .venv
fi

echo "[2/3] Installing dependencies..."
.venv/bin/pip install -q -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple || .venv/bin/pip install -q -r requirements.txt

echo "[3/3] Starting local ASR server on ws://127.0.0.1:8765/ws/asr ..."
export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"
.venv/bin/python server.py --model base --port 8765
