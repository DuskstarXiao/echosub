import type { ExtensionSettings } from '../../types/settings';
import { DashScopeAsrAdapter } from './dashscope';
import { DeepgramAsrAdapter } from './deepgram';
import { DemoAsrAdapter } from './demo';
import { GroqWhisperAsrAdapter } from './groq-whisper';
import { LocalWsAsrAdapter } from './local-ws';
import { SiliconFlowSenseVoiceAdapter } from './siliconflow';
import type { AsrAdapter } from './types';

export function createAsrAdapter(settings: ExtensionSettings): AsrAdapter {
  switch (settings.asrProvider) {
    case 'siliconflow':
      return new SiliconFlowSenseVoiceAdapter({
        apiKey: settings.siliconflowApiKey,
        model: settings.siliconflowAsrModel,
        timingMode: settings.timingMode,
      });
    case 'groq':
      return new GroqWhisperAsrAdapter({
        apiKey: settings.groqApiKey,
        model: settings.groqModel,
        language: settings.sourceLanguage,
        timingMode: settings.timingMode,
      });
    case 'dashscope':
      return new DashScopeAsrAdapter({
        apiKey: settings.dashscopeApiKey,
        model: settings.dashscopeModel,
        language: settings.sourceLanguage,
      });
    case 'deepgram':
      return new DeepgramAsrAdapter({
        apiKey: settings.deepgramApiKey,
        model: settings.deepgramModel,
        language: settings.sourceLanguage,
      });
    case 'local-ws':
      return new LocalWsAsrAdapter({
        url: settings.localWsUrl,
        token: settings.localWsToken,
        language: settings.sourceLanguage,
      });
    case 'demo':
    default:
      return new DemoAsrAdapter();
  }
}
