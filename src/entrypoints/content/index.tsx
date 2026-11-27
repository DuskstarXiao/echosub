import React from 'react';
import ReactDOM from 'react-dom/client';
import type { RuntimeMessage } from '../../types/messages';
import { DEFAULT_APPEARANCE } from '../../types/settings';
import {
  SubtitleOverlay,
  sendOverlayMessage,
  type OverlayState,
} from './SubtitleOverlay';
import { VideoTrackReader } from './track-reader';
import overlayCss from './style.css?inline';

const HOST_ID = 'echosub-top-layer-host';

/**
 * Fullscreen-proof Shadow DOM + Native Top-Layer (`popover="manual"`) Controller
 * + Hybrid Native Subtitle Track Reader (YouTube / Bilibili / HTML5 `<track>`).
 */
class TopLayerOverlayManager {
  private host: HTMLDivElement | null = null;
  private root: ReactDOM.Root | null = null;
  private trackReader: VideoTrackReader | null = null;
  private state: OverlayState = {
    activeCaption: null,
    lastSegment: null,
    status: 'idle',
    captureMode: 'auto',
    activeInputSource: 'idle',
    overlayVisible: true,
    autoStartHint: null,
    appearance: DEFAULT_APPEARANCE,
    errorMessage: null,
  };

  init(): void {
    if (document.getElementById(HOST_ID)) return;

    const host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('popover', 'manual');
    this.host = host;

    const shadow = host.attachShadow({ mode: 'open' });
    const styleEl = document.createElement('style');
    styleEl.textContent = overlayCss;
    shadow.appendChild(styleEl);

    const mountPoint = document.createElement('div');
    shadow.appendChild(mountPoint);

    this.mountIntoBestParent();
    this.root = ReactDOM.createRoot(mountPoint);
    this.render();

    this.trackReader = new VideoTrackReader({
      onAvailabilityChange: (available, provider) => {
        sendOverlayMessage({
          type: 'CONTENT_TRACK_STATUS',
          available,
          provider,
        });
      },
      onCue: (text, isFinal, source) => {
        sendOverlayMessage({
          type: 'CONTENT_TRACK_CUE',
          text,
          isFinal,
          source,
        });
      },
    });

    document.addEventListener('fullscreenchange', this.handleFullscreenChange, true);
    document.addEventListener(
      'webkitfullscreenchange',
      this.handleFullscreenChange,
      true
    );

    chrome.runtime.onMessage.addListener((message: RuntimeMessage) => {
      if (message.type === 'CONTENT_SYNC') {
        this.state = {
          activeCaption: message.activeCaption,
          lastSegment: message.lastSegment,
          status: message.status,
          captureMode: message.captureMode,
          activeInputSource: message.activeInputSource,
          overlayVisible: message.overlayVisible,
          autoStartHint: message.autoStartHint,
          appearance: message.appearance,
          errorMessage: message.errorMessage,
        };

        const shouldReadTracks =
          message.status !== 'idle' &&
          (message.captureMode === 'auto' || message.captureMode === 'track');
        this.trackReader?.setEnabled(
          shouldReadTracks,
          message.appearance.hideNativeTrackCaptions
        );

        this.promoteTopLayer(false);
        this.render();
      }
    });
  }

  private handleFullscreenChange = (): void => {
    this.mountIntoBestParent();
    requestAnimationFrame(() => this.promoteTopLayer(true));
  };

  private mountIntoBestParent(): void {
    if (!this.host) return;
    const fsEl =
      document.fullscreenElement ||
      (document as unknown as { webkitFullscreenElement?: Element | null })
        .webkitFullscreenElement ||
      null;

    const canContainChildren =
      fsEl &&
      fsEl.tagName !== 'VIDEO' &&
      fsEl.tagName !== 'IFRAME' &&
      fsEl.tagName !== 'IMG';

    const targetParent = canContainChildren
      ? fsEl
      : document.body || document.documentElement;

    if (targetParent && this.host.parentElement !== targetParent) {
      targetParent.appendChild(this.host);
    }

    this.promoteTopLayer(true);
  }

  private promoteTopLayer(forceReopen = false): void {
    if (!this.host || !this.host.isConnected) return;
    const shouldShow =
      this.state.overlayVisible &&
      (this.state.status !== 'idle' || Boolean(this.state.errorMessage));

    try {
      const popoverHost = this.host as HTMLElement & {
        showPopover?: () => void;
        hidePopover?: () => void;
      };
      if (typeof popoverHost.showPopover === 'function') {
        const isOpen = popoverHost.matches(':popover-open');
        if (shouldShow) {
          if (forceReopen && isOpen) {
            try {
              popoverHost.hidePopover?.();
            } catch {
              // Ignore
            }
          }
          if (forceReopen || !isOpen) {
            popoverHost.showPopover();
          }
        } else if (isOpen) {
          try {
            popoverHost.hidePopover?.();
          } catch {
            // Already hidden
          }
        }
      }
    } catch {
      // Graceful fallback to fixed + max z-index
    }
  }

  private render(): void {
    if (!this.root) return;
    this.root.render(
      <React.StrictMode>
        <SubtitleOverlay
          state={this.state}
          onUpdateAppearance={(patch) => {
            this.state = {
              ...this.state,
              appearance: {
                ...this.state.appearance,
                ...patch,
                position: patch.position
                  ? { ...this.state.appearance.position, ...patch.position }
                  : this.state.appearance.position,
              },
            };
            this.render();
            sendOverlayMessage({ type: 'UPDATE_APPEARANCE', patch });
          }}
          onHideOverlay={() => {
            this.state = { ...this.state, overlayVisible: false };
            this.promoteTopLayer(false);
            this.render();
            sendOverlayMessage({ type: 'TOGGLE_OVERLAY', visible: false });
          }}
        />
      </React.StrictMode>
    );
  }
}

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_idle',
  main() {
    const manager = new TopLayerOverlayManager();
    manager.init();
  },
});
