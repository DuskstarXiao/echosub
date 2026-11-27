import type { ExtensionSettings } from '../../types/settings';
import { ChromeBuiltInTranslator } from './chrome-ai';
import { FreeFallbackTranslator } from './free-google';
import { OpenAiCompatibleTranslator } from './llm-openai';
import { TencentTmtTranslator } from './tencent-tmt';
import type { TranslateRequest, TranslatorAdapter } from './types';

class NoopTranslator implements TranslatorAdapter {
  readonly id = 'none' as const;
  async translate(_request: TranslateRequest): Promise<string> {
    return '';
  }
}

export function createTranslatorAdapter(
  settings: ExtensionSettings
): TranslatorAdapter {
  switch (settings.translatorProvider) {
    case 'none':
      return new NoopTranslator();

    case 'chrome-ai':
      return new ChromeBuiltInTranslator();

    case 'tencent':
      if (settings.tencentSecretId.trim() && settings.tencentSecretKey.trim()) {
        return new TencentTmtTranslator({
          secretId: settings.tencentSecretId,
          secretKey: settings.tencentSecretKey,
          region: settings.tencentRegion,
        });
      }
      return new FreeFallbackTranslator();

    case 'llm': {
      const isLocal =
        settings.llmBaseUrl.includes('127.0.0.1') ||
        settings.llmBaseUrl.includes('localhost');
      // If using SiliconFlow free LLM preset, allow reusing siliconflowApiKey automatically!
      const effectiveKey =
        settings.llmApiKey.trim() ||
        (settings.llmPreset === 'siliconflow-free'
          ? settings.siliconflowApiKey.trim()
          : '');
      if (effectiveKey || isLocal) {
        return new OpenAiCompatibleTranslator({
          baseUrl: settings.llmBaseUrl,
          apiKey: effectiveKey,
          model: settings.llmModel,
        });
      }
      return new FreeFallbackTranslator();
    }

    case 'free':
    default:
      return new FreeFallbackTranslator();
  }
}
