import {
  combineTestResults,
  testAsrConnection,
  testTranslatorConnection,
} from '../core/diagnostics/connection-tester';
import { getDictionary } from '../core/i18n';
import { matchAutoStartSite } from '../core/sites/auto-start';
import { isAlreadyInTargetLanguage } from '../core/translator/language-detect';
import { generateAiSummary } from '../core/translator/llm-openai';
import { logger } from '../shared/logger';
import { loadSettings, saveAppearance, saveSettings } from '../shared/storage';
import type {
  ConnectionTestResult,
  RuntimeMessage,
  RuntimeResponse,
} from '../types/messages';
import type { ExtensionSettings } from '../types/settings';
import {
  EMPTY_AUDIO_METRICS,
  INITIAL_SESSION_SNAPSHOT,
  type SessionSnapshot,
} from '../types/subtitle';

const OFFSCREEN_PATH = 'offscreen.html';
const DASHSCOPE_DNR_RULE_ID = 9401;
const MAX_SEGMENTS = 600;

let snapshot: SessionSnapshot = {
  ...INITIAL_SESSION_SNAPSHOT,
  metrics: { ...EMPTY_AUDIO_METRICS },
  segments: [],
};

let currentSettings: ExtensionSettings | null = null;
let creatingOffscreen: Promise<void> | null = null;
let trackResumeAudioTimer: ReturnType<typeof setTimeout> | null = null;
let lastAutoTriggeredKey = '';

async function getSettings(forceReload = false): Promise<ExtensionSettings> {
  if (!currentSettings || forceReload) {
    currentSettings = await loadSettings();
  }
  return currentSettings;
}

function isRestrictedUrl(url?: string): boolean {
  if (!url) return true;
  return (
    url.startsWith('chrome://') ||
    url.startsWith('edge://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('about:') ||
    url.startsWith('https://chromewebstore.google.com/') ||
    url.startsWith('https://microsoftedge.microsoft.com/addons')
  );
}

async function closeOffscreenDocument(): Promise<void> {
  try {
    if (chrome.offscreen?.closeDocument) {
      await chrome.offscreen.closeDocument();
    }
  } catch {
    // Ignore if no offscreen document exists
  }
}

async function sendOffscreenMessageWithRetry<T = unknown>(
  message: RuntimeMessage,
  retries = 5
): Promise<RuntimeResponse<T> | undefined> {
  let lastErr: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return (await chrome.runtime.sendMessage(message)) as
        | RuntimeResponse<T>
        | undefined;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Receiving end does not exist') && i < retries - 1) {
        await new Promise((r) => setTimeout(r, 80));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function ensureOffscreenDocument(forceFresh = false): Promise<void> {
  if (forceFresh) {
    await closeOffscreenDocument();
  }
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });
    if (contexts.length > 0) return;
  } catch {
    // Fall through and create document
  }

  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_PATH,
        reasons: [
          chrome.offscreen.Reason.USER_MEDIA,
          chrome.offscreen.Reason.AUDIO_PLAYBACK,
        ],
        justification:
          'Capture active tab audio for real-time speech recognition while keeping original audio playback unmuted, and run window-scoped built-in translation.',
      })
      .finally(() => {
        creatingOffscreen = null;
      });
  }

  await creatingOffscreen;
}

async function syncDashScopeAuthRule(settings: ExtensionSettings): Promise<void> {
  try {
    if (
      settings.asrProvider === 'dashscope' &&
      settings.dashscopeApiKey.trim()
    ) {
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [DASHSCOPE_DNR_RULE_ID],
        addRules: [
          {
            id: DASHSCOPE_DNR_RULE_ID,
            priority: 1,
            action: {
              type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
              requestHeaders: [
                {
                  header: 'Authorization',
                  operation: chrome.declarativeNetRequest.HeaderOperation.SET,
                  value: `Bearer ${settings.dashscopeApiKey.trim()}`,
                },
              ],
            },
            condition: {
              urlFilter: '||dashscope.aliyuncs.com/',
              resourceTypes: [
                chrome.declarativeNetRequest.ResourceType.WEBSOCKET,
              ],
            },
          },
        ],
      });
    } else {
      await clearDashScopeAuthRule();
    }
  } catch (err) {
    logger.warn('Background', 'Failed to configure DashScope DNR rule:', err);
  }
}

async function clearDashScopeAuthRule(): Promise<void> {
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [DASHSCOPE_DNR_RULE_ID],
    });
  } catch {
    // Ignore
  }
}

async function updateBadge(status: SessionSnapshot['status']): Promise<void> {
  try {
    if (status === 'running') {
      const label = snapshot.autoStartHint
        ? 'AUTO'
        : snapshot.activeInputSource === 'track'
          ? 'CC'
          : 'LIVE';
      await chrome.action.setBadgeText({ text: label });
      await chrome.action.setBadgeBackgroundColor({
        color:
          snapshot.autoStartHint || snapshot.activeInputSource === 'track'
            ? '#4f46e5'
            : '#0d9488',
      });
    } else if (status === 'reconnecting' || status === 'starting') {
      await chrome.action.setBadgeText({ text: '...' });
      await chrome.action.setBadgeBackgroundColor({ color: '#d97706' });
    } else if (status === 'error') {
      await chrome.action.setBadgeText({ text: 'ERR' });
      await chrome.action.setBadgeBackgroundColor({ color: '#e11d48' });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch {
    // Ignore
  }
}

function broadcastSnapshotToUi(): void {
  const msg: RuntimeMessage = { type: 'SESSION_SNAPSHOT', snapshot };
  chrome.runtime.sendMessage(msg).catch(() => {});
}

async function syncOverlayToTab(
  tabId: number | null,
  attemptInject = false
): Promise<void> {
  if (tabId === null) return;
  const settings = await getSettings();
  const lastSegment =
    snapshot.segments.length > 0
      ? snapshot.segments[snapshot.segments.length - 1]
      : null;

  const payload: RuntimeMessage = {
    type: 'CONTENT_SYNC',
    activeCaption: snapshot.activeCaption,
    lastSegment,
    status: snapshot.status,
    captureMode: snapshot.captureMode,
    activeInputSource: snapshot.activeInputSource,
    overlayVisible: snapshot.overlayVisible,
    autoStartHint: snapshot.autoStartHint,
    appearance: settings.appearance,
    errorMessage: snapshot.errorMessage,
  };

  try {
    await chrome.tabs.sendMessage(tabId, payload);
  } catch {
    if (!attemptInject) return;
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content-scripts/content.js'],
      });
      await chrome.tabs.sendMessage(tabId, payload);
    } catch (injectErr) {
      logger.warn('Background', 'Unable to inject content script into tab:', injectErr);
    }
  }
}

async function broadcastAll(attemptInject = false): Promise<void> {
  broadcastSnapshotToUi();
  await syncOverlayToTab(snapshot.tabId, attemptInject);
}

async function getTargetTab(explicitTabId?: number): Promise<chrome.tabs.Tab | null> {
  if (explicitTabId !== undefined) {
    try {
      return await chrome.tabs.get(explicitTabId);
    } catch {
      return null;
    }
  }
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  return tab ?? null;
}

function requestTabStreamId(targetTabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId }, (streamId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!streamId) {
        reject(new Error('Chrome returned an empty media stream ID.'));
        return;
      }
      resolve(streamId);
    });
  });
}

async function startCapture(
  explicitTabId?: number,
  options?: { autoStartSiteName?: string }
): Promise<RuntimeResponse> {
  const settings = await getSettings(true);
  const tab = await getTargetTab(explicitTabId);

  if (!tab?.id) {
    return { ok: false, error: '未找到可捕获的活动标签页。' };
  }

  if (isRestrictedUrl(tab.url)) {
    return {
      ok: false,
      error:
        '浏览器内置页面（chrome:// / edge:// / 应用商店）不支持注入字幕，请先打开 YouTube、B站 或任意视频网页。',
    };
  }

  if (snapshot.status !== 'idle') {
    await stopCapture();
  }

  const startedAt = Date.now();
  let trackOnly = settings.captureMode === 'track';
  let autoStartHint: string | null = null;
  const isAutoStart = Boolean(options?.autoStartSiteName);

  snapshot = {
    ...snapshot,
    status: 'starting',
    tabId: tab.id,
    tabTitle: tab.title ?? 'Untitled Tab',
    tabUrl: tab.url ?? '',
    startedAt,
    captureMode: settings.captureMode,
    activeInputSource: trackOnly
      ? 'track'
      : settings.asrProvider === 'demo'
        ? 'demo'
        : 'audio',
    trackDetected: false,
    asrProvider: settings.asrProvider,
    translatorProvider: settings.translatorProvider,
    overlayVisible: true,
    autoStartHint: null,
    errorMessage: null,
    latencyMs: null,
    activeCaption: null,
    metrics: { ...EMPTY_AUDIO_METRICS },
  };
  await updateBadge('starting');
  await broadcastAll(true);

  let streamId: string | null = null;
  if (!trackOnly) {
    try {
      streamId = await requestTabStreamId(tab.id);
    } catch (err) {
      if (isAutoStart) {
        // Chrome MV3 requires a user gesture (activeTab) for raw tab audio capture.
        // Gracefully auto-start native Track Mode immediately + prompt 1-key audio wake!
        trackOnly = true;
        const { locale } = getDictionary(settings.uiLocale);
        autoStartHint =
          locale === 'zh'
            ? `已自动识别 ${options!.autoStartSiteName} · 字幕轨直译已开启；若为无字幕生肉视频，按 Alt+Shift+S 或点右上角 EchoSub 图标授权音频识别`
            : `Auto-detected ${options!.autoStartSiteName} · Track translation active; press Alt+Shift+S or click EchoSub icon to enable live audio ASR`;
        snapshot = {
          ...snapshot,
          activeInputSource: 'track',
          autoStartHint,
        };
      } else if (settings.asrProvider !== 'demo') {
        const message =
          err instanceof Error
            ? err.message
            : 'Failed to capture tab audio stream.';
        snapshot = {
          ...snapshot,
          status: 'error',
          errorMessage: `标签页音频捕获失败：${message}`,
        };
        await updateBadge('error');
        await broadcastAll();
        return { ok: false, error: snapshot.errorMessage ?? message };
      } else {
        logger.warn(
          'Background',
          'tabCapture unavailable in Demo mode; continuing with demo stream:',
          err
        );
      }
    }
  }

  try {
    if (!trackOnly) {
      await syncDashScopeAuthRule(settings);
    }
    // Always open a clean fresh Offscreen document on new capture start to prevent stale state
    await ensureOffscreenDocument(true);
    const res = await sendOffscreenMessageWithRetry({
      type: 'OFFSCREEN_START',
      streamId,
      tabId: tab.id,
      settings,
      startedAt,
      trackOnly,
    } satisfies RuntimeMessage);

    if (res && !res.ok) {
      throw new Error(res.error || 'Offscreen pipeline failed to start.');
    }

    return { ok: true, data: snapshot };
  } catch (err) {
    const message =
      err instanceof TypeError && err.stack
        ? `${err.message} (${err.stack.split('\n')[1]?.trim() ?? ''})`
        : err instanceof Error
          ? err.message
          : String(err);
    await clearDashScopeAuthRule();
    await closeOffscreenDocument();
    snapshot = {
      ...snapshot,
      status: 'error',
      errorMessage: message,
    };
    await updateBadge('error');
    await broadcastAll();
    return { ok: false, error: message };
  }
}

async function stopCapture(): Promise<RuntimeResponse> {
  const prevTabId = snapshot.tabId;
  if (trackResumeAudioTimer) {
    clearTimeout(trackResumeAudioTimer);
    trackResumeAudioTimer = null;
  }

  try {
    await chrome.runtime.sendMessage({
      type: 'OFFSCREEN_STOP',
    } satisfies RuntimeMessage);
  } catch {
    // Offscreen document may not exist
  }

  await closeOffscreenDocument();
  await clearDashScopeAuthRule();

  snapshot = {
    ...snapshot,
    status: 'idle',
    activeInputSource: 'idle',
    trackDetected: false,
    activeCaption: null,
    autoStartHint: null,
    errorMessage: null,
    latencyMs: null,
    metrics: { ...EMPTY_AUDIO_METRICS },
  };

  await updateBadge('idle');
  broadcastSnapshotToUi();
  await syncOverlayToTab(prevTabId);
  return { ok: true, data: snapshot };
}

async function runConnectionTests(): Promise<ConnectionTestResult> {
  const settings = await getSettings();
  const asrResult = await testAsrConnection(settings);

  // Run translator test inside Offscreen Window context so Chrome 138+ `self.Translator` works cleanly!
  let transResult: {
    ok: boolean;
    message: string;
    sample?: string;
    latencyMs?: number;
  };
  try {
    await ensureOffscreenDocument();
    const res = (await chrome.runtime.sendMessage({
      type: 'OFFSCREEN_TEST_TRANSLATOR',
      settings,
    } satisfies RuntimeMessage)) as RuntimeResponse<{
      ok: boolean;
      message: string;
      sample?: string;
      latencyMs?: number;
    }>;
    if (res?.ok && res.data) {
      transResult = res.data;
    } else {
      transResult = await testTranslatorConnection(settings);
    }
  } catch {
    transResult = await testTranslatorConnection(settings);
  }

  return combineTestResults(asrResult, transResult);
}

async function maybeAutoStartTab(tabId: number, url?: string): Promise<void> {
  if (!url || isRestrictedUrl(url)) return;
  const settings = await getSettings(true);
  if (!settings.autoStart?.enabled) return;

  const { locale } = getDictionary(settings.uiLocale);
  const match = matchAutoStartSite(url, settings.autoStart, locale);
  if (!match) return;

  // Do not disrupt an already running capture on this tab unless URL navigated to a new video
  const key = `${tabId}:${url.split('#')[0]}`;
  if (key === lastAutoTriggeredKey) return;
  if (snapshot.status === 'running' && snapshot.tabId === tabId && !snapshot.autoStartHint) {
    lastAutoTriggeredKey = key;
    return;
  }

  lastAutoTriggeredKey = key;
  logger.info('Background', `Auto-starting EchoSub for matched site: ${match.siteName}`);
  await startCapture(tabId, { autoStartSiteName: match.siteName });
}

export default defineBackground(() => {
  logger.info('Background', 'Service worker initialized');

  chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'toggle-capture') {
      if (
        snapshot.status === 'idle' ||
        snapshot.status === 'error' ||
        Boolean(snapshot.autoStartHint)
      ) {
        await startCapture();
      } else {
        await stopCapture();
      }
    } else if (command === 'toggle-overlay') {
      snapshot = {
        ...snapshot,
        overlayVisible: !snapshot.overlayVisible,
      };
      await broadcastAll();
    }
  });

  chrome.tabs.onRemoved.addListener((closedTabId) => {
    if (lastAutoTriggeredKey.startsWith(`${closedTabId}:`)) {
      lastAutoTriggeredKey = '';
    }
    if (snapshot.tabId === closedTabId && snapshot.status !== 'idle') {
      void stopCapture();
    }
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tabId === snapshot.tabId && changeInfo.status === 'complete') {
      if (tab.title) snapshot.tabTitle = tab.title;
      if (tab.url) snapshot.tabUrl = tab.url;
      void syncOverlayToTab(tabId, true);
    }

    // Trigger auto-start on both full loads AND SPA video navigation (YouTube / Bilibili)
    if (
      (changeInfo.status === 'complete' || typeof changeInfo.url === 'string') &&
      tab.active &&
      tab.url
    ) {
      void maybeAutoStartTab(tabId, tab.url);
    }
  });

  chrome.tabs.onActivated.addListener(({ tabId }) => {
    void chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.url) {
          return maybeAutoStartTab(tabId, tab.url);
        }
      })
      .catch(() => {});
  });

  const BACKGROUND_MESSAGE_TYPES = new Set<RuntimeMessage['type']>([
    'GET_SESSION_STATE',
    'CAPTURE_START',
    'CAPTURE_STOP',
    'CLEAR_TRANSCRIPT',
    'RESET_SPEAKERS',
    'TOGGLE_OVERLAY',
    'OPEN_SIDEPANEL',
    'UPDATE_SETTINGS',
    'UPDATE_APPEARANCE',
    'GENERATE_SUMMARY',
    'TEST_CONNECTIONS',
    'CONTENT_TRACK_STATUS',
    'CONTENT_TRACK_CUE',
    'OFFSCREEN_STATUS',
    'OFFSCREEN_AUDIO_METRICS',
    'OFFSCREEN_CAPTION_UPDATE',
    'OFFSCREEN_SEGMENT_FINAL',
    'OFFSCREEN_SEGMENT_TRANSLATED',
  ]);

  chrome.runtime.onMessage.addListener(
    (
      message: RuntimeMessage,
      sender,
      sendResponse: (response: RuntimeResponse) => void
    ) => {
      if (!message?.type || !BACKGROUND_MESSAGE_TYPES.has(message.type)) {
        return false;
      }

      void (async () => {
        try {
          switch (message.type) {
            case 'GET_SESSION_STATE': {
              const settings = await getSettings(true);
              sendResponse({ ok: true, data: { snapshot, settings } });
              return;
            }

            case 'CAPTURE_START': {
              const res = await startCapture(message.tabId);
              sendResponse(res);
              return;
            }

            case 'CAPTURE_STOP': {
              const res = await stopCapture();
              sendResponse(res);
              return;
            }

            case 'CLEAR_TRANSCRIPT': {
              snapshot = {
                ...snapshot,
                segments: [],
                activeCaption: null,
              };
              await broadcastAll();
              sendResponse({ ok: true });
              return;
            }

            case 'RESET_SPEAKERS': {
              chrome.runtime
                .sendMessage({
                  type: 'OFFSCREEN_RESET_SPEAKERS',
                } satisfies RuntimeMessage)
                .catch(() => {});
              sendResponse({ ok: true });
              return;
            }

            case 'TOGGLE_OVERLAY': {
              snapshot = {
                ...snapshot,
                overlayVisible:
                  message.visible !== undefined
                    ? message.visible
                    : !snapshot.overlayVisible,
              };
              await broadcastAll(true);
              sendResponse({ ok: true, data: snapshot.overlayVisible });
              return;
            }

            case 'OPEN_SIDEPANEL': {
              const tab = await getTargetTab(message.tabId);
              if (tab?.windowId !== undefined && chrome.sidePanel?.open) {
                await chrome.sidePanel.open({ windowId: tab.windowId });
              }
              sendResponse({ ok: true });
              return;
            }

            case 'UPDATE_SETTINGS': {
              const prevProvider = currentSettings?.asrProvider;
              const prevCaptureMode = currentSettings?.captureMode;
              const next = await saveSettings(message.patch);
              currentSettings = next;
              const isRunning = snapshot.status !== 'idle';
              snapshot = {
                ...snapshot,
                captureMode: next.captureMode,
                asrProvider: next.asrProvider,
                translatorProvider: next.translatorProvider,
                activeInputSource: isRunning
                  ? next.captureMode === 'track'
                    ? 'track'
                    : snapshot.activeInputSource === 'track' &&
                        next.captureMode === 'auto'
                      ? 'track'
                      : next.asrProvider === 'demo'
                        ? 'demo'
                        : 'audio'
                  : 'idle',
              };
              if (isRunning) {
                await syncDashScopeAuthRule(next);
                if (prevCaptureMode !== next.captureMode && snapshot.tabId !== null) {
                  await startCapture(snapshot.tabId);
                } else {
                  const res = (await chrome.runtime
                    .sendMessage({
                      type: 'OFFSCREEN_UPDATE_SETTINGS',
                      settings: next,
                    } satisfies RuntimeMessage)
                    .catch(() => null)) as
                    | RuntimeResponse<{ needsRestart?: boolean }>
                    | null;
                  if (
                    res?.data?.needsRestart &&
                    snapshot.tabId !== null &&
                    prevProvider === 'demo'
                  ) {
                    await startCapture(snapshot.tabId);
                  }
                }
              }
              await broadcastAll();
              sendResponse({ ok: true, data: next });
              return;
            }

            case 'UPDATE_APPEARANCE': {
              const next = await saveAppearance(message.patch);
              currentSettings = next;
              await syncOverlayToTab(snapshot.tabId);
              broadcastSnapshotToUi();
              sendResponse({ ok: true, data: next });
              return;
            }

            case 'GENERATE_SUMMARY': {
              const settings = await getSettings();
              const { locale } = getDictionary(settings.uiLocale);
              const markdown = await generateAiSummary(
                snapshot.segments,
                settings,
                locale
              );
              sendResponse({ ok: true, data: markdown });
              return;
            }

            case 'TEST_CONNECTIONS': {
              const result = await runConnectionTests();
              sendResponse({ ok: true, data: result });
              return;
            }

            // Hybrid Video Subtitle Track events from Content Script
            case 'CONTENT_TRACK_STATUS': {
              if (sender.tab?.id !== snapshot.tabId) {
                sendResponse({ ok: true });
                return;
              }
              snapshot = { ...snapshot, trackDetected: message.available };
              broadcastSnapshotToUi();
              sendResponse({ ok: true });
              return;
            }

            case 'CONTENT_TRACK_CUE': {
              if (
                sender.tab?.id !== snapshot.tabId ||
                snapshot.status === 'idle' ||
                snapshot.captureMode === 'audio'
              ) {
                sendResponse({ ok: true });
                return;
              }

              // In Hybrid Auto mode, ignore native tracks that are ALREADY in targetLanguage
              // (e.g. Bilibili AI Chinese subtitles on English videos) so Audio ASR delivers real bilingual captions!
              const activeSettings = await getSettings();
              if (
                snapshot.captureMode === 'auto' &&
                isAlreadyInTargetLanguage(
                  message.text,
                  'auto',
                  activeSettings.targetLanguage
                )
              ) {
                sendResponse({ ok: true });
                return;
              }

              // In Hybrid Auto mode, pause audio ASR while live native captions are streaming!
              if (snapshot.activeInputSource !== 'track') {
                snapshot = {
                  ...snapshot,
                  activeInputSource: 'track',
                  trackDetected: true,
                };
                await updateBadge('running');
                chrome.runtime
                  .sendMessage({
                    type: 'OFFSCREEN_SET_AUDIO_ASR_PAUSED',
                    paused: true,
                  } satisfies RuntimeMessage)
                  .catch(() => {});
                broadcastSnapshotToUi();
              }

              if (snapshot.captureMode === 'auto') {
                if (trackResumeAudioTimer) clearTimeout(trackResumeAudioTimer);
                trackResumeAudioTimer = setTimeout(() => {
                  if (
                    snapshot.status === 'running' &&
                    snapshot.captureMode === 'auto'
                  ) {
                    snapshot = {
                      ...snapshot,
                      activeInputSource:
                        snapshot.asrProvider === 'demo' ? 'demo' : 'audio',
                    };
                    void updateBadge('running');
                    chrome.runtime
                      .sendMessage({
                        type: 'OFFSCREEN_SET_AUDIO_ASR_PAUSED',
                        paused: false,
                      } satisfies RuntimeMessage)
                      .catch(() => {});
                    broadcastSnapshotToUi();
                  }
                }, 7000);
              }

              const elapsedMs = snapshot.startedAt
                ? Math.max(0, Date.now() - snapshot.startedAt)
                : 0;
              chrome.runtime
                .sendMessage({
                  type: 'OFFSCREEN_TRACK_CUE',
                  text: message.text,
                  isFinal: message.isFinal,
                  elapsedMs,
                  language: message.language,
                } satisfies RuntimeMessage)
                .catch(() => {});
              sendResponse({ ok: true });
              return;
            }

            // Messages from Offscreen Document
            case 'OFFSCREEN_STATUS': {
              snapshot = {
                ...snapshot,
                status: message.status,
                errorMessage:
                  message.errorMessage !== undefined
                    ? message.errorMessage
                    : snapshot.errorMessage,
              };
              await updateBadge(snapshot.status);
              await broadcastAll();
              sendResponse({ ok: true });
              return;
            }

            case 'OFFSCREEN_AUDIO_METRICS': {
              snapshot = {
                ...snapshot,
                metrics: message.metrics,
              };
              broadcastSnapshotToUi();
              sendResponse({ ok: true });
              return;
            }

            case 'OFFSCREEN_CAPTION_UPDATE': {
              snapshot = {
                ...snapshot,
                activeCaption: message.activeCaption,
                latencyMs:
                  message.latencyMs !== undefined
                    ? message.latencyMs
                    : snapshot.latencyMs,
              };
              await broadcastAll();
              sendResponse({ ok: true });
              return;
            }

            case 'OFFSCREEN_SEGMENT_FINAL': {
              const segments = [...snapshot.segments, message.segment];
              if (segments.length > MAX_SEGMENTS) {
                segments.splice(0, segments.length - MAX_SEGMENTS);
              }
              snapshot = {
                ...snapshot,
                activeCaption: null,
                segments,
                latencyMs:
                  message.latencyMs !== undefined
                    ? message.latencyMs
                    : snapshot.latencyMs,
              };
              await broadcastAll();
              sendResponse({ ok: true });
              return;
            }

            case 'OFFSCREEN_SEGMENT_TRANSLATED': {
              snapshot = {
                ...snapshot,
                segments: snapshot.segments.map((seg) =>
                  seg.id === message.segmentId
                    ? {
                        ...seg,
                        translatedText: message.translatedText,
                        delayMs:
                          message.delayMs !== undefined
                            ? message.delayMs
                            : seg.delayMs,
                      }
                    : seg
                ),
              };
              await broadcastAll();
              sendResponse({ ok: true });
              return;
            }

            default:
              sendResponse({ ok: true });
          }
        } catch (err) {
          logger.error('Background', 'Message handler error:', err);
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })();
      return true;
    }
  );
});
