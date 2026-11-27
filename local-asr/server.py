#!/usr/bin/env python3
"""
EchoSub Local Offline ASR Server (echosub-v1 protocol)

Runs 100% locally on your CPU or GPU with ZERO cloud API cost.
Default engine: faster-whisper (int8 CPU / float16 CUDA auto-detect).
Uses hf-mirror.com automatically when HF_ENDPOINT is not set so downloads
are blazing fast in mainland China.

Usage:
    python server.py --model small --port 8765
    python server.py --model base --device cpu
"""

import argparse
import asyncio
import json
import os
import time
from typing import Optional

# Domestic-friendly HuggingFace mirror by default (can be overridden via env)
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")

import numpy as np
import websockets
from faster_whisper import WhisperModel

SAMPLE_RATE = 16000
BYTES_PER_SECOND = SAMPLE_RATE * 2  # Int16 mono

HALLUCINATIONS = {
    "thank you.",
    "thank you",
    "thanks for watching.",
    "thanks for watching",
    "you",
    "bye.",
}


def is_hallucination(text: str) -> bool:
    cleaned = text.strip()
    if len(cleaned) <= 1:
        return True
    return cleaned.lower() in HALLUCINATIONS


class LocalAsrEngine:
    def __init__(self, model_name: str, device: str, compute_type: str):
        self.model_name = model_name
        print(f"[EchoSub Local ASR] Loading faster-whisper '{model_name}' ({device}/{compute_type})...")
        t0 = time.perf_counter()
        self.model = WhisperModel(model_name, device=device, compute_type=compute_type)
        print(f"[EchoSub Local ASR] Model ready in {time.perf_counter() - t0:.2f}s!")

    def transcribe(self, raw_pcm: bytes, language: Optional[str]) -> tuple[str, Optional[str], int]:
        t0 = time.perf_counter()
        audio = np.frombuffer(raw_pcm, dtype=np.int16).astype(np.float32) / 32768.0
        segments, info = self.model.transcribe(
            audio,
            language=language,
            beam_size=1,
            best_of=1,
            vad_filter=False,
            condition_on_previous_text=False,
        )
        text = " ".join(s.text.strip() for s in segments).strip()
        latency_ms = int((time.perf_counter() - t0) * 1000)
        detected = getattr(info, "language", None)
        return text, detected, latency_ms


async def handle_client(ws, engine: LocalAsrEngine, auth_token: Optional[str]):
    pcm_chunks: list[bytes] = []
    buffered_bytes = 0
    last_partial_bytes = 0
    language: Optional[str] = None
    loop = asyncio.get_running_loop()

    try:
        async for message in ws:
            if isinstance(message, bytes):
                pcm_chunks.append(message)
                buffered_bytes += len(message)

                # Emit rolling interim result every ~1.4s of speech
                if (
                    buffered_bytes >= int(BYTES_PER_SECOND * 1.1)
                    and buffered_bytes - last_partial_bytes >= int(BYTES_PER_SECOND * 1.4)
                ):
                    last_partial_bytes = buffered_bytes
                    snapshot = b"".join(pcm_chunks)
                    text, detected, latency = await loop.run_in_executor(
                        None, engine.transcribe, snapshot, language
                    )
                    if text and not is_hallucination(text):
                        await ws.send(
                            json.dumps(
                                {
                                    "type": "partial",
                                    "text": text,
                                    "language": detected,
                                    "latencyMs": latency,
                                },
                                ensure_ascii=False,
                            )
                        )

                # Force segment finalize at ~7.5s continuous speech
                if buffered_bytes >= int(BYTES_PER_SECOND * 7.5):
                    snapshot = b"".join(pcm_chunks)
                    pcm_chunks.clear()
                    buffered_bytes = 0
                    last_partial_bytes = 0
                    text, detected, latency = await loop.run_in_executor(
                        None, engine.transcribe, snapshot, language
                    )
                    if text and not is_hallucination(text):
                        await ws.send(
                            json.dumps(
                                {
                                    "type": "final",
                                    "text": text,
                                    "language": detected,
                                    "latencyMs": latency,
                                },
                                ensure_ascii=False,
                            )
                        )
            else:
                try:
                    ctrl = json.loads(message)
                except json.JSONDecodeError:
                    continue

                msg_type = ctrl.get("type")
                if msg_type == "ping":
                    await ws.send(
                        json.dumps(
                            {
                                "type": "pong",
                                "engine": "faster-whisper",
                                "model": engine.model_name,
                            }
                        )
                    )
                elif msg_type == "config":
                    if auth_token and ctrl.get("token") != auth_token:
                        await ws.close(code=4001, reason="Invalid token")
                        return
                    lang = ctrl.get("language")
                    language = None if not lang or lang == "auto" else str(lang).split("-")[0]
                elif msg_type in ("vad_end", "flush"):
                    if buffered_bytes >= int(BYTES_PER_SECOND * 0.35):
                        snapshot = b"".join(pcm_chunks)
                        pcm_chunks.clear()
                        buffered_bytes = 0
                        last_partial_bytes = 0
                        text, detected, latency = await loop.run_in_executor(
                            None, engine.transcribe, snapshot, language
                        )
                        if text and not is_hallucination(text):
                            await ws.send(
                                json.dumps(
                                    {
                                        "type": "final",
                                        "text": text,
                                        "language": detected,
                                        "latencyMs": latency,
                                    },
                                    ensure_ascii=False,
                                )
                            )
                    else:
                        pcm_chunks.clear()
                        buffered_bytes = 0
                        last_partial_bytes = 0
                elif msg_type == "stop":
                    pcm_chunks.clear()
                    buffered_bytes = 0
                    last_partial_bytes = 0
    except websockets.exceptions.ConnectionClosed:
        pass


async def run_server(host: str, port: int, engine: LocalAsrEngine, token: Optional[str]):
    print("=" * 60)
    print(f"  EchoSub Local Offline ASR Server is RUNNING!")
    print(f"  WebSocket URL : ws://{host}:{port}/ws/asr")
    print(f"  Model         : faster-whisper ({engine.model_name})")
    print("  Keep this window open while watching videos with EchoSub.")
    print("=" * 60)
    async with websockets.serve(
        lambda ws: handle_client(ws, engine, token),
        host,
        port,
        max_size=4 * 1024 * 1024,
    ):
        await asyncio.Future()


def main():
    parser = argparse.ArgumentParser(description="EchoSub Local Offline ASR Server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument(
        "--model",
        default="base",
        help="Whisper model size: tiny, base (fast CPU default), small (higher accuracy), medium",
    )
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    parser.add_argument("--compute-type", default="int8")
    parser.add_argument("--token", default=None)
    args = parser.parse_args()

    engine = LocalAsrEngine(args.model, args.device, args.compute_type)
    asyncio.run(run_server(args.host, args.port, engine, args.token))


if __name__ == "__main__":
    main()
