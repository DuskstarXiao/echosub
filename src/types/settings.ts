import type {
  AsrProviderId,
  CaptureMode,
  DisplayMode,
  LineOrder,
  SubtitleTimingMode,
  TranslatorProviderId,
} from './subtitle';

export type UiLocale = 'auto' | 'zh' | 'en';

export type LlmPresetId =
  | 'siliconflow-free'
  | 'zhipu-free'
  | 'deepseek'
  | 'dashscope'
  | 'openai'
  | 'custom';

export interface AppearanceSettings {
  displayMode: DisplayMode;
  lineOrder: LineOrder;
  fontSize: number;
  secondaryFontScale: number;
  backgroundOpacity: number;
  backdropBlur: number;
  maxWidthPercent: number;
  accentColor: string;
  textShadow: boolean;
  speakerColoring: boolean;
  showTranslationDelay: boolean;
  hideNativeTrackCaptions: boolean;
  position: {
    xPercent: number;
    yPercent: number;
  };
}

export interface AutoStartConfig {
  enabled: boolean;
  enabledSiteIds: string[];
  customDomains: string[];
}

export interface ExtensionSettings {
  uiLocale: UiLocale;
  captureMode: CaptureMode;
  timingMode: SubtitleTimingMode;
  autoStart: AutoStartConfig;
  sourceLanguage: string;
  targetLanguage: string;
  asrProvider: AsrProviderId;
  siliconflowApiKey: string;
  siliconflowAsrModel: string;
  groqApiKey: string;
  groqModel: string;
  dashscopeApiKey: string;
  dashscopeModel: string;
  deepgramApiKey: string;
  deepgramModel: string;
  localWsUrl: string;
  localWsToken: string;
  translatorProvider: TranslatorProviderId;
  tencentSecretId: string;
  tencentSecretKey: string;
  tencentRegion: string;
  llmPreset: LlmPresetId;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  vadThresholdDb: number;
  speakerSensitivity: number;
  appearance: AppearanceSettings;
}

export interface LlmPresetDefinition {
  id: LlmPresetId;
  label: string;
  badge?: string;
  baseUrl: string;
  defaultModel: string;
}

export const LLM_PRESETS: Record<LlmPresetId, LlmPresetDefinition> = {
  'siliconflow-free': {
    id: 'siliconflow-free',
    label: '硅基流动 Qwen2.5-7B',
    badge: '国内免费',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
  },
  'zhipu-free': {
    id: 'zhipu-free',
    label: '智谱 GLM-4-Flash',
    badge: '国内免费',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    badge: '高性价比',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
  },
  dashscope: {
    id: 'dashscope',
    label: '阿里云百炼 Qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-turbo-latest',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
  },
  custom: {
    id: 'custom',
    label: 'Custom / Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'qwen2.5:7b',
  },
};

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  displayMode: 'bilingual',
  lineOrder: 'source-first',
  fontSize: 20,
  secondaryFontScale: 0.78,
  backgroundOpacity: 0.74,
  backdropBlur: 14,
  maxWidthPercent: 78,
  accentColor: '#38e8d6',
  textShadow: true,
  speakerColoring: true,
  showTranslationDelay: false,
  hideNativeTrackCaptions: true,
  position: {
    xPercent: 50,
    yPercent: 86,
  },
};

export const DEFAULT_AUTO_START: AutoStartConfig = {
  enabled: false,
  enabledSiteIds: ['youtube', 'bilibili', 'twitch'],
  customDomains: [],
};

export const DEFAULT_SETTINGS: ExtensionSettings = {
  uiLocale: 'auto',
  captureMode: 'auto',
  timingMode: 'realtime',
  autoStart: DEFAULT_AUTO_START,
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  asrProvider: 'demo',
  siliconflowApiKey: '',
  siliconflowAsrModel: 'FunAudioLLM/SenseVoiceSmall',
  groqApiKey: '',
  groqModel: 'whisper-large-v3-turbo',
  dashscopeApiKey: '',
  dashscopeModel: 'paraformer-realtime-v2',
  deepgramApiKey: '',
  deepgramModel: 'nova-2',
  localWsUrl: 'ws://127.0.0.1:8765/ws/asr',
  localWsToken: '',
  translatorProvider: 'free',
  tencentSecretId: '',
  tencentSecretKey: '',
  tencentRegion: 'ap-beijing',
  llmPreset: 'siliconflow-free',
  llmBaseUrl: LLM_PRESETS['siliconflow-free'].baseUrl,
  llmApiKey: '',
  llmModel: LLM_PRESETS['siliconflow-free'].defaultModel,
  vadThresholdDb: -46,
  speakerSensitivity: 0.64,
  appearance: DEFAULT_APPEARANCE,
};
