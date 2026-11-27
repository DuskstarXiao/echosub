import { detectTextLanguage, normalizeBcp47Base } from './language-detect';
import type { TranslateRequest, TranslatorAdapter } from './types';

interface ChromeTranslatorInstance {
  translate(input: string): Promise<string>;
  ready?: Promise<void>;
  destroy?: () => void;
}

interface ChromeTranslatorStatic {
  availability(options: {
    sourceLanguage: string;
    targetLanguage: string;
  }): Promise<'available' | 'downloadable' | 'downloading' | 'unavailable'>;
  create(options: {
    sourceLanguage: string;
    targetLanguage: string;
    signal?: AbortSignal;
  }): Promise<ChromeTranslatorInstance>;
}

interface ChromeLanguageDetectorStatic {
  create(): Promise<{
    detect(text: string): Promise<Array<{ detectedLanguage: string; confidence: number }>>;
  }>;
}

function getChromeTranslatorApi(): ChromeTranslatorStatic | null {
  const g = globalThis as unknown as { Translator?: ChromeTranslatorStatic };
  return typeof g.Translator?.availability === 'function' ? g.Translator : null;
}

function getChromeLanguageDetectorApi(): ChromeLanguageDetectorStatic | null {
  const g = globalThis as unknown as {
    LanguageDetector?: ChromeLanguageDetectorStatic;
  };
  return typeof g.LanguageDetector?.create === 'function'
    ? g.LanguageDetector
    : null;
}

export async function checkChromeTranslatorSupport(
  sourceLang = 'en',
  targetLang = 'zh-CN'
): Promise<'available' | 'downloadable' | 'downloading' | 'unavailable'> {
  const api = getChromeTranslatorApi();
  if (!api) return 'unavailable';
  const src = sourceLang === 'auto' ? 'en' : normalizeBcp47Base(sourceLang);
  const tgt = normalizeBcp47Base(targetLang);
  if (src === tgt) return 'available';
  try {
    return await api.availability({
      sourceLanguage: src,
      targetLanguage: tgt,
    });
  } catch {
    return 'unavailable';
  }
}

/**
 * Chrome 138+ Built-in On-Device Translator Adapter (`self.Translator`).
 * Zero API Key, zero network traffic, ~10ms local NMT inference directly inside Chrome!
 */
export class ChromeBuiltInTranslator implements TranslatorAdapter {
  readonly id = 'chrome-ai' as const;
  private instances = new Map<string, ChromeTranslatorInstance>();

  async translate(request: TranslateRequest): Promise<string> {
    const text = request.text.trim();
    if (!text) return '';

    const api = getChromeTranslatorApi();
    if (!api) {
      throw new Error(
        'Chrome Built-in Translator API requires Desktop Chrome 138+.'
      );
    }

    const src = await this.resolveSourceLanguage(text, request.sourceLang);
    const tgt = normalizeBcp47Base(request.targetLang || 'zh-CN');

    if (src === tgt) {
      return text;
    }

    const pairKey = `${src}->${tgt}`;
    let instance = this.instances.get(pairKey);

    if (!instance) {
      const availability = await api.availability({
        sourceLanguage: src,
        targetLanguage: tgt,
      });
      if (availability === 'unavailable') {
        throw new Error(
          `Chrome Built-in Translator does not support ${src} -> ${tgt} on this device.`
        );
      }
      instance = await api.create({
        sourceLanguage: src,
        targetLanguage: tgt,
        signal: request.signal,
      });
      if (instance.ready) {
        await instance.ready;
      }
      this.instances.set(pairKey, instance);
    }

    const translated = await instance.translate(text);
    return translated.trim();
  }

  private async resolveSourceLanguage(
    text: string,
    configured: string
  ): Promise<string> {
    if (configured && configured !== 'auto') {
      return normalizeBcp47Base(configured);
    }
    const detectorApi = getChromeLanguageDetectorApi();
    if (detectorApi) {
      try {
        const detector = await detectorApi.create();
        const results = await detector.detect(text);
        if (results[0]?.detectedLanguage && results[0].confidence > 0.5) {
          return normalizeBcp47Base(results[0].detectedLanguage);
        }
      } catch {
        // Fall back to script heuristic
      }
    }
    return detectTextLanguage(text, 'en');
  }
}
