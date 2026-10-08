// Ozza's voice: the browser's own text-to-speech, picking the most natural English voice available.
let chosen: SpeechSynthesisVoice | null | undefined;
function pickVoice(): SpeechSynthesisVoice | null {
  if (chosen !== undefined) return chosen;
  const voices = window.speechSynthesis?.getVoices() ?? [];
  if (!voices.length) return null;
  const en = voices.filter((v) => /^en[-_]/i.test(v.lang));
  const rank = (v: SpeechSynthesisVoice) =>
    /natural|neural/i.test(v.name) ? 0 : /Google UK English Female|Google US English/i.test(v.name) ? 1 : /Samantha|Serena|Karen|Moira|Tessa/i.test(v.name) ? 2 : /en-(ZA|GB)/i.test(v.lang) ? 3 : 4;
  chosen = [...en].sort((a, b) => rank(a) - rank(b))[0] ?? null;
  return chosen;
}
if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.onvoiceschanged = () => { chosen = undefined; };

export const canSpeak = () => typeof window !== 'undefined' && !!window.speechSynthesis;
export function stopSpeaking() { if (canSpeak()) window.speechSynthesis.cancel(); }

/** Speak and resolve when done. Never hangs: gives up after 2 s + 90 ms per character. */
export function speak(text: string, onStart?: () => void): Promise<void> {
  return new Promise((resolve) => {
    if (!canSpeak() || !text) return resolve();
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice(); if (v) u.voice = v;
    u.rate = 1.0; u.pitch = 1.0;
    let done = false;
    const fin = () => { if (!done) { done = true; resolve(); } };
    u.onstart = () => onStart?.();
    u.onend = fin; u.onerror = fin;
    setTimeout(fin, 2000 + text.length * 90);
    window.speechSynthesis.speak(u);
  });
}
