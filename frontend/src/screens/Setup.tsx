import React, { useEffect, useRef, useState } from 'react';
import { Check, Mic, Square, SendHorizontal, CalendarDays, BookOpen, Sparkles } from 'lucide-react';
import { BusinessDraft } from '../types';
import { api } from '../lib/api';
import { Page } from '../components/Shell';
import { Ozza, OzzaState, OzzaStatus } from '../components/Ozza';
import { canRecord, isPhantom, recordUtterance, type Recording } from '../lib/voice';

type Msg = { who: 'ozza' | 'you'; text: string };
const START: BusinessDraft = { services: [], hours: [], askedVoice: false, askedRules: false, extra: 0 };
const GREETING = "Hi! I'll set up a booking assistant for your business. First, what is your business called, and which city or time zone are you in?";
const EXAMPLE = 'I own Corner Cuts, a barbershop in Johannesburg, and we charge in rand. A haircut is 30 minutes for 150, a beard trim is 20 minutes for 80, and a colour treatment is 90 minutes for 450, but colour needs a consultation first so never book it by voice. We are open Monday to Friday 9 to 5 and Saturday 9 to 1. Customers must give 2 hours notice and I need 10 minutes between customers.';
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function hoursText(d: BusinessDraft) {
  const h = [...(d.hours ?? [])].sort((a, b) => ((a.day + 6) % 7) - ((b.day + 6) % 7));
  const groups: { days: string[]; t: string }[] = [];
  for (const x of h) {
    const t = `${x.open}–${x.close}`;
    const g = groups[groups.length - 1];
    if (g && g.t === t) g.days.push(DAY[x.day]); else groups.push({ days: [DAY[x.day]], t });
  }
  return groups.map((g) => `${g.days.length > 2 ? `${g.days[0]}–${g.days[g.days.length - 1]}` : g.days.join(', ')} ${g.t}`).join(' · ');
}

/** Setting up a business is one conversation with Ozza. The checklist on the right fills in as the server understands. */
export function Setup({ signedIn, onCreated }: { signedIn: boolean; onCreated: (slug: string) => void }) {
  const [draft, setDraft] = useState<BusinessDraft>(START);
  const [missing, setMissing] = useState<string[]>(['name', 'timezone', 'currency', 'services', 'hours']);
  const [complete, setComplete] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([{ who: 'ozza', text: GREETING }]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [ozza, setOzza] = useState<OzzaState>('idle');
  const [status, setStatus] = useState<string | undefined>();
  const [level, setLevel] = useState(0);
  const [google, setGoogle] = useState(false);
  const [live, setLive] = useState<number>(-1); // go-live progress step, -1 = not started
  const [err, setErr] = useState<string | null>(null);
  const rec = useRef<Recording | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { api.getConfig().then((c) => setGoogle(!!c.googleSignIn)).catch(() => {}); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [msgs.length]);

  async function send(t: string) {
    t = t.trim(); if (!t || busy) return;
    setBusy(true); setText(''); setErr(null);
    setMsgs((m) => [...m, { who: 'you', text: t }]);
    setOzza('thinking'); setStatus('Writing that down…');
    try {
      const r = await api.interview({ draft, messages: msgs.map((m) => ({ role: m.who === 'ozza' ? 'assistant' : 'user', content: m.text })).slice(-12), text: t });
      if (r.draft) setDraft(r.draft);
      if (r.missing) setMissing(r.missing);
      setComplete(!!r.complete);
      setMsgs((m) => [...m, { who: 'ozza', text: r.reply || 'Got it.' }]);
      setOzza(r.complete ? 'happy' : 'idle');
      if (r.complete) setTimeout(() => setOzza('idle'), 1400);
    } catch (e: any) {
      setOzza('confused'); setTimeout(() => setOzza('idle'), 1400);
      setErr(e.message || 'Could not reach Ozza. Please try again.');
    } finally { setBusy(false); setStatus(undefined); }
  }

  async function listen() {
    if (rec.current) { rec.current.stop(); return; }
    if (busy) return;
    if (!canRecord()) { setErr('Voice is not available in this browser. You can type instead.'); return; }
    let r: Recording;
    try { r = await recordUtterance(setLevel); } catch { setErr('Microphone permission was denied. You can type instead.'); return; }
    rec.current = r; setOzza('listening'); setErr(null);
    const blob = await r.done; rec.current = null; setLevel(0);
    if (!blob) { setOzza('idle'); return; }
    setOzza('thinking'); setStatus('Listening back…');
    try {
      const { text: heard } = await api.transcribe('', blob);
      setStatus(undefined);
      if (isPhantom(heard)) { setOzza('confused'); setTimeout(() => setOzza('idle'), 1400); setErr("I didn't catch that. Try again, or type."); return; }
      send(heard);
    } catch { setOzza('idle'); setStatus(undefined); setErr('Voice is unavailable right now. You can type instead.'); }
  }

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function goLiveBuiltIn() {
    setErr(null); setLive(0); setOzza('working');
    try {
      let slug: string | null = null;
      if (signedIn) {
        try { slug = (await api.createBusiness(draft)).slug; } catch (e: any) { if (e.status !== 401) throw e; }
      }
      await wait(500); setLive(1);
      if (!slug) {
        const { draftId } = await api.createDraft(draft);
        const r = await api.loginDemo(draftId);
        slug = r.business?.slug ?? null;
      }
      if (!slug) throw new Error('Could not create the business.');
      await wait(500); setLive(2);
      await wait(500); setLive(3); setOzza('happy');
      await wait(900);
      onCreated(slug);
    } catch (e: any) { setLive(-1); setOzza('confused'); setErr(e.message || 'Could not go live. Please try again.'); }
  }

  async function goLiveGoogle() {
    setErr(null); setLive(0); setOzza('working');
    try { const { draftId } = await api.createDraft(draft); window.location.href = api.googleSignInUrl(draftId); }
    catch (e: any) { setLive(-1); setOzza('confused'); setErr(e.message || 'Could not continue to Google.'); }
  }

  const services = draft.services ?? [];
  const items: { key: string; label: string; value: React.ReactNode; done: boolean }[] = [
    { key: 'name', label: 'Business name', value: draft.name, done: !!draft.name },
    { key: 'timezone', label: 'Time zone', value: draft.timezone?.replace(/_/g, ' '), done: !!draft.timezone },
    { key: 'currency', label: 'Currency', value: draft.currency, done: !!draft.currency },
    {
      key: 'services', label: 'Services', done: services.length > 0,
      value: services.length ? (
        <ul className="mt-1 space-y-1">{services.map((s) => (
          <li key={s.id || s.name} className="flex flex-wrap gap-x-2 items-baseline">
            <span>{s.name}</span><span className="text-ink-3 text-sm tabular">{s.durationMin} min · {s.price}</span>
            {!s.bookableByVoice && <span className="text-xs px-2 py-0.5 rounded-full bg-warn-soft text-warn">never by voice</span>}
          </li>))}</ul>
      ) : null,
    },
    { key: 'hours', label: 'Opening hours', value: (draft.hours?.length ?? 0) ? hoursText(draft) : null, done: (draft.hours?.length ?? 0) > 0 },
    { key: 'voiceRule', label: 'Voice rules', value: draft.askedVoice ? (services.some((s) => !s.bookableByVoice) ? `${services.filter((s) => !s.bookableByVoice).length} service kept off voice` : 'Everything can be booked by voice') : null, done: !!draft.askedVoice || (complete && !missing.includes('voiceRule')) },
    { key: 'bookingRules', label: 'Notice and gaps', value: draft.askedRules || draft.minNoticeMin != null ? `${draft.minNoticeMin ?? 0} min notice · ${draft.bufferMin ?? 0} min between` : null, done: !!draft.askedRules || (complete && !missing.includes('bookingRules')) },
  ];
  const doneCount = items.filter((i) => i.done).length;
  const last = [...msgs].reverse().find((m) => m.who === 'ozza')!;
  const listening = ozza === 'listening';
  const started = msgs.some((m) => m.who === 'you');

  if (live >= 0) {
    const steps = ['Saving your services and hours', 'Opening your diary', 'Switching on your booking links', 'Ozza is ready for customers'];
    return (
      <Page narrow>
        <div className="pt-16 flex flex-col items-center text-center">
          <Ozza state={live >= 3 ? 'happy' : 'working'} size={170} />
          <h1 className="serif text-4xl mt-8">Going live…</h1>
          <ul className="mt-8 text-left space-y-3">
            {steps.map((s, i) => (
              <li key={s} className={`flex items-center gap-3 transition-opacity ${i <= live ? 'opacity-100' : 'opacity-30'}`}>
                <span className={`grid place-items-center w-6 h-6 rounded-full ${i < live || live === 3 ? 'bg-ok text-white tick' : 'border hairline'}`}>{(i < live || live === 3) && <Check className="w-3.5 h-3.5" aria-hidden />}</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <div className="pt-8 grid lg:grid-cols-[1.35fr_1fr] gap-8 items-start">
        {/* Conversation */}
        <section className="rise">
          <p className="eyebrow">Set up your business</p>
          <div className="mt-5 flex items-start gap-5">
            <div className="shrink-0"><Ozza state={ozza} size={96} level={level} /></div>
            <div className="pt-1 min-w-0">
              <OzzaStatus state={ozza} text={status} />
              <p className={`serif leading-snug mt-2 rise ${last.text.length > 180 ? 'text-lg sm:text-xl' : 'text-2xl sm:text-[27px]'}`} key={msgs.length}>{last.text}</p>
            </div>
          </div>

          {!started && (
            <div className="mt-6 card p-5 bg-amber-soft/40">
              <p className="text-[15px]">Tip: say everything at once, like you'd tell a new receptionist. Ozza picks out the services, prices, hours and rules.</p>
              <button className="chip mt-3" onClick={() => send(EXAMPLE)}><Sparkles className="w-4 h-4 mr-1.5" aria-hidden />Try an example barbershop</button>
            </div>
          )}

          {started && (
            <ol className="mt-6 space-y-3 max-h-[42vh] overflow-y-auto pr-1" aria-label="Conversation">
              {msgs.slice(0, -1).concat(msgs[msgs.length - 1].who === 'you' ? [msgs[msgs.length - 1]] : []).map((m, i) => (
                <li key={i} className={m.who === 'you' ? 'text-right' : ''}>
                  <span className={`inline-block px-4 py-2.5 rounded-2xl max-w-[90%] text-left text-[15px] ${m.who === 'you' ? 'bg-ink text-white' : 'bg-surface border hairline text-ink-2'}`}>{m.text}</span>
                </li>
              ))}
              <div ref={endRef} />
            </ol>
          )}

          <form className="mt-6 flex items-end gap-3" onSubmit={(e) => { e.preventDefault(); send(text); }}>
            <button type="button" onClick={listen} disabled={busy && !listening}
              className={`shrink-0 grid place-items-center w-14 h-14 rounded-full transition-all ${listening ? 'bg-amber-deep text-white shadow-[0_0_0_8px_var(--color-amber-soft)]' : 'bg-ink text-white hover:bg-black'}`}
              aria-label={listening ? 'Stop listening' : 'Speak your answer'}>
              {listening ? <Square className="w-5 h-5" fill="currentColor" aria-hidden /> : <Mic className="w-6 h-6" aria-hidden />}
            </button>
            <textarea className="field flex-1 !rounded-3xl !px-5 !py-4 resize-none" rows={2} value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text); } }}
              placeholder={complete ? 'Anything to change? Or go live on the right.' : 'Type your answer, or tap the microphone…'} aria-label="Your answer" maxLength={1500} />
            <button className="btn btn-ghost !w-14 !h-14 !p-0" type="submit" disabled={!text.trim() || busy} aria-label="Send"><SendHorizontal className="w-5 h-5" aria-hidden /></button>
          </form>
          {err && <p className="mt-3 text-warn" role="alert">{err}</p>}
        </section>

        {/* What Ozza knows so far */}
        <aside className="card p-6 lg:sticky lg:top-24 rise-2" aria-label="What Ozza knows so far">
          <div className="flex items-baseline justify-between">
            <h2 className="serif text-2xl">What Ozza knows</h2>
            <span className="text-sm text-ink-3 tabular">{doneCount} of {items.length}</span>
          </div>
          <div className="mt-3 h-1.5 rounded-full bg-line overflow-hidden"><div className="h-full bg-amber transition-all duration-700" style={{ width: `${(doneCount / items.length) * 100}%` }} /></div>
          <ul className="mt-5 space-y-4">
            {items.map((i) => (
              <li key={i.key} className="flex gap-3">
                <span className={`mt-0.5 shrink-0 grid place-items-center w-5 h-5 rounded-full ${i.done ? 'bg-ok text-white tick' : 'border-2 hairline'}`}>{i.done && <Check className="w-3 h-3" aria-hidden />}</span>
                <div className="min-w-0">
                  <p className={`text-sm ${i.done ? 'text-ink-3' : 'text-ink-2'}`}>{i.label}</p>
                  {i.value ? <div className="text-[15px]">{i.value}</div> : <p className="text-sm text-ink-3 italic">Not yet</p>}
                </div>
              </li>
            ))}
          </ul>

          {complete && (
            <div className="mt-6 pt-6 border-t hairline rise">
              <p className="serif text-xl">Ready to go live.</p>
              <p className="text-sm text-ink-2 mt-1">Choose where bookings are written. You can change your details any time.</p>
              <div className="mt-4 flex flex-col gap-2">
                {google && <button className="btn btn-primary" onClick={goLiveGoogle}><CalendarDays className="w-4 h-4" aria-hidden />Connect Google Calendar</button>}
                <button className={`btn ${google ? 'btn-ghost' : 'btn-amber'}`} onClick={goLiveBuiltIn}><BookOpen className="w-4 h-4" aria-hidden />{google ? 'Use the built-in diary instead' : 'Go live with the built-in diary'}</button>
              </div>
              {google && <p className="text-xs text-ink-3 mt-3">Google: one click, no keys to copy. Your own events block those times automatically.</p>}
            </div>
          )}
        </aside>
      </div>
    </Page>
  );
}
