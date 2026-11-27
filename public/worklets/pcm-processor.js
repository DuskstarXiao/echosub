/**
 * EchoSub AudioWorkletProcessor (MV3 CSP-safe static module)
 *
 * Runs on the dedicated Web Audio rendering thread:
 * 1. Downmixes multi-channel tab audio to mono Float32.
 * 2. Stateful linear-interpolation resampling from native AudioContext sampleRate
 *    (typically 48kHz / 44.1kHz) to 16kHz Int16 PCM with zero quantum-boundary clicks.
 * 3. Computes lightweight RMS, peak, zero-crossing rate (ZCR), and 24-bin waveform
 *    amplitudes per 40ms frame (640 samples @ 16kHz = 1280 bytes).
 * 4. Transfers Int16Array ArrayBuffer zero-copy to the Offscreen Document main thread.
 *
 * NOTE: Output channel is intentionally left silent; original audio playback is routed
 * directly from MediaStreamAudioSourceNode -> AudioContext.destination to prevent echo.
 */

const TARGET_SAMPLE_RATE = 16000;
const CHUNK_SAMPLES = 640; // 40ms at 16kHz
const WAVEFORM_BINS = 24;

class EchoSubPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_SAMPLE_RATE;
    this.phase = 0;
    this.lastSample = 0;
    this.pcmBuffer = new Int16Array(CHUNK_SAMPLES);
    this.writeIndex = 0;
    this.sumSquares = 0;
    this.peak = 0;
    this.zeroCrossings = 0;
    this.prevMono = 0;
    this.active = true;

    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'STOP') {
        this.active = false;
      }
    };
  }

  process(inputs) {
    if (!this.active) {
      return false;
    }

    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) {
      return true;
    }

    const channelCount = input.length;
    const ch0 = input[0];
    const ch1 = channelCount > 1 ? input[1] : null;
    const frameLength = ch0.length;

    // Mix stereo/multi-channel down to mono
    const mono = new Float32Array(frameLength);
    if (ch1) {
      for (let i = 0; i < frameLength; i++) {
        mono[i] = (ch0[i] + ch1[i]) * 0.5;
      }
    } else {
      mono.set(ch0);
    }

    // Stateful fractional-phase linear resampling -> 16kHz Int16 PCM
    let pos = this.phase;
    while (pos < frameLength) {
      const idx = Math.floor(pos);
      const frac = pos - idx;
      const s0 = idx === 0 && pos < 0 ? this.lastSample : mono[idx];
      const s1 = idx + 1 < frameLength ? mono[idx + 1] : mono[frameLength - 1];
      const sample = s0 + (s1 - s0) * frac;

      const clamped = sample < -1 ? -1 : sample > 1 ? 1 : sample;
      const int16 = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);

      this.pcmBuffer[this.writeIndex++] = int16;
      this.sumSquares += clamped * clamped;
      const absVal = Math.abs(clamped);
      if (absVal > this.peak) this.peak = absVal;
      if ((clamped >= 0 && this.prevMono < 0) || (clamped < 0 && this.prevMono >= 0)) {
        this.zeroCrossings++;
      }
      this.prevMono = clamped;

      if (this.writeIndex >= CHUNK_SAMPLES) {
        this.flushChunk();
      }

      pos += this.ratio;
    }

    this.lastSample = mono[frameLength - 1];
    this.phase = pos - frameLength;

    return true;
  }

  flushChunk() {
    const out = this.pcmBuffer;
    const rms = Math.sqrt(this.sumSquares / CHUNK_SAMPLES);
    const zcr = this.zeroCrossings / CHUNK_SAMPLES;

    // Downsample into 24 visual waveform bars
    const binSize = Math.floor(CHUNK_SAMPLES / WAVEFORM_BINS);
    const waveform = new Array(WAVEFORM_BINS);
    for (let b = 0; b < WAVEFORM_BINS; b++) {
      let maxAbs = 0;
      const start = b * binSize;
      const end = start + binSize;
      for (let i = start; i < end; i++) {
        const v = Math.abs(out[i]) / 32768;
        if (v > maxAbs) maxAbs = v;
      }
      // Subtle log-like perceptual curve so normal speech animates nicely
      waveform[b] = Math.min(1, Math.pow(maxAbs, 0.65));
    }

    this.port.postMessage(
      {
        type: 'PCM_CHUNK',
        pcm: out.buffer,
        rms,
        peak: this.peak,
        zcr,
        waveform,
        sampleRate: TARGET_SAMPLE_RATE,
      },
      [out.buffer]
    );

    // Allocate fresh buffer for next 40ms frame
    this.pcmBuffer = new Int16Array(CHUNK_SAMPLES);
    this.writeIndex = 0;
    this.sumSquares = 0;
    this.peak = 0;
    this.zeroCrossings = 0;
  }
}

registerProcessor('echosub-pcm-processor', EchoSubPcmProcessor);
