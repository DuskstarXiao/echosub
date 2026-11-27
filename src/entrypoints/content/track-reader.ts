/**
 * Smart Video Native Subtitle Track Reader (Hybrid Mode).
 *
 * Reads existing captions from:
 * 1. YouTube player native captions (`.ytp-caption-segment`)
 * 2. Bilibili player native subtitles (`.bpx-player-subtitle-panel-text` / `.bili-subtitle-x-subtitle-panel-text`)
 * 3. Standard HTML5 `<video>.textTracks` (Coursera, Udemy, TED, Vimeo, local videos, etc.)
 *
 * When native captions exist, EchoSub translates them directly at ZERO ASR API cost
 * and ~0ms transcription latency while optionally hiding duplicate native caption chrome
 * via `opacity: 0` (preserving DOM updates!).
 */

export interface TrackCueCallback {
  onAvailabilityChange: (available: boolean, provider?: string) => void;
  onCue: (text: string, isFinal: boolean, provider: string) => void;
}

const HIDE_NATIVE_STYLE_ID = 'echosub-hide-native-cc';

export class VideoTrackReader {
  private active = false;
  private hideNative = false;
  private observer: MutationObserver | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastText = '';
  private lastAvailable = false;
  private lastProvider: string | undefined = undefined;
  private boundTracks = new WeakSet<TextTrack>();

  constructor(private readonly callbacks: TrackCueCallback) {}

  setEnabled(enabled: boolean, hideNative: boolean): void {
    this.hideNative = hideNative;
    this.syncHideNativeStyle(enabled && hideNative && this.lastAvailable);

    if (enabled === this.active) return;
    this.active = enabled;

    if (enabled) {
      this.start();
    } else {
      this.stop();
    }
  }

  private start(): void {
    this.scanNow();

    this.observer = new MutationObserver(() => {
      if (this.active) this.scanDomCaptions();
    });
    this.observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    this.pollTimer = setInterval(() => {
      if (this.active) this.scanNow();
    }, 900);
  }

  private stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    this.lastText = '';
    this.lastAvailable = false;
    this.lastProvider = undefined;
    this.syncHideNativeStyle(false);
  }

  private scanNow(): void {
    this.attachHtml5TextTracks();
    this.scanDomCaptions();
  }

  private scanDomCaptions(): void {
    // 1) YouTube live caption segments
    const ytSegments = document.querySelectorAll('.ytp-caption-segment');
    if (ytSegments.length > 0) {
      const text = Array.from(ytSegments)
        .map((el) => el.textContent?.trim() ?? '')
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      this.reportAvailability(true, 'youtube-cc');
      if (text) {
        this.emitCaption(text, 'youtube-cc');
      }
      return;
    }

    // 2) Bilibili native subtitle nodes
    const biliNodes = document.querySelectorAll(
      '.bpx-player-subtitle-panel-text, .bili-subtitle-x-subtitle-panel-text'
    );
    if (biliNodes.length > 0) {
      const text = Array.from(biliNodes)
        .map((el) => el.textContent?.trim() ?? '')
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      this.reportAvailability(true, 'bilibili-cc');
      if (text) {
        this.emitCaption(text, 'bilibili-cc');
      }
      return;
    }

    // 3) Check if any HTML5 <video> has active TextTracks
    const videos = document.querySelectorAll('video');
    let hasTrack = false;
    videos.forEach((video) => {
      for (let i = 0; i < video.textTracks.length; i++) {
        const track = video.textTracks[i];
        if (
          (track.kind === 'subtitles' || track.kind === 'captions') &&
          track.mode !== 'disabled'
        ) {
          hasTrack = true;
        }
      }
    });

    if (hasTrack) {
      this.reportAvailability(true, 'html5-track');
    } else if (
      document.querySelector('.ytp-caption-window-container') === null &&
      biliNodes.length === 0
    ) {
      this.reportAvailability(false, undefined);
    }
  }

  private attachHtml5TextTracks(): void {
    const videos = document.querySelectorAll('video');
    videos.forEach((video) => {
      for (let i = 0; i < video.textTracks.length; i++) {
        const track = video.textTracks[i];
        if (track.kind !== 'subtitles' && track.kind !== 'captions') continue;
        if (this.boundTracks.has(track)) continue;

        this.boundTracks.add(track);
        track.addEventListener('cuechange', () => {
          if (!this.active || !track.activeCues || track.activeCues.length === 0) {
            return;
          }
          const lines: string[] = [];
          for (let c = 0; c < track.activeCues.length; c++) {
            const cue = track.activeCues[c] as VTTCue;
            if (typeof cue.text === 'string') {
              const cleaned = cue.text
                .replace(/<[^>]+>/g, '')
                .replace(/\s+/g, ' ')
                .trim();
              if (cleaned) lines.push(cleaned);
            }
          }
          const combined = lines.join(' ').trim();
          if (combined) {
            this.reportAvailability(true, 'html5-track');
            this.emitCaption(combined, 'html5-track');
          }
        });
      }
    });
  }

  private emitCaption(text: string, provider: string): void {
    if (text === this.lastText) return;

    // If a completely new sentence started, finalize previous line cleanly
    const isExtensionOfPrevious =
      this.lastText.length > 0 &&
      text.toLowerCase().startsWith(this.lastText.toLowerCase().slice(0, 12));

    if (this.lastText && !isExtensionOfPrevious) {
      this.callbacks.onCue(this.lastText, true, provider);
    }

    this.lastText = text;
    this.callbacks.onCue(text, false, provider);

    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      if (this.active && this.lastText === text) {
        this.callbacks.onCue(text, true, provider);
        this.lastText = '';
      }
    }, 2600);
  }

  private reportAvailability(available: boolean, provider?: string): void {
    if (available !== this.lastAvailable || provider !== this.lastProvider) {
      this.lastAvailable = available;
      this.lastProvider = provider;
      this.syncHideNativeStyle(this.active && this.hideNative && available);
      this.callbacks.onAvailabilityChange(available, provider);
    }
  }

  private syncHideNativeStyle(shouldHide: boolean): void {
    const existing = document.getElementById(HIDE_NATIVE_STYLE_ID);
    if (shouldHide) {
      if (!existing) {
        const style = document.createElement('style');
        style.id = HIDE_NATIVE_STYLE_ID;
        // Use opacity: 0 (NOT display: none) so YouTube/Bilibili still update DOM cues!
        style.textContent = `
          .ytp-caption-window-container,
          .bpx-player-subtitle-panel-text,
          .bili-subtitle-x-subtitle-panel-text {
            opacity: 0 !important;
            pointer-events: none !important;
          }
        `;
        (document.head || document.documentElement).appendChild(style);
      }
    } else if (existing) {
      existing.remove();
    }
  }
}
