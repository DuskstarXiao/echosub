import type { DisplayMode, SubtitleSegment } from '../../types/subtitle';

/**
 * Formats milliseconds into SubRip (.srt) timestamp format: HH:MM:SS,mmm
 */
export function formatSrtTimestamp(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  const millis = safe % 1000;

  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)},${pad3(millis)}`;
}

/**
 * Formats milliseconds into compact human-readable MM:SS or HH:MM:SS.
 */
export function formatShortTimestamp(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const hours = Math.floor(safe / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  if (hours > 0) {
    return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
  }
  return `${pad2(minutes)}:${pad2(seconds)}`;
}

/**
 * Exports finalized subtitle segments to standard SubRip (.srt) format.
 */
export function exportToSrt(
  segments: readonly SubtitleSegment[],
  mode: DisplayMode = 'bilingual'
): string {
  const blocks: string[] = [];

  segments.forEach((seg, index) => {
    const start = formatSrtTimestamp(seg.startMs);
    const end = formatSrtTimestamp(Math.max(seg.endMs, seg.startMs + 500));

    const lines: string[] = [];
    if (mode === 'source') {
      lines.push(seg.sourceText.trim());
    } else if (mode === 'translated') {
      lines.push((seg.translatedText || seg.sourceText).trim());
    } else {
      if (seg.translatedText && seg.translatedText.trim() !== seg.sourceText.trim()) {
        lines.push(seg.translatedText.trim());
      }
      lines.push(seg.sourceText.trim());
    }

    blocks.push(`${index + 1}\n${start} --> ${end}\n${lines.join('\n')}`);
  });

  return blocks.join('\n\n') + (blocks.length > 0 ? '\n' : '');
}

export interface MarkdownExportMeta {
  title?: string;
  url?: string;
  exportedAt?: Date;
  summary?: string;
}

/**
 * Exports transcript + optional AI summary to clean study-ready Markdown (.md).
 */
export function exportToMarkdown(
  segments: readonly SubtitleSegment[],
  meta: MarkdownExportMeta = {}
): string {
  const title = meta.title?.trim() || 'EchoSub Transcript';
  const exportedAt = (meta.exportedAt ?? new Date()).toISOString();
  const lines: string[] = [
    `# ${title}`,
    '',
    `- **Captured by**: EchoSub`,
    `- **Exported at**: ${exportedAt}`,
  ];

  if (meta.url) {
    lines.push(`- **Source URL**: ${meta.url}`);
  }
  lines.push(`- **Segments**: ${segments.length}`, '');

  if (meta.summary?.trim()) {
    lines.push('## AI Summary', '', meta.summary.trim(), '');
  }

  lines.push('## Bilingual Transcript', '');

  for (const seg of segments) {
    const ts = formatShortTimestamp(seg.startMs);
    const speakerTag = seg.speaker ? ` · ${seg.speaker.label}` : '';
    lines.push(`### [${ts}${speakerTag}]`);
    lines.push(`- **Original**: ${seg.sourceText.trim()}`);
    if (
      seg.translatedText?.trim() &&
      seg.translatedText.trim() !== seg.sourceText.trim()
    ) {
      lines.push(`- **Translation**: ${seg.translatedText.trim()}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function pad3(n: number): string {
  return String(n).padStart(3, '0');
}
