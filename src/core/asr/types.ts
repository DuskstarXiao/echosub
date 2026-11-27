import type { AsrProviderId } from '../../types/subtitle';

export interface AsrTranscriptEvent {
  text: string;
  isFinal: boolean;
  language?: string;
  speakerIndex?: number;
  timestampMs: number;
  latencyMs?: number;
}

export interface AsrAdapterCallbacks {
  onTranscript: (event: AsrTranscriptEvent) => void;
  onStatusChange?: (status: 'connected' | 'reconnecting' | 'disconnected') => void;
  onError: (error: Error) => void;
}

export interface AsrAdapter {
  readonly id: AsrProviderId;
  start(callbacks: AsrAdapterCallbacks): Promise<void>;
  pushAudio(pcm16k: Int16Array, isSpeech: boolean, elapsedMs: number): void;
  flush(elapsedMs: number): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Common Whisper hallucinations emitted on silence / pure BGM chunks.
 */
const WHISPER_HALLUCINATION_PATTERNS: readonly RegExp[] = [
  /^thank(s|\s+you)(\s+for\s+watching|\s+very\s+much)?[.!?\s]*$/i,
  /^please\s+subscribe(\s+to\s+my\s+channel)?[.!?\s]*$/i,
  /^(you|bye|goodbye|okay|hmm|uh|um)[.!?\s]*$/i,
  /^(字幕由|请不吝点赞|感谢观看|谢谢观看|订阅频道|Amara\.org|MBC 뉴스)/i,
  /^\[?(music|applause|laughter|silence|空白|音乐)\]?$/i,
];

export function isLikelyHallucination(text: string): boolean {
  const cleaned = text.trim();
  if (!cleaned || cleaned.length <= 1) return true;
  return WHISPER_HALLUCINATION_PATTERNS.some((re) => re.test(cleaned));
}
