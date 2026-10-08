import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, ExternalLink, Plus, Settings2, Mic, Globe, Bot, PenLine, X, CalendarCheck2, AlertTriangle } from 'lucide-react';
import { Business, Booking, BusinessStats, Slot } from '../types';
import { api } from '../lib/api';
import { Page } from '../components/Shell';
import { Ozza, OzzaState } from '../components/Ozza';
import { go } from '../lib/router';

const VIA: Record<string, { label: string; Icon: any }> = {
  voice: { label: 'Voice, on your link', Icon: Mic },
  web: { label: 'Booking page', Icon: Globe },
  mcp: { label: 'AI assistant (MCP)', Icon: Bot },
  owner: { label: 'Added by you', Icon: PenLine },
};

function greeting(tz: string) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', hour12: false }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
const dayKey = (iso: string, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso));
function dayLabel(key: string, tz: string) {
  const today = dayKey(new Date().toISOString(), tz);
  const t = new Date(`${today}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + 1);
  if (key === today) return 'Today';
  if (key === t.toISOString().slice(0, 10)) return 'Tomorrow';
  return new Date(`${key}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}
const timeOf = (iso: string, tz: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** The owner's home: what Ozza did today, what's coming, and how to share. Plain words, no jargon. */
export function Owner({ business, businesses, merchant, onSwitch, onChanged }: {
  business: Business; businesses: Business[]; merchant: { email?: string; demo?: boolean } | null;
  onSwitch: (slug: string) => void; onChanged: (b: Business) => void;
}) {
  const [stats, setStats] = useState<BusinessStats | null>(null);
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [health, setHealth] = useState<string>('ok');
  const [ozza, setOzza] = useState<OzzaState>('idle');
  const [toast, setToast] = useState<string | null>(null);
  const [walkin, setWalkin] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const known = useRef<Set<string> | null>(null);
  const tz = business.timezone;
  const welcome = new URLSearchParams(window.location.search).get('welcome') === business.slug;

  async function load() {
    const [s, b] = await Promise.all([api.getMerchantStats(business.slug), api.getMerchantBookings(business.slug, { status: 'confirmed' })]);
    setStats(s); setBookings(b);
    // A booking that wasn't here a moment ago: Ozza celebrates and says where it came from.
    if (known.current) {
      const fresh = b.filter((x) => !known.current!.has(x.id));
      if (fresh.length) {
        const n = fresh[0];
        setToast(`New booking: ${n.serviceName}, ${n.startLocal}, ${VIA[n.channel]?.label.toLowerCase() ?? n.channel}.`);
        setOzza('happy'); setTimeout(() => setOzza('idle'), 1500); setTimeout(() => setToast(null), 6000);
      }
    }
    known.current = new Set(b.map((x) => x.id));
  }

  useEffect(() => {
    known.current = null; setStats(null); setBookings(null);
    load().catch(() => {});
    api.getMerchantHealth(business.slug).then((h) => setHealth(h.calendar)).catch(() => {});
    const t = setInterval(() => load().catch(() => {}), 15000);
    return () => clearInterval(t);
  }, [business.slug]);

  const groups = useMemo(() => {
    const g = new Map<string, Booking[]>();
    for (const b of bookings ?? []) { const k = dayKey(b.start, tz); g.set(k, [...(g.get(k) ?? []), b]); }
    return [...g.entries()];
  }, [bookings, tz]);

  async function toggle() {
    const b = await api.updateMerchantBusiness(business.slug, { acceptingBookings: !business.acceptingBookings });
    onChanged(b);
  }
  async function cancel(b: Booking) {
    if (!confirm(`Cancel ${b.customerName}'s ${b.serviceName} on ${b.startLocal}? The time becomes free again. The customer is not notified automatically.`)) return;
    await api.cancelOwnerBooking(business.slug, b.id).catch((e) => alert(e.message));
    load();
  }
  const copy = (k: string, v: string) => { navigator.clipboard?.writeText(v); setCopied(k); setTimeout(() => setCopied(null), 1200); };
  const voiceLink = `${window.location.origin}/?business=${business.slug}&view=assistant`;
  const bookLink = `${window.location.origin}/?business=${business.slug}&view=booking`;
  const mcpLink = business.links?.mcp ?? `${window.location.origin}/mcp/${business.slug}`;
  const today = stats?.today.bookings ?? 0;

  return (
    <Page>
      {toast && <div role="status" className="fixed top-20 left-1/2 -translate-x-1/2 z-40 card px-5 py-3 shadow-xl rise flex items-center gap-2"><CalendarCheck2 className="w-5 h-5 text-ok" aria-hidden />{toast}</div>}

      <section className="pt-8 sm:pt-12 flex flex-col sm:flex-row sm:items-center gap-6">
        <Ozza state={ozza} size={112} />
        <div className="flex-1">
          <p className="eyebrow">{greeting(tz)}{merchant?.demo ? ' · demo business (resets in a day)' : merchant?.email ? ` · ${merchant.email}` : ''}</p>
          <h1 className="serif text-[34px] sm:text-[44px] leading-tight mt-2">
            {stats === null ? business.name : today ? <>Ozza has <em className="text-amber-deep">{today} booking{today === 1 ? '' : 's'}</em> for you today.</> : <>{business.name} is ready for bookings.</>}
          </h1>
          <p className="text-ink-2 mt-2">
            {stats?.next ? <>Next: <strong className="font-medium text-ink">{stats.next.serviceName}</strong> for {stats.next.customerName}, {dayLabel(dayKey(stats.next.start, tz), tz).toLowerCase()} at {timeOf(stats.next.start, tz)}.</> : 'Share your voice link below and bookings will appear here as they happen.'}
          </p>
        </div>
        {businesses.length > 1 && (
          <select className="field !w-auto" value={business.slug} onChange={(e) => onSwitch(e.target.value)} aria-label="Business">
            {businesses.map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}
          </select>
        )}
      </section>

      {welcome && <div className="mt-6 card p-5 border-ok/30 bg-ok-soft/50 rise"><strong className="font-medium">You're live.</strong> Customers can now book {business.name} by voice. Share your links below.</div>}
      {health === 'reconnect' && (
        <div className="mt-6 card p-5 flex items-center gap-3 border-warn/30"><AlertTriangle className="w-5 h-5 text-warn" aria-hidden /><span className="flex-1">Your Google Calendar link needs a refresh to keep taking bookings.</span><a className="btn btn-primary" href={api.googleSignInUrl()}>Reconnect</a></div>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <button onClick={toggle} role="switch" aria-checked={business.acceptingBookings} className={`btn ${business.acceptingBookings ? 'btn-ghost' : 'btn-amber'}`}>
          <span className={`w-2.5 h-2.5 rounded-full ${business.acceptingBookings ? 'bg-ok' : 'bg-white'}`} aria-hidden />
          {business.acceptingBookings ? 'Taking bookings · pause' : 'Paused · resume bookings'}
        </button>
        <button className="btn btn-ghost" onClick={() => setWalkin(true)}><Plus className="w-4 h-4" aria-hidden />Add a booking</button>
        <button className="btn btn-ghost" onClick={() => go('settings', business.slug)}><Settings2 className="w-4 h-4" aria-hidden />Services and hours</button>
        <button className="btn btn-ghost" onClick={() => go('setup')}>Set up another business</button>
      </div>

      <div className="mt-8 grid lg:grid-cols-[1.5fr_1fr] gap-6 items-start">
        <section className="card p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="serif text-2xl">Coming up</h2>
            <span className="text-sm text-ink-3">next 30 days</span>
          </div>
          {bookings === null && <p className="text-ink-3 mt-6">Loading…</p>}
          {bookings?.length === 0 && <p className="text-ink-2 mt-6">No bookings yet. Try your own voice link: book something as a customer and watch it appear here.</p>}
          {groups.map(([k, list]) => (
            <div key={k} className="mt-6">
              <p className="eyebrow">{dayLabel(k, tz)}</p>
              <ul className="mt-2 divide-y divide-line">
                {list.map((b) => { const V = VIA[b.channel] ?? VIA.mcp; return (
                  <li key={b.id} className="py-3 flex items-center gap-4">
                    <span className="serif text-xl w-16 tabular">{timeOf(b.start, tz)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{b.customerName} <span className="text-ink-2 font-normal">· {b.serviceName}</span></p>
                      <p className="text-sm text-ink-3 flex items-center gap-1.5"><V.Icon className="w-3.5 h-3.5" aria-hidden />{V.label}{b.customerPhone ? ` · ${b.customerPhone}` : ''}</p>
                    </div>
                    <span className="text-sm text-ink-2 tabular hidden sm:inline">{b.price} {business.currency}</span>
                    <button className="text-sm text-ink-3 hover:text-warn px-2 py-1" onClick={() => cancel(b)} aria-label={`Cancel ${b.customerName}'s booking`}>Cancel</button>
                  </li>
                ); })}
              </ul>
            </div>
          ))}
        </section>

        <div className="space-y-6">
          <section className="card p-6">
            <h2 className="serif text-2xl">Share your business</h2>
            {[
              ['voice', 'Book by voice with Ozza', voiceLink, true],
              ['book', 'Booking page', bookLink, true],
              ['mcp', 'For Alexa+ and other AI assistants', mcpLink, false],
            ].map(([k, label, url, open]) => (
              <div key={k as string} className="mt-4">
                <p className="text-sm text-ink-2">{label as string}</p>
                <div className="mt-1 flex items-center gap-2">
                  <code className="flex-1 min-w-0 truncate text-[13px] bg-canvas border hairline rounded-lg px-3 py-2">{url as string}</code>
                  <button className="btn btn-ghost !min-h-10 !px-3" onClick={() => copy(k as string, url as string)} aria-label={`Copy ${label}`}><Copy className="w-4 h-4" aria-hidden />{copied === k ? 'Copied' : ''}</button>
                  {open && <a className="btn btn-ghost !min-h-10 !px-3" href={url as string} target="_blank" rel="noreferrer" aria-label={`Open ${label}`}><ExternalLink className="w-4 h-4" aria-hidden /></a>}
                </div>
              </div>
            ))}
            <p className="text-sm text-ink-3 mt-4">
              {business.calendar === 'google' ? 'Bookings go straight into your Google Calendar. Your own events block those times.' : business.calendar === 'internal' ? "Bookings are kept in Open Counter's built-in calendar." : 'Bookings go into the shared Google Calendar.'}
            </p>
          </section>

          <section className="card p-6">
            <h2 className="serif text-2xl">This week</h2>
            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <div><p className="serif text-3xl tabular">{stats?.week.bookings ?? '–'}</p><p className="text-xs text-ink-3 mt-1">bookings</p></div>
              <div><p className="serif text-3xl tabular">{stats ? Math.round(stats.week.revenue) : '–'}</p><p className="text-xs text-ink-3 mt-1">{business.currency} booked</p></div>
              <div><p className="serif text-3xl tabular">{stats?.week.cancelled ?? '–'}</p><p className="text-xs text-ink-3 mt-1">cancelled</p></div>
            </div>
            <ChannelBars stats={stats} />
          </section>
        </div>
      </div>

      {walkin && <WalkIn business={business} onClose={() => setWalkin(false)} onDone={() => { setWalkin(false); load(); }} />}
    </Page>
  );
}

function ChannelBars({ stats }: { stats: BusinessStats | null }) {
  const by = (stats?.byChannel ?? {}) as Record<string, number>;
  const total = Object.values(by).reduce((a, b) => a + b, 0);
  if (!total) return <p className="text-sm text-ink-3 mt-5">Where bookings come from will show here.</p>;
  return (
    <div className="mt-5 space-y-2.5" aria-label="Where bookings came from">
      {Object.entries(VIA).filter(([k]) => by[k]).map(([k, v]) => (
        <div key={k}>
          <div className="flex justify-between text-sm"><span className="flex items-center gap-1.5 text-ink-2"><v.Icon className="w-3.5 h-3.5" aria-hidden />{v.label}</span><span className="tabular">{by[k]}</span></div>
          <div className="h-1.5 rounded-full bg-canvas mt-1 overflow-hidden"><div className="h-full rounded-full bg-amber" style={{ width: `${(by[k] / total) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

/** A booking the owner takes by phone or at the counter. Same rules and locks as every other booking. */
function WalkIn({ business, onClose, onDone }: { business: Business; onClose: () => void; onDone: () => void }) {
  const [svc, setSvc] = useState(business.services[0]?.id ?? '');
  const [date, setDate] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: business.timezone }).format(new Date()));
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [start, setStart] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setSlots(null); setStart('');
    api.getMerchantAvailability(business.slug, svc, date).then((r) => { setSlots(r.ok ? r.slots : []); setStart(r.ok && r.slots[0] ? r.slots[0].start : ''); }).catch(() => setSlots([]));
  }, [svc, date]);
  async function save() {
    if (!start) { setMsg('Pick a free time.'); return; }
    setBusy(true); setMsg(null);
    try { await api.createOwnerBooking(business.slug, { serviceId: svc, start, customerName: name.trim() || 'Walk-in', customerPhone: phone.trim() || undefined, idempotencyKey: crypto.randomUUID() }); onDone(); }
    catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-50 bg-ink/30 backdrop-blur-sm grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Add a booking" onClick={onClose}>
      <div className="card p-6 w-full max-w-md rise" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h2 className="serif text-2xl">Add a booking</h2><button onClick={onClose} aria-label="Close" className="p-2"><X className="w-5 h-5" aria-hidden /></button></div>
        <p className="text-sm text-ink-2 mt-1">For walk-ins and phone calls. Any service, same rules.</p>
        <div className="mt-4 space-y-3">
          <label className="block text-sm text-ink-2">Service<select className="field mt-1" value={svc} onChange={(e) => setSvc(e.target.value)}>{business.services.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.durationMin} min</option>)}</select></label>
          <label className="block text-sm text-ink-2">Day<input className="field mt-1" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="block text-sm text-ink-2">Time<select className="field mt-1" value={start} onChange={(e) => setStart(e.target.value)}>{slots === null ? <option>Checking…</option> : slots.length ? slots.map((s) => <option key={s.start} value={s.start}>{s.start.slice(11, 16)}</option>) : <option value="">No free times that day</option>}</select></label>
          <label className="block text-sm text-ink-2">Customer name<input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>
          <label className="block text-sm text-ink-2">Phone (optional)<input className="field mt-1" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} /></label>
        </div>
        {msg && <p className="text-warn text-sm mt-3" role="alert">{msg}</p>}
        <button className="btn btn-primary w-full mt-5" onClick={save} disabled={busy}>{busy ? 'Adding…' : 'Add booking'}</button>
      </div>
    </div>
  );
}
