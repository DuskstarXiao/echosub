import type { AsrAdapter, AsrAdapterCallbacks } from './types';

interface DemoUtterance {
  chunks: string[];
  finalText: string;
}

const DEMO_SCRIPT: readonly DemoUtterance[] = [
  {
    chunks: [
      'Welcome to EchoSub,',
      'Welcome to EchoSub, an open-source Chrome extension',
      'Welcome to EchoSub, an open-source Chrome extension for real-time bilingual subtitles.',
    ],
    finalText:
      'Welcome to EchoSub, an open-source Chrome extension for real-time bilingual subtitles.',
  },
  {
    chunks: [
      'Unlike heavy browser-side',
      'Unlike heavy browser-side Whisper models, we stream',
      'Unlike heavy browser-side Whisper models, we stream 16kHz PCM audio through an AudioWorklet.',
    ],
    finalText:
      'Unlike heavy browser-side Whisper models, we stream 16kHz PCM audio through an AudioWorklet.',
  },
  {
    chunks: [
      'Your original tab audio',
      'Your original tab audio plays directly to AudioContext destination',
      'Your original tab audio plays directly to AudioContext destination so the video is never muted.',
    ],
    finalText:
      'Your original tab audio plays directly to AudioContext destination so the video is never muted.',
  },
  {
    chunks: [
      'Stable prefix locking',
      'Stable prefix locking prevents subtitle flickering',
      'Stable prefix locking prevents subtitle flickering while Top-Layer keeps captions visible in fullscreen.',
    ],
    finalText:
      'Stable prefix locking prevents subtitle flickering while Top-Layer keeps captions visible in fullscreen.',
  },
  {
    chunks: [
      'Switch to Groq, DashScope,',
      'Switch to Groq, DashScope, Deepgram, or a local WebSocket',
      'Switch to Groq, DashScope, Deepgram, or a local WebSocket server anytime in Settings.',
    ],
    finalText:
      'Switch to Groq, DashScope, Deepgram, or a local WebSocket server anytime in Settings.',
  },
];

/**
 * Zero-Key Streaming Demo ASR Adapter.
 * Emits realistic progressive partial + final captions so users can immediately
 * experience fullscreen Top-Layer rendering, stabilization, translation, and export
 * before configuring any cloud or local ASR API key.
 */
export class DemoAsrAdapter implements AsrAdapter {
  readonly id = 'demo' as const;
  private callbacks: AsrAdapterCallbacks | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private startedAt = 0;
  private lineIndex = 0;
  private chunkIndex = 0;

  async start(callbacks: AsrAdapterCallbacks): Promise<void> {
    this.callbacks = callbacks;
    this.stopped = false;
    this.startedAt = Date.now();
    this.lineIndex = 0;
    this.chunkIndex = 0;
    callbacks.onStatusChange?.('connected');
    this.scheduleNext(450);
  }

  pushAudio(_pcm16k: Int16Array, _isSpeech: boolean, _elapsedMs: number): void {
    // Real audio metrics still flow from AudioWorklet to the live waveform UI
  }

  async flush(_elapsedMs: number): Promise<void> {
    // No-op in demo mode
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.callbacks?.onStatusChange?.('disconnected');
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => this.tick(), delayMs);
  }

  private tick(): void {
    if (this.stopped || !this.callbacks) return;

    const item = DEMO_SCRIPT[this.lineIndex % DEMO_SCRIPT.length];
    const elapsedMs = Date.now() - this.startedAt;
    const speakerIndex = this.lineIndex % 2;

    if (this.chunkIndex < item.chunks.length) {
      this.callbacks.onTranscript({
        text: item.chunks[this.chunkIndex],
        isFinal: false,
        language: 'en',
        speakerIndex,
        timestampMs: elapsedMs,
        latencyMs: 240 + Math.floor(Math.random() * 140),
      });
      this.chunkIndex++;
      this.scheduleNext(850);
    } else {
      this.callbacks.onTranscript({
        text: item.finalText,
        isFinal: true,
        language: 'en',
        speakerIndex,
        timestampMs: elapsedMs,
        latencyMs: 310 + Math.floor(Math.random() * 120),
      });
      this.lineIndex++;
      this.chunkIndex = 0;
      this.scheduleNext(1400);
    }
  }
}
