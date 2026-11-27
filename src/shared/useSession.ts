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
  INITIAL_SESSION_SNAPSHOT,
  type SessionSnapshot,
} from '../types/subtitle';
import { loadSettings, saveAppearance, saveSettings } from './storage';

function sendMsg<T = unknown>(
  message: RuntimeMessage
): Promise<RuntimeResponse<T>> {
  return chrome.runtime.sendMessage(message);
}

export function useEchoSubSession() {
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(
    INITIAL_SESSION_SNAPSHOT
  );
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    // Load directly from chrome.storage.local AND sync live snapshot from background SW
    void Promise.all([
      loadSettings().catch(() => DEFAULT_SETTINGS),
      sendMsg<{ snapshot: SessionSnapshot; settings: ExtensionSettings }>({
        type: 'GET_SESSION_STATE',
      }).catch(() => null),
    ])
      .then(([storedSettings, res]) => {
        if (!active) return;
        setSettings(res?.ok && res.data?.settings ? res.data.settings : storedSettings);
        if (res?.ok && res.data?.snapshot) {
          setSnapshot(res.data.snapshot);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const listener = (message: RuntimeMessage) => {
      if (message.type === 'SESSION_SNAPSHOT') {
        setSnapshot(message.snapshot);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      active = false;
      chrome.runtime.onMessage.removeListener(listener);
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
      setSettings((prev) => ({ ...prev, ...patch }));
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
