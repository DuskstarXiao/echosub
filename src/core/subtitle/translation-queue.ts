import type { SubtitleTimingMode } from '../../types/subtitle';
import type {
  TranslationContextPair,
  TranslatorAdapter,
} from '../translator/types';

export interface TranslationSchedulerOptions {
  /** Debounce window for interim partial captions (ms). */
  debounceMs?: number;
  /** Minimum character growth before triggering another interim translation. */
  minDeltaChars?: number;
  /** Number of recent finalized bilingual segments passed as sliding LLM context. */
  contextWindowSize?: number;
  /** Max LRU cache entries for repeated utterances. */
  cacheSize?: number;
  /** Optional ultra-fast local adapter (e.g. Chrome Built-in AI ~10ms) used ONLY for live interim drafts in Mode A. */
  fastInterimAdapter?: TranslatorAdapter | null;
  timingMode?: SubtitleTimingMode;
  sourceLang: string;
  targetLang: string;
}

/**
 * Debounced, race-safe contextual translation scheduler.
 *
 * Key guarantees:
 * 1. Mode A ('realtime'): low-latency interim drafts (optionally accelerated by ~10ms on-device Chrome AI),
 *    polished by primary LLM/translator on final sentence.
 * 2. Mode B ('sentence'): suppresses word-by-word interim translations completely and translates full sentences once.
 * 3. Out-of-order interim responses are cancelled with AbortController + monotonic sequence numbers.
 */
export class TranslationScheduler {
  private debounceMs: number;
  private readonly minDeltaChars: number;
  private readonly contextWindowSize: number;
  private readonly cacheSize: number;

  private timingMode: SubtitleTimingMode;
  private sourceLang: string;
  private targetLang: string;
  private adapter: TranslatorAdapter;
  private fastInterimAdapter: TranslatorAdapter | null;
  private fastInterimFailed = false;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private interimController: AbortController | null = null;
  private interimSeq = 0;
  private lastInterimSource = '';
  private contextHistory: TranslationContextPair[] = [];
  private cache = new Map<string, string>();
  private disposed = false;

  constructor(
    adapter: TranslatorAdapter,
    options: TranslationSchedulerOptions
  ) {
    this.adapter = adapter;
    this.timingMode = options.timingMode ?? 'realtime';
    this.debounceMs = options.debounceMs ?? (this.timingMode === 'realtime' ? 90 : 280);
    this.minDeltaChars = options.minDeltaChars ?? 3;
    this.contextWindowSize = options.contextWindowSize ?? 3;
    this.cacheSize = options.cacheSize ?? 128;
    this.fastInterimAdapter = options.fastInterimAdapter ?? null;
    this.sourceLang = options.sourceLang;
    this.targetLang = options.targetLang;
  }

  updateConfig(
    adapter: TranslatorAdapter,
    sourceLang: string,
    targetLang: string,
    timingMode?: SubtitleTimingMode
  ): void {
    const langChanged =
      sourceLang !== this.sourceLang || targetLang !== this.targetLang;
    this.adapter = adapter;
    this.sourceLang = sourceLang;
    this.targetLang = targetLang;
    if (timingMode) {
      this.timingMode = timingMode;
      this.debounceMs = timingMode === 'realtime' ? 90 : 280;
    }
    if (langChanged) {
      this.cache.clear();
      this.fastInterimFailed = false;
    }
  }

  /**
   * Schedule debounced translation for an active interim caption (Mode A only).
   */
  scheduleInterim(
    captionId: string,
    sourceText: string,
    onTranslated: (captionId: string, translatedText: string) => void,
    speakerLabel?: string
  ): void {
    if (
      this.disposed ||
      this.adapter.id === 'none' ||
      this.timingMode === 'sentence'
    ) {
      return;
    }
    const cleaned = sourceText.trim();
    if (!cleaned) return;

    // Skip tiny incremental updates to prevent excessive API calls and jitter
    if (
      this.lastInterimSource &&
      cleaned.startsWith(this.lastInterimSource) &&
      cleaned.length - this.lastInterimSource.length < this.minDeltaChars
    ) {
      return;
    }

    const cached = this.getCached(cleaned);
    if (cached !== undefined) {
      this.lastInterimSource = cleaned;
      onTranslated(captionId, cached);
      return;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    const seq = ++this.interimSeq;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.disposed || seq !== this.interimSeq) return;
      this.lastInterimSource = cleaned;
      void this.runInterim(seq, captionId, cleaned, onTranslated, speakerLabel);
    }, this.debounceMs);
  }

  /**
   * Translate a finalized segment immediately (never dropped, updates sliding context).
   */
  async translateFinal(
    sourceText: string,
    speakerLabel?: string
  ): Promise<string> {
    if (this.disposed || this.adapter.id === 'none') return '';
    const cleaned = sourceText.trim();
    if (!cleaned) return '';

    // Cancel any stale interim timer/request since the segment is now final
    this.cancelInterim();
    this.lastInterimSource = '';

    const cached = this.getCached(cleaned);
    if (cached !== undefined) {
      this.pushContext(cleaned, cached, speakerLabel);
      return cached;
    }

    try {
      const translated = await this.adapter.translate({
        text: cleaned,
        sourceLang: this.sourceLang,
        targetLang: this.targetLang,
        speakerLabel,
        context: [...this.contextHistory],
      });
      if (translated) {
        this.setCached(cleaned, translated);
        this.pushContext(cleaned, translated, speakerLabel);
      }
      return translated;
    } catch {
      return '';
    }
  }

  cancelInterim(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.interimController?.abort();
    this.interimController = null;
    this.interimSeq++;
  }

  reset(): void {
    this.cancelInterim();
    this.lastInterimSource = '';
    this.contextHistory = [];
  }

  dispose(): void {
    this.disposed = true;
    this.reset();
    this.cache.clear();
  }

  private async runInterim(
    seq: number,
    captionId: string,
    text: string,
    onTranslated: (captionId: string, translatedText: string) => void,
    speakerLabel?: string
  ): Promise<void> {
    this.interimController?.abort();
    const controller = new AbortController();
    this.interimController = controller;

    try {
      let translated = '';
      // In Mode A ('realtime'), prefer ~10ms on-device Chrome Built-in AI for instant live interim drafts!
      if (this.fastInterimAdapter && !this.fastInterimFailed) {
        try {
          translated = await this.fastInterimAdapter.translate({
            text,
            sourceLang: this.sourceLang,
            targetLang: this.targetLang,
            signal: controller.signal,
          });
        } catch (fastErr) {
          if ((fastErr as Error).name === 'AbortError') return;
          this.fastInterimFailed = true;
        }
      }

      if (!translated) {
        translated = await this.adapter.translate({
          text,
          sourceLang: this.sourceLang,
          targetLang: this.targetLang,
          speakerLabel,
          context: [...this.contextHistory],
          signal: controller.signal,
        });
      }

      if (this.disposed || seq !== this.interimSeq || controller.signal.aborted) {
        return;
      }

      if (translated) {
        this.setCached(text, translated);
        onTranslated(captionId, translated);
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      // Interim failures are non-fatal; next update or final segment will recover
    }
  }

  private pushContext(
    source: string,
    translated: string,
    speakerLabel?: string
  ): void {
    this.contextHistory.push({ speakerLabel, source, translated });
    if (this.contextHistory.length > this.contextWindowSize) {
      this.contextHistory.shift();
    }
  }

  private cacheKey(text: string): string {
    return `${this.adapter.id}:${this.sourceLang}:${this.targetLang}:${text}`;
  }

  private getCached(text: string): string | undefined {
    const key = this.cacheKey(text);
    const hit = this.cache.get(key);
    if (hit !== undefined) {
      // Refresh LRU order
      this.cache.delete(key);
      this.cache.set(key, hit);
    }
    return hit;
  }

  private setCached(text: string, translated: string): void {
    const key = this.cacheKey(text);
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.cacheSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, translated);
  }
}
