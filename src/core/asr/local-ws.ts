import { TARGET_SAMPLE_RATE } from '../audio/resampler';
import { PcmRingBuffer } from '../audio/ring-buffer';
import type { AsrAdapter, AsrAdapterCallbacks } from './types';

export interface LocalWsConfig {
  url: string;
  token?: string;
  language: string;
}

export interface ParsedLocalWsMessage {
  text: string;
  isFinal: boolean;
  language?: string;
  latencyMs?: number;
}

/**
 * Pure parser for EchoSub Local WebSocket ASR Protocol v1.
 * Also supports WhisperLiveKit-compatible payloads (`lines` + `buffer_transcription`)
 * and SenseVoice bridge JSON payloads out of the box.
 */
export function parseLocalWsPayload(raw: string): ParsedLocalWsMessage | null {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }

  // 1) EchoSub native protocol: { type: "partial" | "final", text: string, language?, latencyMs? }
  if (
    (msg.type === 'partial' || msg.type === 'final') &&
    typeof msg.text === 'string'
  ) {
    const text = msg.text.trim();
    if (!text) return null;
    return {
      text,
      isFinal: msg.type === 'final',
      language: typeof msg.language === 'string' ? msg.language : undefined,
      latencyMs: typeof msg.latencyMs === 'number' ? msg.latencyMs : undefined,
    };
  }

  // 2) WhisperLiveKit compatibility: { lines: [{ text }], buffer_transcription: "..." }
  if (Array.isArray(msg.lines) || typeof msg.buffer_transcription === 'string') {
    const lines = Array.isArray(msg.lines)
      ? (msg.lines as Array<{ text?: string }>)
      : [];
    const lastLine = lines.length > 0 ? (lines[lines.length - 1]?.text ?? '').trim() : '';
    const buffer =
      typeof msg.buffer_transcription === 'string'
        ? msg.buffer_transcription.trim()
        : '';
    const combined = [lastLine, buffer].filter(Boolean).join(' ').trim();
    if (!combined) return null;
    return {
      text: combined,
      isFinal: buffer.length === 0 && lastLine.length > 0,
    };
  }

  return null;
}

/**
 * Geek-mode Offline Local WebSocket ASR Adapter.
 * Connects to a local WhisperLiveKit / SenseVoice / faster-whisper WebSocket server
 * at zero cloud API cost.
 */
export class LocalWsAsrAdapter implements AsrAdapter {
  readonly id = 'local-ws' as const;
  private readonly preRoll = new PcmRingBuffer(Math.floor(TARGET_SAMPLE_RATE * 0.32));

  private ws: WebSocket | null = null;
  private callbacks: AsrAdapterCallbacks | null = null;
  private stopped = false;
  private wasSpeech = false;
  private lastAudioSentAt = 0;
  private latestElapsedMs = 0;

  constructor(private readonly config: LocalWsConfig) {}

  async start(callbacks: AsrAdapterCallbacks): Promise<void> {
    if (!this.config.url.trim()) {
      throw new Error('Local WebSocket URL is required (e.g. ws://127.0.0.1:8765/ws/asr).');
    }
    this.callbacks = callbacks;
    this.stopped = false;
    await this.connect();
  }

  pushAudio(pcm16k: Int16Array, isSpeech: boolean, elapsedMs: number): void {
    this.latestElapsedMs = elapsedMs;
    if (this.stopped) return;

    if (!isSpeech && !this.wasSpeech) {
      this.preRoll.push(pcm16k);
      return;
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    if (isSpeech && !this.wasSpeech) {
      const leadIn = this.preRoll.readAll();
      if (leadIn.length > 0) {
        this.ws.send(
          leadIn.buffer.slice(leadIn.byteOffset, leadIn.byteOffset + leadIn.byteLength)
        );
      }
      this.preRoll.clear();
      this.wasSpeech = true;
    }

    if (isSpeech) {
      this.ws.send(
        pcm16k.buffer.slice(pcm16k.byteOffset, pcm16k.byteOffset + pcm16k.byteLength)
      );
      this.lastAudioSentAt = performance.now();
    } else if (this.wasSpeech) {
      this.wasSpeech = false;
      this.ws.send(JSON.stringify({ type: 'vad_end' }));
    }
  }

  async flush(_elapsedMs: number): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'flush' }));
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'stop' }));
        }
        this.ws.close();
      } catch {
        // Ignore
      }
      this.ws = null;
    }
    this.callbacks?.onStatusChange?.('disconnected');
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.config.url.trim());
      this.ws = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'config',
            protocol: 'echosub-v1',
            sampleRate: TARGET_SAMPLE_RATE,
            channels: 1,
            format: 'pcm_s16le',
            language: this.config.language,
            token: this.config.token || undefined,
          })
        );
        this.callbacks?.onStatusChange?.('connected');
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      ws.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        const parsed = parseLocalWsPayload(event.data);
        if (!parsed) return;

        const computedLatency =
          parsed.latencyMs ??
          (this.lastAudioSentAt > 0
            ? Math.max(20, Math.round(performance.now() - this.lastAudioSentAt))
            : undefined);

        this.callbacks?.onTranscript({
          text: parsed.text,
          isFinal: parsed.isFinal,
          language: parsed.language,
          timestampMs: this.latestElapsedMs,
          latencyMs: computedLatency,
        });
      };

      ws.onerror = () => {
        const err = new Error(
          `Cannot connect to local ASR server at ${this.config.url}. Check docs/LOCAL_WS_PROTOCOL.md.`
        );
        if (!settled) {
          settled = true;
          reject(err);
        } else {
          this.callbacks?.onError(err);
        }
      };

      ws.onclose = () => {
        if (!this.stopped) {
          this.callbacks?.onStatusChange?.('disconnected');
        }
      };
    });
  }
}
