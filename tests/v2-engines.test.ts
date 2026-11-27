import { describe, expect, it, vi } from 'vitest';
import { cleanSenseVoiceText } from '../src/core/asr/siliconflow';
import { ChromeBuiltInTranslator } from '../src/core/translator/chrome-ai';
import {
  detectTextLanguage,
  normalizeBcp47Base,
} from '../src/core/translator/language-detect';
import { buildTencentTc3Authorization } from '../src/core/translator/tencent-tmt';
import { mergeSettings } from '../src/shared/storage';

describe('EchoSub v2.0 Free Cloud, Chrome AI & Tencent TMT Engines', () => {
  it('strips SenseVoice rich-transcription metadata tags cleanly', () => {
    expect(
      cleanSenseVoiceText(
        '<|en|><|NEUTRAL|><|Speech|><|withitn|>Hello from SiliconFlow SenseVoice!'
      )
    ).toBe('Hello from SiliconFlow SenseVoice!');

    expect(
      cleanSenseVoiceText('<|zh|><|HAPPY|><|Laughter|>你好，欢迎使用 EchoSub。')
    ).toBe('你好，欢迎使用 EchoSub。');
  });

  it('detects script language accurately for auto-detect translation', () => {
    expect(detectTextLanguage('Welcome to Chrome Built-in AI')).toBe('en');
    expect(detectTextLanguage('实时视频双语字幕插件')).toBe('zh');
    expect(detectTextLanguage('こんにちは、世界へようこそ')).toBe('ja');
    expect(detectTextLanguage('안녕하세요 반갑습니다')).toBe('ko');
    expect(normalizeBcp47Base('zh-CN')).toBe('zh');
    expect(normalizeBcp47Base('zh-TW')).toBe('zh-Hant');
  });

  it('builds a valid deterministic TC3-HMAC-SHA256 Authorization header for Tencent TMT', async () => {
    const auth = await buildTencentTc3Authorization({
      secretId: 'AKIDtest123',
      secretKey: 'SecretTest456',
      payload: JSON.stringify({
        SourceText: 'Hello',
        Source: 'en',
        Target: 'zh',
        ProjectId: 0,
      }),
      timestampSec: 1700000000,
    });

    expect(auth.timestamp).toBe('1700000000');
    expect(auth.authorization).toMatch(
      /^TC3-HMAC-SHA256 Credential=AKIDtest123\/2023-11-14\/tmt\/tc3_request, SignedHeaders=content-type;host;x-tc-action, Signature=[0-9a-f]{64}$/
    );
  });

  it('uses Chrome 138+ built-in self.Translator when available', async () => {
    const mockTranslate = vi.fn().mockResolvedValue('你好，世界');
    const mockCreate = vi.fn().mockResolvedValue({
      translate: mockTranslate,
      ready: Promise.resolve(),
    });
    const mockAvailability = vi.fn().mockResolvedValue('available');

    const prev = (globalThis as Record<string, unknown>).Translator;
    (globalThis as Record<string, unknown>).Translator = {
      availability: mockAvailability,
      create: mockCreate,
    };

    try {
      const adapter = new ChromeBuiltInTranslator();
      const out = await adapter.translate({
        text: 'Hello, world',
        sourceLang: 'auto',
        targetLang: 'zh-CN',
      });
      expect(out).toBe('你好，世界');
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ sourceLanguage: 'en', targetLanguage: 'zh' })
      );
    } finally {
      if (prev === undefined) {
        delete (globalThis as Record<string, unknown>).Translator;
      } else {
        (globalThis as Record<string, unknown>).Translator = prev;
      }
    }
  });

  it('merges v2 settings cleanly with backward-compatible defaults', () => {
    const merged = mergeSettings({
      captureMode: 'track',
      siliconflowApiKey: 'sk-free',
    });
    expect(merged.captureMode).toBe('track');
    expect(merged.siliconflowApiKey).toBe('sk-free');
    expect(merged.appearance.hideNativeTrackCaptions).toBe(true);
  });
});
