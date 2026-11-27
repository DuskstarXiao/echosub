import React from 'react';
import type { LocaleDictionary } from '../core/i18n/locales';
import type { AudioMetrics, CaptureStatus } from '../types/subtitle';

interface WaveformMeterProps {
  metrics: AudioMetrics;
  status: CaptureStatus;
  latencyMs: number | null;
  t: LocaleDictionary;
  compact?: boolean;
}

export const WaveformMeter: React.FC<WaveformMeterProps> = ({
  metrics,
  status,
  latencyMs,
  t,
  compact = false,
}) => {
  const isActive = status === 'running' || status === 'reconnecting';

  return (
    <div
      className={`glass-card rounded-xl ${compact ? 'px-3 py-2.5' : 'px-3.5 py-3'}`}
    >
      <div className="mb-2 flex items-center justify-between text-[11px]">
        <span className="font-medium text-slate-300">{t.audioMonitor}</span>
        <div className="flex items-center gap-2">
          {latencyMs !== null && isActive && (
            <span className="rounded-md bg-slate-800/90 px-1.5 py-0.5 font-mono text-[10px] text-teal-300">
              {latencyMs}ms
            </span>
          )}
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              isActive && metrics.isSpeech
                ? 'bg-teal-500/20 text-teal-300'
                : 'bg-slate-800/90 text-slate-400'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isActive && metrics.isSpeech
                  ? 'animate-pulse bg-teal-400'
                  : 'bg-slate-500'
              }`}
            />
            {isActive ? (metrics.isSpeech ? t.speaking : t.silent) : t.idle}
          </span>
        </div>
      </div>

      {/* 24-bar real-time AudioWorklet waveform */}
      <div
        className={`flex items-center justify-between gap-[3px] ${
          compact ? 'h-7' : 'h-9'
        }`}
      >
        {metrics.waveform.map((val, idx) => {
          const heightPct = isActive ? Math.max(12, Math.round(val * 100)) : 12;
          return (
            <div
              key={idx}
              className="flex-1 rounded-full transition-all duration-75"
              style={{
                height: `${heightPct}%`,
                background:
                  isActive && metrics.isSpeech
                    ? 'linear-gradient(180deg, #38e8d6 0%, #6366f1 100%)'
                    : isActive
                      ? 'rgba(148, 163, 184, 0.35)'
                      : 'rgba(148, 163, 184, 0.16)',
              }}
            />
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-slate-400">
        <span>{isActive ? `${metrics.db} dBFS` : '-- dBFS'}</span>
        <span>
          {metrics.sampleRate / 1000}kHz PCM ·{' '}
          {isActive ? `${metrics.packetsPerSec} pkt/s` : '0 pkt/s'}
        </span>
      </div>
    </div>
  );
};
