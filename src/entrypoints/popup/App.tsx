import React from 'react';
import {
  AlertTriangle,
  Captions,
  Eye,
  EyeOff,
  Languages,
  Mic,
  PanelRightOpen,
  Play,
  Sparkles,
  Square,
  Wand2,
  Zap,
  MessageSquareQuote,
} from 'lucide-react';
import { useEchoSubSession } from '../../shared/useSession';
import { WaveformMeter } from '../../shared/WaveformMeter';
import { DEFAULT_AUTO_START } from '../../types/settings';
import type {
  CaptureMode,
  DisplayMode,
  SubtitleTimingMode,
} from '../../types/subtitle';

export const PopupApp: React.FC = () => {
  const {
    snapshot,
    settings,
    actionError,
    locale,
    t,
    startCapture,
    stopCapture,
    toggleOverlay,
    openSidePanel,
    updateSettings,
    updateAppearance,
  } = useEchoSubSession();

  const isRunning =
    snapshot.status === 'running' ||
    snapshot.status === 'starting' ||
    snapshot.status === 'reconnecting';

  const latestPreview = snapshot.activeCaption
    ? {
        source:
          `${snapshot.activeCaption.committedSource}${snapshot.activeCaption.speculativeSource}`.trim(),
        translated: snapshot.activeCaption.translatedText,
      }
    : snapshot.segments.length > 0
      ? {
          source: snapshot.segments[snapshot.segments.length - 1].sourceText,
          translated:
            snapshot.segments[snapshot.segments.length - 1].translatedText,
        }
      : null;

  const displayModes: Array<{ id: DisplayMode; label: string }> = [
    { id: 'bilingual', label: t.modeBilingual },
    { id: 'translated', label: t.modeTranslated },
    { id: 'source', label: t.modeSource },
  ];

  const captureModes: Array<{
    id: CaptureMode;
    label: string;
    icon: React.FC<{ className?: string }>;
  }> = [
    { id: 'auto', label: t.modeAuto, icon: Wand2 },
    { id: 'audio', label: t.modeAudio, icon: Mic },
    { id: 'track', label: t.modeTrack, icon: Captions },
  ];

  const handleToggleLocale = () => {
    void updateSettings({ uiLocale: locale === 'zh' ? 'en' : 'zh' });
  };

  const autoStart = settings.autoStart ?? DEFAULT_AUTO_START;
  const enabledSiteCount =
    (autoStart.enabledSiteIds?.length ?? 0) +
    (autoStart.customDomains?.length ?? 0);

  return (
    <div className="w-[376px] bg-[#090d16] p-4 text-slate-100">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <img
            src="/icon/48.png"
            alt="EchoSub"
            className="h-8 w-8 rounded-lg shadow-md"
          />
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-[15px] font-bold tracking-tight text-white">
                {t.appName}
              </h1>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                  snapshot.status === 'running'
                    ? snapshot.activeInputSource === 'track'
                      ? 'bg-indigo-500/25 text-indigo-200'
                      : 'bg-teal-500/20 text-teal-300'
                    : snapshot.status === 'error'
                      ? 'bg-rose-500/20 text-rose-300'
                      : 'bg-slate-800 text-slate-400'
                }`}
              >
                {snapshot.status === 'running'
                  ? snapshot.activeInputSource === 'track'
                    ? t.sourceBadgeTrack
                    : t.live
                  : snapshot.status === 'starting'
                    ? t.starting
                    : snapshot.status === 'reconnecting'
                      ? t.reconnecting
                      : snapshot.status === 'error'
                        ? t.error
                        : t.idle}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">{t.tagline}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleToggleLocale}
          title={t.uiLanguage}
          className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-700/70 bg-slate-800/70 px-2 py-1 text-[11px] font-medium text-slate-300 transition hover:border-teal-400/50 hover:text-white"
        >
          <Languages className="h-3.5 w-3.5" />
          {locale === 'zh' ? 'EN' : '中'}
        </button>
      </div>

      {/* Hybrid Input Mode Selector */}
      <div className="mb-2 grid grid-cols-3 gap-1 rounded-xl border border-slate-800 bg-slate-900/80 p-1">
        {captureModes.map(({ id, label, icon: Icon }) => {
          const active = settings.captureMode === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => void updateSettings({ captureMode: id })}
              className={`flex cursor-pointer items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-medium transition ${
                active
                  ? 'bg-indigo-500/25 text-indigo-200 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="h-3 w-3" />
              {label}
            </button>
          );
        })}
      </div>

      {/* Mode A (Low-Latency) vs Mode B (Full Sentence) */}
      <div className="mb-3 grid grid-cols-2 gap-1.5">
        {(
          [
            {
              id: 'realtime' as SubtitleTimingMode,
              label: t.timingRealtime,
              desc: t.timingRealtimeDesc,
              icon: Zap,
            },
            {
              id: 'sentence' as SubtitleTimingMode,
              label: t.timingSentence,
              desc: t.timingSentenceDesc,
              icon: MessageSquareQuote,
            },
          ] as const
        ).map(({ id, label, desc, icon: Icon }) => {
          const active = settings.timingMode === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => void updateSettings({ timingMode: id })}
              className={`flex cursor-pointer flex-col rounded-xl border px-2.5 py-1.5 text-left transition ${
                active
                  ? 'border-teal-400/60 bg-teal-500/15 text-teal-200'
                  : 'border-slate-800 bg-slate-900/70 text-slate-400 hover:border-slate-700 hover:text-slate-200'
              }`}
            >
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold">
                <Icon className="h-3 w-3" />
                {label}
              </span>
              <span className="mt-0.5 text-[10px] opacity-75">{desc}</span>
            </button>
          );
        })}
      </div>

      {/* Primary Capture CTA */}
      <button
        type="button"
        onClick={() => void (isRunning ? stopCapture() : startCapture())}
        className={`mb-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white transition active:scale-[0.99] ${
          isRunning ? 'danger-gradient-btn' : 'accent-gradient-btn'
        }`}
      >
        {isRunning ? (
          <>
            <Square className="h-4 w-4 fill-current" />
            {t.stopCapture}
          </>
        ) : (
          <>
            <Play className="h-4 w-4 fill-current" />
            {t.startCapture}
          </>
        )}
      </button>

      {/* Error Banner */}
      {actionError && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
          <span className="leading-relaxed">{actionError}</span>
        </div>
      )}

      {/* Demo mode friendly upgrade guide */}
      {settings.asrProvider === 'demo' && settings.captureMode !== 'track' && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-indigo-400/25 bg-indigo-500/10 p-2.5 text-[11px] text-indigo-100">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-300" />
          <div className="flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-teal-300">{t.demoBadge}</span>
              <button
                type="button"
                onClick={() => void openSidePanel()}
                className="cursor-pointer rounded bg-teal-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-teal-200 hover:bg-teal-500/30"
              >
                {t.setupFreeCta} →
              </button>
            </div>
            <p className="mt-1 leading-relaxed text-slate-300">{t.demoHint}</p>
          </div>
        </div>
      )}

      {/* Live Audio Pipeline Monitor */}
      <WaveformMeter
        metrics={snapshot.metrics}
        status={snapshot.status}
        latencyMs={snapshot.latencyMs}
        t={t}
        compact
      />

      {/* Compact Live Caption Preview */}
      {latestPreview && (
        <div className="glass-card mt-3 rounded-xl px-3 py-2.5">
          <p className="line-clamp-2 text-[11px] leading-snug text-slate-300">
            {latestPreview.source}
          </p>
          {latestPreview.translated && (
            <p className="mt-1 line-clamp-2 text-xs font-medium leading-snug text-teal-300">
              {latestPreview.translated}
            </p>
          )}
        </div>
      )}

      {/* Quick Display Mode + Overlay Switch */}
      <div className="mt-3 flex items-center gap-2">
        <div className="grid flex-1 grid-cols-3 rounded-xl border border-slate-800 bg-slate-900/80 p-1">
          {displayModes.map((m) => {
            const active = settings.appearance.displayMode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => void updateAppearance({ displayMode: m.id })}
                className={`cursor-pointer rounded-lg py-1.5 text-[11px] font-medium transition ${
                  active
                    ? 'bg-teal-500/20 text-teal-300 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => void toggleOverlay()}
          title={snapshot.overlayVisible ? t.hideOverlay : t.showOverlay}
          className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border transition ${
            snapshot.overlayVisible
              ? 'border-teal-500/40 bg-teal-500/15 text-teal-300'
              : 'border-slate-800 bg-slate-900/80 text-slate-400 hover:text-slate-200'
          }`}
        >
          {snapshot.overlayVisible ? (
            <Eye className="h-4 w-4" />
          ) : (
            <EyeOff className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Quick Auto-Start Video Sites Toggle */}
      <label className="mt-2.5 flex cursor-pointer items-center justify-between rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-[11px] text-slate-300 transition hover:border-slate-700">
        <span className="font-medium">
          {t.autoStartToggle}
          <span className="ml-1.5 font-mono text-[10px] text-slate-400">
            ({enabledSiteCount})
          </span>
        </span>
        <input
          type="checkbox"
          checked={Boolean(autoStart.enabled)}
          onChange={(e) =>
            void updateSettings({
              autoStart: {
                ...autoStart,
                enabled: e.target.checked,
              },
            })
          }
          className="h-3.5 w-3.5 accent-teal-400"
        />
      </label>

      {/* Footer: Open Full Side Panel */}
      <button
        type="button"
        onClick={() => void openSidePanel()}
        className="mt-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-700/70 bg-slate-800/60 px-3 py-2.5 text-xs font-medium text-slate-200 transition hover:border-teal-400/40 hover:bg-slate-800 hover:text-white"
      >
        <PanelRightOpen className="h-4 w-4 text-teal-300" />
        {t.openSidePanel}
        <span className="ml-auto rounded bg-slate-900/80 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
          {snapshot.segments.length}
        </span>
      </button>
    </div>
  );
};
