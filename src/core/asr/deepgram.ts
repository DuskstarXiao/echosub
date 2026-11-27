import { TARGET_SAMPLE_RATE } from '../audio/resampler';
import { PcmRingBuffer } from '../audio/ring-buffer';
import type { AsrAdapter, AsrAdapterCallbacks } from './types';

export interface DeepgramConfig {
  apiKey: string;
  model: string;
  language: string;
}

/**
 * Native streaming WebSocket ASR adapter for Deepgram Nova-2/3.
 * Authenticates via WebSocket subprotocol ['token', apiKey] (browser-native, no proxy needed).
 */
export class DeepgramAsrAdapter implements AsrAdapter {
  readonly id = 'deepgram' as const;
  private readonly preRoll = new PcmRingBuffer(Math.floor(TARGET_SAMPLE_RATE * 0.28));

  private ws: WebSocket | null = null;
  private callbacks: AsrAdapterCallbacks | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private reconnectAttempts = 0;
  private wasSpeech = false;
  private lastAudioSentAt = 0;
  private latestElapsedMs = 0;

  constructor(private readonly config: DeepgramConfig) {}

  async start(callbacks: AsrAdapterCallbacks): Promise<void> {
    if (!this.config.apiKey.trim()) {
      throw new Error('Deepgram API Key is required. Configure it in Settings.');
    }
    this.callbacks = callbacks;
    this.stopped = false;
    this.reconnectAttempts = 0;
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
        this.ws.send(leadIn.buffer.slice(leadIn.byteOffset, leadIn.byteOffset + leadIn.byteLength));
      }
      this.preRoll.clear();
      this.wasSpeech = true;
    }

    if (isSpeech) {
      this.ws.send(pcm16k.buffer.slice(pcm16k.byteOffset, pcm16k.byteOffset + pcm16k.byteLength));
      this.lastAudioSentAt = performance.now();
    } else if (this.wasSpeech) {
      this.wasSpeech = false;
      // Send a final trailing silent chunk to prompt clean endpointing
      this.ws.send(pcm16k.buffer.slice(pcm16k.byteOffset, pcm16k.byteOffset + pcm16k.byteLength));
    }
  }

  async flush(_elapsedMs: number): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'Finalize' }));
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.clearTimers();
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'CloseStream' }));
        }
        this.ws.close();
      } catch {
        // Ignore close errors
      }
      this.ws = null;
    }
    this.callbacks?.onStatusChange?.('disconnected');
  }

  private buildUrl(): string {
    const params = new URLSearchParams({
      model: this.config.model || 'nova-2',
      encoding: 'linear16',
      sample_rate: String(TARGET_SAMPLE_RATE),
      channels: '1',
      interim_results: 'true',
      punctuate: 'true',
      smart_format: 'true',
      diarize: 'true',
      endpointing: '350',
    });

    if (this.config.language && this.config.language !== 'auto') {
      params.set('language', this.config.language);
    } else {
      params.set('detect_language', 'true');
    }

    return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.buildUrl(), [
        'token',
        this.config.apiKey.trim(),
      ]);
      this.ws = ws;

      ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.callbacks?.onStatusChange?.('connected');
        this.startKeepAlive();
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      ws.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        try {
          const msg = JSON.parse(event.data) as {
            type?: string;
            is_final?: boolean;
            speech_final?: boolean;
            channel?: {
              detected_language?: string;
              alternatives?: Array<{
                transcript?: string;
                words?: Array<{ speaker?: number }>;
              }>;
            };
          };
          if (msg.type !== 'Results') return;
          const alt = msg.channel?.alternatives?.[0];
          const transcript = alt?.transcript?.trim() ?? '';
          if (!transcript) return;
          const speakerIndex = alt?.words?.[0]?.speaker;

          const latencyMs =
            this.lastAudioSentAt > 0
              ? Math.max(50, Math.round(performance.now() - this.lastAudioSentAt))
              : undefined;

          this.callbacks?.onTranscript({
            text: transcript,
            isFinal: Boolean(msg.is_final || msg.speech_final),
            language: msg.channel?.detected_language,
            speakerIndex:
              typeof speakerIndex === 'number' ? speakerIndex : undefined,
            timestampMs: this.latestElapsedMs,
            latencyMs,
          });
        } catch {
          // Ignore malformed keepalive frames
        }
      };

      ws.onerror = () => {
        const err = new Error('Deepgram WebSocket connection error. Verify API key & network.');
        if (!settled) {
          settled = true;
          reject(err);
        } else {
          this.callbacks?.onError(err);
        }
      };

      ws.onclose = () => {
        this.clearKeepAlive();
        if (this.stopped) return;
        this.scheduleReconnect();
      };
    });
  }

  private startKeepAlive(): void {
    this.clearKeepAlive();
    this.keepAliveTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
      }
    }, 5000);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectAttempts >= 5) {
      this.callbacks?.onError(new Error('Deepgram WebSocket disconnected after retries.'));
      return;
    }
    this.reconnectAttempts++;
    this.callbacks?.onStatusChange?.('reconnecting');
    const delay = Math.min(8000, 1000 * Math.pow(1.8, this.reconnectAttempts - 1));
    this.reconnectTimer = setTimeout(() => {
      void this.connect().catch((err) => this.callbacks?.onError(err as Error));
    }, delay);
  }

  private clearKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearKeepAlive();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
