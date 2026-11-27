import type { AutoStartConfig } from '../../types/settings';

export interface PresetVideoSite {
  id: string;
  nameZh: string;
  nameEn: string;
  domains: readonly string[];
  /** Optional playback URL path check so homepages/feeds do not trigger unwanted overlays. */
  isVideoUrl?: (url: URL) => boolean;
}

export const PRESET_VIDEO_SITES: readonly PresetVideoSite[] = [
  {
    id: 'youtube',
    nameZh: 'YouTube',
    nameEn: 'YouTube',
    domains: ['youtube.com', 'youtu.be'],
    isVideoUrl: (u) =>
      u.hostname === 'youtu.be' ||
      u.pathname === '/watch' ||
      u.pathname.startsWith('/shorts/') ||
      u.pathname.startsWith('/live/'),
  },
  {
    id: 'bilibili',
    nameZh: 'B站 (Bilibili)',
    nameEn: 'Bilibili',
    domains: ['bilibili.com'],
    isVideoUrl: (u) =>
      u.hostname === 'live.bilibili.com' ||
      u.pathname.startsWith('/video/') ||
      u.pathname.startsWith('/bangumi/play/') ||
      u.pathname.startsWith('/list/'),
  },
  {
    id: 'twitch',
    nameZh: 'Twitch 直播',
    nameEn: 'Twitch',
    domains: ['twitch.tv'],
    isVideoUrl: (u) => {
      const seg = u.pathname.replace(/^\/+|\/+$/g, '');
      if (!seg) return false;
      const nonChannel = ['directory', 'downloads', 'jobs', 'settings', 'wallet'];
      return !nonChannel.some((p) => seg === p || seg.startsWith(`${p}/`));
    },
  },
  {
    id: 'coursera',
    nameZh: 'Coursera 网课',
    nameEn: 'Coursera',
    domains: ['coursera.org'],
    isVideoUrl: (u) =>
      u.pathname.includes('/learn/') || u.pathname.includes('/lecture/'),
  },
  {
    id: 'udemy',
    nameZh: 'Udemy 网课',
    nameEn: 'Udemy',
    domains: ['udemy.com'],
    isVideoUrl: (u) => u.pathname.includes('/course/'),
  },
  {
    id: 'ted',
    nameZh: 'TED / Vimeo',
    nameEn: 'TED / Vimeo',
    domains: ['ted.com', 'vimeo.com'],
    isVideoUrl: (u) =>
      (u.hostname.endsWith('ted.com') && u.pathname.includes('/talks/')) ||
      (u.hostname.endsWith('vimeo.com') && /^\/\d+/.test(u.pathname)),
  },
];

export interface AutoStartMatch {
  siteId: string;
  siteName: string;
  host: string;
}

/**
 * Normalizes user input such as "https://www.Netflix.com/watch/123" -> "netflix.com".
 */
export function normalizeDomainInput(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return '';
  try {
    const withProto = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
    const host = new URL(withProto).hostname.replace(/^www\./, '');
    if (!host.includes('.') || /\s/.test(host)) return '';
    return host;
  } catch {
    return '';
  }
}

function hostMatchesDomain(hostname: string, domain: string): boolean {
  const h = hostname.toLowerCase();
  const d = domain.toLowerCase().replace(/^www\./, '');
  return h === d || h.endsWith(`.${d}`);
}

/**
 * Determines whether a tab URL matches the user's checked video sites or custom domains.
 */
export function matchAutoStartSite(
  rawUrl: string | undefined,
  config: AutoStartConfig | undefined | null,
  locale: 'zh' | 'en' = 'zh'
): AutoStartMatch | null {
  if (!config?.enabled || !rawUrl) return null;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  const enabledSiteIds = Array.isArray(config.enabledSiteIds)
    ? config.enabledSiteIds
    : [];
  const customDomains = Array.isArray(config.customDomains)
    ? config.customDomains
    : [];

  // 1) Check enabled preset video sites (with video-page path filtering)
  for (const preset of PRESET_VIDEO_SITES) {
    if (!enabledSiteIds.includes(preset.id)) continue;
    const domainHit = preset.domains.some((d) =>
      hostMatchesDomain(parsed.hostname, d)
    );
    if (!domainHit) continue;
    if (preset.isVideoUrl && !preset.isVideoUrl(parsed)) continue;
    return {
      siteId: preset.id,
      siteName: locale === 'zh' ? preset.nameZh : preset.nameEn,
      host: parsed.hostname,
    };
  }

  // 2) Check user-added custom domains (matches any page on that domain)
  for (const custom of customDomains) {
    const clean = normalizeDomainInput(custom);
    if (clean && hostMatchesDomain(parsed.hostname, clean)) {
      return {
        siteId: `custom:${clean}`,
        siteName: clean,
        host: parsed.hostname,
      };
    }
  }

  return null;
}
