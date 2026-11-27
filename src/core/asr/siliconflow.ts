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

export interface SiliconFlowAsrConfig {
  apiKey: string;
  model?: string;
  /** 'realtime' emits fast rolling interims; 'sentence' skips word-by-word interims and commits full sentences. */
  timingMode?: 'realtime' | 'sentence';
  interimIntervalMs?: number;
  maxUtteranceMs?: number;
}

export const SILICONFLOW_ASR_URL =
  'https://api.siliconflow.cn/v1/audio/transcriptions';

export function sanitizeApiKey(raw: string): string {
  return raw.trim().replace(/^Bearer\s+/i, '').trim();
}

/**
 * Strips SenseVoice rich-transcription metadata tags such as:
 * `<|en|><|NEUTRAL|><|Speech|><|withitn|>` -> clean subtitle text.
 */
export function cleanSenseVoiceText(raw: string): string {
  return raw
    .replace(/<\|[^|>]+\|>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * SiliconFlow (硅基流动) FREE FunAudioLLM/SenseVoiceSmall ASR Adapter.
 *
 * - Mainland China direct connection (no proxy needed)
 * - ¥0 free tier hosted by SiliconFlow
 * - Non-autoregressive inference (~200-450ms) supporting ZH / EN / JA / KO / YUE
 */
export class SiliconFlowSenseVoiceAdapter implements AsrAdapter {
  readonly id = 'siliconflow' as const;
  private readonly preRoll = new PcmRingBuffer(
    Math.floor(TARGET_SAMPLE_RATE * 0.32)
  );
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
  private stopped = false;

  constructor(private readonly config: SiliconFlowAsrConfig) {
    this.timingMode = config.timingMode ?? 'realtime';
    this.interimIntervalMs =
      config.interimIntervalMs ?? (this.timingMode === 'realtime' ? 720 : 999999);
    this.minInterimDurationMs = this.timingMode === 'realtime' ? 520 : 999999;
    this.maxUtteranceMs =
      config.maxUtteranceMs ?? (this.timingMode === 'realtime' ? 3800 : 7200);
  }

  async start(callbacks: AsrAdapterCallbacks): Promise<void> {
    if (!this.config.apiKey.trim()) {
      throw new Error(
        '请先填写硅基流动免费 API Key（在「引擎设置」点击免费领取按钮，30 秒即可开通）。'
      );
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
      ((this.sampleCount - this.lastInterimSampleCount) / TARGET_SAMPLE_RATE) *
      1000;

    if (!isSpeech && this.wasSpeech) {
      this.wasSpeech = false;
      void this.commitBuffer(true, elapsedMs);
      return;
    }

    if (durationMs >= this.maxUtteranceMs) {
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

  private async dispatchInterim(
    pcm: Int16Array,
    elapsedMs: number
  ): Promise<void> {
    this.interimController?.abort();
    const controller = new AbortController();
    this.interimController = controller;
    this.interimInFlight = true;

    try {
      const started = performance.now();
      const raw = await this.transcribeWav(pcm, controller.signal);
      if (this.stopped || controller.signal.aborted) return;
      const text = cleanSenseVoiceText(raw);
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

  private async commitBuffer(
    isFinal: boolean,
    elapsedMs: number
  ): Promise<void> {
    if (this.sampleCount < TARGET_SAMPLE_RATE * 0.3) {
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
      const raw = await this.transcribeWav(pcm);
      if (this.stopped) return;
      const text = cleanSenseVoiceText(raw);
      if (text && !isLikelyHallucination(text)) {
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
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav');
    form.append('model', this.config.model || 'FunAudioLLM/SenseVoiceSmall');

    const res = await fetch(SILICONFLOW_ASR_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sanitizeApiKey(this.config.apiKey)}`,
        Accept: 'application/json',
      },
      body: form,
      signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new Error(`硅基流动 ASR HTTP ${res.status}: ${detail.slice(0, 180)}`);
    }

    const data = (await res.json()) as { text?: string };
    return (data.text ?? '').trim();
  }
}

/**
 * Verifies a SiliconFlow API key against the free SenseVoiceSmall endpoint using a 0.6s tone WAV.
 */
export async function testSiliconFlowAsr(
  apiKey: string,
  model = 'FunAudioLLM/SenseVoiceSmall'
): Promise<{ latencyMs: number }> {
  const cleanKey = sanitizeApiKey(apiKey);
  if (!cleanKey) {
    throw new Error('请先粘贴硅基流动 API Key（以 sk- 开头）');
  }

  // Generate a valid 0.6s 440Hz soft sine wave so strict WAV/VAD validators accept it cleanly
  const sampleCount = Math.floor(TARGET_SAMPLE_RATE * 0.6);
  const testPcm = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    testPcm[i] = Math.round(
      Math.sin((2 * Math.PI * 440 * i) / TARGET_SAMPLE_RATE) * 1800
    );
  }
  const wav = encodeWavFromInt16(testPcm, TARGET_SAMPLE_RATE);
  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'ping.wav');
  form.append('model', model || 'FunAudioLLM/SenseVoiceSmall');

  const started = performance.now();
  const res = await fetch(SILICONFLOW_ASR_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cleanKey}`,
      Accept: 'application/json',
    },
    body: form,
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    if (res.status === 402) {
      throw new Error(
        '硅基流动账号未实名或余额为 ¥0.00 (HTTP 402)，需实名认证并充值 ¥0.01~¥1 激活网关后即可免费调用'
      );
    }
    if (res.status === 401) {
      throw new Error('API Key 无效或未复制完整 (HTTP 401)');
    }
    if (res.status === 403) {
      throw new Error('账号无权访问该模型或需实名认证 (HTTP 403)');
    }
    if (res.status === 429) {
      throw new Error('请求过于频繁触发限流，请稍后再试 (HTTP 429)');
    }
    throw new Error(`HTTP ${res.status}: ${detail.slice(0, 140)}`);
  }

  return { latencyMs: Math.round(performance.now() - started) };
}
