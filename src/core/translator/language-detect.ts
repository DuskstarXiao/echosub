/**
 * Lightweight zero-dependency script-based language detector.
 * Used when `sourceLanguage === 'auto'` for engines that require an explicit
 * BCP-47 source language code (such as Chrome Built-in Translator API).
 */
export function detectTextLanguage(text: string, fallback = 'en'): string {
  const sample = text.trim();
  if (!sample) return fallback;

  let cjk = 0;
  let kana = 0;
  let hangul = 0;
  let latin = 0;
  let cyrillic = 0;

  for (const ch of sample) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x3040 && code <= 0x309f) || // Hiragana
      (code >= 0x30a0 && code <= 0x30ff) // Katakana
    ) {
      kana++;
    } else if (code >= 0xac00 && code <= 0xd7af) {
      hangul++;
    } else if (code >= 0x4e00 && code <= 0x9fff) {
      cjk++;
    } else if (
      (code >= 0x0041 && code <= 0x005a) ||
      (code >= 0x0061 && code <= 0x007a)
    ) {
      latin++;
    } else if (code >= 0x0400 && code <= 0x04ff) {
      cyrillic++;
    }
  }

  if (kana >= 2 || (kana >= 1 && cjk > 0)) return 'ja';
  if (hangul >= 2) return 'ko';
  if (cjk >= 2 && cjk >= latin * 0.4) return 'zh';
  if (cyrillic >= 3) return 'ru';
  if (latin >= 2) return 'en';
  return fallback;
}

/**
 * Returns true if the text is already predominantly in `targetLang`,
 * avoiding redundant LLM/MT translation (which causes duplicate same-language lines).
 */
export function isAlreadyInTargetLanguage(
  text: string,
  sourceLang: string,
  targetLang: string
): boolean {
  const cleaned = text.trim();
  if (!cleaned) return true;

  const targetBase = normalizeBcp47Base(targetLang || 'zh-CN');
  if (sourceLang && sourceLang !== 'auto') {
    return normalizeBcp47Base(sourceLang) === targetBase;
  }

  const detected = detectTextLanguage(cleaned);
  if (detected !== targetBase) return false;

  // For zh target: if text contains substantial English/Latin words (e.g. mixed sentence),
  // still allow translation unless CJK heavily dominates.
  if (targetBase === 'zh' || targetBase === 'zh-Hant') {
    const cjkCount = (cleaned.match(/[\u4e00-\u9fff]/g) ?? []).length;
    const latinWords = (cleaned.match(/[A-Za-z]{2,}/g) ?? []).length;
    if (latinWords >= 3 && latinWords * 2 >= cjkCount) {
      return false;
    }
  }

  return true;
}

export function normalizeBcp47Base(lang: string): string {
  const lower = lang.trim().toLowerCase();
  if (!lower || lower === 'auto') return 'auto';
  if (lower === 'zh-cn' || lower === 'zh-hans' || lower === 'zh') return 'zh';
  if (lower === 'zh-tw' || lower === 'zh-hant') return 'zh-Hant';
  return lower.split('-')[0];
}
