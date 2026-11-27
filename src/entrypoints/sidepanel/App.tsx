import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Captions,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Globe,
  MessageSquareQuote,
  Mic,
  Palette,
  Play,
  RotateCcw,
  ScrollText,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  Wand2,
  XCircle,
  Zap,
} from 'lucide-react';
import { SPEAKER_PALETTE } from '../../core/audio/speaker-diarizer';
import {
  PRESET_VIDEO_SITES,
  normalizeDomainInput,
} from '../../core/sites/auto-start';
import {
  exportToMarkdown,
  exportToSrt,
  formatShortTimestamp,
} from '../../core/subtitle/exporter';
import { checkChromeTranslatorSupport } from '../../core/translator/chrome-ai';
import { useEchoSubSession } from '../../shared/useSession';
import { WaveformMeter } from '../../shared/WaveformMeter';
import type { ConnectionTestResult } from '../../types/messages';
import {
  DEFAULT_APPEARANCE,
  DEFAULT_AUTO_START,
  LLM_PRESETS,
  type LlmPresetId,
  type UiLocale,
} from '../../types/settings';
import type {
  AsrProviderId,
  CaptureMode,
  DisplayMode,
  SubtitleTimingMode,
  TranslatorProviderId,
} from '../../types/subtitle';

type PanelTab = 'transcript' | 'appearance' | 'settings';

const ACCENT_SWATCHES = [
  '#38e8d6',
  '#fde047',
  '#ffffff',
  '#a5b4fc',
  '#fb7185',
  '#4ade80',
];

function triggerFileDownload(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const SidePanelApp: React.FC = () => {
  const {
    snapshot,
    settings,
    actionError,
    locale,
    t,
    startCapture,
    stopCapture,
    toggleOverlay,
    clearTranscript,
    resetSpeakers,
    updateSettings,
    updateAppearance,
    generateSummary,
    testConnections,
  } = useEchoSubSession();

  const [activeTab, setActiveTab] = useState<PanelTab>('transcript');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState(false);
  const [customDomainInput, setCustomDomainInput] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(
    null
  );
  const [chromeAiStatus, setChromeAiStatus] = useState<
    'available' | 'downloadable' | 'downloading' | 'unavailable'
  >('unavailable');

  const listEndRef = useRef<HTMLDivElement | null>(null);
  const isRunning =
    snapshot.status === 'running' ||
    snapshot.status === 'starting' ||
    snapshot.status === 'reconnecting';

  useEffect(() => {
    if (activeTab === 'transcript') {
      listEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [snapshot.segments.length, snapshot.activeCaption?.updatedAt, activeTab]);

  useEffect(() => {
    void checkChromeTranslatorSupport(
      settings.sourceLanguage,
      settings.targetLanguage
    ).then(setChromeAiStatus);
  }, [settings.sourceLanguage, settings.targetLanguage]);

  const flashSaved = () => {
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 1600);
  };

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // Ignore
    }
  };

  const handleExportSrt = () => {
    const srt = exportToSrt(snapshot.segments, settings.appearance.displayMode);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    triggerFileDownload(srt, `echosub-${stamp}.srt`, 'text/plain;charset=utf-8');
  };

  const handleExportMd = () => {
    const md = exportToMarkdown(snapshot.segments, {
      title: snapshot.tabTitle || 'EchoSub Transcript',
      url: snapshot.tabUrl || undefined,
      summary: summaryText ?? undefined,
    });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    triggerFileDownload(
      md,
      `echosub-notes-${stamp}.md`,
      'text/markdown;charset=utf-8'
    );
  };

  const handleSummarize = async () => {
    setSummarizing(true);
    setSummaryError(null);
    try {
      const md = await generateSummary();
      setSummaryText(md);
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : String(err));
    } finally {
      setSummarizing(false);
    }
  };

  const handleTestAll = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testConnections(settings);
      setTestResult(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTestResult({
        asrOk: false,
        asrMessage: msg,
        translatorOk: false,
        translatorMessage: msg,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleLlmPresetChange = (presetId: LlmPresetId) => {
    const preset = LLM_PRESETS[presetId];
    void updateSettings({
      llmPreset: presetId,
      llmBaseUrl: preset.baseUrl,
      llmModel: preset.defaultModel,
    });
    flashSaved();
  };

  // One-click free scenario presets
  const applySiliconFlowAllInOne = () => {
    const preset = LLM_PRESETS['siliconflow-free'];
    void updateSettings({
      asrProvider: 'siliconflow',
      siliconflowAsrModel: 'FunAudioLLM/SenseVoiceSmall',
      translatorProvider: 'llm',
      llmPreset: 'siliconflow-free',
      llmBaseUrl: preset.baseUrl,
      llmModel: preset.defaultModel,
      llmApiKey: settings.siliconflowApiKey || settings.llmApiKey,
    });
    setTestResult(null);
    flashSaved();
  };

  const applyLocalOfflinePreset = () => {
    void updateSettings({
      asrProvider: 'local-ws',
      translatorProvider:
        chromeAiStatus !== 'unavailable' ? 'chrome-ai' : 'free',
    });
    setTestResult(null);
    flashSaved();
  };

  const applyGroqPreset = () => {
    void updateSettings({
      asrProvider: 'groq',
      translatorProvider: 'free',
    });
    setTestResult(null);
    flashSaved();
  };

  const applyDemoPreset = () => {
    void updateSettings({
      asrProvider: 'demo',
      translatorProvider: 'free',
    });
    setTestResult(null);
    flashSaved();
  };

  const autoStart = settings.autoStart ?? DEFAULT_AUTO_START;
  const enabledSiteIds = autoStart.enabledSiteIds ?? [];
  const customDomains = autoStart.customDomains ?? [];

  const togglePresetSite = (siteId: string) => {
    const exists = enabledSiteIds.includes(siteId);
    const nextIds = exists
      ? enabledSiteIds.filter((id) => id !== siteId)
      : [...enabledSiteIds, siteId];
    void updateSettings({
      autoStart: {
        ...autoStart,
        enabledSiteIds: nextIds,
      },
    });
    flashSaved();
  };

  const handleAddCustomDomain = () => {
    const clean = normalizeDomainInput(customDomainInput);
    if (!clean) return;
    if (!customDomains.includes(clean)) {
      void updateSettings({
        autoStart: {
          ...autoStart,
          customDomains: [...customDomains, clean],
        },
      });
      flashSaved();
    }
    setCustomDomainInput('');
  };

  const handleRemoveCustomDomain = (domain: string) => {
    void updateSettings({
      autoStart: {
        ...autoStart,
        customDomains: customDomains.filter((d) => d !== domain),
      },
    });
    flashSaved();
  };

  return (
    <div className="flex h-screen flex-col bg-[#090d16] text-slate-100">
      {/* Top Studio Header */}
      <header className="shrink-0 border-b border-slate-800/80 bg-[#0c1220]/90 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <img
              src="/icon/48.png"
              alt="EchoSub"
              className="h-7 w-7 shrink-0 rounded-lg"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold tracking-tight text-white">
                  {t.appName}
                </span>
                <span className="font-mono text-[9px] text-slate-500">
                  v2.3.1
                </span>
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
                      : snapshot.asrProvider === 'demo'
                        ? t.sourceBadgeDemo
                        : `${
                            snapshot.asrProvider === 'siliconflow'
                              ? '硅基流动'
                              : snapshot.asrProvider === 'local-ws'
                                ? '本地离线'
                                : snapshot.asrProvider.toUpperCase()
                          } · ${t.live}`
                    : snapshot.status === 'error'
                      ? t.error
                      : t.idle}
                </span>
              </div>
              {snapshot.tabTitle && (
                <p className="truncate text-[11px] text-slate-400">
                  {snapshot.tabTitle}
                </p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => void toggleOverlay()}
              title={snapshot.overlayVisible ? t.hideOverlay : t.showOverlay}
              className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border transition ${
                snapshot.overlayVisible
                  ? 'border-teal-500/40 bg-teal-500/15 text-teal-300'
                  : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-white'
              }`}
            >
              {snapshot.overlayVisible ? (
                <Eye className="h-4 w-4" />
              ) : (
                <EyeOff className="h-4 w-4" />
              )}
            </button>

            <button
              type="button"
              onClick={() => void (isRunning ? stopCapture() : startCapture())}
              className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition ${
                isRunning ? 'danger-gradient-btn' : 'accent-gradient-btn'
              }`}
            >
              {isRunning ? (
                <>
                  <Square className="h-3.5 w-3.5 fill-current" />
                  {t.stopCapture}
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 fill-current" />
                  {t.startCapture}
                </>
              )}
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="mt-3 grid grid-cols-3 gap-1 rounded-xl border border-slate-800/90 bg-slate-900/70 p-1">
          {(
            [
              { id: 'transcript', label: t.tabTranscript, icon: ScrollText },
              { id: 'appearance', label: t.tabAppearance, icon: Palette },
              { id: 'settings', label: t.tabSettings, icon: Settings2 },
            ] as const
          ).map(({ id, label, icon: Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition ${
                  active
                    ? 'bg-teal-500/20 text-teal-300 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            );
          })}
        </nav>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto px-4 py-3">
        {actionError && (
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
            <span>{actionError}</span>
          </div>
        )}

        {/* TAB 1: LIVE TRANSCRIPT & EXPORT */}
        {activeTab === 'transcript' && (
          <div className="flex flex-col gap-3">
            {/* Hybrid Capture Mode Bar */}
            <div className="grid grid-cols-3 gap-1 rounded-xl border border-slate-800 bg-slate-900/80 p-1">
              {(
                [
                  { id: 'auto', label: t.modeAuto, icon: Wand2 },
                  { id: 'audio', label: t.modeAudio, icon: Mic },
                  { id: 'track', label: t.modeTrack, icon: Captions },
                ] as Array<{
                  id: CaptureMode;
                  label: string;
                  icon: React.FC<{ className?: string }>;
                }>
              ).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => void updateSettings({ captureMode: id })}
                  className={`flex cursor-pointer items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-medium transition ${
                    settings.captureMode === id
                      ? 'bg-indigo-500/25 text-indigo-200'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Icon className="h-3 w-3" />
                  {label}
                </button>
              ))}
            </div>

            {/* Mode A (Realtime Low-Latency) vs Mode B (Full Sentence Polish) */}
            <div className="grid grid-cols-2 gap-1.5">
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
                    className={`flex cursor-pointer flex-col rounded-xl border px-2.5 py-2 text-left transition ${
                      active
                        ? 'border-teal-400/60 bg-teal-500/15 text-teal-200'
                        : 'border-slate-800 bg-slate-900/70 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold">
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                    </span>
                    <span className="mt-0.5 text-[10px] opacity-80">{desc}</span>
                  </button>
                );
              })}
            </div>

            <WaveformMeter
              metrics={snapshot.metrics}
              status={snapshot.status}
              latencyMs={snapshot.latencyMs}
              t={t}
              compact
            />

            {/* Export & AI Summary Toolbar */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={snapshot.segments.length === 0}
                onClick={handleExportSrt}
                className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-700/80 bg-slate-800/70 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 transition hover:border-teal-400/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Download className="h-3.5 w-3.5 text-teal-300" />
                {t.exportSrt}
              </button>
              <button
                type="button"
                disabled={snapshot.segments.length === 0}
                onClick={handleExportMd}
                className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-700/80 bg-slate-800/70 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 transition hover:border-teal-400/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <FileText className="h-3.5 w-3.5 text-indigo-300" />
                {t.exportMd}
              </button>
              <button
                type="button"
                disabled={snapshot.segments.length === 0 || summarizing}
                onClick={() => void handleSummarize()}
                className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-teal-500/35 bg-teal-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-teal-200 transition hover:bg-teal-500/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {summarizing ? t.summarizing : t.aiSummary}
              </button>

              <label
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-medium transition ${
                  settings.appearance.showTranslationDelay
                    ? 'border-amber-400/50 bg-amber-500/15 text-amber-200'
                    : 'border-slate-700/80 bg-slate-800/60 text-slate-300 hover:border-slate-600'
                }`}
              >
                <input
                  type="checkbox"
                  checked={settings.appearance.showTranslationDelay}
                  onChange={(e) =>
                    void updateAppearance({
                      showTranslationDelay: e.target.checked,
                    })
                  }
                  className="h-3.5 w-3.5 accent-amber-400"
                />
                {t.showTranslationDelayShort}
              </label>

              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  disabled={snapshot.segments.length === 0}
                  onClick={() =>
                    void handleCopy(
                      'all',
                      snapshot.segments
                        .map((s) =>
                          s.translatedText
                            ? `${s.sourceText}\n${s.translatedText}`
                            : s.sourceText
                        )
                        .join('\n\n')
                    )
                  }
                  title={t.copyAll}
                  className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-400 transition hover:text-white disabled:opacity-40"
                >
                  {copiedId === 'all' ? (
                    <Check className="h-3.5 w-3.5 text-teal-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  disabled={snapshot.segments.length === 0}
                  onClick={() => {
                    setSummaryText(null);
                    void clearTranscript();
                  }}
                  title={t.clear}
                  className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-slate-800 bg-slate-900 text-slate-400 transition hover:text-rose-300 disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {summaryError && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
                {summaryError}
              </div>
            )}
            {summaryText && (
              <div className="rounded-xl border border-teal-500/30 bg-gradient-to-b from-teal-950/40 to-slate-900/90 p-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-300">
                    <Sparkles className="h-3.5 w-3.5" />
                    {t.summaryTitle}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void handleCopy('summary', summaryText)}
                      className="cursor-pointer rounded px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-slate-800"
                    >
                      {copiedId === 'summary' ? t.copied : t.copyAll}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSummaryText(null)}
                      className="cursor-pointer rounded px-1.5 py-0.5 text-[11px] text-slate-400 hover:bg-slate-800"
                    >
                      {t.close}
                    </button>
                  </div>
                </div>
                <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-200">
                  {summaryText}
                </pre>
              </div>
            )}

            {snapshot.segments.length === 0 && !snapshot.activeCaption ? (
              <div className="glass-card flex flex-col items-center justify-center rounded-2xl px-6 py-10 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-500/15 text-teal-300">
                  <ScrollText className="h-6 w-6" />
                </div>
                <h2 className="text-sm font-semibold text-white">
                  {t.noSegmentsTitle}
                </h2>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                  {t.noSegmentsDesc}
                </p>
                {settings.asrProvider === 'demo' && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('settings')}
                    className="mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-teal-400/40 bg-teal-500/15 px-3 py-1.5 text-xs font-semibold text-teal-200 hover:bg-teal-500/25"
                  >
                    <Zap className="h-3.5 w-3.5" />
                    {t.setupFreeCta} →
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {snapshot.segments.map((seg) => {
                  const spkColor =
                    settings.appearance.speakerColoring && seg.speaker
                      ? seg.speaker.color
                      : '#5eead4';
                  const hasDistinctTranslation =
                    Boolean(seg.translatedText?.trim()) &&
                    seg.translatedText.trim() !== seg.sourceText.trim();
                  return (
                    <div
                      key={seg.id}
                      className="glass-card group rounded-xl px-3.5 py-2.5 transition hover:border-slate-600/70"
                      style={{
                        borderLeft:
                          settings.appearance.speakerColoring && seg.speaker
                            ? `3px solid ${seg.speaker.color}`
                            : undefined,
                      }}
                    >
                      <div className="mb-1 flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px] text-slate-500">
                            {formatShortTimestamp(seg.startMs)}
                          </span>
                          {seg.speaker && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                              style={{
                                color: seg.speaker.color,
                                backgroundColor: `${seg.speaker.color}1a`,
                              }}
                            >
                              <span
                                className="h-1.5 w-1.5 rounded-full"
                                style={{ backgroundColor: seg.speaker.color }}
                              />
                              {seg.speaker.label}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            void handleCopy(
                              seg.id,
                              hasDistinctTranslation
                                ? `${seg.sourceText}\n${seg.translatedText}`
                                : seg.sourceText
                            )
                          }
                          className="cursor-pointer text-slate-400 opacity-0 transition hover:text-teal-300 group-hover:opacity-100"
                        >
                          {copiedId === seg.id ? (
                            <Check className="h-3.5 w-3.5 text-teal-400" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                      <p className="text-xs leading-relaxed text-slate-300">
                        {seg.sourceText}
                      </p>
                      {hasDistinctTranslation && (
                        <p
                          className="mt-1 text-[13px] font-medium leading-relaxed"
                          style={{ color: spkColor }}
                        >
                          {seg.translatedText}
                          {settings.appearance.showTranslationDelay &&
                            seg.delayMs &&
                            seg.delayMs > 0 && (
                              <span className="ml-1.5 font-mono text-[10px] opacity-70">
                                [{Math.max(0.1, seg.delayMs / 1000).toFixed(1)}
                                {locale === 'zh' ? 's前]' : 's ago]'}
                              </span>
                            )}
                        </p>
                      )}
                    </div>
                  );
                })}

                {snapshot.activeCaption && (
                  <div
                    className="rounded-xl border border-teal-500/40 bg-teal-500/10 px-3.5 py-2.5"
                    style={{
                      borderColor:
                        settings.appearance.speakerColoring &&
                        snapshot.activeCaption.speaker
                          ? `${snapshot.activeCaption.speaker.color}66`
                          : undefined,
                    }}
                  >
                    <div className="mb-1 flex items-center gap-1.5">
                      <span
                        className="h-1.5 w-1.5 animate-pulse rounded-full"
                        style={{
                          backgroundColor:
                            settings.appearance.speakerColoring &&
                            snapshot.activeCaption.speaker
                              ? snapshot.activeCaption.speaker.color
                              : '#2dd4bf',
                        }}
                      />
                      <span className="font-mono text-[10px] text-teal-300">
                        {formatShortTimestamp(snapshot.activeCaption.startMs)} ·{' '}
                        {t.live}
                      </span>
                      {snapshot.activeCaption.speaker && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                          style={{
                            color: snapshot.activeCaption.speaker.color,
                            backgroundColor: `${snapshot.activeCaption.speaker.color}1f`,
                          }}
                        >
                          {snapshot.activeCaption.speaker.label}
                        </span>
                      )}
                    </div>
                    <p className="text-xs leading-relaxed text-slate-100">
                      <span>{snapshot.activeCaption.committedSource}</span>
                      <span className="italic text-slate-400">
                        {snapshot.activeCaption.speculativeSource}
                      </span>
                    </p>
                    {snapshot.activeCaption.translatedText &&
                      snapshot.activeCaption.translatedText.trim() !==
                        `${snapshot.activeCaption.committedSource}${snapshot.activeCaption.speculativeSource}`.trim() && (
                        <p
                          className="mt-1 text-[13px] font-medium leading-relaxed"
                          style={{
                            color:
                              settings.appearance.speakerColoring &&
                              snapshot.activeCaption.speaker
                                ? snapshot.activeCaption.speaker.color
                                : '#5eead4',
                          }}
                        >
                          {snapshot.activeCaption.translatedText}
                        </p>
                      )}
                  </div>
                )}

                <div ref={listEndRef} />
              </div>
            )}
          </div>
        )}

        {/* TAB 2: APPEARANCE STUDIO */}
        {activeTab === 'appearance' && (
          <div className="flex flex-col gap-3.5">
            <div className="relative flex h-36 items-end justify-center overflow-hidden rounded-2xl border border-slate-700/70 bg-gradient-to-br from-indigo-950 via-slate-900 to-teal-950 p-4">
              <div
                className="w-full rounded-xl border border-white/15 px-3.5 py-2 text-center shadow-2xl"
                style={{
                  maxWidth: `${settings.appearance.maxWidthPercent}%`,
                  backgroundColor: `rgba(10, 14, 24, ${settings.appearance.backgroundOpacity})`,
                  backdropFilter: `blur(${settings.appearance.backdropBlur}px)`,
                }}
              >
                {settings.appearance.lineOrder === 'translated-first' ? (
                  <>
                    {settings.appearance.displayMode !== 'source' && (
                      <div
                        className="font-semibold leading-snug"
                        style={{
                          fontSize: `${Math.min(20, settings.appearance.fontSize * 0.8)}px`,
                          color: settings.appearance.accentColor,
                        }}
                      >
                        实时电影级双语字幕，全屏永不遮挡
                      </div>
                    )}
                    {settings.appearance.displayMode !== 'translated' && (
                      <div
                        className="mt-0.5 text-slate-200"
                        style={{
                          fontSize: `${Math.max(11, Math.min(16, settings.appearance.fontSize * 0.62))}px`,
                        }}
                      >
                        Cinematic live bilingual captions in fullscreen.
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {settings.appearance.displayMode !== 'translated' && (
                      <div
                        className="text-slate-200"
                        style={{
                          fontSize: `${Math.max(11, Math.min(16, settings.appearance.fontSize * 0.62))}px`,
                        }}
                      >
                        Cinematic live bilingual captions in fullscreen.
                      </div>
                    )}
                    {settings.appearance.displayMode !== 'source' && (
                      <div
                        className="mt-0.5 font-semibold leading-snug"
                        style={{
                          fontSize: `${Math.min(20, settings.appearance.fontSize * 0.8)}px`,
                          color: settings.appearance.accentColor,
                        }}
                      >
                        实时电影级双语字幕，全屏永不遮挡
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="glass-card flex flex-col gap-3 rounded-xl p-3.5">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-300">
                  {t.displayMode}
                </label>
                <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-900/90 p-1">
                  {(
                    [
                      ['bilingual', t.modeBilingual],
                      ['translated', t.modeTranslated],
                      ['source', t.modeSource],
                    ] as Array<[DisplayMode, string]>
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => void updateAppearance({ displayMode: id })}
                      className={`cursor-pointer rounded-lg py-1.5 text-xs font-medium transition ${
                        settings.appearance.displayMode === id
                          ? 'bg-teal-500/20 text-teal-300'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-300">
                  {t.lineOrder}
                </label>
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-900/90 p-1">
                  <button
                    type="button"
                    onClick={() =>
                      void updateAppearance({ lineOrder: 'source-first' })
                    }
                    className={`cursor-pointer rounded-lg py-1.5 text-[11px] font-medium transition ${
                      settings.appearance.lineOrder === 'source-first'
                        ? 'bg-teal-500/20 text-teal-300'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {t.orderSourceFirst}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void updateAppearance({ lineOrder: 'translated-first' })
                    }
                    className={`cursor-pointer rounded-lg py-1.5 text-[11px] font-medium transition ${
                      settings.appearance.lineOrder === 'translated-first'
                        ? 'bg-teal-500/20 text-teal-300'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {t.orderTranslatedFirst}
                  </button>
                </div>
              </div>

              <SliderRow
                label={t.fontSize}
                valueLabel={`${settings.appearance.fontSize}px`}
                min={14}
                max={34}
                step={1}
                value={settings.appearance.fontSize}
                onChange={(v) => void updateAppearance({ fontSize: v })}
              />

              <SliderRow
                label={t.bgOpacity}
                valueLabel={`${Math.round(settings.appearance.backgroundOpacity * 100)}%`}
                min={0}
                max={95}
                step={5}
                value={Math.round(settings.appearance.backgroundOpacity * 100)}
                onChange={(v) =>
                  void updateAppearance({ backgroundOpacity: v / 100 })
                }
              />

              <SliderRow
                label={t.blurStrength}
                valueLabel={`${settings.appearance.backdropBlur}px`}
                min={0}
                max={24}
                step={2}
                value={settings.appearance.backdropBlur}
                onChange={(v) => void updateAppearance({ backdropBlur: v })}
              />

              <SliderRow
                label={t.maxWidth}
                valueLabel={`${settings.appearance.maxWidthPercent}%`}
                min={45}
                max={94}
                step={2}
                value={settings.appearance.maxWidthPercent}
                onChange={(v) => void updateAppearance({ maxWidthPercent: v })}
              />

              <div>
                <label className="mb-2 block text-xs font-medium text-slate-300">
                  {t.accentColor}
                </label>
                <div className="flex items-center gap-2">
                  {ACCENT_SWATCHES.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => void updateAppearance({ accentColor: hex })}
                      className={`h-6 w-6 cursor-pointer rounded-full border-2 transition ${
                        settings.appearance.accentColor === hex
                          ? 'scale-110 border-white'
                          : 'border-transparent opacity-80 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                <label className="flex cursor-pointer items-center justify-between gap-2 text-[11px] font-medium text-slate-200">
                  <span>{t.speakerColoring}</span>
                  <input
                    type="checkbox"
                    checked={settings.appearance.speakerColoring}
                    onChange={(e) =>
                      void updateAppearance({
                        speakerColoring: e.target.checked,
                      })
                    }
                    className="h-4 w-4 accent-teal-400"
                  />
                </label>
                <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
                  {t.speakerColoringHint}
                </p>
                {settings.appearance.speakerColoring && (
                  <>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {SPEAKER_PALETTE.map((entry) => (
                        <span
                          key={entry.id}
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                          style={{
                            color: entry.color,
                            backgroundColor: `${entry.color}1a`,
                          }}
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: entry.color }}
                          />
                          {locale === 'zh' ? entry.labelZh : entry.labelEn}
                        </span>
                      ))}
                      <button
                        type="button"
                        onClick={() => void resetSpeakers()}
                        className="ml-auto cursor-pointer rounded-md border border-slate-700 bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300 hover:border-teal-400/50 hover:text-white"
                      >
                        {t.resetSpeakers}
                      </button>
                    </div>
                    <div className="mt-2.5">
                      <SliderRow
                        label={t.speakerSensitivity}
                        valueLabel={`${Math.round(settings.speakerSensitivity * 100)}%`}
                        min={50}
                        max={82}
                        step={2}
                        value={Math.round(settings.speakerSensitivity * 100)}
                        onChange={(v) =>
                          void updateSettings({ speakerSensitivity: v / 100 })
                        }
                      />
                    </div>
                  </>
                )}
              </div>

              <label className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-[11px] text-slate-300">
                <span>{t.showTranslationDelay}</span>
                <input
                  type="checkbox"
                  checked={settings.appearance.showTranslationDelay}
                  onChange={(e) =>
                    void updateAppearance({
                      showTranslationDelay: e.target.checked,
                    })
                  }
                  className="h-4 w-4 accent-amber-400"
                />
              </label>

              <label className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-[11px] text-slate-300">
                <span>{t.hideNativeCc}</span>
                <input
                  type="checkbox"
                  checked={settings.appearance.hideNativeTrackCaptions}
                  onChange={(e) =>
                    void updateAppearance({
                      hideNativeTrackCaptions: e.target.checked,
                    })
                  }
                  className="h-4 w-4 accent-teal-400"
                />
              </label>

              <button
                type="button"
                onClick={() =>
                  void updateAppearance({
                    position: { ...DEFAULT_APPEARANCE.position },
                  })
                }
                className="mt-1 inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 py-2 text-xs font-medium text-slate-200 hover:border-teal-400/50 hover:text-white"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t.resetPosition}
              </button>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3 text-[11px] leading-relaxed text-slate-400">
              <p>• {t.dragTip}</p>
              <p className="mt-1">• {t.fullscreenTip}</p>
            </div>
          </div>
        )}

        {/* TAB 3: ZERO-BARRIER GUIDED SETUP & ENGINES */}
        {activeTab === 'settings' && (
          <div className="flex flex-col gap-3.5 pb-6">
            {savedToast && (
              <div className="rounded-lg border border-teal-500/35 bg-teal-500/15 px-3 py-1.5 text-center text-xs font-medium text-teal-300">
                ✓ {t.savedHint}
              </div>
            )}

            {/* Quick Scenario Presets */}
            <section className="flex flex-col gap-2">
              <div>
                <h3 className="text-xs font-bold text-white">
                  {t.quickPresetsTitle}
                </h3>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {t.quickPresetsSub}
                </p>
              </div>

              {/* Card 1: SiliconFlow All-in-One Free (CN Direct) */}
              <div
                className={`rounded-xl border p-3 transition ${
                  settings.asrProvider === 'siliconflow'
                    ? 'border-teal-400/70 bg-teal-500/10'
                    : 'glass-card hover:border-slate-600'
                }`}
              >
                <button
                  type="button"
                  onClick={applySiliconFlowAllInOne}
                  className="flex w-full cursor-pointer items-start justify-between gap-2 text-left"
                >
                  <div className="flex items-start gap-2">
                    <Zap className="mt-0.5 h-4 w-4 shrink-0 text-teal-300" />
                    <div>
                      <div className="text-xs font-semibold text-white">
                        {t.presetSfTitle}
                      </div>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-slate-300">
                        {t.presetSfDesc}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-teal-500/20 px-2 py-0.5 text-[10px] font-semibold text-teal-300">
                    {t.presetSfBadge}
                  </span>
                </button>

                {settings.asrProvider === 'siliconflow' && (
                  <div className="mt-3 flex flex-col gap-2 border-t border-teal-500/20 pt-2.5">
                    <div className="flex items-center justify-between text-[11px] text-slate-300">
                      <span>
                        {locale === 'zh'
                          ? '① 手机号登录 → 左侧「API 密钥」新建'
                          : '1. Sign in → Create API Key'}
                      </span>
                      <a
                        href="https://cloud.siliconflow.cn/account/ak"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-teal-300 hover:underline"
                      >
                        {t.getFreeKeyBtn}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                    <TextField
                      label={
                        locale === 'zh'
                          ? '② 粘贴硅基流动免费 Key（同时驱动语音转文字 + 翻译）'
                          : '2. Paste SiliconFlow Free Key (ASR + Translation)'
                      }
                      type="password"
                      value={settings.siliconflowApiKey}
                      placeholder="sk-..."
                      onChange={(v) => {
                        void updateSettings({
                          siliconflowApiKey: v,
                          llmApiKey:
                            settings.llmPreset === 'siliconflow-free'
                              ? v
                              : settings.llmApiKey,
                        });
                        flashSaved();
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Card 2: 100% Local Offline */}
              <div
                className={`rounded-xl border p-3 transition ${
                  settings.asrProvider === 'local-ws'
                    ? 'border-indigo-400/70 bg-indigo-500/10'
                    : 'glass-card hover:border-slate-600'
                }`}
              >
                <button
                  type="button"
                  onClick={applyLocalOfflinePreset}
                  className="flex w-full cursor-pointer items-start justify-between gap-2 text-left"
                >
                  <div className="flex items-start gap-2">
                    <Cpu className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" />
                    <div>
                      <div className="text-xs font-semibold text-white">
                        {t.presetLocalTitle}
                      </div>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-slate-300">
                        {t.presetLocalDesc}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-semibold text-indigo-200">
                    {t.presetLocalBadge}
                  </span>
                </button>

                {settings.asrProvider === 'local-ws' && (
                  <div className="mt-3 flex flex-col gap-2 border-t border-indigo-400/20 pt-2.5">
                    <TextField
                      label="Local WebSocket URL"
                      value={settings.localWsUrl}
                      placeholder="ws://127.0.0.1:8765/ws/asr"
                      onChange={(v) => void updateSettings({ localWsUrl: v })}
                    />
                    <p className="text-[11px] leading-relaxed text-indigo-200/80">
                      {t.localWsTip}
                    </p>
                  </div>
                )}
              </div>

              {/* Card 3: Groq Global Free */}
              <div
                className={`rounded-xl border p-3 transition ${
                  settings.asrProvider === 'groq'
                    ? 'border-sky-400/70 bg-sky-500/10'
                    : 'glass-card hover:border-slate-600'
                }`}
              >
                <button
                  type="button"
                  onClick={applyGroqPreset}
                  className="flex w-full cursor-pointer items-start justify-between gap-2 text-left"
                >
                  <div className="flex items-start gap-2">
                    <Globe className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />
                    <div>
                      <div className="text-xs font-semibold text-white">
                        {t.presetGroqTitle}
                      </div>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-slate-300">
                        {t.presetGroqDesc}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] font-semibold text-sky-200">
                    {t.presetGroqBadge}
                  </span>
                </button>

                {settings.asrProvider === 'groq' && (
                  <div className="mt-3 flex flex-col gap-2 border-t border-sky-400/20 pt-2.5">
                    <div className="flex justify-end">
                      <a
                        href="https://console.groq.com/keys"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-300 hover:underline"
                      >
                        {t.getFreeKeyBtn} (console.groq.com)
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                    <TextField
                      label="Groq API Key"
                      type="password"
                      value={settings.groqApiKey}
                      placeholder="gsk_..."
                      onChange={(v) => {
                        void updateSettings({ groqApiKey: v });
                        flashSaved();
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Card 4: Demo Preview */}
              <button
                type="button"
                onClick={applyDemoPreset}
                className={`flex w-full cursor-pointer items-start justify-between gap-2 rounded-xl border p-3 text-left transition ${
                  settings.asrProvider === 'demo'
                    ? 'border-amber-400/60 bg-amber-500/10'
                    : 'glass-card hover:border-slate-600'
                }`}
              >
                <div className="flex items-start gap-2">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                  <div>
                    <div className="text-xs font-semibold text-white">
                      {t.presetDemoTitle}
                    </div>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-slate-300">
                      {t.presetDemoDesc}
                    </p>
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
                  {t.presetDemoBadge}
                </span>
              </button>
            </section>

            {/* One-Click Connection Diagnostic Bar */}
            <section className="glass-card flex flex-col gap-2.5 rounded-xl p-3.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-300">
                  Chrome 内置离线机翻：
                  <strong
                    className={
                      chromeAiStatus !== 'unavailable'
                        ? 'ml-1 text-teal-300'
                        : 'ml-1 text-slate-400'
                    }
                  >
                    {chromeAiStatus === 'available'
                      ? '已就绪 (零网络)'
                      : chromeAiStatus === 'downloadable'
                        ? '支持 (首次自动下载语言包)'
                        : chromeAiStatus === 'downloading'
                          ? '语言包下载中…'
                          : '需 Chrome 138+ (已启用云端方案)'}
                  </strong>
                </span>
              </div>

              <button
                type="button"
                disabled={testing}
                onClick={() => void handleTestAll()}
                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-teal-400/40 bg-teal-500/15 py-2.5 text-xs font-semibold text-teal-200 transition hover:bg-teal-500/25 disabled:opacity-50"
              >
                <Activity
                  className={`h-4 w-4 ${testing ? 'animate-spin' : ''}`}
                />
                {testing ? t.testingConnection : t.testConnectionBtn}
              </button>

              {testResult && (
                <div className="flex flex-col gap-1.5 rounded-lg border border-slate-800 bg-slate-950/70 p-2.5 text-[11px]">
                  <div className="flex items-start gap-1.5">
                    {testResult.asrOk ? (
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-400" />
                    ) : (
                      <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
                    )}
                    <div>
                      <span className="font-medium text-slate-200">
                        语音识别：
                      </span>
                      <span
                        className={
                          testResult.asrOk ? 'text-teal-300' : 'text-rose-300'
                        }
                      >
                        {testResult.asrMessage}
                        {testResult.asrLatencyMs !== undefined &&
                        testResult.asrLatencyMs > 0
                          ? ` (${testResult.asrLatencyMs}ms)`
                          : ''}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-start gap-1.5">
                    {testResult.translatorOk ? (
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-400" />
                    ) : (
                      <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
                    )}
                    <div>
                      <span className="font-medium text-slate-200">
                        字幕翻译：
                      </span>
                      <span
                        className={
                          testResult.translatorOk
                            ? 'text-teal-300'
                            : 'text-rose-300'
                        }
                      >
                        {testResult.translatorMessage}
                        {testResult.translatorLatencyMs !== undefined &&
                        testResult.translatorLatencyMs > 0
                          ? ` (${testResult.translatorLatencyMs}ms)`
                          : ''}
                      </span>
                      {testResult.translatorSample && (
                        <div className="mt-1 rounded bg-slate-900 px-2 py-1 text-slate-300">
                          样句译文：{testResult.translatorSample}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* Auto-Start on Checked Video Sites */}
            <section className="glass-card flex flex-col gap-2.5 rounded-xl p-3.5">
              <label className="flex cursor-pointer items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-white">
                    {t.autoStartTitle}
                  </div>
                  <p className="mt-0.5 text-[10px] text-slate-400">
                    {t.autoStartDesc}
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={Boolean(autoStart.enabled)}
                  onChange={(e) => {
                    void updateSettings({
                      autoStart: {
                        ...autoStart,
                        enabled: e.target.checked,
                      },
                    });
                    flashSaved();
                  }}
                  className="h-4 w-4 shrink-0 accent-teal-400"
                />
              </label>

              <div className="grid grid-cols-2 gap-1.5">
                {PRESET_VIDEO_SITES.map((site) => {
                  const checked = enabledSiteIds.includes(site.id);
                  return (
                    <label
                      key={site.id}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition ${
                        checked
                          ? 'border-teal-400/50 bg-teal-500/15 text-teal-200'
                          : 'border-slate-800 bg-slate-900/70 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePresetSite(site.id)}
                        className="h-3.5 w-3.5 accent-teal-400"
                      />
                      <span className="truncate">
                        {locale === 'zh' ? site.nameZh : site.nameEn}
                      </span>
                    </label>
                  );
                })}
              </div>

              {/* Custom Domain Input */}
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={customDomainInput}
                  placeholder={t.autoStartCustomPlaceholder}
                  onChange={(e) => setCustomDomainInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddCustomDomain();
                  }}
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white placeholder-slate-500 outline-none focus:border-teal-400"
                />
                <button
                  type="button"
                  onClick={handleAddCustomDomain}
                  className="cursor-pointer rounded-lg border border-teal-500/40 bg-teal-500/15 px-3 py-1.5 text-xs font-medium text-teal-200 hover:bg-teal-500/25"
                >
                  {t.autoStartAdd}
                </button>
              </div>

              {customDomains.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {customDomains.map((domain) => (
                    <span
                      key={domain}
                      className="inline-flex items-center gap-1 rounded-full border border-indigo-400/40 bg-indigo-500/15 px-2 py-0.5 text-[10px] font-medium text-indigo-200"
                    >
                      {domain}
                      <button
                        type="button"
                        onClick={() => handleRemoveCustomDomain(domain)}
                        className="cursor-pointer text-indigo-300 hover:text-white"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <p className="text-[10px] leading-relaxed text-slate-400">
                {t.autoStartMv3Note}
              </p>
            </section>

            {/* Languages & VAD */}
            <section className="glass-card flex flex-col gap-3 rounded-xl p-3.5">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-300">
                    {t.sourceLang}
                  </label>
                  <select
                    value={settings.sourceLanguage}
                    onChange={(e) => {
                      void updateSettings({ sourceLanguage: e.target.value });
                      flashSaved();
                    }}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-white outline-none focus:border-teal-400"
                  >
                    <option value="auto">{t.autoDetect}</option>
                    <option value="en">English</option>
                    <option value="ja">日本語</option>
                    <option value="ko">한국어</option>
                    <option value="zh">中文</option>
                    <option value="es">Español</option>
                    <option value="fr">Français</option>
                    <option value="de">Deutsch</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-300">
                    {t.targetLang}
                  </label>
                  <select
                    value={settings.targetLanguage}
                    onChange={(e) => {
                      void updateSettings({ targetLanguage: e.target.value });
                      flashSaved();
                    }}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-white outline-none focus:border-teal-400"
                  >
                    <option value="zh-CN">简体中文</option>
                    <option value="zh-TW">繁體中文</option>
                    <option value="en">English</option>
                    <option value="ja">日本語</option>
                    <option value="ko">한국어</option>
                    <option value="es">Español</option>
                    <option value="fr">Français</option>
                    <option value="de">Deutsch</option>
                  </select>
                </div>
              </div>

              <SliderRow
                label={t.vadSensitivity}
                valueLabel={`${settings.vadThresholdDb} dB`}
                min={-55}
                max={-24}
                step={1}
                value={settings.vadThresholdDb}
                onChange={(v) => void updateSettings({ vadThresholdDb: v })}
              />

              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-300">
                  {t.uiLanguage}
                </label>
                <select
                  value={settings.uiLocale}
                  onChange={(e) =>
                    void updateSettings({
                      uiLocale: e.target.value as UiLocale,
                    })
                  }
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-white outline-none focus:border-teal-400"
                >
                  <option value="auto">{t.autoDetect}</option>
                  <option value="zh">简体中文</option>
                  <option value="en">English</option>
                </select>
              </div>
            </section>

            {/* Collapsible Advanced Custom Engines */}
            <section className="glass-card rounded-xl">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex w-full cursor-pointer items-center justify-between px-3.5 py-3 text-left text-xs font-medium text-slate-300 hover:text-white"
              >
                <span>{t.advancedSettings}</span>
                {showAdvanced ? (
                  <ChevronUp className="h-4 w-4 shrink-0" />
                ) : (
                  <ChevronDown className="h-4 w-4 shrink-0" />
                )}
              </button>

              {showAdvanced && (
                <div className="flex flex-col gap-3 border-t border-slate-800 px-3.5 py-3">
                  {/* Fine-grained ASR selector */}
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-teal-300">
                      {t.asrEngine}
                    </label>
                    <select
                      value={settings.asrProvider}
                      onChange={(e) => {
                        void updateSettings({
                          asrProvider: e.target.value as AsrProviderId,
                        });
                        flashSaved();
                      }}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-white outline-none focus:border-teal-400"
                    >
                      <option value="siliconflow">{t.providerSiliconflow}</option>
                      <option value="local-ws">{t.providerLocalWs}</option>
                      <option value="groq">{t.providerGroq}</option>
                      <option value="dashscope">{t.providerDashscope}</option>
                      <option value="deepgram">{t.providerDeepgram}</option>
                      <option value="demo">{t.providerDemo}</option>
                    </select>
                  </div>

                  {settings.asrProvider === 'dashscope' && (
                    <>
                      <TextField
                        label="阿里云百炼 DashScope API Key"
                        type="password"
                        value={settings.dashscopeApiKey}
                        placeholder={t.apiKeyPlaceholder}
                        onChange={(v) => {
                          void updateSettings({ dashscopeApiKey: v });
                          flashSaved();
                        }}
                      />
                      <TextField
                        label={t.modelName}
                        value={settings.dashscopeModel}
                        placeholder="paraformer-realtime-v2"
                        onChange={(v) =>
                          void updateSettings({ dashscopeModel: v })
                        }
                      />
                    </>
                  )}

                  {settings.asrProvider === 'deepgram' && (
                    <>
                      <TextField
                        label="Deepgram API Key"
                        type="password"
                        value={settings.deepgramApiKey}
                        placeholder={t.apiKeyPlaceholder}
                        onChange={(v) => {
                          void updateSettings({ deepgramApiKey: v });
                          flashSaved();
                        }}
                      />
                      <TextField
                        label={t.modelName}
                        value={settings.deepgramModel}
                        placeholder="nova-2"
                        onChange={(v) =>
                          void updateSettings({ deepgramModel: v })
                        }
                      />
                    </>
                  )}

                  {/* Fine-grained Translator selector */}
                  <div className="border-t border-slate-800 pt-3">
                    <label className="mb-1 block text-[11px] font-semibold text-indigo-300">
                      {t.translatorEngine}
                    </label>
                    <select
                      value={settings.translatorProvider}
                      onChange={(e) => {
                        void updateSettings({
                          translatorProvider: e.target
                            .value as TranslatorProviderId,
                        });
                        flashSaved();
                      }}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-white outline-none focus:border-teal-400"
                    >
                      <option value="free">{t.translatorFree}</option>
                      <option value="chrome-ai">{t.translatorChromeAi}</option>
                      <option value="tencent">{t.translatorTencent}</option>
                      <option value="llm">{t.translatorLlm}</option>
                      <option value="none">{t.translatorNone}</option>
                    </select>
                  </div>

                  {settings.translatorProvider === 'tencent' && (
                    <>
                      <TextField
                        label="腾讯云 SecretId（每月免费 500 万字符）"
                        value={settings.tencentSecretId}
                        placeholder="AKID..."
                        onChange={(v) => {
                          void updateSettings({ tencentSecretId: v });
                          flashSaved();
                        }}
                      />
                      <TextField
                        label="腾讯云 SecretKey"
                        type="password"
                        value={settings.tencentSecretKey}
                        placeholder="SecretKey"
                        onChange={(v) => {
                          void updateSettings({ tencentSecretKey: v });
                          flashSaved();
                        }}
                      />
                    </>
                  )}

                  {settings.translatorProvider === 'llm' && (
                    <>
                      <div>
                        <label className="mb-1 block text-[11px] font-medium text-slate-300">
                          {t.llmPreset}
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                          {(Object.keys(LLM_PRESETS) as LlmPresetId[]).map(
                            (id) => (
                              <button
                                key={id}
                                type="button"
                                onClick={() => handleLlmPresetChange(id)}
                                className={`cursor-pointer rounded-lg border px-2 py-1 text-[11px] font-medium transition ${
                                  settings.llmPreset === id
                                    ? 'border-teal-400/60 bg-teal-500/20 text-teal-200'
                                    : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-white'
                                }`}
                              >
                                {LLM_PRESETS[id].label}
                                {LLM_PRESETS[id].badge
                                  ? ` · ${LLM_PRESETS[id].badge}`
                                  : ''}
                              </button>
                            )
                          )}
                        </div>
                      </div>

                      <TextField
                        label="LLM API Key"
                        type="password"
                        value={settings.llmApiKey}
                        placeholder={t.apiKeyPlaceholder}
                        onChange={(v) => {
                          void updateSettings({ llmApiKey: v });
                          flashSaved();
                        }}
                      />
                      <TextField
                        label={t.baseUrl}
                        value={settings.llmBaseUrl}
                        placeholder="https://api.deepseek.com/v1"
                        onChange={(v) => void updateSettings({ llmBaseUrl: v })}
                      />
                      <TextField
                        label={t.modelName}
                        value={settings.llmModel}
                        placeholder="deepseek-chat"
                        onChange={(v) => void updateSettings({ llmModel: v })}
                      />
                    </>
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
};

interface SliderRowProps {
  label: string;
  valueLabel: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}

const SliderRow: React.FC<SliderRowProps> = ({
  label,
  valueLabel,
  min,
  max,
  step,
  value,
  onChange,
}) => (
  <div>
    <div className="mb-1 flex items-center justify-between text-[11px]">
      <span className="text-slate-300">{label}</span>
      <span className="font-mono text-teal-300">{valueLabel}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-1.5 w-full cursor-pointer accent-teal-400"
    />
  </div>
);

interface TextFieldProps {
  label: string;
  value: string;
  placeholder?: string;
  type?: 'text' | 'password';
  onChange: (value: string) => void;
}

const TextField: React.FC<TextFieldProps> = ({
  label,
  value,
  placeholder,
  type = 'text',
  onChange,
}) => (
  <div>
    <label className="mb-1 block text-[11px] font-medium text-slate-300">
      {label}
    </label>
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-teal-400"
    />
  </div>
);
