import { describe, expect, it } from 'vitest';
import { parseLocalWsPayload } from '../src/core/asr/local-ws';
import { isLikelyHallucination } from '../src/core/asr/types';

describe('Local WebSocket ASR Protocol & Hallucination Filter', () => {
  it('parses EchoSub native partial and final frames', () => {
    expect(
      parseLocalWsPayload(
        JSON.stringify({
          type: 'partial',
          text: 'Streaming local speech',
          language: 'en',
          latencyMs: 120,
        })
      )
    ).toEqual({
      text: 'Streaming local speech',
      isFinal: false,
      language: 'en',
      latencyMs: 120,
    });

    expect(
      parseLocalWsPayload(
        JSON.stringify({ type: 'final', text: 'Done speaking.' })
      )
    ).toEqual({
      text: 'Done speaking.',
      isFinal: true,
      language: undefined,
      latencyMs: undefined,
    });
  });

  it('compat-parses WhisperLiveKit payload format', () => {
    expect(
      parseLocalWsPayload(
        JSON.stringify({
          lines: [{ text: 'First confirmed clause' }],
          buffer_transcription: 'and live tail',
        })
      )
    ).toEqual({
      text: 'First confirmed clause and live tail',
      isFinal: false,
    });
  });

  it('filters common Whisper silence hallucinations while preserving real speech', () => {
    expect(isLikelyHallucination('Thank you for watching.')).toBe(true);
    expect(isLikelyHallucination('字幕由某社区提供')).toBe(true);
    expect(isLikelyHallucination('AudioWorklet runs off the main thread.')).toBe(
      false
    );
  });
});
