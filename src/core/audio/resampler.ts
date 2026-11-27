/**
 * Pure TypeScript 16kHz mono PCM resampling & RIFF WAV encoding utilities.
 * Decoupled from browser APIs so it can be thoroughly unit-tested in Vitest
 * and shared across AudioWorklet fallbacks & HTTP-based ASR adapters (Groq Whisper).
 */

export const TARGET_SAMPLE_RATE = 16000;

/**
 * Stateful linear resampler from arbitrary source sample rate (e.g. 48kHz / 44.1kHz)
 * to 16kHz Int16 mono PCM.
 */
export class StatefulPcmResampler {
  private readonly ratio: number;
  private phase = 0;

  constructor(
    sourceSampleRate: number,
    targetSampleRate: number = TARGET_SAMPLE_RATE
  ) {
    if (sourceSampleRate <= 0 || targetSampleRate <= 0) {
      throw new Error('Sample rates must be positive numbers');
    }
    this.ratio = sourceSampleRate / targetSampleRate;
  }

  process(input: Float32Array): Int16Array {
    if (input.length === 0) return new Int16Array(0);

    const estimated = Math.max(
      0,
      Math.ceil((input.length - this.phase) / this.ratio)
    );
    const out = new Int16Array(estimated);
    let writeIdx = 0;
    let pos = this.phase;

    while (pos < input.length) {
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const s0 = input[idx];
      const s1 = idx + 1 < input.length ? input[idx + 1] : input[input.length - 1];
      const interpolated = s0 + (s1 - s0) * frac;
      const clamped = Math.max(-1, Math.min(1, interpolated));
      out[writeIdx++] =
        clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
      pos += this.ratio;
    }

    this.phase = pos - input.length;
    return writeIdx === out.length ? out : out.subarray(0, writeIdx);
  }

  reset(): void {
    this.phase = 0;
  }
}

/**
 * Downmix multi-channel planar Float32 buffers into a single mono Float32Array.
 */
export function downmixToMono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return new Float32Array(channels[0]);

  const len = channels[0].length;
  const mono = new Float32Array(len);
  const invCount = 1 / channels.length;

  for (let i = 0; i < len; i++) {
    let sum = 0;
    for (let c = 0; c < channels.length; c++) {
      sum += channels[c][i] ?? 0;
    }
    mono[i] = sum * invCount;
  }

  return mono;
}

/**
 * Convert RMS amplitude (0..1) into decibels clamped to [-60, 0].
 */
export function rmsToDb(rms: number): number {
  if (rms <= 1e-6) return -60;
  return Math.max(-60, Math.min(0, 20 * Math.log10(rms)));
}

/**
 * Concatenate multiple Int16Array PCM chunks into one contiguous Int16Array.
 */
export function concatInt16Arrays(chunks: readonly Int16Array[]): Int16Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Int16Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * Encode 16-bit mono PCM samples into a standard RIFF WAVE ArrayBuffer.
 */
export function encodeWavFromInt16(
  pcm: Int16Array,
  sampleRate: number = TARGET_SAMPLE_RATE
): ArrayBuffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcm.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');

  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // AudioFormat = 1 (PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Copy little-endian Int16 samples
  const outBytes = new Uint8Array(buffer, 44);
  const srcBytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  outBytes.set(srcBytes);

  return buffer;
}

function writeAscii(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
