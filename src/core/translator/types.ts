import type { TranslatorProviderId } from '../../types/subtitle';

export interface TranslationContextPair {
  speakerLabel?: string;
  source: string;
  translated: string;
}

export interface TranslateRequest {
  text: string;
  sourceLang: string;
  targetLang: string;
  speakerLabel?: string;
  context?: TranslationContextPair[];
  signal?: AbortSignal;
}

export interface TranslatorAdapter {
  readonly id: TranslatorProviderId;
  translate(request: TranslateRequest): Promise<string>;
}
