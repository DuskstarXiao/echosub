import {
  DEFAULT_APPEARANCE,
  DEFAULT_AUTO_START,
  DEFAULT_SETTINGS,
  type AppearanceSettings,
  type ExtensionSettings,
} from '../types/settings';

const SETTINGS_KEY = 'echosub_settings_v1';

export function mergeSettings(
  stored?: Partial<ExtensionSettings> | null
): ExtensionSettings {
  if (!stored) {
    return {
      ...DEFAULT_SETTINGS,
      autoStart: {
        ...DEFAULT_AUTO_START,
        enabledSiteIds: [...DEFAULT_AUTO_START.enabledSiteIds],
        customDomains: [...DEFAULT_AUTO_START.customDomains],
      },
      appearance: {
        ...DEFAULT_APPEARANCE,
        position: { ...DEFAULT_APPEARANCE.position },
      },
    };
  }
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    autoStart: {
      ...DEFAULT_AUTO_START,
      ...(stored.autoStart ?? {}),
      enabledSiteIds: stored.autoStart?.enabledSiteIds
        ? [...stored.autoStart.enabledSiteIds]
        : [...DEFAULT_AUTO_START.enabledSiteIds],
      customDomains: stored.autoStart?.customDomains
        ? [...stored.autoStart.customDomains]
        : [...DEFAULT_AUTO_START.customDomains],
    },
    appearance: {
      ...DEFAULT_APPEARANCE,
      ...(stored.appearance ?? {}),
      position: {
        ...DEFAULT_APPEARANCE.position,
        ...(stored.appearance?.position ?? {}),
      },
    },
  };
}

export async function loadSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return mergeSettings(result[SETTINGS_KEY] as Partial<ExtensionSettings> | undefined);
}

export async function saveSettings(
  patch: Partial<ExtensionSettings>
): Promise<ExtensionSettings> {
  const current = await loadSettings();
  const next = mergeSettings({
    ...current,
    ...patch,
    appearance: patch.appearance
      ? {
          ...current.appearance,
          ...patch.appearance,
          position: {
            ...current.appearance.position,
            ...(patch.appearance.position ?? {}),
          },
        }
      : current.appearance,
  });
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function saveAppearance(
  patch: Partial<AppearanceSettings>
): Promise<ExtensionSettings> {
  const current = await loadSettings();
  return saveSettings({
    appearance: {
      ...current.appearance,
      ...patch,
      position: {
        ...current.appearance.position,
        ...(patch.position ?? {}),
      },
    },
  });
}
