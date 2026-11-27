import { testSiliconFlowAsr } from '../asr/siliconflow';
import { createTranslatorAdapter } from '../translator/registry';
import type { ConnectionTestResult } from '../../types/messages';
import type { ExtensionSettings } from '../../types/settings';

const SAMPLE_EN = 'Hello, EchoSub live subtitles are ready!';

export async function testAsrConnection(
  settings: ExtensionSettings
): Promise<{ ok: boolean; message: string; latencyMs?: number }> {
  const started = performance.now();

  try {
    switch (settings.asrProvider) {
      case 'demo':
        return {
          ok: true,
          message: '内置演示流已就绪（无需 API Key）',
          latencyMs: 0,
        };

      case 'siliconflow': {
        const res = await testSiliconFlowAsr(
          settings.siliconflowApiKey,
          settings.siliconflowAsrModel
        );
        return {
          ok: true,
          message: `硅基流动免费 SenseVoiceSmall 连通成功`,
          latencyMs: res.latencyMs,
        };
      }

      case 'groq': {
        if (!settings.groqApiKey.trim()) {
          return { ok: false, message: '请先填写 Groq API Key' };
        }
        const res = await fetch('https://api.groq.com/openai/v1/models', {
          headers: { Authorization: `Bearer ${settings.groqApiKey.trim()}` },
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) {
          return { ok: false, message: `Groq 鉴权失败 (HTTP ${res.status})` };
        }
        return {
          ok: true,
          message: 'Groq Whisper 接口连通成功',
          latencyMs: Math.round(performance.now() - started),
        };
      }

      case 'deepgram': {
        if (!settings.deepgramApiKey.trim()) {
          return { ok: false, message: '请先填写 Deepgram API Key' };
        }
        const res = await fetch('https://api.deepgram.com/v1/projects', {
          headers: {
            Authorization: `Token ${settings.deepgramApiKey.trim()}`,
          },
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) {
          return {
            ok: false,
            message: `Deepgram 鉴权失败 (HTTP ${res.status})`,
          };
        }
        return {
          ok: true,
          message: 'Deepgram 接口连通成功',
          latencyMs: Math.round(performance.now() - started),
        };
      }

      case 'dashscope': {
        if (!settings.dashscopeApiKey.trim()) {
          return { ok: false, message: '请先填写阿里云百炼 DashScope API Key' };
        }
        const res = await fetch(
          'https://dashscope.aliyuncs.com/compatible-mode/v1/models',
          {
            headers: {
              Authorization: `Bearer ${settings.dashscopeApiKey.trim()}`,
            },
            signal: AbortSignal.timeout(6000),
          }
        );
        if (!res.ok) {
          return {
            ok: false,
            message: `百炼鉴权失败 (HTTP ${res.status})，请检查 Key`,
          };
        }
        return {
          ok: true,
          message: '阿里云百炼 API Key 校验通过',
          latencyMs: Math.round(performance.now() - started),
        };
      }

      case 'local-ws': {
        return await testLocalWs(settings.localWsUrl);
      }
    }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function testTranslatorConnection(
  settings: ExtensionSettings
): Promise<{
  ok: boolean;
  message: string;
  sample?: string;
  latencyMs?: number;
}> {
  if (settings.translatorProvider === 'none') {
    return { ok: true, message: '翻译已关闭（仅显示原文）', latencyMs: 0 };
  }

  const started = performance.now();
  try {
    const translator = createTranslatorAdapter(settings);
    const translated = await translator.translate({
      text: SAMPLE_EN,
      sourceLang: 'en',
      targetLang: settings.targetLanguage || 'zh-CN',
      signal: AbortSignal.timeout(9000),
    });
    if (!translated) {
      return { ok: false, message: '翻译引擎返回空结果' };
    }
    return {
      ok: true,
      message: '翻译引擎连通成功',
      sample: translated,
      latencyMs: Math.round(performance.now() - started),
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function testLocalWs(
  url: string
): Promise<{ ok: boolean; message: string; latencyMs?: number }> {
  return new Promise((resolve) => {
    const started = performance.now();
    let settled = false;
    const finish = (res: { ok: boolean; message: string; latencyMs?: number }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(res);
    };

    const timer = setTimeout(() => {
      finish({
        ok: false,
        message: `连接本地服务超时 (${url})，请先双击运行 local-asr/一键启动本地语音引擎.bat`,
      });
    }, 3500);

    try {
      const ws = new WebSocket(url.trim());
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'ping' }));
        // Even if custom server doesn't reply pong, successful WS open confirms connectivity
        setTimeout(() => {
          try {
            ws.close();
          } catch {
            // Ignore
          }
          finish({
            ok: true,
            message: '本地离线语音服务连接成功',
            latencyMs: Math.round(performance.now() - started),
          });
        }, 350);
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string' && ev.data.includes('pong')) {
          try {
            const parsed = JSON.parse(ev.data) as {
              engine?: string;
              model?: string;
            };
            ws.close();
            finish({
              ok: true,
              message: `本地引擎已就绪 (${parsed.engine ?? 'local'} / ${parsed.model ?? 'default'})`,
              latencyMs: Math.round(performance.now() - started),
            });
          } catch {
            // Let timeout/open handle
          }
        }
      };
      ws.onerror = () => {
        finish({
          ok: false,
          message: `无法连接本地服务 (${url})，请先双击启动 local-asr/一键启动本地语音引擎.bat`,
        });
      };
    } catch (err) {
      finish({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

export function combineTestResults(
  asr: { ok: boolean; message: string; latencyMs?: number },
  translator: {
    ok: boolean;
    message: string;
    sample?: string;
    latencyMs?: number;
  }
): ConnectionTestResult {
  return {
    asrOk: asr.ok,
    asrMessage: asr.message,
    asrLatencyMs: asr.latencyMs,
    translatorOk: translator.ok,
    translatorMessage: translator.message,
    translatorSample: translator.sample,
    translatorLatencyMs: translator.latencyMs,
  };
}

/**
 * Runs both ASR & Translator checks in parallel directly inside an extension Window context
 * (Side Panel / Popup), avoiding unnecessary SW <-> Offscreen IPC hops and supporting
 * Chrome 138+ `self.Translator` natively.
 */
export async function runAllConnectionTests(
  settings: ExtensionSettings
): Promise<ConnectionTestResult> {
  const [asr, translator] = await Promise.all([
    testAsrConnection(settings),
    testTranslatorConnection(settings),
  ]);
  return combineTestResults(asr, translator);
}
