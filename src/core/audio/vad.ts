import { rmsToDb } from './resampler';

export interface VadOptions {
  /** Base energy threshold in dBFS (e.g. -42). Frames below this are considered silence. */
  thresholdDb?: number;
  /** Number of consecutive voiced frames required to enter speech state (filters transient clicks). */
  minSpeechFrames?: number;
  /** Number of consecutive silent frames before exiting speech state (preserves trailing syllables). */
  hangoverFrames?: number;
  /** Human voice zero-crossing rate range at 16kHz (helps reject pure high-frequency hiss & sub-bass hum). */
  minZcr?: number;
  maxZcr?: number;
  /** Enable adaptive background noise floor tracking during silence. */
  adaptiveNoiseFloor?: boolean;
}

export interface VadFrameInput {
  rms: number;
  zcr: number;
}

export interface VadDecision {
  isSpeech: boolean;
  speechStarted: boolean;
  speechEnded: boolean;
  db: number;
  effectiveThresholdDb: number;
}

/**
 * Lightweight dual-feature (Adaptive Energy + Zero-Crossing Rate) Voice Activity Detector
 * with Attack & Hangover hysteresis state machine.
 *
 * Designed for 40ms PCM frames (25 fps) to:
 *  - Avoid sending silence / quiet BGM to paid cloud ASR endpoints (saves ~35-55% API cost).
 *  - Trigger clean utterance boundaries for quasi-streaming ASR (Groq Whisper).
 */
export class VoiceActivityDetector {
  private thresholdDb: number;
  private readonly minSpeechFrames: number;
  private readonly hangoverFrames: number;
  private readonly minZcr: number;
  private readonly maxZcr: number;
  private readonly adaptiveNoiseFloor: boolean;

  private speaking = false;
  private speechStreak = 0;
  private silenceStreak = 0;
  private noiseFloorDb = -55;

  constructor(options: VadOptions = {}) {
    this.thresholdDb = options.thresholdDb ?? -42;
    this.minSpeechFrames = options.minSpeechFrames ?? 2; // 80ms attack
    this.hangoverFrames = options.hangoverFrames ?? 14; // 560ms tail hangover
    this.minZcr = options.minZcr ?? 0.015;
    this.maxZcr = options.maxZcr ?? 0.42;
    this.adaptiveNoiseFloor = options.adaptiveNoiseFloor ?? true;
  }

  setThresholdDb(thresholdDb: number): void {
    this.thresholdDb = Math.max(-60, Math.min(-10, thresholdDb));
  }

  reset(): void {
    this.speaking = false;
    this.speechStreak = 0;
    this.silenceStreak = 0;
    this.noiseFloorDb = -55;
  }

  evaluate(frame: VadFrameInput): VadDecision {
    const db = rmsToDb(frame.rms);
    const adaptiveFloor = this.adaptiveNoiseFloor
      ? Math.min(this.thresholdDb + 8, this.noiseFloorDb + 7)
      : this.thresholdDb;
    const effectiveThresholdDb = Math.max(this.thresholdDb, adaptiveFloor);

    const energyPass = db >= effectiveThresholdDb;
    const zcrPass = frame.zcr >= this.minZcr && frame.zcr <= this.maxZcr;
    // Strong vocal energy overrides strict ZCR (e.g. sustained vowels have low ZCR)
    const frameVoiced = energyPass && (zcrPass || db >= effectiveThresholdDb + 7);

    let speechStarted = false;
    let speechEnded = false;

    if (frameVoiced) {
      this.silenceStreak = 0;
      this.speechStreak++;
      if (!this.speaking && this.speechStreak >= this.minSpeechFrames) {
        this.speaking = true;
        speechStarted = true;
      }
    } else {
      this.speechStreak = 0;
      if (this.speaking) {
        this.silenceStreak++;
        if (this.silenceStreak >= this.hangoverFrames) {
          this.speaking = false;
          speechEnded = true;
          this.silenceStreak = 0;
        }
      } else if (this.adaptiveNoiseFloor && db > -60) {
        // Exponential moving average of ambient floor while idle
        this.noiseFloorDb = this.noiseFloorDb * 0.96 + db * 0.04;
      }
    }

    return {
      isSpeech: this.speaking,
      speechStarted,
      speechEnded,
      db,
      effectiveThresholdDb,
    };
  }
}
