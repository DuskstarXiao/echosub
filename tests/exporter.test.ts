import { describe, expect, it } from 'vitest';
import {
  exportToMarkdown,
  exportToSrt,
  formatShortTimestamp,
  formatSrtTimestamp,
} from '../src/core/subtitle/exporter';
import type { SubtitleSegment } from '../src/types/subtitle';

const SAMPLE_SEGMENTS: SubtitleSegment[] = [
  {
    id: 's1',
    startMs: 1250,
    endMs: 4800,
    sourceText: 'Hello everyone, welcome back.',
    translatedText: '大家好，欢迎回来。',
    isFinal: true,
    createdAt: 1000,
  },
  {
    id: 's2',
    startMs: 65000,
    endMs: 70250,
    sourceText: 'Let us inspect the AudioWorklet pipeline.',
    translatedText: '让我们一起看看 AudioWorklet 音频管线。',
    isFinal: true,
    createdAt: 2000,
  },
];

describe('Subtitle Exporter (.srt & .md)', () => {
  it('formats SubRip and short timestamps accurately', () => {
    expect(formatSrtTimestamp(0)).toBe('00:00:00,000');
    expect(formatSrtTimestamp(3_661_045)).toBe('01:01:01,045');
    expect(formatShortTimestamp(65_000)).toBe('01:05');
    expect(formatShortTimestamp(3_665_000)).toBe('01:01:05');
  });

  it('exports valid bilingual .srt blocks', () => {
    const srt = exportToSrt(SAMPLE_SEGMENTS, 'bilingual');
    expect(srt).toContain('1\n00:00:01,250 --> 00:00:04,800\n大家好，欢迎回来。\nHello everyone, welcome back.');
    expect(srt).toContain('2\n00:01:05,000 --> 00:01:10,250\n让我们一起看看 AudioWorklet 音频管线。');
  });

  it('exports structured Markdown with optional AI summary', () => {
    const md = exportToMarkdown(SAMPLE_SEGMENTS, {
      title: 'Web Audio Deep Dive',
      url: 'https://example.com/watch',
      summary: '- AudioWorklet runs on a dedicated audio thread.',
      exportedAt: new Date('2026-11-25T14:00:00.000Z'),
    });
    expect(md).toContain('# Web Audio Deep Dive');
    expect(md).toContain('## AI Summary');
    expect(md).toContain('### [01:05]');
    expect(md).toContain('**Translation**: 让我们一起看看 AudioWorklet 音频管线。');
  });
});
