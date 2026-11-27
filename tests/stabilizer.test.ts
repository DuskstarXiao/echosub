import { describe, expect, it } from 'vitest';
import {
  SubtitleStabilizer,
  tokenizeLossless,
} from '../src/core/subtitle/stabilizer';

describe('SubtitleStabilizer (Anti-Flicker Prefix Locking)', () => {
  it('tokenizes mixed CJK and English losslessly', () => {
    const sample = '欢迎使用 EchoSub, real-time 字幕!';
    const tokens = tokenizeLossless(sample);
    expect(tokens.map((t) => t.raw).join('')).toBe(sample);
  });

  it('locks stable prefix monotonically across agreeing hypotheses without shrinking', () => {
    const stabilizer = new SubtitleStabilizer({ minAgreementCount: 2 });

    // Hypothesis 1: everything is speculative initially
    const r1 = stabilizer.push('Today we are going', false, 1000);
    expect(r1.finalizedSegment).toBeNull();
    expect(r1.activeCaption?.committedSource).toBe('');
    expect(r1.activeCaption?.speculativeSource).toBe('Today we are going');

    // Hypothesis 2: agrees on "Today we are" -> locks prefix!
    const r2 = stabilizer.push('Today we are gonna build', false, 1400);
    expect(r2.activeCaption?.committedSource).toBe('Today we are');
    expect(r2.activeCaption?.speculativeSource).toBe(' gonna build');

    // Hypothesis 3: ASR tries to slightly alter word 2, committed prefix MUST remain locked!
    const r3 = stabilizer.push('Today we were going to build EchoSub', false, 1800);
    expect(r3.activeCaption?.committedSource).toBe('Today we are');

    // Final event emits clean segment and resets active cue
    const r4 = stabilizer.push('Today we are going to build EchoSub.', true, 2300, 'en');
    expect(r4.activeCaption).toBeNull();
    expect(r4.finalizedSegment).not.toBeNull();
    expect(r4.finalizedSegment?.sourceText).toBe(
      'Today we are going to build EchoSub.'
    );
    expect(r4.finalizedSegment?.startMs).toBe(1000);
    expect(r4.finalizedSegment?.endMs).toBe(2300);
    expect(r4.finalizedSegment?.language).toBe('en');
  });

  it('preserves existing interim translation on finalization', () => {
    const stabilizer = new SubtitleStabilizer();
    const r1 = stabilizer.push('Hello world', false, 500);
    stabilizer.setCurrentTranslation(r1.activeCaption!.id, '你好世界');
    const r2 = stabilizer.push('Hello world!', true, 1200);
    expect(r2.finalizedSegment?.translatedText).toBe('你好世界');
  });
});
