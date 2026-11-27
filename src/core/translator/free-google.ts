import { ChromeBuiltInTranslator } from './chrome-ai';
import {
  detectTextLanguage,
  isAlreadyInTargetLanguage,
  normalizeBcp47Base,
} from './language-detect';
import type { TranslateRequest, TranslatorAdapter } from './types';

const DEMO_ZH_DICTIONARY: Record<string, string> = {
  'Welcome to EchoSub,': '欢迎使用 EchoSub，',
  'Welcome to EchoSub, an open-source Chrome extension':
    '欢迎使用 EchoSub，一款开源的 Chrome 浏览器扩展',
  'Welcome to EchoSub, an open-source Chrome extension for real-time bilingual subtitles.':
    '欢迎使用 EchoSub，一款专为实时双语字幕打造的开源 Chrome 浏览器扩展。',
  'Unlike heavy browser-side': '与笨重的浏览器端模型不同，',
  'Unlike heavy browser-side Whisper models, we stream':
    '与笨重的浏览器端 Whisper 模型不同，我们实时推流',
  'Unlike heavy browser-side Whisper models, we stream 16kHz PCM audio through an AudioWorklet.':
    '与笨重的浏览器端 Whisper 模型不同，我们通过 AudioWorklet 实时推流 16kHz PCM 音频。',
  'Your original tab audio': '你原本标签页的音频',
  'Your original tab audio plays directly to AudioContext destination':
    '你原本标签页的音频会直通 AudioContext 输出端',
  'Your original tab audio plays directly to AudioContext destination so the video is never muted.':
    '你原本标签页的音频会直通 AudioContext 输出端，确保视频画面全程不断声。',
  'Stable prefix locking': '稳定前缀锁定算法',
  'Stable prefix locking prevents subtitle flickering':
    '稳定前缀锁定算法能彻底杜绝字幕闪烁重排',
  'Stable prefix locking prevents subtitle flickering while Top-Layer keeps captions visible in fullscreen.':
    '稳定前缀锁定算法杜绝字幕疯狂闪烁，Top-Layer 原生顶层机制让全屏下字幕依然稳稳浮在最上方。',
  'Switch to Groq, DashScope,': '随时切换到硅基流动、Groq、阿里云百炼、',
  'Switch to Groq, DashScope, Deepgram, or a local WebSocket':
    '随时在设置中切换到硅基流动免费 SenseVoice、Groq 或本地离线引擎',
  'Switch to Groq, DashScope, Deepgram, or a local WebSocket server anytime in Settings.':
    '随时在设置中切换硅基流动免费 SenseVoice、Groq、Deepgram 或本机离线语音服务。',
};

function mergeSignals(
  external?: AbortSignal,
  timeoutMs = 2400
): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!external) return timeoutSignal;
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([external, timeoutSignal]);
  }
  return external;
}

/**
 * Multi-tier Zero-Key Free Machine Translator (Fast Failover, Never Stalls in China).
 *
 * Cascade order:
 * 1. Instant local dictionary for Demo mode phrases.
 * 2. Chrome 138+ Built-in On-Device Translator (`self.Translator`) — 100% offline, ~10ms!
 * 3. Google Translate gtx endpoint with strict 2.2s timeout (instant when proxy active, never hangs).
 * 4. MyMemory free public API (3.5s timeout, domestic direct, filters quota warnings).
 */
export class FreeFallbackTranslator implements TranslatorAdapter {
  readonly id = 'free' as const;
  private readonly chromeBuiltIn = new ChromeBuiltInTranslator();
  private chromeAiFailed = false;
  private googleBlockedUntil = 0;

  async translate(request: TranslateRequest): Promise<string> {
    const text = request.text.trim();
    if (!text) return '';

    if (request.targetLang.startsWith('zh') && DEMO_ZH_DICTIONARY[text]) {
      return DEMO_ZH_DICTIONARY[text];
    }

    // Skip translation if text is already in target language (avoids duplicate bilingual lines)
    if (
      isAlreadyInTargetLanguage(text, request.sourceLang, request.targetLang)
    ) {
      return '';
    }
    const detected =
      request.sourceLang === 'auto'
        ? detectTextLanguage(text)
        : normalizeBcp47Base(request.sourceLang);

    // 1) Try Chrome 138+ Built-in On-Device Translator first (zero network, works anywhere!)
    if (!this.chromeAiFailed) {
      try {
        const res = await this.chromeBuiltIn.translate(request);
        if (res && res !== text) return res;
      } catch (err) {
        if ((err as Error).name === 'AbortError') throw err;
        this.chromeAiFailed = true;
      }
    }

    // 2) Try Google gtx with fast 2.2s timeout (auto-cools down for 60s if blocked in CN)
    if (Date.now() > this.googleBlockedUntil) {
      try {
        const translated = await this.translateWithGoogle(request);
        if (translated) return translated;
      } catch (err) {
        if (request.signal?.aborted) throw err;
        this.googleBlockedUntil = Date.now() + 60_000;
      }
    }

    // 3) Fallback to MyMemory free API (direct accessible in mainland China)
    try {
      const translated = await this.translateWithMyMemory(request, detected);
      if (translated) return translated;
    } catch (err) {
      if (request.signal?.aborted) throw err;
    }

    throw new Error(
      '免费公共机翻通道暂不可达。推荐在「引擎设置」中选择「国内零成本全家桶（硅基流动免费 Key）」或升级至 Chrome 138+ 开启本地离线翻译。'
    );
  }

  private async translateWithGoogle(req: TranslateRequest): Promise<string> {
    const sl = req.sourceLang === 'auto' ? 'auto' : req.sourceLang;
    const tl = req.targetLang || 'zh-CN';
    const url = new URL('https://translate.googleapis.com/translate_a/single');
    url.searchParams.set('client', 'gtx');
    url.searchParams.set('sl', sl);
    url.searchParams.set('tl', tl);
    url.searchParams.set('dt', 't');
    url.searchParams.set('q', req.text);

    const res = await fetch(url.toString(), {
      signal: mergeSignals(req.signal, 2200),
    });
    if (!res.ok) throw new Error(`Google translate HTTP ${res.status}`);

    const data = (await res.json()) as unknown[];
    const segments = Array.isArray(data[0]) ? (data[0] as unknown[][]) : [];
    return segments
      .map((item) => (typeof item[0] === 'string' ? item[0] : ''))
      .join('')
      .trim();
  }

  private async translateWithMyMemory(
    req: TranslateRequest,
    detectedLang: string
  ): Promise<string> {
    const src =
      req.sourceLang === 'auto'
        ? detectedLang
        : normalizeBcp47Base(req.sourceLang);
    const tgt = req.targetLang || 'zh-CN';
    const url = new URL('https://api.mymemory.translated.net/get');
    url.searchParams.set('q', req.text);
    url.searchParams.set('langpair', `${src}|${tgt}`);

    const res = await fetch(url.toString(), {
      signal: mergeSignals(req.signal, 3500),
    });
    if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);

    const data = (await res.json()) as {
      responseStatus?: number;
      responseData?: { translatedText?: string };
    };
    const out = (data.responseData?.translatedText ?? '').trim();
    if (
      !out ||
      out.toUpperCase().includes('MYMEMORY WARNING') ||
      data.responseStatus === 429
    ) {
      throw new Error('MyMemory quota exceeded');
    }
    return out;
  }
}
