import {
  DEFAULT_APPEARANCE,
  DEFAULT_AUTO_START,
  DEFAULT_SETTINGS,
  type AppearanceSettings,
  type ExtensionSettings,
} from '../types/settings';

export const SETTINGS_KEY = 'echosub_settings_v1';

export function mergeSettings(
  stored?: Partial<ExtensionSettings> | null
): ExtensionSettings {
  if (!stored || typeof stored !== 'object') {
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
  const rawAutoStart =
    stored.autoStart && typeof stored.autoStart === 'object'
      ? stored.autoStart
      : undefined;
  const rawAppearance =
    stored.appearance && typeof stored.appearance === 'object'
      ? stored.appearance
      : undefined;
  const rawPosition =
    rawAppearance?.position && typeof rawAppearance.position === 'object'
      ? rawAppearance.position
      : undefined;

  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    autoStart: {
      ...DEFAULT_AUTO_START,
      ...(rawAutoStart ?? {}),
      enabled:
        typeof rawAutoStart?.enabled === 'boolean'
          ? rawAutoStart.enabled
          : DEFAULT_AUTO_START.enabled,
      enabledSiteIds: Array.isArray(rawAutoStart?.enabledSiteIds)
        ? [...rawAutoStart.enabledSiteIds]
        : [...DEFAULT_AUTO_START.enabledSiteIds],
      customDomains: Array.isArray(rawAutoStart?.customDomains)
        ? [...rawAutoStart.customDomains]
        : [...DEFAULT_AUTO_START.customDomains],
    },
    appearance: {
      ...DEFAULT_APPEARANCE,
      ...(rawAppearance ?? {}),
      position: {
        ...DEFAULT_APPEARANCE.position,
        ...(rawPosition ?? {}),
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
    autoStart: patch.autoStart
      ? {
          ...current.autoStart,
          ...patch.autoStart,
          enabledSiteIds: Array.isArray(patch.autoStart.enabledSiteIds)
            ? [...patch.autoStart.enabledSiteIds]
            : [...current.autoStart.enabledSiteIds],
          customDomains: Array.isArray(patch.autoStart.customDomains)
            ? [...patch.autoStart.customDomains]
            : [...current.autoStart.customDomains],
        }
      : current.autoStart,
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
