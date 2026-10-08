import React, { useEffect, useMemo, useState } from 'react';
import { Business, Service, Slot } from '../types';
import { api } from '../lib/api';
import { Page } from '../components/Shell';
import { Receipt } from '../components/Receipt';
import { Ozza } from '../components/Ozza';
import { go } from '../lib/router';

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Today's date in the business's time zone, then the next open days. */
function openDays(b: Business, n = 8) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: b.timezone }).format(new Date());
  const out: string[] = [];
  for (let i = 0; out.length < n && i < 21; i++) {
    const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i);
    if (b.hours.some((h) => h.day === d.getUTCDay())) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Book online without talking: the same server rules, the same receipt. */
export function Book({ business, customerLink }: { business: Business; customerLink: boolean }) {
  const services = business.services.filter((s) => s.bookableByVoice);
  const blocked = business.services.filter((s) => !s.bookableByVoice);
  const days = useMemo(() => openDays(business), [business.slug]);
  const [svc, setSvc] = useState<Service | null>(services[0] ?? null);
  const [date, setDate] = useState(days[0] ?? '');
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [booked, setBooked] = useState<any>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!svc || !date) return;
    setSlots(null); setSlot(null);
    api.getPublicAvailability(business.slug, svc.id, date).then((r) => setSlots(r.ok ? r.slots : [])).catch((e) => { setSlots([]); setMsg(e.message); });
  }, [svc?.id, date, business.slug]);

  async function confirm() {
    if (!svc || !slot) return;
    if (!name.trim()) { setMsg('Please enter your name.'); return; }
    setBusy(true); setMsg(null);
    try {
      const r: any = await api.createPublicBooking(business.slug, { serviceId: svc.id, start: slot.start, customerName: name.trim(), customerPhone: phone.trim() || undefined, customerConfirmed: true, idempotencyKey: key });
      setBooked(r); setKey(crypto.randomUUID());
    } catch (e: any) {
      setMsg(e.message || 'Could not book that time.');
      setSlots(null); api.getPublicAvailability(business.slug, svc.id, date).then((r) => setSlots(r.ok ? r.slots : []));
    } finally { setBusy(false); }
  }

  async function cancel() {
    try { await api.cancelPublicBooking(business.slug, booked.bookingId); setBooked(null); setMsg('Your booking is cancelled.'); } catch (e: any) { setMsg(e.message); }
  }

  if (!business.acceptingBookings) return (
    <Page narrow><div className="pt-16 text-center"><Ozza size={150} /><h1 className="serif text-3xl mt-8">{business.name} isn't taking online bookings right now.</h1><p className="text-ink-2 mt-2">Please contact them directly.</p></div></Page>
  );

  if (booked) return (
    <Page narrow>
      <div className="pt-10 grid place-items-center"><Ozza state="happy" size={130} /></div>
      <h1 className="serif text-4xl text-center mt-6">You're booked.</h1>
      <div className="mt-8"><Receipt booking={booked} business={business.name} onCancel={cancel} /></div>
      <div className="text-center mt-6"><button className="btn btn-ghost" onClick={() => setBooked(null)}>Book another</button></div>
    </Page>
  );

  return (
    <Page narrow>
      <header className="pt-10 rise">
        <p className="eyebrow">Book online</p>
        <h1 className="serif text-4xl sm:text-5xl mt-3">{business.name}</h1>
        <p className="text-ink-2 mt-2">Prefer to talk? <button className="underline underline-offset-4" onClick={() => go('talk', business.slug)}>Book with Ozza by voice</button>.</p>
      </header>

      <section className="mt-10">
        <h2 className="serif text-2xl">1. What would you like?</h2>
        <div className="mt-4 grid sm:grid-cols-2 gap-3">
          {services.map((s) => (
            <button key={s.id} onClick={() => setSvc(s)} className={`card p-4 text-left transition-all ${svc?.id === s.id ? '!border-amber shadow-[0_0_0_3px_var(--color-amber-soft)]' : 'hover:!border-line-2'}`} aria-pressed={svc?.id === s.id}>
              <span className="font-medium">{s.name}</span>
              <span className="block text-sm text-ink-2 mt-1 tabular">{s.durationMin} min · {s.price} {business.currency}</span>
            </button>
          ))}
        </div>
        {blocked.length > 0 && <p className="text-sm text-ink-3 mt-3">{blocked.map((s) => s.name).join(', ')}: please book directly with {business.name}.</p>}
      </section>

      <section className="mt-10">
        <h2 className="serif text-2xl">2. When?</h2>
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1" role="listbox" aria-label="Day">
          {days.map((d) => {
            const x = new Date(`${d}T12:00:00Z`);
            return (
              <button key={d} onClick={() => setDate(d)} role="option" aria-selected={date === d}
                className={`shrink-0 w-[72px] py-3 rounded-2xl border text-center transition-all ${date === d ? 'bg-ink text-white border-ink' : 'bg-surface hairline hover:border-line-2'}`}>
                <span className="block text-xs opacity-70">{DAY[x.getUTCDay()]}</span>
                <span className="block serif text-2xl leading-tight">{x.getUTCDate()}</span>
                <span className="block text-xs opacity-70">{MON[x.getUTCMonth()]}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-5 flex flex-wrap gap-2 min-h-11">
          {slots === null && <p className="text-ink-3 text-sm">Checking free times…</p>}
          {slots?.length === 0 && <p className="text-ink-2 text-sm">No free times that day. Try another day.</p>}
          {slots?.map((s) => (
            <button key={s.start} onClick={() => setSlot(s)} className={`chip tabular ${slot?.start === s.start ? '!bg-ink !text-white !border-ink' : ''}`} aria-pressed={slot?.start === s.start}>
              {s.start.slice(11, 16)}
            </button>
          ))}
        </div>
      </section>

      {slot && svc && (
        <section className="mt-10 card p-6 rise">
          <h2 className="serif text-2xl">3. Your details</h2>
          <div className="mt-4 grid sm:grid-cols-2 gap-3">
            <label className="text-sm text-ink-2">Name<input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} /></label>
            <label className="text-sm text-ink-2">Phone (optional)<input className="field mt-1" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" maxLength={30} /></label>
          </div>
          <p className="mt-5 text-[15px]"><span className="font-medium">{svc.name}</span>, {slot.startLocal}, {svc.price} {business.currency}</p>
          <button className="btn btn-amber mt-4 w-full sm:w-auto" onClick={confirm} disabled={busy}>{busy ? 'Booking…' : 'Confirm booking'}</button>
        </section>
      )}
      {msg && <p className="mt-4 text-warn" role="alert">{msg}</p>}
      <CancelByCode slug={business.slug} />
      {customerLink && <p className="mt-16 text-center text-xs text-ink-3">Powered by Open Counter</p>}
    </Page>
  );
}

/** Cancel later with the code from the receipt and the name on the booking. */
function CancelByCode({ slug }: { slug: string }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function go() {
    setBusy(true); setMsg(null);
    try { const r: any = await api.cancelPublicByCode(slug, code, name); setMsg({ ok: true, text: r.summary ?? 'Your booking is cancelled.' }); setCode(''); }
    catch (e: any) { setMsg({ ok: false, text: e.message || 'Could not cancel.' }); }
    finally { setBusy(false); }
  }
  return (
    <details className="mt-12 card p-5">
      <summary className="cursor-pointer font-medium">Need to cancel a booking?</summary>
      <p className="text-sm text-ink-2 mt-2">Enter the six-character code from your receipt and the name the booking is under.</p>
      <div className="mt-3 grid sm:grid-cols-[160px_1fr_auto] gap-3 items-end">
        <label className="text-sm text-ink-2">Code<input className="field mt-1 font-mono uppercase tracking-widest" value={code} onChange={(e) => setCode(e.target.value)} placeholder="K7P-Q2M" maxLength={9} autoComplete="off" /></label>
        <label className="text-sm text-ink-2">Name<input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} /></label>
        <button className="btn btn-ghost text-warn" onClick={go} disabled={busy || code.replace(/[^0-9a-z]/gi, '').length !== 6 || !name.trim()}>{busy ? 'Cancelling…' : 'Cancel booking'}</button>
      </div>
      {msg && <p className={`mt-3 ${msg.ok ? 'text-ok' : 'text-warn'}`} role="status">{msg.text}</p>}
    </details>
  );
}
