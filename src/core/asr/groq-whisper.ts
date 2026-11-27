import {
  TARGET_SAMPLE_RATE,
  concatInt16Arrays,
  encodeWavFromInt16,
} from '../audio/resampler';
import { PcmRingBuffer } from '../audio/ring-buffer';
import {
  isLikelyHallucination,
  type AsrAdapter,
  type AsrAdapterCallbacks,
} from './types';

export interface GroqWhisperConfig {
  apiKey: string;
  model: string;
  language: string;
  timingMode?: 'realtime' | 'sentence';
  /** Interval between interim recognition snapshots while speaking (ms). */
  interimIntervalMs?: number;
  /** Maximum utterance duration before forcing a final segment (ms). */
  maxUtteranceMs?: number;
}

const GROQ_TRANSCRIPTIONS_URL =
  'https://api.groq.com/openai/v1/audio/transcriptions';

/**
 * Quasi-streaming Groq Whisper adapter.
 * Uses VAD utterance boundaries + rolling interim snapshots (~1.4s cadence)
 * over ultra-fast Groq Whisper-large-v3-turbo (~300ms inference).
 */
export class GroqWhisperAsrAdapter implements AsrAdapter {
  readonly id = 'groq' as const;
  private readonly preRoll = new PcmRingBuffer(Math.floor(TARGET_SAMPLE_RATE * 0.32));
  private readonly timingMode: 'realtime' | 'sentence';
  private readonly interimIntervalMs: number;
  private readonly maxUtteranceMs: number;
  private readonly minInterimDurationMs: number;

  private callbacks: AsrAdapterCallbacks | null = null;
  private chunks: Int16Array[] = [];
  private sampleCount = 0;
  private wasSpeech = false;
  private lastInterimSampleCount = 0;
  private interimController: AbortController | null = null;
  private interimInFlight = false;
  private previousContextPrompt = '';
  private stopped = false;

  constructor(private readonly config: GroqWhisperConfig) {
    this.timingMode = config.timingMode ?? 'realtime';
    this.interimIntervalMs =
      config.interimIntervalMs ?? (this.timingMode === 'realtime' ? 750 : 999999);
    this.minInterimDurationMs = this.timingMode === 'realtime' ? 550 : 999999;
    this.maxUtteranceMs =
      config.maxUtteranceMs ?? (this.timingMode === 'realtime' ? 4000 : 7200);
  }

  async start(callbacks: AsrAdapterCallbacks): Promise<void> {
    if (!this.config.apiKey.trim()) {
      throw new Error('Groq API Key is required. Configure it in Settings.');
    }
    this.callbacks = callbacks;
    this.stopped = false;
    this.chunks = [];
    this.sampleCount = 0;
    this.wasSpeech = false;
    this.lastInterimSampleCount = 0;
    this.preRoll.clear();
    callbacks.onStatusChange?.('connected');
  }

  pushAudio(pcm16k: Int16Array, isSpeech: boolean, elapsedMs: number): void {
    if (this.stopped) return;

    if (!isSpeech && !this.wasSpeech) {
      this.preRoll.push(pcm16k);
      return;
    }

    if (isSpeech && !this.wasSpeech) {
      // Speech just started: prepend pre-roll so initial consonants are never clipped
      const leadIn = this.preRoll.readAll();
      if (leadIn.length > 0) {
        this.chunks.push(leadIn);
        this.sampleCount += leadIn.length;
      }
      this.preRoll.clear();
      this.wasSpeech = true;
    }

    this.chunks.push(new Int16Array(pcm16k));
    this.sampleCount += pcm16k.length;

    const durationMs = (this.sampleCount / TARGET_SAMPLE_RATE) * 1000;
    const deltaMs =
      ((this.sampleCount - this.lastInterimSampleCount) / TARGET_SAMPLE_RATE) * 1000;

    if (!isSpeech && this.wasSpeech) {
      // Speech ended via VAD hangover -> finalize segment
      this.wasSpeech = false;
      void this.commitBuffer(true, elapsedMs);
      return;
    }

    if (durationMs >= this.maxUtteranceMs) {
      // Hard max length -> force finalize and keep speaking cleanly
      void this.commitBuffer(true, elapsedMs);
      return;
    }

    if (
      this.timingMode === 'realtime' &&
      durationMs >= this.minInterimDurationMs &&
      deltaMs >= this.interimIntervalMs &&
      !this.interimInFlight
    ) {
      this.lastInterimSampleCount = this.sampleCount;
      const snapshot = concatInt16Arrays(this.chunks);
      void this.dispatchInterim(snapshot, elapsedMs);
    }
  }

  async flush(elapsedMs: number): Promise<void> {
    if (this.sampleCount > TARGET_SAMPLE_RATE * 0.35) {
      await this.commitBuffer(true, elapsedMs);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.interimController?.abort();
    this.interimController = null;
    this.chunks = [];
    this.sampleCount = 0;
    this.preRoll.clear();
    this.callbacks?.onStatusChange?.('disconnected');
  }

  private async dispatchInterim(pcm: Int16Array, elapsedMs: number): Promise<void> {
    this.interimController?.abort();
    const controller = new AbortController();
    this.interimController = controller;
    this.interimInFlight = true;

    try {
      const started = performance.now();
      const text = await this.transcribeWav(pcm, controller.signal);
      if (this.stopped || controller.signal.aborted) return;
      if (text && !isLikelyHallucination(text)) {
        this.callbacks?.onTranscript({
          text,
          isFinal: false,
          timestampMs: elapsedMs,
          latencyMs: Math.round(performance.now() - started),
        });
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      this.callbacks?.onError(err as Error);
    } finally {
      if (this.interimController === controller) {
        this.interimInFlight = false;
      }
    }
  }

  private async commitBuffer(isFinal: boolean, elapsedMs: number): Promise<void> {
    if (this.sampleCount < TARGET_SAMPLE_RATE * 0.32) {
      this.chunks = [];
      this.sampleCount = 0;
      this.lastInterimSampleCount = 0;
      return;
    }

    const pcm = concatInt16Arrays(this.chunks);
    this.chunks = [];
    this.sampleCount = 0;
    this.lastInterimSampleCount = 0;
    this.interimController?.abort();
    this.interimInFlight = false;

    try {
      const started = performance.now();
      const text = await this.transcribeWav(pcm);
      if (this.stopped) return;
      if (text && !isLikelyHallucination(text)) {
        this.previousContextPrompt = text.slice(-140);
        this.callbacks?.onTranscript({
          text,
          isFinal,
          timestampMs: elapsedMs,
          latencyMs: Math.round(performance.now() - started),
        });
      }
    } catch (err) {
      this.callbacks?.onError(err as Error);
    }
  }

  private async transcribeWav(
    pcm: Int16Array,
    signal?: AbortSignal
  ): Promise<string> {
    const wav = encodeWavFromInt16(pcm, TARGET_SAMPLE_RATE);
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
    form.append('model', this.config.model || 'whisper-large-v3-turbo');
    form.append('response_format', 'json');
    form.append('temperature', '0');

    if (this.config.language && this.config.language !== 'auto') {
      form.append('language', this.config.language.split('-')[0]);
    }
    if (this.previousContextPrompt) {
      form.append('prompt', this.previousContextPrompt);
    }

    const res = await fetch(GROQ_TRANSCRIPTIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey.trim()}`,
      },
      body: form,
      signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new Error(`Groq ASR HTTP ${res.status}: ${detail.slice(0, 180)}`);
    }

    const data = (await res.json()) as { text?: string };
    return (data.text ?? '').trim();
  }
}
