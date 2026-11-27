import { TARGET_SAMPLE_RATE } from './resampler';
import type { SpeakerInfo } from '../../types/subtitle';

export interface SpeakerPaletteEntry {
  id: string;
  index: number;
  labelZh: string;
  labelEn: string;
  color: string;
}

/**
 * High-contrast cinematic speaker colors designed for readability over dark frosted glass.
 */
export const SPEAKER_PALETTE: readonly SpeakerPaletteEntry[] = [
  { id: 'spk_1', index: 0, labelZh: '角色 A', labelEn: 'Speaker A', color: '#38e8d6' }, // Cyan-Teal
  { id: 'spk_2', index: 1, labelZh: '角色 B', labelEn: 'Speaker B', color: '#fbbf24' }, // Warm Amber
  { id: 'spk_3', index: 2, labelZh: '角色 C', labelEn: 'Speaker C', color: '#f472b6' }, // Rose Pink
  { id: 'spk_4', index: 3, labelZh: '角色 D', labelEn: 'Speaker D', color: '#a78bfa' }, // Lavender Violet
  { id: 'spk_5', index: 4, labelZh: '角色 E', labelEn: 'Speaker E', color: '#4ade80' }, // Mint Emerald
];

export interface VoiceprintFeatures {
  /** Normalized 10-dim MFCC timbre vector (c1..c10, energy-invariant). */
  mfcc: Float32Array;
  /** Median voiced fundamental frequency in Hz (75..380 Hz). */
  pitchHz: number;
  /** Mean normalized spectral centroid (0..1, brightness). */
  centroid: number;
  /** Number of voiced frames analyzed. */
  voicedFrames: number;
}

interface SpeakerProfile {
  palette: SpeakerPaletteEntry;
  mfcc: Float32Array;
  pitchHz: number;
  centroid: number;
  sampleCount: number;
}

export interface SpeakerDiarizerOptions {
  maxSpeakers?: number;
  /** Combined similarity threshold [0..1] below which a new speaker is spawned. */
  matchThreshold?: number;
  locale?: 'zh' | 'en';
}

const FFT_SIZE = 512;
const HOP_SIZE = 256;
const NUM_MEL_BANDS = 12;
const NUM_MFCC = 10; // c1..c10 (skip c0 loudness for volume invariance)
const MIN_PITCH_HZ = 75;
const MAX_PITCH_HZ = 380;

// Precomputed Hann window, Mel filterbank, and DCT matrix for sub-millisecond inference
const HANN_WINDOW = buildHannWindow(FFT_SIZE);
const MEL_FILTERS = buildMelFilterbank(
  FFT_SIZE,
  TARGET_SAMPLE_RATE,
  NUM_MEL_BANDS,
  100,
  6800
);
const DCT_MATRIX = buildDctMatrix(NUM_MEL_BANDS, NUM_MFCC);

function buildHannWindow(size: number): Float32Array {
  const win = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  return win;
}

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

function melToHz(mel: number): number {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}

function buildMelFilterbank(
  fftSize: number,
  sampleRate: number,
  numBands: number,
  minHz: number,
  maxHz: number
): Float32Array[] {
  const numBins = fftSize / 2 + 1;
  const minMel = hzToMel(minHz);
  const maxMel = hzToMel(maxHz);
  const binPoints: number[] = [];

  for (let i = 0; i < numBands + 2; i++) {
    const mel = minMel + ((maxMel - minMel) * i) / (numBands + 1);
    const hz = melToHz(mel);
    binPoints.push(Math.floor(((fftSize + 1) * hz) / sampleRate));
  }

  const filters: Float32Array[] = [];
  for (let b = 1; b <= numBands; b++) {
    const filter = new Float32Array(numBins);
    const left = binPoints[b - 1];
    const center = Math.max(left + 1, binPoints[b]);
    const right = Math.max(center + 1, binPoints[b + 1]);

    for (let k = left; k < center && k < numBins; k++) {
      filter[k] = (k - left) / (center - left);
    }
    for (let k = center; k <= right && k < numBins; k++) {
      filter[k] = (right - k) / (right - center);
    }
    filters.push(filter);
  }
  return filters;
}

function buildDctMatrix(numBands: number, numCoeffs: number): Float32Array[] {
  const rows: Float32Array[] = [];
  // Start at c = 1 to skip c0 (volume)
  for (let c = 1; c <= numCoeffs; c++) {
    const row = new Float32Array(numBands);
    for (let m = 0; m < numBands; m++) {
      row[m] = Math.cos((Math.PI * c * (m + 0.5)) / numBands);
    }
    rows.push(row);
  }
  return rows;
}

/**
 * In-place iterative Radix-2 Cooley-Tukey FFT.
 */
function fftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wStepRe = Math.cos(angle);
    const wStepIm = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + half] * wRe - im[i + j + half] * wIm;
        const vIm = re[i + j + half] * wIm + im[i + j + half] * wRe;

        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + half] = uRe - vRe;
        im[i + j + half] = uIm - vIm;

        const nextWRe = wRe * wStepRe - wIm * wStepIm;
        wIm = wRe * wStepIm + wIm * wStepRe;
        wRe = nextWRe;
      }
    }
  }
}

/**
 * Estimates fundamental frequency F0 (Hz) on a 512-sample frame via normalized autocorrelation
 * with first-major-peak selection (prevents octave-halving errors when speakers shout).
 */
function estimateFramePitchHz(frame: Float32Array, sampleRate: number): number {
  const minLag = Math.floor(sampleRate / MAX_PITCH_HZ);
  const maxLag = Math.min(frame.length - 2, Math.floor(sampleRate / MIN_PITCH_HZ));

  let energy0 = 0;
  for (let i = 0; i < frame.length; i++) {
    energy0 += frame[i] * frame[i];
  }
  if (energy0 < 1e-4) return 0;

  const corrs = new Float32Array(maxLag + 1);
  let maxCorr = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let dot = 0;
    let e1 = 0;
    let e2 = 0;
    const limit = frame.length - lag;
    for (let i = 0; i < limit; i++) {
      const a = frame[i];
      const b = frame[i + lag];
      dot += a * b;
      e1 += a * a;
      e2 += b * b;
    }
    const denom = Math.sqrt(e1 * e2);
    const corr = denom > 1e-8 ? dot / denom : 0;
    corrs[lag] = corr;
    if (corr > maxCorr) maxCorr = corr;
  }

  // Require strong periodicity to reject unvoiced fricatives/noise
  if (maxCorr < 0.45) return 0;

  // Pick the FIRST strong local peak >= 86% of global max to avoid picking double-period (F0/2)
  const threshold = maxCorr * 0.86;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (
      corrs[lag] >= threshold &&
      corrs[lag] >= corrs[lag - 1] &&
      corrs[lag] >= corrs[lag + 1]
    ) {
      return sampleRate / lag;
    }
  }

  let bestLag = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (corrs[lag] === maxCorr) {
      bestLag = lag;
      break;
    }
  }
  return sampleRate / bestLag;
}

function l2Normalize(vec: Float32Array): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) sumSq += vec[i] * vec[i];
  const norm = Math.sqrt(sumSq);
  const out = new Float32Array(vec.length);
  if (norm > 1e-8) {
    for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm;
  }
  return out;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return Math.max(-1, Math.min(1, dot));
}

/**
 * Extracts a compact, volume-invariant voiceprint (10-dim MFCC + median Pitch F0 + Spectral Centroid)
 * from 16kHz Int16 mono PCM audio in <0.5ms.
 */
export function extractVoiceprint(
  pcm16k: Int16Array,
  sampleRate = TARGET_SAMPLE_RATE
): VoiceprintFeatures | null {
  if (pcm16k.length < FFT_SIZE * 2) return null;

  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  const rawFrame = new Float32Array(FFT_SIZE);
  const magSq = new Float32Array(FFT_SIZE / 2 + 1);
  const logMel = new Float32Array(NUM_MEL_BANDS);
  const mfccAcc = new Float32Array(NUM_MFCC);
  const pitches: number[] = [];

  let voicedFrames = 0;
  let centroidAcc = 0;

  // Analyze up to 120 frames (~2 seconds) for bounded sub-ms CPU cost
  const maxStart = pcm16k.length - FFT_SIZE;
  const stride = Math.max(HOP_SIZE, Math.floor(maxStart / 110));

  for (let offset = 0; offset <= maxStart; offset += stride) {
    let sumSq = 0;
    for (let i = 0; i < FFT_SIZE; i++) {
      const s = pcm16k[offset + i] / 32768;
      rawFrame[i] = s;
      sumSq += s * s;
    }

    const rms = Math.sqrt(sumSq / FFT_SIZE);
    if (rms < 0.014) continue; // Ignore silent/quiet background frames

    const pitch = estimateFramePitchHz(rawFrame, sampleRate);
    if (pitch > 0) {
      pitches.push(pitch);
    }

    // Window + FFT
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = rawFrame[i] * HANN_WINDOW[i];
      im[i] = 0;
    }
    fftInPlace(re, im);

    let magSum = 0;
    let weightedBinSum = 0;
    const numBins = FFT_SIZE / 2 + 1;
    for (let k = 0; k < numBins; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      magSq[k] = p;
      const m = Math.sqrt(p);
      magSum += m;
      weightedBinSum += k * m;
    }

    if (magSum > 1e-6) {
      centroidAcc += weightedBinSum / magSum / numBins;
    }

    for (let b = 0; b < NUM_MEL_BANDS; b++) {
      const filter = MEL_FILTERS[b];
      let bandEnergy = 0;
      for (let k = 0; k < numBins; k++) {
        if (filter[k] > 0) bandEnergy += magSq[k] * filter[k];
      }
      logMel[b] = Math.log(bandEnergy + 1e-7);
    }

    for (let c = 0; c < NUM_MFCC; c++) {
      const row = DCT_MATRIX[c];
      let val = 0;
      for (let b = 0; b < NUM_MEL_BANDS; b++) {
        val += row[b] * logMel[b];
      }
      mfccAcc[c] += val;
    }

    voicedFrames++;
  }

  if (voicedFrames < 4) return null;

  for (let c = 0; c < NUM_MFCC; c++) {
    mfccAcc[c] /= voicedFrames;
  }

  let medianPitch = 150;
  if (pitches.length > 0) {
    pitches.sort((a, b) => a - b);
    medianPitch = pitches[Math.floor(pitches.length / 2)];
  }

  return {
    mfcc: l2Normalize(mfccAcc),
    pitchHz: Math.round(medianPitch),
    centroid: centroidAcc / voicedFrames,
    voicedFrames,
  };
}

/**
 * Online Streaming Acoustic Speaker Diarizer.
 * Clusters speakers in real time by pitch (F0), vocal-tract timbre (MFCC), and brightness,
 * assigning distinct subtitle colors with zero cloud cost and <0.5ms latency.
 */
export class SpeakerDiarizer {
  private readonly maxSpeakers: number;
  private matchThreshold: number;
  private locale: 'zh' | 'en';
  private profiles: SpeakerProfile[] = [];
  private lastAssigned: SpeakerInfo | null = null;

  constructor(options: SpeakerDiarizerOptions = {}) {
    this.maxSpeakers = Math.min(
      SPEAKER_PALETTE.length,
      Math.max(2, options.maxSpeakers ?? 4)
    );
    this.matchThreshold = options.matchThreshold ?? 0.64;
    this.locale = options.locale ?? 'zh';
  }

  setLocale(locale: 'zh' | 'en'): void {
    this.locale = locale;
  }

  setMatchThreshold(threshold: number): void {
    this.matchThreshold = Math.max(0.45, Math.min(0.85, threshold));
  }

  /**
   * Maps an explicit cloud/demo speaker index (0..N) to a styled SpeakerInfo.
   */
  fromSpeakerIndex(index: number): SpeakerInfo {
    const entry =
      SPEAKER_PALETTE[Math.abs(index) % SPEAKER_PALETTE.length];
    const info = this.toSpeakerInfo(entry);
    this.lastAssigned = info;
    return info;
  }

  /**
   * Classifies a speech utterance's PCM audio into an existing or newly discovered speaker.
   * Uses un-compressed exponential MFCC distance + semitone pitch distance + spectral brightness
   * so rapid A -> B -> A -> B dialogue switches colors immediately on Turn 1.
   */
  identify(pcm16k: Int16Array): SpeakerInfo {
    const features = extractVoiceprint(pcm16k);
    if (!features) {
      return this.lastAssigned ?? this.toSpeakerInfo(SPEAKER_PALETTE[0]);
    }

    if (this.profiles.length === 0) {
      const profile: SpeakerProfile = {
        palette: SPEAKER_PALETTE[0],
        mfcc: features.mfcc,
        pitchHz: features.pitchHz,
        centroid: features.centroid,
        sampleCount: 1,
      };
      this.profiles.push(profile);
      const info = this.toSpeakerInfo(profile.palette, features.pitchHz);
      this.lastAssigned = info;
      return info;
    }

    let bestProfile: SpeakerProfile | null = null;
    let bestScore = -Infinity;

    for (const profile of this.profiles) {
      const score = this.computeSimilarity(features, profile);
      if (score > bestScore) {
        bestScore = score;
        bestProfile = profile;
      }
    }

    // Spawn a new speaker immediately when acoustic distance exceeds threshold on solid voiced speech
    if (
      bestScore < this.matchThreshold &&
      this.profiles.length < this.maxSpeakers &&
      features.voicedFrames >= 8
    ) {
      const palette = SPEAKER_PALETTE[this.profiles.length];
      const created: SpeakerProfile = {
        palette,
        mfcc: features.mfcc,
        pitchHz: features.pitchHz,
        centroid: features.centroid,
        sampleCount: 1,
      };
      this.profiles.push(created);
      const info = this.toSpeakerInfo(palette, features.pitchHz);
      this.lastAssigned = info;
      return info;
    }

    const matched = bestProfile ?? this.profiles[0];
    // Smooth EMA profile refinement on confident match
    if (bestScore >= this.matchThreshold) {
      const alpha = Math.max(0.08, 1 / (matched.sampleCount + 4));
      const updated = new Float32Array(NUM_MFCC);
      for (let i = 0; i < NUM_MFCC; i++) {
        updated[i] = matched.mfcc[i] * (1 - alpha) + features.mfcc[i] * alpha;
      }
      matched.mfcc = l2Normalize(updated);
      matched.pitchHz = Math.round(
        matched.pitchHz * (1 - alpha) + features.pitchHz * alpha
      );
      matched.centroid =
        matched.centroid * (1 - alpha) + features.centroid * alpha;
      matched.sampleCount++;
    }

    const info = this.toSpeakerInfo(matched.palette, features.pitchHz);
    this.lastAssigned = info;
    return info;
  }

  getDetectedSpeakers(): SpeakerInfo[] {
    return this.profiles.map((p) => this.toSpeakerInfo(p.palette, p.pitchHz));
  }

  reset(): void {
    this.profiles = [];
    this.lastAssigned = null;
  }

  private computeSimilarity(
    feat: VoiceprintFeatures,
    profile: SpeakerProfile
  ): number {
    // True cosine distance (0 = identical, ~0.04 = same speaker, 0.14+ = different timbre)
    const mfccDist = Math.max(0, 1 - cosineSimilarity(feat.mfcc, profile.mfcc));
    const mfccSim = Math.exp(-mfccDist / 0.16);

    // Semitone pitch similarity (~0-2.5st same voice, 4-12st different voice)
    const semitoneDiff = Math.abs(
      12 * Math.log2(Math.max(50, feat.pitchHz) / Math.max(50, profile.pitchHz))
    );
    const pitchSim = Math.exp(-semitoneDiff / 5.5);

    // Spectral brightness similarity
    const centroidSim = Math.exp(-Math.abs(feat.centroid - profile.centroid) / 0.08);

    return 0.48 * mfccSim + 0.36 * pitchSim + 0.16 * centroidSim;
  }

  private toSpeakerInfo(
    palette: SpeakerPaletteEntry,
    pitchHz?: number
  ): SpeakerInfo {
    return {
      id: palette.id,
      index: palette.index,
      label: this.locale === 'zh' ? palette.labelZh : palette.labelEn,
      color: palette.color,
      pitchHz,
    };
  }
}
