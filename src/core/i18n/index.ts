import type { UiLocale } from '../../types/settings';
import { LOCALES, type LocaleDictionary, type ResolvedLocale } from './locales';

export function resolveLocale(setting: UiLocale): ResolvedLocale {
  if (setting === 'zh' || setting === 'en') return setting;
  const navLang =
    typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : 'en';
  return navLang.startsWith('zh') ? 'zh' : 'en';
}

export function getDictionary(setting: UiLocale): {
  locale: ResolvedLocale;
  t: LocaleDictionary;
} {
  const locale = resolveLocale(setting);
  return { locale, t: LOCALES[locale] };
}
