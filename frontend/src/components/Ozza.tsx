import React from 'react';
import ozzaPhoto from '../assets/images/ozza_corgi_avatar_1791406665619.jpg';

export type OzzaState = 'idle' | 'listening' | 'thinking' | 'working' | 'speaking' | 'happy' | 'confused';

const LABEL: Record<OzzaState, string> = {
  idle: 'Ozza is ready',
  listening: 'Ozza is listening',
  thinking: 'Ozza is thinking',
  working: 'Ozza is checking the diary',
  speaking: 'Ozza is speaking',
  happy: 'Ozza is happy',
  confused: "Ozza didn't catch that",
};

/**
 * Ozza, the companion. Every state is driven by a real event (mic open, request in flight, reply spoken, booking
 * confirmed). `level` (0..1) is the live microphone level while listening.
 */
export function Ozza({ state = 'idle', size = 220, level = 0, label }: { state?: OzzaState; size?: number; level?: number; label?: string }) {
  const orbit = state === 'thinking' || state === 'working';
  return (
    <div className="ozza" data-state={state} style={{ width: size, height: size }} role="img" aria-label={label ?? LABEL[state]}>
      <div className="ozza-glow" />
      <div className="ozza-shadow" />
      <div className="ozza-bloom" key={state === 'happy' ? Date.now() : 'b'} />
      <div className="ozza-pulse" />
      <div className="ozza-ring" style={{ transform: `scale(${1 + Math.min(level, 1) * 0.22})` }} />
      <div className="ozza-face" style={{ width: size, height: size }}>
        <img src={ozzaPhoto} alt="" draggable={false} />
      </div>
      {orbit && [0, 1, 2].map((i) => (
        <span key={i} className="ozza-orbit" style={{ ['--r' as any]: `${size / 2 + 14}px`, animationDelay: `${-i * 0.8}s`, opacity: 1 - i * 0.25 }} />
      ))}
    </div>
  );
}

/** Live caption of what Ozza is doing, in plain words. */
export function OzzaStatus({ state, text }: { state: OzzaState; text?: string }) {
  const words: Partial<Record<OzzaState, string>> = {
    listening: 'Listening… take your time',
    thinking: 'Understanding…',
    working: 'Checking the diary…',
  };
  const t = text ?? words[state];
  return (
    <p className="min-h-6 text-sm text-ink-2 text-center" aria-live="polite">{t ?? ' '}</p>
  );
}
