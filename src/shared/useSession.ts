import { useCallback, useEffect, useState } from 'react';
import { runAllConnectionTests } from '../core/diagnostics/connection-tester';
import { getDictionary } from '../core/i18n';
import type {
  ConnectionTestResult,
  RuntimeMessage,
  RuntimeResponse,
} from '../types/messages';
import {
  DEFAULT_SETTINGS,
  type AppearanceSettings,
  type ExtensionSettings,
} from '../types/settings';
import {
  EMPTY_AUDIO_METRICS,
  INITIAL_SESSION_SNAPSHOT,
  type SessionSnapshot,
} from '../types/subtitle';
import {
  SETTINGS_KEY,
  loadSettings,
  mergeSettings,
  saveAppearance,
  saveSettings,
} from './storage';

function normalizeSnapshot(
  raw?: Partial<SessionSnapshot> | null
): SessionSnapshot {
  if (!raw || typeof raw !== 'object') {
    return {
      ...INITIAL_SESSION_SNAPSHOT,
      metrics: { ...EMPTY_AUDIO_METRICS },
      segments: [],
    };
  }
  return {
    ...INITIAL_SESSION_SNAPSHOT,
    ...raw,
    metrics: {
      ...EMPTY_AUDIO_METRICS,
      ...(raw.metrics ?? {}),
    },
    segments: Array.isArray(raw.segments) ? raw.segments : [],
  };
}

function sendMsg<T = unknown>(
  message: RuntimeMessage
): Promise<RuntimeResponse<T>> {
  return chrome.runtime.sendMessage(message);
}

export function useEchoSubSession() {
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(() =>
    normalizeSnapshot(INITIAL_SESSION_SNAPSHOT)
  );
  const [settings, setSettings] = useState<ExtensionSettings>(() =>
    mergeSettings(DEFAULT_SETTINGS)
  );
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    // Load directly from chrome.storage.local AND sync live snapshot from background SW.
    // Always pass settings through mergeSettings() so upgrading from older SW versions
    // missing newly added nested fields (e.g., autoStart) can never crash the UI.
    void Promise.all([
      loadSettings().catch(() => mergeSettings(DEFAULT_SETTINGS)),
      sendMsg<{ snapshot: SessionSnapshot; settings: ExtensionSettings }>({
        type: 'GET_SESSION_STATE',
      }).catch(() => null),
    ])
      .then(([storedSettings, res]) => {
        if (!active) return;
        const incomingSettings =
          res?.ok && res.data?.settings
            ? mergeSettings({ ...storedSettings, ...res.data.settings })
            : mergeSettings(storedSettings);
        setSettings(incomingSettings);
        if (res?.ok && res.data?.snapshot) {
          setSnapshot(normalizeSnapshot(res.data.snapshot));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const listener = (message: RuntimeMessage) => {
      if (message.type === 'SESSION_SNAPSHOT') {
        setSnapshot(normalizeSnapshot(message.snapshot));
      }
    };
    const storageListener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName === 'local' && changes[SETTINGS_KEY]?.newValue) {
        setSettings(
          mergeSettings(
            changes[SETTINGS_KEY].newValue as Partial<ExtensionSettings>
          )
        );
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    chrome.storage?.onChanged?.addListener(storageListener);
    return () => {
      active = false;
      chrome.runtime.onMessage.removeListener(listener);
      chrome.storage?.onChanged?.removeListener(storageListener);
    };
  }, []);

  const startCapture = useCallback(async () => {
    setActionError(null);
    const res = await sendMsg<SessionSnapshot>({ type: 'CAPTURE_START' });
    if (!res?.ok) {
      setActionError(res?.error || '启动捕获失败，请刷新扩展后重试。');
    }
  }, []);

  const stopCapture = useCallback(async () => {
    setActionError(null);
    await sendMsg({ type: 'CAPTURE_STOP' });
  }, []);

  const toggleOverlay = useCallback(async () => {
    await sendMsg({ type: 'TOGGLE_OVERLAY' });
  }, []);

  const openSidePanel = useCallback(async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.windowId !== undefined && chrome.sidePanel?.open) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    } else {
      await sendMsg({ type: 'OPEN_SIDEPANEL', tabId: tab?.id });
    }
  }, []);

  const clearTranscript = useCallback(async () => {
    await sendMsg({ type: 'CLEAR_TRANSCRIPT' });
  }, []);

  const resetSpeakers = useCallback(async () => {
    await sendMsg({ type: 'RESET_SPEAKERS' });
  }, []);

  const updateSettings = useCallback(
    async (patch: Partial<ExtensionSettings>) => {
      setSettings((prev) =>
        mergeSettings({
          ...prev,
          ...patch,
          autoStart: patch.autoStart
            ? { ...prev.autoStart, ...patch.autoStart }
            : prev.autoStart,
          appearance: patch.appearance
            ? {
                ...prev.appearance,
                ...patch.appearance,
                position: patch.appearance.position
                  ? { ...prev.appearance.position, ...patch.appearance.position }
                  : prev.appearance.position,
              }
            : prev.appearance,
        })
      );
      // Persist directly to chrome.storage.local immediately so keys are never lost
      const persisted = await saveSettings(patch);
      setSettings(persisted);
      // Notify background SW (non-blocking)
      void sendMsg<ExtensionSettings>({
        type: 'UPDATE_SETTINGS',
        patch,
      }).catch(() => {});
    },
    []
  );

  const updateAppearance = useCallback(
    async (patch: Partial<AppearanceSettings>) => {
      setSettings((prev) => ({
        ...prev,
        appearance: {
          ...prev.appearance,
          ...patch,
          position: patch.position
            ? { ...prev.appearance.position, ...patch.position }
            : prev.appearance.position,
        },
      }));
      const persisted = await saveAppearance(patch);
      setSettings(persisted);
      void sendMsg<ExtensionSettings>({
        type: 'UPDATE_APPEARANCE',
        patch,
      }).catch(() => {});
    },
    []
  );

  const generateSummary = useCallback(async (): Promise<string> => {
    const res = await sendMsg<string>({ type: 'GENERATE_SUMMARY' });
    if (!res?.ok || !res.data) {
      throw new Error(res?.error || '生成 AI 总结失败。');
    }
    return res.data;
  }, []);

  const testConnections = useCallback(
    async (overrideSettings?: ExtensionSettings): Promise<ConnectionTestResult> => {
      const target = overrideSettings ?? (await loadSettings());
      return runAllConnectionTests(target);
    },
    []
  );

  const { locale, t } = getDictionary(settings.uiLocale);

  return {
    snapshot,
    settings,
    loading,
    actionError: actionError || snapshot.errorMessage,
    locale,
    t,
    startCapture,
    stopCapture,
    toggleOverlay,
    openSidePanel,
    clearTranscript,
    resetSpeakers,
    updateSettings,
    updateAppearance,
    generateSummary,
    testConnections,
  };
}
