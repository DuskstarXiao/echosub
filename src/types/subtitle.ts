export type DisplayMode = 'bilingual' | 'translated' | 'source';

export type LineOrder = 'source-first' | 'translated-first';

export type CaptureMode = 'auto' | 'audio' | 'track';

export type SubtitleTimingMode = 'realtime' | 'sentence';

export type ActiveInputSource = 'idle' | 'audio' | 'track' | 'demo';

export interface SpeakerInfo {
  id: string;
  index: number;
  label: string;
  color: string;
  pitchHz?: number;
}

export interface SubtitleSegment {
  id: string;
  startMs: number;
  endMs: number;
  sourceText: string;
  translatedText: string;
  isFinal: boolean;
  language?: string;
  speaker?: SpeakerInfo;
  /** True end-to-end age (ms) from when this utterance was spoken to when translation appeared. */
  delayMs?: number;
  createdAt: number;
}

export interface ActiveCaption {
  id: string;
  committedSource: string;
  speculativeSource: string;
  translatedText: string;
  speaker?: SpeakerInfo;
  delayMs?: number;
  startMs: number;
  updatedAt: number;
}

export interface AudioMetrics {
  rms: number;
  db: number;
  isSpeech: boolean;
  sampleRate: number;
  packetsPerSec: number;
  waveform: number[];
}

export type CaptureStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'reconnecting'
  | 'error';

export type AsrProviderId =
  | 'siliconflow'
  | 'local-ws'
  | 'groq'
  | 'dashscope'
  | 'deepgram'
  | 'demo';

export type TranslatorProviderId =
  | 'chrome-ai'
  | 'free'
  | 'tencent'
  | 'llm'
  | 'none';

export interface SessionSnapshot {
  status: CaptureStatus;
  tabId: number | null;
  tabTitle: string;
  tabUrl: string;
  startedAt: number | null;
  captureMode: CaptureMode;
  activeInputSource: ActiveInputSource;
  trackDetected: boolean;
  asrProvider: AsrProviderId;
  translatorProvider: TranslatorProviderId;
  overlayVisible: boolean;
  autoStartHint: string | null;
  errorMessage: string | null;
  latencyMs: number | null;
  activeCaption: ActiveCaption | null;
  segments: SubtitleSegment[];
  metrics: AudioMetrics;
}

export const EMPTY_AUDIO_METRICS: AudioMetrics = {
  rms: 0,
  db: -60,
  isSpeech: false,
  sampleRate: 16000,
  packetsPerSec: 0,
  waveform: Array.from({ length: 24 }, () => 0.04),
};

export const INITIAL_SESSION_SNAPSHOT: SessionSnapshot = {
  status: 'idle',
  tabId: null,
  tabTitle: '',
  tabUrl: '',
  startedAt: null,
  captureMode: 'auto',
  activeInputSource: 'idle',
  trackDetected: false,
  asrProvider: 'demo',
  translatorProvider: 'free',
  overlayVisible: true,
  autoStartHint: null,
  errorMessage: null,
  latencyMs: null,
  activeCaption: null,
  segments: [],
  metrics: EMPTY_AUDIO_METRICS,
};
