import type { ExtensionSettings } from '../../types/settings';
import type { SubtitleSegment } from '../../types/subtitle';
import { isAlreadyInTargetLanguage } from './language-detect';
import type { TranslateRequest, TranslatorAdapter } from './types';

export interface LlmTranslatorConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

const LANG_NAMES: Record<string, string> = {
  'zh-CN': 'Simplified Chinese',
  'zh-TW': 'Traditional Chinese',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

/**
 * Removes accidental speaker tags or surrounding quotes if an LLM echoes them.
 */
export function cleanTranslatedOutput(raw: string): string {
  return raw
    .trim()
    .replace(/^[\[【(（]\s*(?:角色|说话人|Speaker)\s*[A-Z0-9]+\s*[\]】)）]\s*[:：-]?\s*/i, '')
    .replace(/^(?:角色|说话人|Speaker)\s*[A-Z0-9]+\s*[:：]\s*/i, '')
    .replace(/^["“”'‘’]+|["“”'‘’]+$/g, '')
    .trim();
}

/**
 * Context-aware OpenAI-compatible LLM Translator.
 * Works with DeepSeek, Aliyun DashScope Qwen, SiliconFlow, OpenAI, and local Ollama.
 */
export class OpenAiCompatibleTranslator implements TranslatorAdapter {
  readonly id = 'llm' as const;

  constructor(private readonly config: LlmTranslatorConfig) {}

  async translate(request: TranslateRequest): Promise<string> {
    const text = request.text.trim();
    if (!text) return '';

    // Prevent double same-language lines (e.g. Chinese speech or Bilibili Chinese CC -> Chinese again!)
    if (
      isAlreadyInTargetLanguage(text, request.sourceLang, request.targetLang)
    ) {
      return '';
    }

    const targetName = LANG_NAMES[request.targetLang] ?? request.targetLang;
    const contextBlock =
      request.context && request.context.length > 0
        ? `Previous lines for context only (DO NOT repeat or output speaker tags):\n${request.context
            .map((c) => `- "${c.source}" => "${c.translated}"`)
            .join('\n')}\n\n`
        : '';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const cleanKey = this.config.apiKey.trim().replace(/^Bearer\s+/i, '').trim();
    if (cleanKey) {
      headers.Authorization = `Bearer ${cleanKey}`;
    }

    const res = await fetch(
      `${normalizeBaseUrl(this.config.baseUrl)}/chat/completions`,
      {
        method: 'POST',
        headers,
        signal: request.signal,
        body: JSON.stringify({
          model: this.config.model,
          temperature: 0.15,
          max_tokens: 180,
          messages: [
            {
              role: 'system',
              content:
                `You are a real-time video subtitle translator. Translate the utterance naturally and concisely into ${targetName}. ` +
                'Output ONLY the pure translated sentence with NO brackets, NO speaker labels, NO quotes, and NO explanations.',
            },
            {
              role: 'user',
              content: `${contextBlock}Translate into ${targetName}:\n${text}`,
            },
          ],
        }),
      }
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      if (res.status === 401) {
        throw new Error('翻译 API Key 无效或未复制完整 (HTTP 401)');
      }
      if (res.status === 403) {
        throw new Error('翻译模型无权访问或需账号实名认证 (HTTP 403)');
      }
      if (res.status === 429) {
        throw new Error('翻译请求触发限流，请稍后再试 (HTTP 429)');
      }
      throw new Error(`LLM 翻译 HTTP ${res.status}: ${detail.slice(0, 160)}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return cleanTranslatedOutput(data.choices?.[0]?.message?.content ?? '');
  }
}

/**
 * Generate a structured AI study/meeting summary from the captured transcript.
 */
export async function generateAiSummary(
  segments: readonly SubtitleSegment[],
  settings: ExtensionSettings,
  locale: 'zh' | 'en'
): Promise<string> {
  if (segments.length === 0) {
    throw new Error(
      locale === 'zh'
        ? '当前还没有可总结的字幕记录。'
        : 'No transcript segments available to summarize yet.'
    );
  }

  const transcriptLines = segments
    .map((s) => {
      const prefix = s.speaker ? `[${s.speaker.label}] ` : '';
      return s.translatedText && s.translatedText !== s.sourceText
        ? `- ${prefix}${s.sourceText} (${s.translatedText})`
        : `- ${prefix}${s.sourceText}`;
    })
    .join('\n');

  // If no LLM API key is configured (and not local Ollama), produce a clean extractive local summary
  const isLocalEndpoint =
    settings.llmBaseUrl.includes('127.0.0.1') ||
    settings.llmBaseUrl.includes('localhost');
  const effectiveKey =
    settings.llmApiKey.trim() ||
    (settings.llmPreset === 'siliconflow-free'
      ? settings.siliconflowApiKey.trim()
      : '');
  if (!effectiveKey && !isLocalEndpoint) {
    return buildExtractiveFallbackSummary(segments, locale);
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (effectiveKey) {
    headers.Authorization = `Bearer ${effectiveKey}`;
  }

  const prompt =
    locale === 'zh'
      ? '请根据以下实时捕获的双语视频/会议逐字稿，输出一份结构清晰的中文 Markdown 重点总结，包含：\n1. 核心主旨（2-3 句话）\n2. 关键要点（分点列出）\n3. 核心术语 / 技术名词速查\n\n逐字稿：\n'
      : 'Summarize the following captured video/meeting transcript into concise Markdown with:\n1. TL;DR (2-3 sentences)\n2. Key Takeaways (bulleted)\n3. Key Terms & Concepts\n\nTranscript:\n';

  const res = await fetch(
    `${normalizeBaseUrl(settings.llmBaseUrl)}/chat/completions`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: settings.llmModel,
        temperature: 0.3,
        max_tokens: 900,
        messages: [
          {
            role: 'system',
            content:
              'You are an expert technical note-taker producing crisp, structured study notes in Markdown.',
          },
          {
            role: 'user',
            content: `${prompt}${transcriptLines.slice(0, 14000)}`,
          },
        ],
      }),
    }
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`AI Summary HTTP ${res.status}: ${detail.slice(0, 180)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return (data.choices?.[0]?.message?.content ?? '').trim();
}

function buildExtractiveFallbackSummary(
  segments: readonly SubtitleSegment[],
  locale: 'zh' | 'en'
): string {
  const highlights = segments.slice(0, 6);
  if (locale === 'zh') {
    return [
      '### 重点摘录（未配置大模型 Key，已启用本地离线提炼）',
      '',
      `共捕获 **${segments.length}** 条双语字幕片段。在设置中填入 DeepSeek / 阿里云百炼 / OpenAI Key 即可解锁深度 AI 总结：`,
      '',
      ...highlights.map(
        (s, idx) =>
          `${idx + 1}. **${s.translatedText || s.sourceText}**${
            s.translatedText && s.translatedText !== s.sourceText
              ? `\n   > ${s.sourceText}`
              : ''
          }`
      ),
    ].join('\n');
  }

  return [
    '### Key Highlights (Local Extractive Mode — Add an LLM Key for Deep AI Summary)',
    '',
    `Captured **${segments.length}** bilingual segments:`,
    '',
    ...highlights.map(
      (s, idx) =>
        `${idx + 1}. **${s.sourceText}**${
          s.translatedText && s.translatedText !== s.sourceText
            ? `\n   > ${s.translatedText}`
            : ''
        }`
    ),
  ].join('\n');
}
