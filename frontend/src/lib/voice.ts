// Voice capture for Ozza: record one utterance, stop on natural silence, then transcribe on the server
// (Whisper, primed with the business's service names). Patient with slow speakers: it waits for 2.2 s of
// silence after speech starts, gives up after 8 s with no speech, and never records more than 25 s.

export const canRecord = () => typeof window !== 'undefined' && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function' && !!(window as any).MediaRecorder;

/** Whisper sometimes "hears" these on silence. */
const PHANTOM = /^(thank you\.?|thanks\.?|thanks for watching\.?|you\.?|bye\.?|\.+|um+\.?|uh+\.?|hmm+\.?)$/i;
export const isPhantom = (t: string) => !t.trim() || PHANTOM.test(t.trim());

export interface Recording { stop(): void; done: Promise<Blob | null> }

/** Start recording. `onLevel` gets 0..1 about 20 times a second (for the waveform). Resolves null if no speech was heard. */
export async function recordUtterance(onLevel?: (level: number) => void): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((m) => (window as any).MediaRecorder.isTypeSupported(m)) || '';
  const mr: MediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
  const ac: AudioContext = new AC();
  const an = ac.createAnalyser(); an.fftSize = 1024;
  ac.createMediaStreamSource(stream).connect(an);
  const buf = new Float32Array(an.fftSize);
  const t0 = performance.now();
  let floor = 0.01, calib: number[] = [], speechMs = 0, lastVoice = 0, started = false, manual = false;

  const ended = new Promise<void>((resolve) => {
    const tick = setInterval(() => {
      an.getFloatTimeDomainData(buf);
      let s = 0; for (const v of buf) s += v * v;
      const rms = Math.sqrt(s / buf.length), now = performance.now() - t0;
      onLevel?.(Math.min(1, rms * 12));
      if (now < 400) { calib.push(rms); floor = Math.max(0.006, calib.reduce((a, b) => a + b, 0) / calib.length); return; }
      if (rms > Math.max(0.02, floor * 3)) { started = true; speechMs += 50; lastVoice = now; }
      if (manual || now > 25000 || (started && speechMs > 250 && now - lastVoice > 2200) || (!started && now > 8000)) { clearInterval(tick); resolve(); }
    }, 50);
  });
  mr.start(250);

  const done = (async () => {
    await ended;
    const stopped = new Promise((r) => (mr.onstop = r)); mr.stop(); await stopped;
    stream.getTracks().forEach((t) => t.stop()); ac.close().catch(() => {});
    onLevel?.(0);
    if (!started && !manual) return null;
    return new Blob(chunks, { type: mr.mimeType || mime || 'audio/webm' });
  })();
  return { stop: () => { manual = true; }, done };
}
