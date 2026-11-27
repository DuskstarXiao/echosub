import { describe, expect, it } from 'vitest';
import {
  matchAutoStartSite,
  normalizeDomainInput,
} from '../src/core/sites/auto-start';
import { mergeSettings } from '../src/shared/storage';
import type { AutoStartConfig, ExtensionSettings } from '../src/types/settings';

const BASE_CONFIG: AutoStartConfig = {
  enabled: true,
  enabledSiteIds: ['youtube', 'bilibili', 'twitch', 'coursera'],
  customDomains: ['netflix.com', 'zoom.us'],
};

describe('Auto-Start Video Site Matcher', () => {
  it('normalizes raw domain and URL strings cleanly', () => {
    expect(normalizeDomainInput('https://www.Netflix.com/watch/123')).toBe(
      'netflix.com'
    );
    expect(normalizeDomainInput('  Zoom.US  ')).toBe('zoom.us');
    expect(normalizeDomainInput('invalid')).toBe('');
  });

  it('returns null when auto-start master switch is disabled', () => {
    expect(
      matchAutoStartSite('https://www.youtube.com/watch?v=abc123', {
        ...BASE_CONFIG,
        enabled: false,
      })
    ).toBeNull();
  });

  it('matches YouTube and Bilibili video/live pages while skipping homepages', () => {
    expect(
      matchAutoStartSite('https://www.youtube.com/watch?v=dQw4w9WgXcQ', BASE_CONFIG)
        ?.siteId
    ).toBe('youtube');
    expect(
      matchAutoStartSite('https://www.youtube.com/shorts/xyz', BASE_CONFIG)
        ?.siteId
    ).toBe('youtube');
    expect(matchAutoStartSite('https://www.youtube.com/', BASE_CONFIG)).toBeNull();

    expect(
      matchAutoStartSite(
        'https://www.bilibili.com/video/BV1xx411c7mD',
        BASE_CONFIG
      )?.siteId
    ).toBe('bilibili');
    expect(
      matchAutoStartSite('https://live.bilibili.com/12345', BASE_CONFIG)?.siteId
    ).toBe('bilibili');
    expect(
      matchAutoStartSite('https://www.bilibili.com/', BASE_CONFIG)
    ).toBeNull();
  });

  it('matches Twitch channels while excluding directory pages', () => {
    expect(
      matchAutoStartSite('https://www.twitch.tv/shroud', BASE_CONFIG)?.siteId
    ).toBe('twitch');
    expect(
      matchAutoStartSite('https://www.twitch.tv/directory/following', BASE_CONFIG)
    ).toBeNull();
  });

  it('matches user-added custom domains and subdomains', () => {
    expect(
      matchAutoStartSite('https://www.netflix.com/watch/80057281', BASE_CONFIG)
        ?.siteName
    ).toBe('netflix.com');
    expect(
      matchAutoStartSite('https://app.zoom.us/wc/join/123', BASE_CONFIG)
        ?.siteName
    ).toBe('zoom.us');
    expect(
      matchAutoStartSite('https://example.com/blog', BASE_CONFIG)
    ).toBeNull();
  });

  it('handles missing or legacy settings safely without throwing', () => {
    expect(
      matchAutoStartSite('https://www.youtube.com/watch?v=abc', undefined)
    ).toBeNull();
    expect(
      matchAutoStartSite('https://www.youtube.com/watch?v=abc', {
        enabled: true,
        enabledSiteIds: undefined as unknown as string[],
        customDomains: null as unknown as string[],
      })
    ).toBeNull();

    // Simulate legacy v2.2.0 settings payload from an older SW/storage missing autoStart
    const legacy = {
      asrProvider: 'siliconflow',
      siliconflowApiKey: 'sk-test',
      autoStart: undefined,
      appearance: { displayMode: 'bilingual' },
    } as unknown as Partial<ExtensionSettings>;
    const merged = mergeSettings(legacy);
    expect(merged.autoStart.enabled).toBe(false);
    expect(Array.isArray(merged.autoStart.enabledSiteIds)).toBe(true);
    expect(merged.autoStart.enabledSiteIds.length).toBeGreaterThan(0);
    expect(Array.isArray(merged.autoStart.customDomains)).toBe(true);
    expect(merged.appearance.position.xPercent).toBe(50);

    // Corrupted non-object autoStart
    const corrupted = mergeSettings({
      autoStart: null as unknown as AutoStartConfig,
    });
    expect(corrupted.autoStart.enabledSiteIds.length).toBeGreaterThan(0);
  });
});
