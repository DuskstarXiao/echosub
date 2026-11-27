import { createAsrAdapter } from '../../core/asr/registry';
import type { AsrAdapter } from '../../core/asr/types';
import { TARGET_SAMPLE_RATE } from '../../core/audio/resampler';
import { PcmRingBuffer } from '../../core/audio/ring-buffer';
import { SpeakerDiarizer } from '../../core/audio/speaker-diarizer';
import { VoiceActivityDetector } from '../../core/audio/vad';
import { testTranslatorConnection } from '../../core/diagnostics/connection-tester';
import { resolveLocale } from '../../core/i18n';
import { SubtitleStabilizer } from '../../core/subtitle/stabilizer';
import { TranslationScheduler } from '../../core/subtitle/translation-queue';
import { ChromeBuiltInTranslator } from '../../core/translator/chrome-ai';
import { createTranslatorAdapter } from '../../core/translator/registry';
import { logger } from '../../shared/logger';
import type { RuntimeMessage, RuntimeResponse } from '../../types/messages';
import type { ExtensionSettings } from '../../types/settings';
import type {
  AudioMetrics,
  CaptureStatus,
  SpeakerInfo,
} from '../../types/subtitle';

interface WorkletPcmMessage {
  type: 'PCM_CHUNK';
  pcm: ArrayBuffer;
  rms: number;
  peak: number;
  zcr: number;
  waveform: number[];
  sampleRate: number;
}

class OffscreenAudioPipeline {
  private mediaStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private vad = new VoiceActivityDetector();
  private stabilizer = new SubtitleStabilizer();
  private diarizer = new SpeakerDiarizer();
  private speechVoiceBuffer = new PcmRingBuffer(
    Math.floor(TARGET_SAMPLE_RATE * 2.4)
  );
  private asr: AsrAdapter | null = null;
  private scheduler: TranslationScheduler | null = null;
  private settings: ExtensionSettings | null = null;

  private startedAt = 0;
  private running = false;
  private audioAsrPaused = false;
  private trackOnly = false;
  private packetCount = 0;
  private packetWindowStart = 0;
  private packetsPerSec = 0;
  private lastMetricsEmitAt = 0;
  private currentUtteranceStartWallMs: number | null = null;
  private demoWaveTimer: ReturnType<typeof setInterval> | null = null;
  private opChain: Promise<unknown> = Promise.resolve();

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.opChain.then(fn, fn);
    this.opChain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  start(
    streamId: string | null,
    settings: ExtensionSettings,
    startedAt: number,
    trackOnly = false
  ): Promise<void> {
    return this.enqueue(() =>
      this.startInternal(streamId, settings, startedAt, trackOnly)
    );
  }

  private async startInternal(
    streamId: string | null,
    settings: ExtensionSettings,
    startedAt: number,
    trackOnly = false
  ): Promise<void> {
    await this.stopInternal();

    this.settings = settings;
    this.startedAt = startedAt;
    this.running = true;
    this.audioAsrPaused = trackOnly;
    this.trackOnly = trackOnly;
    this.packetCount = 0;
    this.packetWindowStart = performance.now();
    this.packetsPerSec = 0;

    this.vad = new VoiceActivityDetector({
      thresholdDb: settings.vadThresholdDb,
      hangoverFrames: settings.timingMode === 'realtime' ? 8 : 13,
    });
    this.stabilizer = new SubtitleStabilizer();
    this.diarizer = new SpeakerDiarizer({
      locale: resolveLocale(settings.uiLocale),
      matchThreshold: settings.speakerSensitivity,
    });
    this.speechVoiceBuffer.clear();
    this.currentUtteranceStartWallMs = null;

    const translator = createTranslatorAdapter(settings);
    this.scheduler = new TranslationScheduler(translator, {
      sourceLang: settings.sourceLanguage,
      targetLang: settings.targetLanguage,
      timingMode: settings.timingMode,
      fastInterimAdapter:
        settings.timingMode === 'realtime' &&
        settings.translatorProvider !== 'none' &&
        settings.translatorProvider !== 'chrome-ai'
          ? new ChromeBuiltInTranslator()
          : null,
    });

    if (trackOnly) {
      this.sendStatus('running', null);
      return;
    }

    // 1) Attach tab audio stream if streamId is present (ALWAYS pass-through unmuted!)
    if (streamId) {
      await this.attachTabAudio(streamId);
    } else if (settings.asrProvider === 'demo') {
      this.startSyntheticDemoWaveform();
    }

    // 2) Connect ASR adapter
    await this.mountAsrAdapter(settings);

    this.sendStatus('running', null);
  }

  private async mountAsrAdapter(settings: ExtensionSettings): Promise<void> {
    if (this.asr) {
      try {
        await this.asr.stop();
      } catch {
        // Ignore
      }
      this.asr = null;
    }

    if (settings.asrProvider !== 'demo' && this.demoWaveTimer) {
      clearInterval(this.demoWaveTimer);
      this.demoWaveTimer = null;
    }

    this.stabilizer.reset();
    this.sendMessage({
      type: 'OFFSCREEN_CAPTION_UPDATE',
      activeCaption: null,
    });

    const adapter = createAsrAdapter(settings);
    if (!adapter || typeof adapter.start !== 'function') {
      throw new Error(
        `无法初始化语音引擎 (${String(settings?.asrProvider)})，请在扩展页点击刷新后重试。`
      );
    }
    this.asr = adapter;
    await adapter.start({
      onStatusChange: (s) => {
        if (!this.running || this.asr !== adapter) return;
        const mapped: CaptureStatus =
          s === 'connected'
            ? 'running'
            : s === 'reconnecting'
              ? 'reconnecting'
              : 'idle';
        this.sendStatus(mapped, null);
      },
      onTranscript: (ev) => {
        if (!this.running || this.audioAsrPaused || this.asr !== adapter) return;
        let speaker: SpeakerInfo | undefined;
        if (ev.speakerIndex !== undefined) {
          speaker = this.diarizer.fromSpeakerIndex(ev.speakerIndex);
        } else if (this.speechVoiceBuffer.length >= TARGET_SAMPLE_RATE * 0.3) {
          speaker = this.diarizer.identify(this.speechVoiceBuffer.readAll());
        }
        if (ev.isFinal) {
          this.speechVoiceBuffer.clear();
        }
        this.handleTranscriptEvent(
          ev.text,
          ev.isFinal,
          ev.timestampMs,
          ev.language,
          ev.latencyMs,
          speaker
        );
      },
      onError: (err) => {
        logger.error('Offscreen', 'ASR error:', err);
        if (!this.running || this.audioAsrPaused || this.asr !== adapter) return;
        this.sendStatus('error', err.message);
      },
    });
  }

  setAudioAsrPaused(paused: boolean): void {
    if (this.trackOnly) return;
    this.audioAsrPaused = paused;
  }

  handleExternalTrackCue(
    text: string,
    isFinal: boolean,
    elapsedMs: number,
    language?: string
  ): void {
    if (!this.running) return;
    this.handleTranscriptEvent(text, isFinal, elapsedMs, language, 15);
  }

  updateSettings(next: ExtensionSettings): Promise<{ needsRestart: boolean }> {
    return this.enqueue(() => this.updateSettingsInternal(next));
  }

  resetSpeakers(): void {
    this.diarizer.reset();
    this.speechVoiceBuffer.clear();
  }

  private async updateSettingsInternal(
    next: ExtensionSettings
  ): Promise<{ needsRestart: boolean }> {
    const prev = this.settings;
    this.settings = next;
    if (!prev || prev.timingMode !== next.timingMode) {
      this.vad = new VoiceActivityDetector({
        thresholdDb: next.vadThresholdDb,
        hangoverFrames: next.timingMode === 'realtime' ? 8 : 13,
      });
    } else {
      this.vad.setThresholdDb(next.vadThresholdDb);
    }
    this.diarizer.setLocale(resolveLocale(next.uiLocale));
    this.diarizer.setMatchThreshold(next.speakerSensitivity);
    if (this.scheduler) {
      const translator = createTranslatorAdapter(next);
      this.scheduler.updateConfig(
        translator,
        next.sourceLanguage,
        next.targetLanguage,
        next.timingMode
      );
    }

    const asrChanged =
      !prev ||
      prev.timingMode !== next.timingMode ||
      prev.asrProvider !== next.asrProvider ||
      prev.siliconflowApiKey !== next.siliconflowApiKey ||
      prev.siliconflowAsrModel !== next.siliconflowAsrModel ||
      prev.groqApiKey !== next.groqApiKey ||
      prev.dashscopeApiKey !== next.dashscopeApiKey ||
      prev.deepgramApiKey !== next.deepgramApiKey ||
      prev.localWsUrl !== next.localWsUrl ||
      prev.sourceLanguage !== next.sourceLanguage;

    if (this.running && !this.trackOnly && asrChanged) {
      if (next.asrProvider !== 'demo' && !this.mediaStream) {
        return { needsRestart: true };
      }
      try {
        await this.mountAsrAdapter(next);
        this.sendStatus('running', null);
      } catch (err) {
        this.sendStatus(
          'error',
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    return { needsRestart: false };
  }

  stop(): Promise<void> {
    return this.enqueue(() => this.stopInternal());
  }

  private async stopInternal(): Promise<void> {
    this.running = false;
    this.audioAsrPaused = false;
    this.trackOnly = false;

    if (this.demoWaveTimer) {
      clearInterval(this.demoWaveTimer);
      this.demoWaveTimer = null;
    }

    if (this.workletNode) {
      try {
        this.workletNode.port.postMessage({ type: 'STOP' });
        this.workletNode.port.onmessage = null;
        this.workletNode.disconnect();
      } catch {
        // Ignore
      }
      this.workletNode = null;
    }

    if (this.audioCtx) {
      try {
        await this.audioCtx.close();
      } catch {
        // Ignore
      }
      this.audioCtx = null;
    }

    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop();
      }
      this.mediaStream = null;
    }

    if (this.asr) {
      try {
        await this.asr.stop();
      } catch {
        // Ignore
      }
      this.asr = null;
    }

    if (this.scheduler) {
      this.scheduler.dispose();
      this.scheduler = null;
    }

    this.stabilizer.reset();
    this.diarizer.reset();
    this.speechVoiceBuffer.clear();
    this.currentUtteranceStartWallMs = null;
  }

  private async attachTabAudio(streamId: string): Promise<void> {
    const constraints = {
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
      video: false,
    } as unknown as MediaStreamConstraints;

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.mediaStream = stream;

    const audioCtx = new AudioContext();
    this.audioCtx = audioCtx;
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    const source = audioCtx.createMediaStreamSource(stream);

    // CRITICAL: Direct pass-through to speakers so original tab audio is NEVER muted!
    source.connect(audioCtx.destination);

    const workletUrl = chrome.runtime.getURL('worklets/pcm-processor.js');
    await audioCtx.audioWorklet.addModule(workletUrl);

    const workletNode = new AudioWorkletNode(audioCtx, 'echosub-pcm-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 2,
    });
    this.workletNode = workletNode;

    // Route worklet output through zero-gain sink so Chromium never prunes process()
    const silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;
    source.connect(workletNode);
    workletNode.connect(silentGain);
    silentGain.connect(audioCtx.destination);

    workletNode.port.onmessage = (event: MessageEvent<WorkletPcmMessage>) => {
      if (!this.running || event.data?.type !== 'PCM_CHUNK') return;
      this.onPcmChunk(event.data);
    };
  }

  private onPcmChunk(msg: WorkletPcmMessage): void {
    const pcm16k = new Int16Array(msg.pcm);
    const vadDecision = this.vad.evaluate({ rms: msg.rms, zcr: msg.zcr });
    const elapsedMs = Math.max(0, Date.now() - this.startedAt);

    // Only stream audio to cloud/local ASR when NOT overridden by native video subtitle track
    if (!this.audioAsrPaused) {
      if (vadDecision.speechStarted || (vadDecision.isSpeech && this.currentUtteranceStartWallMs === null)) {
        // Account for ~280ms pre-roll & attack so delay reflects true spoken start time
        this.currentUtteranceStartWallMs = Date.now() - 280;
      }
      if (vadDecision.isSpeech) {
        this.speechVoiceBuffer.push(pcm16k);
      }
      this.asr?.pushAudio(pcm16k, vadDecision.isSpeech, elapsedMs);
    }

    this.packetCount++;
    const now = performance.now();
    const windowElapsed = now - this.packetWindowStart;
    if (windowElapsed >= 1000) {
      this.packetsPerSec = Math.round((this.packetCount * 1000) / windowElapsed);
      this.packetCount = 0;
      this.packetWindowStart = now;
    }

    if (now - this.lastMetricsEmitAt >= 80) {
      this.lastMetricsEmitAt = now;
      const metrics: AudioMetrics = {
        rms: msg.rms,
        db: Math.round(vadDecision.db),
        isSpeech: vadDecision.isSpeech,
        sampleRate: msg.sampleRate,
        packetsPerSec: this.packetsPerSec || 25,
        waveform: msg.waveform,
      };
      this.sendMessage({ type: 'OFFSCREEN_AUDIO_METRICS', metrics });
    }
  }

  private handleTranscriptEvent(
    text: string,
    isFinal: boolean,
    timestampMs: number,
    language?: string,
    latencyMs?: number,
    speaker?: SpeakerInfo
  ): void {
    const isSentenceMode = this.settings?.timingMode === 'sentence';

    // Mode B ('sentence'): skip partial word-by-word flashes; wait for complete sentence!
    if (isSentenceMode && !isFinal) {
      return;
    }

    const spokenAtWallMs =
      this.currentUtteranceStartWallMs ?? Date.now() - (latencyMs ?? 600);
    if (isFinal) {
      this.currentUtteranceStartWallMs = null;
    }

    const result = this.stabilizer.push(
      text,
      isFinal,
      timestampMs,
      language,
      speaker
    );

    if (result.finalizedSegment) {
      const seg = result.finalizedSegment;

      if (
        isSentenceMode &&
        this.scheduler &&
        this.settings?.translatorProvider !== 'none'
      ) {
        // In Mode B, wait for full-sentence translation so source + translation appear together cleanly
        const translatePromise = this.scheduler.translateFinal(
          seg.sourceText,
          seg.speaker?.label
        );
        void Promise.race([
          translatePromise,
          new Promise<string>((resolve) => setTimeout(() => resolve(''), 3000)),
        ]).then((translated) => {
          if (!this.running) return;
          const totalDelayMs = Math.max(100, Date.now() - spokenAtWallMs);
          this.sendMessage({
            type: 'OFFSCREEN_SEGMENT_FINAL',
            segment: {
              ...seg,
              translatedText: translated || seg.translatedText,
              delayMs: totalDelayMs,
            },
            latencyMs: latencyMs ?? null,
          });
          // If translation finished slightly after the 3s safety cap, still patch it in!
          if (!translated) {
            void translatePromise.then((late) => {
              if (!this.running || !late) return;
              this.sendMessage({
                type: 'OFFSCREEN_SEGMENT_TRANSLATED',
                segmentId: seg.id,
                translatedText: late,
                delayMs: Math.max(100, Date.now() - spokenAtWallMs),
              });
            });
          }
        });
        return;
      }

      this.sendMessage({
        type: 'OFFSCREEN_SEGMENT_FINAL',
        segment: {
          ...seg,
          delayMs: Math.max(100, Date.now() - spokenAtWallMs),
        },
        latencyMs: latencyMs ?? null,
      });

      if (this.scheduler && this.settings?.translatorProvider !== 'none') {
        void this.scheduler
          .translateFinal(seg.sourceText, seg.speaker?.label)
          .then((translated) => {
            if (!this.running || !translated) return;
            this.sendMessage({
              type: 'OFFSCREEN_SEGMENT_TRANSLATED',
              segmentId: seg.id,
              translatedText: translated,
              delayMs: Math.max(100, Date.now() - spokenAtWallMs),
            });
          });
      }
      return;
    }

    if (result.activeCaption) {
      const caption = result.activeCaption;
      this.sendMessage({
        type: 'OFFSCREEN_CAPTION_UPDATE',
        activeCaption: {
          ...caption,
          delayMs: Math.max(100, Date.now() - spokenAtWallMs),
        },
        latencyMs: latencyMs ?? null,
      });

      const fullSource =
        `${caption.committedSource}${caption.speculativeSource}`.trim();
      if (this.scheduler && this.settings?.translatorProvider !== 'none') {
        this.scheduler.scheduleInterim(
          caption.id,
          fullSource,
          (captionId, translatedText) => {
            if (!this.running) return;
            const interimDelayMs = Math.max(100, Date.now() - spokenAtWallMs);
            const updated = this.stabilizer.setCurrentTranslation(
              captionId,
              translatedText,
              interimDelayMs
            );
            if (updated) {
              this.sendMessage({
                type: 'OFFSCREEN_CAPTION_UPDATE',
                activeCaption: updated,
              });
            }
          },
          caption.speaker?.label
        );
      }
    }
  }

  private startSyntheticDemoWaveform(): void {
    let phase = 0;
    this.demoWaveTimer = setInterval(() => {
      if (!this.running) return;
      phase += 0.35;
      const waveform = Array.from({ length: 24 }, (_, idx) => {
        const env = Math.sin((idx / 23) * Math.PI);
        const wave = 0.25 + 0.55 * Math.abs(Math.sin(phase + idx * 0.45));
        return Math.min(1, Math.max(0.06, env * wave));
      });
      this.sendMessage({
        type: 'OFFSCREEN_AUDIO_METRICS',
        metrics: {
          rms: 0.14,
          db: -18,
          isSpeech: true,
          sampleRate: 16000,
          packetsPerSec: 25,
          waveform,
        },
      });
    }, 90);
  }

  private sendStatus(status: CaptureStatus, errorMessage: string | null): void {
    this.sendMessage({ type: 'OFFSCREEN_STATUS', status, errorMessage });
  }

  private sendMessage(message: RuntimeMessage): void {
    chrome.runtime.sendMessage(message).catch(() => {});
  }
}

function formatDetailedError(err: unknown): string {
  if (err instanceof Error) {
    const firstFrame = err.stack
      ?.split('\n')
      .slice(1, 3)
      .map((l) => l.trim())
      .join(' | ');
    return firstFrame ? `${err.message} (${firstFrame})` : err.message;
  }
  return String(err);
}

const pipeline = new OffscreenAudioPipeline();

chrome.runtime.onMessage.addListener(
  (
    message: RuntimeMessage,
    _sender,
    sendResponse: (res: RuntimeResponse) => void
  ) => {
    if (message.type === 'OFFSCREEN_START') {
      void pipeline
        .start(
          message.streamId,
          message.settings,
          message.startedAt,
          Boolean(message.trackOnly)
        )
        .then(() => sendResponse({ ok: true }))
        .catch((err) => {
          logger.error('Offscreen', 'Start failed:', err);
          sendResponse({ ok: false, error: formatDetailedError(err) });
        });
      return true;
    }

    if (message.type === 'OFFSCREEN_STOP') {
      void pipeline
        .stop()
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }

    if (message.type === 'OFFSCREEN_UPDATE_SETTINGS') {
      void pipeline
        .updateSettings(message.settings)
        .then((res) => sendResponse({ ok: true, data: res }))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }

    if (message.type === 'OFFSCREEN_RESET_SPEAKERS') {
      pipeline.resetSpeakers();
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === 'OFFSCREEN_SET_AUDIO_ASR_PAUSED') {
      pipeline.setAudioAsrPaused(message.paused);
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === 'OFFSCREEN_TRACK_CUE') {
      pipeline.handleExternalTrackCue(
        message.text,
        message.isFinal,
        message.elapsedMs,
        message.language
      );
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === 'OFFSCREEN_TEST_TRANSLATOR') {
      void testTranslatorConnection(message.settings)
        .then((res) => sendResponse({ ok: true, data: res }))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }

    return false;
  }
);
