import type { AppearanceSettings, ExtensionSettings } from './settings';
import type {
  ActiveCaption,
  ActiveInputSource,
  AudioMetrics,
  CaptureMode,
  CaptureStatus,
  SessionSnapshot,
  SubtitleSegment,
} from './subtitle';

export interface ConnectionTestResult {
  asrOk: boolean;
  asrMessage: string;
  asrLatencyMs?: number;
  translatorOk: boolean;
  translatorMessage: string;
  translatorSample?: string;
  translatorLatencyMs?: number;
}

/**
 * Strongly-typed message union across:
 *   UI (Popup / SidePanel) <-> Background SW <-> Offscreen Document <-> Content Script
 */
export type RuntimeMessage =
  // UI -> Background
  | { type: 'CAPTURE_START'; tabId?: number }
  | { type: 'CAPTURE_STOP' }
  | { type: 'GET_SESSION_STATE' }
  | { type: 'CLEAR_TRANSCRIPT' }
  | { type: 'RESET_SPEAKERS' }
  | { type: 'TOGGLE_OVERLAY'; visible?: boolean }
  | { type: 'OPEN_SIDEPANEL'; tabId?: number }
  | { type: 'UPDATE_SETTINGS'; patch: Partial<ExtensionSettings> }
  | { type: 'UPDATE_APPEARANCE'; patch: Partial<AppearanceSettings> }
  | { type: 'GENERATE_SUMMARY' }
  | { type: 'TEST_CONNECTIONS' }

  // Content Script -> Background (Hybrid Video Subtitle Track Reader)
  | { type: 'CONTENT_TRACK_STATUS'; available: boolean; provider?: string }
  | {
      type: 'CONTENT_TRACK_CUE';
      text: string;
      isFinal: boolean;
      language?: string;
      source?: string;
    }

  // Background -> Offscreen
  | {
      type: 'OFFSCREEN_START';
      streamId: string | null;
      tabId: number;
      settings: ExtensionSettings;
      startedAt: number;
      trackOnly?: boolean;
    }
  | { type: 'OFFSCREEN_STOP' }
  | { type: 'OFFSCREEN_UPDATE_SETTINGS'; settings: ExtensionSettings }
  | { type: 'OFFSCREEN_RESET_SPEAKERS' }
  | { type: 'OFFSCREEN_SET_AUDIO_ASR_PAUSED'; paused: boolean }
  | {
      type: 'OFFSCREEN_TRACK_CUE';
      text: string;
      isFinal: boolean;
      elapsedMs: number;
      language?: string;
    }
  | {
      type: 'OFFSCREEN_TEST_TRANSLATOR';
      settings: ExtensionSettings;
    }

  // Offscreen -> Background
  | { type: 'OFFSCREEN_STATUS'; status: CaptureStatus; errorMessage?: string | null }
  | { type: 'OFFSCREEN_AUDIO_METRICS'; metrics: AudioMetrics }
  | {
      type: 'OFFSCREEN_CAPTION_UPDATE';
      activeCaption: ActiveCaption | null;
      latencyMs?: number | null;
    }
  | {
      type: 'OFFSCREEN_SEGMENT_FINAL';
      segment: SubtitleSegment;
      latencyMs?: number | null;
    }
  | {
      type: 'OFFSCREEN_SEGMENT_TRANSLATED';
      segmentId: string;
      translatedText: string;
      delayMs?: number;
    }

  // Background -> UI & Content Script broadcasts
  | { type: 'SESSION_SNAPSHOT'; snapshot: SessionSnapshot }
  | {
      type: 'CONTENT_SYNC';
      activeCaption: ActiveCaption | null;
      lastSegment: SubtitleSegment | null;
      status: CaptureStatus;
      captureMode: CaptureMode;
      activeInputSource: ActiveInputSource;
      overlayVisible: boolean;
      autoStartHint: string | null;
      appearance: AppearanceSettings;
      errorMessage: string | null;
    };

export interface RuntimeResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}
