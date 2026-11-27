import { describe, expect, it, vi } from 'vitest';
import { TARGET_SAMPLE_RATE } from '../src/core/audio/resampler';
import {
  SpeakerDiarizer,
  extractVoiceprint,
} from '../src/core/audio/speaker-diarizer';
import { TranslationScheduler } from '../src/core/subtitle/translation-queue';
import { isAlreadyInTargetLanguage } from '../src/core/translator/language-detect';
import { cleanTranslatedOutput } from '../src/core/translator/llm-openai';
import type { TranslateRequest, TranslatorAdapter } from '../src/core/translator/types';

function synthesizeVoice(params: {
  f0: number;
  harmonicWeights: number[];
  durationSec: number;
  amplitude: number;
}): Int16Array {
  const n = Math.floor(TARGET_SAMPLE_RATE * params.durationSec);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / TARGET_SAMPLE_RATE;
    let sample = 0;
    for (let h = 0; h < params.harmonicWeights.length; h++) {
      const freq = params.f0 * (h + 1);
      if (freq < TARGET_SAMPLE_RATE / 2) {
        sample += params.harmonicWeights[h] * Math.sin(2 * Math.PI * freq * t);
      }
    }
    const clamped = Math.max(-0.98, Math.min(0.98, sample * params.amplitude));
    out[i] = Math.round(clamped * 32767);
  }
  return out;
}

describe('Real-Time Acoustic SpeakerDiarizer, Bracket Cleanup & Mode B Sentence Mode', () => {
  it('extracts accurate pitch F0 and energy-invariant MFCC voiceprint', () => {
    const maleVoice = synthesizeVoice({
      f0: 112,
      harmonicWeights: [0.6, 0.45, 0.3, 0.15, 0.08],
      durationSec: 0.8,
      amplitude: 0.35,
    });
    const vp = extractVoiceprint(maleVoice);
    expect(vp).not.toBeNull();
    expect(vp!.pitchHz).toBeGreaterThan(100);
    expect(vp!.pitchHz).toBeLessThan(125);
    expect(vp!.mfcc.length).toBe(10);
  });

  it('distinguishes distinct voice timbres while keeping one expressive speaker consistent', () => {
    const diarizer = new SpeakerDiarizer({ locale: 'zh' });

    const maleCalm = synthesizeVoice({
      f0: 112,
      harmonicWeights: [0.68, 0.52, 0.28, 0.12, 0.04],
      durationSec: 0.9,
      amplitude: 0.25,
    });

    // Same vocal tract formants, louder & slightly higher excited pitch -> MUST stay Speaker A!
    const maleExcited = synthesizeVoice({
      f0: 138,
      harmonicWeights: [0.66, 0.5, 0.29, 0.13, 0.05],
      durationSec: 0.9,
      amplitude: 0.65,
    });

    // Very different bright female voice -> spawns Speaker B cleanly!
    const femaleBright = synthesizeVoice({
      f0: 255,
      harmonicWeights: [0.15, 0.3, 0.65, 0.58, 0.45, 0.38],
      durationSec: 0.9,
      amplitude: 0.35,
    });

    const r1 = diarizer.identify(maleCalm);
    const r2 = diarizer.identify(maleExcited);
    // Must switch immediately on Turn 1 for rapid A -> B -> A dialogue!
    const r3 = diarizer.identify(femaleBright);
    const r4 = diarizer.identify(maleCalm);
    const r5 = diarizer.identify(femaleBright);

    expect(r1.id).toBe('spk_1');
    expect(r2.id).toBe('spk_1'); // Expressive loudness/pitch change stays same speaker!
    expect(r3.id).toBe('spk_2'); // Immediately detects Speaker B on Turn 1!
    expect(r3.color).not.toBe(r1.color);
    expect(r4.id).toBe('spk_1'); // Returns cleanly to Speaker A
    expect(r5.id).toBe('spk_2'); // Matches Speaker B again without spawning C!
  });

  it('strips accidental LLM speaker bracket prefixes and surrounding quotes', () => {
    expect(cleanTranslatedOutput('[角色 A] 大家好欢迎来到直播间')).toBe(
      '大家好欢迎来到直播间'
    );
    expect(cleanTranslatedOutput('【Speaker B】: "这太酷了！"')).toBe(
      '这太酷了！'
    );
    expect(cleanTranslatedOutput('角色 C：我们出发吧')).toBe('我们出发吧');
  });

  it('suppresses word-by-word interim translations in Mode B (sentence mode)', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const adapter: TranslatorAdapter = {
      id: 'llm',
      async translate(req: TranslateRequest) {
        calls.push(req.text);
        return `译:${req.text}`;
      },
    };

    const scheduler = new TranslationScheduler(adapter, {
      timingMode: 'sentence',
      sourceLang: 'en',
      targetLang: 'zh-CN',
    });

    const interimCb = vi.fn();
    scheduler.scheduleInterim('cap1', 'Hello every', interimCb);
    scheduler.scheduleInterim('cap1', 'Hello everyone welcome', interimCb);
    await vi.advanceTimersByTimeAsync(1000);

    expect(interimCb).not.toHaveBeenCalled();
    expect(calls).toEqual([]);

    const finalOut = await scheduler.translateFinal('Hello everyone, welcome back.');
    expect(finalOut).toBe('译:Hello everyone, welcome back.');
    expect(calls).toEqual(['Hello everyone, welcome back.']);

    scheduler.dispose();
    vi.useRealTimers();
  });

  it('prevents redundant same-language translation while allowing foreign & mixed speech', () => {
    expect(isAlreadyInTargetLanguage('你好，今天我们来看这个视频', 'auto', 'zh-CN')).toBe(true);
    expect(isAlreadyInTargetLanguage('Welcome back to the stream!', 'auto', 'zh-CN')).toBe(false);
    expect(isAlreadyInTargetLanguage('こんにちは、今日はいい天気ですね', 'auto', 'zh-CN')).toBe(false);
    expect(
      isAlreadyInTargetLanguage(
        '这个 AudioWorklet pipeline really works well',
        'auto',
        'zh-CN'
      )
    ).toBe(false);
  });
});
