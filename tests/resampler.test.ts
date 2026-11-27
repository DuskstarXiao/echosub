import { describe, expect, it } from 'vitest';
import {
  StatefulPcmResampler,
  TARGET_SAMPLE_RATE,
  concatInt16Arrays,
  downmixToMono,
  encodeWavFromInt16,
  rmsToDb,
} from '../src/core/audio/resampler';
import { PcmRingBuffer } from '../src/core/audio/ring-buffer';

describe('StatefulPcmResampler & WAV encoder', () => {
  it('resamples 48kHz stereo downmixed sine wave accurately to 16kHz Int16 PCM across chunks', () => {
    const resampler = new StatefulPcmResampler(48000, TARGET_SAMPLE_RATE);
    // 1 second of 48kHz audio split into 375 Web Audio render quanta (128 frames each)
    const chunks: Int16Array[] = [];
    for (let q = 0; q < 375; q++) {
      const quantum = new Float32Array(128);
      for (let i = 0; i < 128; i++) {
        const sampleIdx = q * 128 + i;
        quantum[i] = Math.sin((2 * Math.PI * 440 * sampleIdx) / 48000) * 0.5;
      }
      chunks.push(resampler.process(quantum));
    }

    const combined = concatInt16Arrays(chunks);
    expect(combined.length).toBe(16000);
    // Peak should be close to 0.5 * 32767 ≈ 16383
    let maxAbs = 0;
    for (let i = 0; i < combined.length; i++) {
      maxAbs = Math.max(maxAbs, Math.abs(combined[i]));
    }
    expect(maxAbs).toBeGreaterThan(15800);
    expect(maxAbs).toBeLessThanOrEqual(16400);
  });

  it('downmixes stereo channels accurately to mono', () => {
    const left = new Float32Array([1, -1, 0.5]);
    const right = new Float32Array([0, 1, 0.5]);
    const mono = downmixToMono([left, right]);
    expect(Array.from(mono)).toEqual([0.5, 0, 0.5]);
  });

  it('encodes a valid RIFF WAVE header and payload', () => {
    const pcm = new Int16Array([0, 1000, -1000, 32767]);
    const wav = encodeWavFromInt16(pcm, 16000);
    expect(wav.byteLength).toBe(44 + pcm.byteLength);

    const view = new DataView(wav);
    const riff = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3)
    );
    const wave = String.fromCharCode(
      view.getUint8(8),
      view.getUint8(9),
      view.getUint8(10),
      view.getUint8(11)
    );
    expect(riff).toBe('RIFF');
    expect(wave).toBe('WAVE');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // Mono
    expect(view.getUint32(24, true)).toBe(16000); // Sample rate
    expect(view.getUint32(40, true)).toBe(8); // Data bytes
    expect(view.getInt16(46, true)).toBe(1000);
    expect(view.getInt16(48, true)).toBe(-1000);
  });

  it('clamps RMS-to-dB cleanly between -60 and 0', () => {
    expect(rmsToDb(0)).toBe(-60);
    expect(rmsToDb(1)).toBe(0);
    expect(Math.round(rmsToDb(0.1))).toBe(-20);
  });

  it('preserves chronological order in PcmRingBuffer on wrap-around', () => {
    const ring = new PcmRingBuffer(6);
    ring.push(new Int16Array([1, 2, 3, 4]));
    ring.push(new Int16Array([5, 6, 7, 8]));
    expect(Array.from(ring.readAll())).toEqual([3, 4, 5, 6, 7, 8]);
  });
});
