import { TARGET_SAMPLE_RATE } from '../audio/resampler';
import { PcmRingBuffer } from '../audio/ring-buffer';
import type { AsrAdapter, AsrAdapterCallbacks } from './types';

export interface DashScopeConfig {
  apiKey: string;
  model: string;
  language: string;
}

const DASHSCOPE_WS_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';

/**
 * Aliyun Bailian (DashScope) Paraformer-realtime-v2 Streaming WebSocket Adapter.
 *
 * Domestic China network friendly & low cost.
 * Because native browser WebSockets cannot pass arbitrary HTTP headers,
 * EchoSub's Background Service Worker dynamically registers a temporary MV3
 * declarativeNetRequest session rule to inject `Authorization: Bearer <key>`
 * exclusively for `wss://dashscope.aliyuncs.com/` handshake requests.
 */
export class DashScopeAsrAdapter implements AsrAdapter {
  readonly id = 'dashscope' as const;
  private readonly preRoll = new PcmRingBuffer(Math.floor(TARGET_SAMPLE_RATE * 0.28));

  private ws: WebSocket | null = null;
  private callbacks: AsrAdapterCallbacks | null = null;
  private taskId = '';
  private taskReady = false;
  private stopped = false;
  private wasSpeech = false;
  private lastAudioSentAt = 0;
  private latestElapsedMs = 0;

  constructor(private readonly config: DashScopeConfig) {}

  async start(callbacks: AsrAdapterCallbacks): Promise<void> {
    if (!this.config.apiKey.trim()) {
      throw new Error('阿里云百炼 DashScope API Key 不能为空，请在设置中填写。');
    }
    this.callbacks = callbacks;
    this.stopped = false;
    this.taskReady = false;
    this.taskId = crypto.randomUUID().replace(/-/g, '');
    await this.connect();
  }

  pushAudio(pcm16k: Int16Array, isSpeech: boolean, elapsedMs: number): void {
    this.latestElapsedMs = elapsedMs;
    if (this.stopped) return;

    if (!isSpeech && !this.wasSpeech) {
      this.preRoll.push(pcm16k);
      return;
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.taskReady) {
      return;
    }

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
      this.ws.send(
        pcm16k.buffer.slice(pcm16k.byteOffset, pcm16k.byteOffset + pcm16k.byteLength)
      );
    }
  }

  async flush(_elapsedMs: number): Promise<void> {
    // DashScope auto-segments sentences via server-side VAD
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.taskReady = false;
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN && this.taskId) {
          this.ws.send(
            JSON.stringify({
              header: {
                action: 'finish-task',
                task_id: this.taskId,
                streaming: 'duplex',
              },
              payload: { input: {} },
            })
          );
        }
        this.ws.close();
      } catch {
        // Ignore close errors
      }
      this.ws = null;
    }
    this.callbacks?.onStatusChange?.('disconnected');
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(DASHSCOPE_WS_URL);
      this.ws = ws;

      ws.onopen = () => {
        const languageHints =
          this.config.language && this.config.language !== 'auto'
            ? [this.config.language.split('-')[0]]
            : ['en', 'zh', 'ja', 'ko'];

        ws.send(
          JSON.stringify({
            header: {
              action: 'run-task',
              task_id: this.taskId,
              streaming: 'duplex',
            },
            payload: {
              task_group: 'audio',
              task: 'asr',
              function: 'recognition',
              model: this.config.model || 'paraformer-realtime-v2',
              parameters: {
                format: 'pcm',
                sample_rate: TARGET_SAMPLE_RATE,
                punctuation_prediction_enabled: true,
                language_hints: languageHints,
              },
              input: {},
            },
          })
        );
      };

      ws.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        try {
          const msg = JSON.parse(event.data) as {
            header?: { event?: string; error_message?: string };
            payload?: {
              output?: {
                sentence?: {
                  text?: string;
                  sentence_end?: boolean;
                };
              };
            };
          };

          const ev = msg.header?.event;
          if (ev === 'task-started') {
            this.taskReady = true;
            this.callbacks?.onStatusChange?.('connected');
            if (!settled) {
              settled = true;
              resolve();
            }
            return;
          }

          if (ev === 'task-failed') {
            const err = new Error(
              `DashScope ASR failed: ${msg.header?.error_message ?? 'Unknown error'}`
            );
            if (!settled) {
              settled = true;
              reject(err);
            } else {
              this.callbacks?.onError(err);
            }
            return;
          }

          if (ev === 'result-generated') {
            const sentence = msg.payload?.output?.sentence;
            const text = sentence?.text?.trim() ?? '';
            if (!text) return;

            const latencyMs =
              this.lastAudioSentAt > 0
                ? Math.max(50, Math.round(performance.now() - this.lastAudioSentAt))
                : undefined;

            this.callbacks?.onTranscript({
              text,
              isFinal: Boolean(sentence?.sentence_end),
              timestampMs: this.latestElapsedMs,
              latencyMs,
            });
          }
        } catch {
          // Ignore non-JSON frames
        }
      };

      ws.onerror = () => {
        const err = new Error(
          '无法连接阿里云百炼 DashScope WebSocket，请确认 API Key 有效且已开通 Paraformer 服务。'
        );
        if (!settled) {
          settled = true;
          reject(err);
        } else {
          this.callbacks?.onError(err);
        }
      };

      ws.onclose = () => {
        this.taskReady = false;
        if (!this.stopped && !settled) {
          settled = true;
          reject(new Error('DashScope WebSocket closed before task-started.'));
        }
      };
    });
  }
}
