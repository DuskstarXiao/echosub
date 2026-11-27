import { describe, expect, it, vi } from 'vitest';
import { TranslationScheduler } from '../src/core/subtitle/translation-queue';
import type {
  TranslateRequest,
  TranslatorAdapter,
} from '../src/core/translator/types';

describe('TranslationScheduler', () => {
  it('debounces rapid interim updates and cancels superseded requests', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const adapter: TranslatorAdapter = {
      id: 'llm',
      async translate(req: TranslateRequest) {
        calls.push(req.text);
        return `ZH:${req.text}`;
      },
    };

    const scheduler = new TranslationScheduler(adapter, {
      debounceMs: 200,
      minDeltaChars: 3,
      sourceLang: 'en',
      targetLang: 'zh-CN',
    });

    const delivered: string[] = [];
    scheduler.scheduleInterim('cap1', 'Hello', (_id, t) => delivered.push(t));
    vi.advanceTimersByTime(100);
    scheduler.scheduleInterim('cap1', 'Hello world today', (_id, t) =>
      delivered.push(t)
    );

    await vi.advanceTimersByTimeAsync(250);

    expect(calls).toEqual(['Hello world today']);
    expect(delivered).toEqual(['ZH:Hello world today']);

    scheduler.dispose();
    vi.useRealTimers();
  });

  it('passes sliding context window to translateFinal and caches repeated phrases', async () => {
    const seenContexts: number[] = [];
    let callCount = 0;
    const adapter: TranslatorAdapter = {
      id: 'llm',
      async translate(req: TranslateRequest) {
        callCount++;
        seenContexts.push(req.context?.length ?? 0);
        return `译:${req.text}`;
      },
    };

    const scheduler = new TranslationScheduler(adapter, {
      contextWindowSize: 2,
      sourceLang: 'en',
      targetLang: 'zh-CN',
    });

    expect(await scheduler.translateFinal('First line')).toBe('译:First line');
    expect(await scheduler.translateFinal('Second line')).toBe('译:Second line');
    expect(await scheduler.translateFinal('Third line')).toBe('译:Third line');
    // Cached hit should not invoke adapter again
    expect(await scheduler.translateFinal('First line')).toBe('译:First line');

    expect(callCount).toBe(3);
    expect(seenContexts).toEqual([0, 1, 2]);
    scheduler.dispose();
  });
});
