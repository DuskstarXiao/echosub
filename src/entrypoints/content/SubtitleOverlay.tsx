import React, { useEffect, useRef, useState } from 'react';
import type { RuntimeMessage } from '../../types/messages';
import type { AppearanceSettings } from '../../types/settings';
import type {
  ActiveCaption,
  ActiveInputSource,
  CaptureMode,
  CaptureStatus,
  DisplayMode,
  SubtitleSegment,
} from '../../types/subtitle';

export interface OverlayState {
  activeCaption: ActiveCaption | null;
  lastSegment: SubtitleSegment | null;
  status: CaptureStatus;
  captureMode: CaptureMode;
  activeInputSource: ActiveInputSource;
  overlayVisible: boolean;
  autoStartHint: string | null;
  appearance: AppearanceSettings;
  errorMessage: string | null;
}

interface SubtitleOverlayProps {
  state: OverlayState;
  onUpdateAppearance: (patch: Partial<AppearanceSettings>) => void;
  onHideOverlay: () => void;
}

const MODE_ORDER: DisplayMode[] = ['bilingual', 'translated', 'source'];
const MODE_LABEL: Record<DisplayMode, string> = {
  bilingual: '双语',
  translated: '译文',
  source: '原文',
};

export const SubtitleOverlay: React.FC<SubtitleOverlayProps> = ({
  state,
  onUpdateAppearance,
  onHideOverlay,
}) => {
  const {
    activeCaption,
    lastSegment,
    status,
    overlayVisible,
    autoStartHint,
    appearance,
    errorMessage,
  } = state;

  const [pos, setPos] = useState(appearance.position);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    if (!dragging) {
      setPos(appearance.position);
    }
  }, [appearance.position.xPercent, appearance.position.yPercent, dragging]);

  const isRunning =
    status === 'running' || status === 'starting' || status === 'reconnecting';

  if (!overlayVisible || (!isRunning && !errorMessage)) {
    return null;
  }

  const hasActive = Boolean(
    activeCaption &&
      (activeCaption.committedSource || activeCaption.speculativeSource)
  );
  const showLast = !hasActive && Boolean(lastSegment);

  const committedSource = hasActive
    ? activeCaption!.committedSource
    : showLast
      ? lastSegment!.sourceText
      : '';
  const speculativeSource = hasActive ? activeCaption!.speculativeSource : '';
  const rawTranslated = hasActive
    ? activeCaption!.translatedText
    : showLast
      ? lastSegment!.translatedText
      : '';
  const fullSource = `${committedSource}${speculativeSource}`.trim();
  const translatedText =
    rawTranslated.trim() && rawTranslated.trim() !== fullSource
      ? rawTranslated.trim()
      : '';
  const speaker = hasActive
    ? activeCaption!.speaker
    : showLast
      ? lastSegment!.speaker
      : undefined;
  const delayMs = hasActive
    ? activeCaption!.delayMs
    : showLast
      ? lastSegment!.delayMs
      : undefined;
  const delayTag =
    appearance.showTranslationDelay && delayMs && delayMs > 0
      ? `[${Math.max(0.1, delayMs / 1000).toFixed(1)}s前]`
      : '';

  const useSpeakerColor = Boolean(appearance.speakerColoring && speaker);
  const activeColor = useSpeakerColor ? speaker!.color : appearance.accentColor;

  const showSource =
    appearance.displayMode === 'bilingual' ||
    appearance.displayMode === 'source' ||
    !translatedText;
  const showTranslated =
    (appearance.displayMode === 'bilingual' ||
      appearance.displayMode === 'translated') &&
    Boolean(translatedText);

  const primaryFontSize = appearance.fontSize;
  const secondaryFontSize = Math.max(
    12,
    Math.round(appearance.fontSize * appearance.secondaryFontScale)
  );

  const shadowStyle = appearance.textShadow
    ? '0 1px 4px rgba(0, 0, 0, 0.85), 0 0 1px rgba(0, 0, 0, 0.9)'
    : 'none';

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: pos.xPercent,
      originY: pos.yPercent,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dxPct = ((e.clientX - drag.startX) / window.innerWidth) * 100;
    const dyPct = ((e.clientY - drag.startY) / window.innerHeight) * 100;
    const nextX = Math.max(12, Math.min(88, drag.originX + dxPct));
    const nextY = Math.max(10, Math.min(93, drag.originY + dyPct));
    setPos({ xPercent: nextX, yPercent: nextY });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
    setDragging(false);
    onUpdateAppearance({
      position: {
        xPercent: Math.round(pos.xPercent * 10) / 10,
        yPercent: Math.round(pos.yPercent * 10) / 10,
      },
    });
  };

  const cycleMode = () => {
    const idx = MODE_ORDER.indexOf(appearance.displayMode);
    const next = MODE_ORDER[(idx + 1) % MODE_ORDER.length];
    onUpdateAppearance({ displayMode: next });
  };

  const stepFont = (delta: number) => {
    const next = Math.max(14, Math.min(36, appearance.fontSize + delta));
    onUpdateAppearance({ fontSize: next });
  };

  const sourceLine = showSource && (committedSource || speculativeSource) && (
    <div
      key="source"
      className="echosub-line echosub-source"
      style={{
        fontSize: `${
          appearance.displayMode === 'source' || !showTranslated
            ? primaryFontSize
            : secondaryFontSize
        }px`,
        color:
          !showTranslated && useSpeakerColor
            ? activeColor
            : useSpeakerColor
              ? `color-mix(in srgb, ${activeColor} 28%, #f8fafc)`
              : 'rgba(241, 245, 249, 0.95)',
        textShadow: shadowStyle,
      }}
    >
      <span>{committedSource}</span>
      {speculativeSource && (
        <span className="echosub-speculative">{speculativeSource}</span>
      )}
      {hasActive && (
        <span
          className="echosub-live-dot"
          style={{
            background: activeColor,
            boxShadow: `0 0 8px ${activeColor}`,
          }}
        />
      )}
    </div>
  );

  const translatedLine = showTranslated && (
    <div
      key="translated"
      className="echosub-line echosub-translated"
      style={{
        fontSize: `${primaryFontSize}px`,
        color: activeColor,
        textShadow: shadowStyle,
      }}
    >
      <span>{translatedText}</span>
      {delayTag && <span className="echosub-delay-tag">{delayTag}</span>}
    </div>
  );

  const lines =
    appearance.lineOrder === 'translated-first'
      ? [translatedLine, sourceLine]
      : [sourceLine, translatedLine];

  const hasText = Boolean(committedSource || speculativeSource || translatedText);

  return (
    <div className="echosub-stage">
      <div
        className={`echosub-pill${dragging ? ' dragging' : ''}`}
        style={{
          left: `${pos.xPercent}%`,
          top: `${pos.yPercent}%`,
          maxWidth: `${appearance.maxWidthPercent}vw`,
          backgroundColor: `rgba(10, 14, 24, ${appearance.backgroundOpacity})`,
          backdropFilter: `blur(${appearance.backdropBlur}px)`,
          WebkitBackdropFilter: `blur(${appearance.backdropBlur}px)`,
          borderLeft:
            useSpeakerColor && hasText
              ? `4px solid ${activeColor}`
              : undefined,
          borderColor:
            useSpeakerColor && hasText ? `${activeColor}66` : undefined,
          boxShadow:
            useSpeakerColor && hasText
              ? `0 18px 48px rgba(0,0,0,0.52), 0 0 22px ${activeColor}28, inset 0 1px 0 ${activeColor}40`
              : undefined,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Auto-reveal mini control bar on hover */}
        <div className="echosub-toolbar" onPointerDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="echosub-tool-btn"
            onClick={cycleMode}
            title="Switch subtitle mode"
          >
            {MODE_LABEL[appearance.displayMode]}
          </button>
          <button
            type="button"
            className="echosub-tool-btn"
            onClick={() => stepFont(-2)}
            title="Decrease font size"
          >
            A-
          </button>
          <button
            type="button"
            className="echosub-tool-btn"
            onClick={() => stepFont(2)}
            title="Increase font size"
          >
            A+
          </button>
          <button
            type="button"
            className="echosub-tool-btn"
            onClick={onHideOverlay}
            title="Hide subtitles (Alt+Shift+H)"
          >
            ✕
          </button>
        </div>

        {errorMessage ? (
          <div className="echosub-status-hint" style={{ color: '#fda4af' }}>
            <span>⚠ {errorMessage}</span>
          </div>
        ) : hasText ? (
          <>
            {useSpeakerColor && speaker && (
              <div
                className="echosub-speaker-badge"
                style={{
                  backgroundColor: speaker.color,
                }}
              >
                <span className="echosub-speaker-dot" />
                <span>{speaker.label}</span>
              </div>
            )}
            {lines}
          </>
        ) : (
          <div className="echosub-status-hint">
            <span className="echosub-live-dot" style={{ marginLeft: 0 }} />
            <span>
              {autoStartHint
                ? autoStartHint
                : status === 'starting'
                  ? 'EchoSub · Connecting audio stream…'
                  : status === 'reconnecting'
                    ? 'EchoSub · Reconnecting ASR…'
                    : 'EchoSub · Listening for speech…'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export function sendOverlayMessage(message: RuntimeMessage): void {
  chrome.runtime.sendMessage(message).catch(() => {});
}
