# EchoSub Local Offline WebSocket ASR Protocol (`echosub-v1`)

EchoSub supports **zero-cloud-cost offline speech recognition** by streaming 16kHz mono Int16 PCM frames over a local WebSocket (`ws://127.0.0.1:8765/ws/asr`).

You can connect:
- **WhisperLiveKit** (supported natively via built-in payload compatibility)
- **SenseVoice / FunASR** (via a lightweight Python WebSocket bridge)
- **faster-whisper / whisper.cpp** (via the reference bridge below)

---

## 1. Wire Protocol Specification

### Client (EchoSub) → Server

1. **Handshake config (JSON text frame, sent immediately on `open`)**:
   ```json
   {
     "type": "config",
     "protocol": "echosub-v1",
     "sampleRate": 16000,
     "channels": 1,
     "format": "pcm_s16le",
     "language": "auto",
     "token": "optional-auth-token"
   }
   ```
2. **Audio data (Binary frames)**:
   - Raw little-endian signed 16-bit PCM (`pcm_s16le`), mono, 16,000 Hz.
   - Emitted in 40ms frames (640 samples = 1,280 bytes) whenever EchoSub's VAD detects voice activity (with a 320ms pre-roll lead-in).
3. **Control signals (JSON text frames)**:
   - `{ "type": "vad_end" }` — VAD detected end of utterance (server may finalize current hypothesis).
   - `{ "type": "flush" }` — Request server to flush buffered audio.
   - `{ "type": "stop" }` — Session closing cleanly.

### Server → Client (EchoSub)

Send UTF-8 JSON text frames in **either** EchoSub native format or WhisperLiveKit format:

- **EchoSub Native Format (Recommended)**:
  ```json
  {
    "type": "partial",
    "text": "Today we are diving into Web Audio",
    "language": "en",
    "latencyMs": 140
  }
  ```
  ```json
  {
    "type": "final",
    "text": "Today we are diving into Web Audio Worklets.",
    "language": "en",
    "latencyMs": 185
  }
  ```

- **WhisperLiveKit Compatible Format** (parsed automatically by EchoSub):
  ```json
  {
    "lines": [{ "text": "Confirmed sentence." }],
    "buffer_transcription": "ongoing live tokens"
  }
  ```

---

## 2. Minimal Python Reference Server (`faster-whisper`)

```bash
pip install websockets faster-whisper numpy
```

```python
import asyncio
import json
import numpy as np
import websockets
from faster_whisper import WhisperModel

model = WhisperModel("small", device="auto", compute_type="int8")

async def handle_asr(ws):
    pcm_chunks = []
    language = None

    async for message in ws:
        if isinstance(message, bytes):
            pcm_chunks.append(message)
            # Emit an interim hypothesis every ~1.6s of buffered speech
            total_bytes = sum(len(c) for c in pcm_chunks)
            if total_bytes >= 16000 * 2 * 1.6:
                text = transcribe(b"".join(pcm_chunks), language)
                if text:
                    await ws.send(json.dumps({"type": "partial", "text": text}))
        else:
            ctrl = json.loads(message)
            if ctrl.get("type") == "config":
                lang = ctrl.get("language")
                language = None if not lang or lang == "auto" else lang.split("-")[0]
            elif ctrl.get("type") in ("vad_end", "flush") and pcm_chunks:
                text = transcribe(b"".join(pcm_chunks), language)
                pcm_chunks.clear()
                if text:
                    await ws.send(json.dumps({"type": "final", "text": text}))

def transcribe(raw_pcm: bytes, language):
    audio = np.frombuffer(raw_pcm, dtype=np.int16).astype(np.float32) / 32768.0
    segments, _ = model.transcribe(audio, language=language, vad_filter=False)
    return " ".join(s.text.strip() for s in segments).strip()

async def main():
    async with websockets.serve(handle_asr, "127.0.0.1", 8765):
        print("EchoSub Local ASR listening on ws://127.0.0.1:8765/ws/asr")
        await asyncio.Future()

asyncio.run(main())
```
