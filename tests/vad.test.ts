import { describe, expect, it } from 'vitest';
import { VoiceActivityDetector } from '../src/core/audio/vad';

describe('VoiceActivityDetector', () => {
  it('stays idle on silence and triggers speech after minSpeechFrames', () => {
    const vad = new VoiceActivityDetector({
      thresholdDb: -40,
      minSpeechFrames: 2,
      hangoverFrames: 3,
      adaptiveNoiseFloor: false,
    });

    // Silent frame
    const s1 = vad.evaluate({ rms: 0.001, zcr: 0.05 });
    expect(s1.isSpeech).toBe(false);

    // 1st voiced frame (attack not yet satisfied -> filters single-frame clicks)
    const v1 = vad.evaluate({ rms: 0.08, zcr: 0.1 });
    expect(v1.isSpeech).toBe(false);
    expect(v1.speechStarted).toBe(false);

    // 2nd voiced frame -> speech starts!
    const v2 = vad.evaluate({ rms: 0.09, zcr: 0.12 });
    expect(v2.isSpeech).toBe(true);
    expect(v2.speechStarted).toBe(true);
  });

  it('holds speech state through hangoverFrames before firing speechEnded', () => {
    const vad = new VoiceActivityDetector({
      thresholdDb: -40,
      minSpeechFrames: 1,
      hangoverFrames: 3,
      adaptiveNoiseFloor: false,
    });

    expect(vad.evaluate({ rms: 0.1, zcr: 0.1 }).isSpeech).toBe(true);

    // 2 silent frames still inside hangover window
    expect(vad.evaluate({ rms: 0.0005, zcr: 0.02 }).isSpeech).toBe(true);
    expect(vad.evaluate({ rms: 0.0005, zcr: 0.02 }).isSpeech).toBe(true);

    // 3rd silent frame completes hangover -> speechEnded
    const end = vad.evaluate({ rms: 0.0005, zcr: 0.02 });
    expect(end.isSpeech).toBe(false);
    expect(end.speechEnded).toBe(true);
  });

  it('rejects low-energy high-frequency hiss outside vocal ZCR band', () => {
    const vad = new VoiceActivityDetector({
      thresholdDb: -40,
      minSpeechFrames: 1,
      adaptiveNoiseFloor: false,
    });
    // Just above threshold (-38 dB) but extreme ZCR (0.7 = white noise/hiss)
    const hiss = vad.evaluate({ rms: 0.012, zcr: 0.7 });
    expect(hiss.isSpeech).toBe(false);
  });
});
