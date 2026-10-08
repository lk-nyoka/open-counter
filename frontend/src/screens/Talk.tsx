import React, { useEffect, useRef, useState } from 'react';
import { Mic, Square, SendHorizontal, Volume2, VolumeX, ScrollText } from 'lucide-react';
import { Ozza, OzzaState, OzzaStatus } from '../components/Ozza';
import { Receipt } from '../components/Receipt';
import { Page } from '../components/Shell';
import { Business } from '../types';
import { api } from '../lib/api';
import { createDialog, sayTime } from '../lib/dialog';
import { canRecord, isPhantom, recordUtterance, type Recording } from '../lib/voice';
import { speak, stopSpeaking } from '../lib/speech';

type Line = { who: 'ozza' | 'you'; text: string };
const STEP: Record<string, string> = { check_availability: 'Checking the diary…', book: 'Booking it…', cancel: 'Cancelling…', get_quote: 'Checking the price…' };

/** Talk to Ozza: the customer side. The dialog code decides every reply from real MCP results. */
export function Talk({ business }: { business: Business }) {
  const [ozza, setOzza] = useState<OzzaState>('idle');
  const [status, setStatus] = useState<string | undefined>();
  const [lines, setLines] = useState<Line[]>([]);
  const [confirm, setConfirm] = useState<any>(null);
  const [booked, setBooked] = useState<any>(null);
  const [offered, setOffered] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [level, setLevel] = useState(0);
  const [voiceOn, setVoiceOn] = useState(true);
  const [keepListening, setKeepListening] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const dialog = useRef<any>(null);
  const rec = useRef<Recording | null>(null);
  const whisperOk = useRef(true);
  const voiceRef = useRef(voiceOn); voiceRef.current = voiceOn;
  const keepRef = useRef(keepListening); keepRef.current = keepListening;

  useEffect(() => {
    dialog.current = createDialog({
      info: business,
      tool: async (name: string, args: any) => {
        setOzza('working'); setStatus(STEP[name] ?? 'Working…');
        try { return await api.callMcpTool(business.slug, name, args); }
        catch (e: any) { return { ok: false, message: 'The booking system could not be reached.' }; }
      },
      understand: async (t: string, awaiting: string | null) => {
        setOzza('thinking'); setStatus('Understanding…');
        return api.understandUtterance(business, t, awaiting);
      },
    });
    setLines([]); setConfirm(null); setBooked(null); setOffered([]);
    reply({ say: dialog.current.greeting() }, false);
    return () => { stopSpeaking(); rec.current?.stop(); };
  }, [business.slug]);

  async function reply(r: any, mayListen = true) {
    setStatus(undefined);
    setLines((l) => [...l, { who: 'ozza', text: r.say }]);
    setConfirm(r.confirm ?? null);
    if (r.booked) setBooked(r.booked);
    if (r.cancelled) setBooked(null);
    setOffered(dialog.current?.state?.awaiting === 'time' ? [...(dialog.current.state.offered ?? [])] : []);
    const mood: OzzaState = r.booked || r.cancelled ? 'happy' : /^Sorry, I didn't catch/.test(r.say) ? 'confused' : 'speaking';
    if (voiceRef.current) {
      setOzza(mood === 'speaking' ? 'speaking' : mood);
      await speak(r.say, () => mood === 'speaking' && setOzza('speaking'));
    } else if (mood !== 'speaking') setOzza(mood);
    setOzza(mood === 'happy' ? 'happy' : 'idle');
    if (mood === 'happy') setTimeout(() => setOzza('idle'), 1400);
    if (mayListen && keepRef.current && !r.booked) listen();
  }

  async function send(t: string, shown = t) {
    t = t.trim(); if (!t || busy || !dialog.current) return;
    stopSpeaking(); setBusy(true); setText(''); setConfirm(null);
    setLines((l) => [...l, { who: 'you', text: shown }]);
    try { await reply(await dialog.current.handle(t)); }
    catch { await reply({ say: "Sorry, I couldn't reach the booking system. Please try again." }, false); }
    finally { setBusy(false); }
  }

  async function answer(yes: boolean) {
    if (busy) return;
    setBusy(true); setConfirm(null);
    setLines((l) => [...l, { who: 'you', text: yes ? 'Yes, book it' : 'No' }]);
    try { await reply(await dialog.current.confirm(yes)); } finally { setBusy(false); }
  }

  async function listen() {
    if (rec.current) { rec.current.stop(); return; }
    if (busy) return;
    stopSpeaking();
    if (!canRecord() || !whisperOk.current) { setStatus('Voice is not available in this browser. You can type instead.'); return; }
    let r: Recording;
    try { r = await recordUtterance(setLevel); }
    catch { setStatus('Microphone permission was denied. You can type instead.'); return; }
    rec.current = r; setOzza('listening'); setStatus(undefined);
    const blob = await r.done; rec.current = null; setLevel(0);
    if (!blob) { setOzza('idle'); setStatus("I didn't hear anything. Tap the microphone and try again."); return; }
    setOzza('thinking'); setStatus('Listening back…');
    try {
      const { text: heard } = await api.transcribe(business.slug, blob);
      if (isPhantom(heard)) { setOzza('confused'); setStatus("I didn't catch that. Tap the microphone and try again."); setTimeout(() => setOzza('idle'), 1400); return; }
      send(heard);
    } catch { whisperOk.current = false; setOzza('idle'); setStatus('Voice is unavailable right now. You can type instead.'); }
  }

  const last = [...lines].reverse().find((l) => l.who === 'ozza');
  const lastYou = [...lines].reverse().find((l) => l.who === 'you');
  const listening = ozza === 'listening';
  const started = lines.some((l) => l.who === 'you');

  return (
    <Page narrow>
      <div className="pt-8 sm:pt-12 flex flex-col items-center text-center">
        <p className="eyebrow">{business.name}</p>
        <div className="mt-6"><Ozza state={ozza} size={190} level={level} /></div>
        <div className="mt-6"><OzzaStatus state={ozza} text={status} /></div>

        {lastYou && !showAll && <p className="text-ink-3 text-sm mt-2 max-w-xl">You said: “{lastYou.text}”</p>}
        {last && !showAll && <p className="serif text-2xl sm:text-[28px] leading-snug mt-3 max-w-2xl rise" key={lines.length}>{last.text}</p>}

        {showAll && (
          <ol className="mt-4 w-full max-w-2xl text-left space-y-3" aria-label="Conversation">
            {lines.map((l, i) => (
              <li key={i} className={l.who === 'you' ? 'text-right' : ''}>
                <span className={`inline-block px-4 py-2.5 rounded-2xl max-w-[85%] ${l.who === 'you' ? 'bg-ink text-white' : 'bg-surface border hairline'}`}>{l.text}</span>
              </li>
            ))}
          </ol>
        )}

        {offered.length > 0 && !confirm && (
          <div className="mt-6 flex flex-wrap justify-center gap-2 rise" aria-label="Free times">
            {offered.map((t) => <button key={t} className="chip tabular" onClick={() => send(sayTime(t))}>{sayTime(t)}</button>)}
          </div>
        )}

        {confirm && (
          <section className="mt-8 w-full max-w-xl card p-6 rise text-left" aria-label="Confirm booking">
            <p className="eyebrow">Please confirm</p>
            <p className="serif text-2xl mt-2">{confirm.service}, {confirm.when}</p>
            <p className="text-ink-2 mt-1">{confirm.price} {confirm.currency} · for {confirm.name}</p>
            <div className="mt-5 flex gap-3">
              <button className="btn btn-amber flex-1" onClick={() => answer(true)} disabled={busy}>Yes, book it</button>
              <button className="btn btn-ghost" onClick={() => answer(false)} disabled={busy}>No</button>
            </div>
          </section>
        )}

        {booked && <div className="mt-8 w-full"><Receipt booking={booked} business={business.name} onCancel={() => send('cancel my booking')} /></div>}

        {!started && (
          <div className="mt-8 flex flex-wrap justify-center gap-2">
            {['What do you offer?', 'When are you open?', `Book a ${business.services.find((s) => s.bookableByVoice)?.name.toLowerCase() ?? 'visit'} tomorrow`].map((p) => (
              <button key={p} className="chip" onClick={() => send(p)}>{p}</button>
            ))}
          </div>
        )}
      </div>

      {/* Composer: a big microphone first, typing always works too */}
      <div className="sticky bottom-0 mt-10 pt-4 pb-5 bg-gradient-to-t from-canvas via-canvas to-transparent">
        <form className="flex items-center gap-3" onSubmit={(e) => { e.preventDefault(); send(text); }}>
          <button type="button" onClick={listen} disabled={busy && !listening}
            className={`shrink-0 grid place-items-center w-14 h-14 rounded-full transition-all ${listening ? 'bg-amber text-white shadow-[0_0_0_8px_var(--color-amber-soft)]' : 'bg-ink text-white hover:bg-black'}`}
            aria-label={listening ? 'Stop listening' : 'Speak to Ozza'}>
            {listening ? <Square className="w-5 h-5" fill="currentColor" aria-hidden /> : <Mic className="w-6 h-6" aria-hidden />}
          </button>
          <input className="field flex-1 !rounded-full !min-h-14 !px-5" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask Ozza anything…" aria-label="Type a message" maxLength={500} />
          <button className="btn btn-ghost !w-14 !h-14 !p-0" type="submit" disabled={!text.trim() || busy} aria-label="Send"><SendHorizontal className="w-5 h-5" aria-hidden /></button>
        </form>
        <div className="mt-3 flex flex-wrap justify-center gap-4 text-sm text-ink-2">
          <button className="inline-flex items-center gap-1.5 hover:text-ink" onClick={() => { setVoiceOn(!voiceOn); stopSpeaking(); }} aria-pressed={voiceOn}>
            {voiceOn ? <Volume2 className="w-4 h-4" aria-hidden /> : <VolumeX className="w-4 h-4" aria-hidden />}{voiceOn ? 'Ozza speaks' : 'Ozza is muted'}
          </button>
          <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={keepListening} onChange={(e) => setKeepListening(e.target.checked)} /> Keep listening after each reply</label>
          <button className="inline-flex items-center gap-1.5 hover:text-ink" onClick={() => setShowAll(!showAll)} aria-pressed={showAll}><ScrollText className="w-4 h-4" aria-hidden />{showAll ? 'Hide conversation' : 'Show conversation'}</button>
        </div>
      </div>
    </Page>
  );
}
