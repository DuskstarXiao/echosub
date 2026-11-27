import type {
  ActiveCaption,
  SpeakerInfo,
  SubtitleSegment,
} from '../../types/subtitle';

export interface StabilizerOptions {
  /** Minimum consecutive agreeing hypotheses before locking a token prefix. Default 2 (LocalAgreement-2). */
  minAgreementCount?: number;
  /** Maximum characters in a single cue before soft-splitting at the nearest clause boundary. */
  maxCueChars?: number;
}

export interface StabilizerUpdateResult {
  activeCaption: ActiveCaption | null;
  finalizedSegment: SubtitleSegment | null;
}

interface Token {
  raw: string;
  norm: string;
}

const TOKEN_REGEX =
  /\s*[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]|\s*[^\s\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g;

const TERMINAL_PUNCTUATION = /[.!?。！？]$/;

export function tokenizeLossless(text: string): Token[] {
  const matches = text.match(TOKEN_REGEX);
  if (!matches) return [];
  return matches.map((raw) => ({
    raw,
    norm: raw
      .trim()
      .toLowerCase()
      .replace(/^[("'“‘]+|[.,!?;:，。！？；：、)"'”’]+$/g, ''),
  }));
}

/**
 * Computes longest common prefix length between two token sequences using normalized forms.
 */
export function longestCommonTokenPrefix(a: readonly Token[], b: readonly Token[]): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a[i].norm === b[i].norm) {
    i++;
  }
  return i;
}

/**
 * Anti-Flicker Streaming Subtitle Stabilizer (LocalAgreement-N Prefix Locking).
 *
 * Why this exists:
 * Cloud & local streaming ASR engines revise recent words as acoustic context arrives.
 * Rendering raw hypotheses directly causes jarring screen jitter.
 *
 * How it works:
 * 1. Tracks consecutive partial hypotheses via lossless CJK/Latin tokenization.
 * 2. Tokens confirmed across consecutive hypotheses lock monotonically into `committedSource`.
 * 3. Unconfirmed tail tokens stay in `speculativeSource` (styled subtly so users see instant feedback
 *    without visual layout jumping).
 * 4. Emits clean timestamped `SubtitleSegment` objects on ASR finals or overlong utterances.
 */
export class SubtitleStabilizer {
  private readonly minAgreementCount: number;
  private readonly maxCueChars: number;

  private seq = 0;
  private currentId: string | null = null;
  private cueStartMs = 0;
  private committedTokens: Token[] = [];
  private previousTokens: Token[] = [];
  private agreementStreak = 0;
  private lastTranslatedText = '';
  private lastDelayMs: number | undefined = undefined;
  private currentSpeaker: SpeakerInfo | undefined = undefined;

  constructor(options: StabilizerOptions = {}) {
    this.minAgreementCount = Math.max(1, options.minAgreementCount ?? 2);
    this.maxCueChars = options.maxCueChars ?? 160;
  }

  setCurrentTranslation(
    captionId: string,
    translatedText: string,
    delayMs?: number
  ): ActiveCaption | null {
    if (!this.currentId || this.currentId !== captionId) return null;
    this.lastTranslatedText = translatedText;
    if (delayMs !== undefined) {
      this.lastDelayMs = delayMs;
    }
    return this.buildActiveCaption(Date.now());
  }

  push(
    rawText: string,
    isFinal: boolean,
    timestampMs: number,
    language?: string,
    speaker?: SpeakerInfo
  ): StabilizerUpdateResult {
    const cleaned = rawText.replace(/\s+/g, ' ').trim();
    if (!cleaned) {
      return { activeCaption: this.getActiveCaption(), finalizedSegment: null };
    }

    if (!this.currentId) {
      this.currentId = `seg_${++this.seq}_${Date.now()}`;
      this.cueStartMs = Math.max(0, timestampMs);
      this.committedTokens = [];
      this.previousTokens = [];
      this.agreementStreak = 0;
      this.lastTranslatedText = '';
      this.currentSpeaker = speaker;
    } else if (speaker) {
      this.currentSpeaker = speaker;
    }

    if (isFinal) {
      const segment: SubtitleSegment = {
        id: this.currentId,
        startMs: this.cueStartMs,
        endMs: Math.max(this.cueStartMs + 400, timestampMs),
        sourceText: cleaned,
        translatedText: this.lastTranslatedText,
        isFinal: true,
        language,
        speaker: this.currentSpeaker,
        createdAt: Date.now(),
      };
      this.resetCurrentCue();
      return { activeCaption: null, finalizedSegment: segment };
    }

    const tokens = tokenizeLossless(cleaned);

    if (this.previousTokens.length > 0) {
      const lcp = longestCommonTokenPrefix(this.previousTokens, tokens);
      if (lcp > this.committedTokens.length) {
        this.agreementStreak++;
        if (this.agreementStreak >= this.minAgreementCount - 1) {
          // Lock the newly agreed prefix monotonically (never shrink committedTokens)
          this.committedTokens = tokens.slice(0, lcp);
        }
      }
    }

    this.previousTokens = tokens;

    // Soft-finalize extremely long unpunctuated run-on streams so subtitles stay readable
    if (
      cleaned.length >= this.maxCueChars &&
      TERMINAL_PUNCTUATION.test(cleaned)
    ) {
      const segment: SubtitleSegment = {
        id: this.currentId,
        startMs: this.cueStartMs,
        endMs: Math.max(this.cueStartMs + 400, timestampMs),
        sourceText: cleaned,
        translatedText: this.lastTranslatedText,
        isFinal: true,
        language,
        speaker: this.currentSpeaker,
        createdAt: Date.now(),
      };
      this.resetCurrentCue();
      return { activeCaption: null, finalizedSegment: segment };
    }

    return {
      activeCaption: this.buildActiveCaption(Date.now()),
      finalizedSegment: null,
    };
  }

  getActiveCaption(): ActiveCaption | null {
    if (!this.currentId) return null;
    return this.buildActiveCaption(Date.now());
  }

  reset(): void {
    this.resetCurrentCue();
  }

  private resetCurrentCue(): void {
    this.currentId = null;
    this.cueStartMs = 0;
    this.committedTokens = [];
    this.previousTokens = [];
    this.agreementStreak = 0;
    this.lastTranslatedText = '';
    this.lastDelayMs = undefined;
    this.currentSpeaker = undefined;
  }

  private buildActiveCaption(updatedAt: number): ActiveCaption {
    const committedText = this.committedTokens
      .map((t) => t.raw)
      .join('')
      .trim();

    // Only show tail tokens beyond committedTokens; if hypothesis diverged slightly earlier,
    // keep committedText rock-solid and display the trailing delta cleanly.
    const tailTokens = this.previousTokens.slice(this.committedTokens.length);
    const speculativeText = tailTokens.map((t) => t.raw).join('');

    return {
      id: this.currentId!,
      committedSource: committedText,
      speculativeSource: committedText ? speculativeText : speculativeText.trim(),
      translatedText: this.lastTranslatedText,
      speaker: this.currentSpeaker,
      delayMs: this.lastDelayMs,
      startMs: this.cueStartMs,
      updatedAt,
    };
  }
}
