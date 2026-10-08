import React, { useState } from 'react';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { Business, BusinessHour, Service } from '../types';
import { api } from '../lib/api';
import { Page } from '../components/Shell';
import { go } from '../lib/router';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_NUM = [1, 2, 3, 4, 5, 6, 0];

/** Services, hours and booking rules, in plain words. Saving goes through the same server validation as everything else. */
export function Settings({ business, onSaved, onDeleted }: { business: Business; onSaved: (b: Business) => void; onDeleted: (slug: string) => void }) {
  const [name, setName] = useState(business.name);
  const [services, setServices] = useState<Service[]>(business.services.map((s) => ({ ...s })));
  const [hours, setHours] = useState<Record<number, BusinessHour | null>>(() => {
    const h: Record<number, BusinessHour | null> = {};
    for (const d of DAY_NUM) h[d] = business.hours.find((x) => x.day === d) ?? null;
    return h;
  });
  const [notice, setNotice] = useState(business.minNoticeMin);
  const [buffer, setBuffer] = useState(business.bufferMin);
  const [advance, setAdvance] = useState(business.maxAdvanceDays);
  const [listed, setListed] = useState(!!business.listed);
  const [confirmName, setConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);

  async function remove() {
    setDeleting(true); setDelErr(null);
    try { await api.deleteBusiness(business.slug); onDeleted(business.slug); }
    catch (e: any) { setDelErr(e.message || 'Could not delete.'); setDeleting(false); }
  }
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const setSvc = (i: number, patch: Partial<Service>) => setServices((l) => l.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const b = await api.updateMerchantBusiness(business.slug, {
        name: name.trim(),
        services: services.filter((s) => s.name.trim()).map((s) => ({ ...s, name: s.name.trim(), durationMin: Number(s.durationMin), price: Number(s.price) })),
        hours: DAY_NUM.map((d) => hours[d]).filter(Boolean) as BusinessHour[],
        minNoticeMin: Number(notice), bufferMin: Number(buffer), maxAdvanceDays: Number(advance), listed,
      });
      onSaved(b); setMsg({ ok: true, text: 'Saved. Ozza is using the new details right away.' });
    } catch (e: any) { setMsg({ ok: false, text: e.message || 'Could not save.' }); }
    finally { setBusy(false); }
  }

  return (
    <Page narrow>
      <button className="mt-8 inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink" onClick={() => go('owner', business.slug)}><ArrowLeft className="w-4 h-4" aria-hidden />Back to {business.name}</button>
      <header className="pt-6 rise">
        <p className="eyebrow">Services and hours</p>
        <h1 className="serif text-4xl mt-3">What Ozza can book</h1>
        <p className="text-ink-2 mt-2">Change anything here. The server checks every rule again on each booking, so nothing slips through.</p>
      </header>

      <section className="mt-10 card p-6">
        <label className="text-sm text-ink-2">Business name<input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>
      </section>

      <section className="mt-6 card p-6">
        <h2 className="serif text-2xl">Services</h2>
        <p className="text-sm text-ink-2 mt-1">Turn off "By voice" for anything customers should book with you directly.</p>
        <div className="mt-5 space-y-3">
          {services.map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_90px_100px_auto_auto] gap-2 items-center pb-3 border-b hairline last:border-0">
              <input className="field col-span-2 sm:col-span-1" value={s.name} onChange={(e) => setSvc(i, { name: e.target.value })} aria-label="Service name" placeholder="Service name" maxLength={60} />
              <label className="text-xs text-ink-3 flex items-center gap-1"><input className="field !w-20 tabular" type="number" min={5} max={600} step={5} value={s.durationMin} onChange={(e) => setSvc(i, { durationMin: Number(e.target.value) })} aria-label="Minutes" />min</label>
              <label className="text-xs text-ink-3 flex items-center gap-1"><input className="field !w-24 tabular" type="number" min={0} step={1} value={s.price} onChange={(e) => setSvc(i, { price: Number(e.target.value) })} aria-label="Price" />{business.currency}</label>
              <label className="text-sm flex items-center gap-2 whitespace-nowrap"><input type="checkbox" checked={s.bookableByVoice} onChange={(e) => setSvc(i, { bookableByVoice: e.target.checked })} />By voice</label>
              <button className="btn btn-ghost !p-2 !min-h-0" onClick={() => setServices((l) => l.filter((_, j) => j !== i))} aria-label={`Remove ${s.name || 'service'}`}><Trash2 className="w-4 h-4" aria-hidden /></button>
            </div>
          ))}
        </div>
        <button className="btn btn-ghost mt-4" onClick={() => setServices((l) => [...l, { id: '', name: '', durationMin: 30, price: 0, bookableByVoice: true }])}><Plus className="w-4 h-4" aria-hidden />Add a service</button>
      </section>

      <section className="mt-6 card p-6">
        <h2 className="serif text-2xl">Opening hours</h2>
        <p className="text-sm text-ink-2 mt-1">In {business.timezone.replace(/_/g, ' ')} time.</p>
        <div className="mt-5 space-y-2">
          {DAY_NUM.map((d, i) => {
            const h = hours[d];
            return (
              <div key={d} className="flex flex-wrap items-center gap-3 min-h-11">
                <label className="w-36 flex items-center gap-2"><input type="checkbox" checked={!!h} onChange={(e) => setHours((x) => ({ ...x, [d]: e.target.checked ? { day: d, open: '09:00', close: '17:00' } : null }))} />{DAYS[i]}</label>
                {h ? (
                  <span className="flex items-center gap-2 text-sm">
                    <input className="field !w-32 tabular" type="time" value={h.open} onChange={(e) => setHours((x) => ({ ...x, [d]: { ...h, open: e.target.value } }))} aria-label={`${DAYS[i]} opens`} />
                    to
                    <input className="field !w-32 tabular" type="time" value={h.close} onChange={(e) => setHours((x) => ({ ...x, [d]: { ...h, close: e.target.value } }))} aria-label={`${DAYS[i]} closes`} />
                  </span>
                ) : <span className="text-sm text-ink-3">Closed</span>}
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-6 card p-6">
        <h2 className="serif text-2xl">Booking rules</h2>
        <div className="mt-5 grid sm:grid-cols-3 gap-4">
          <label className="text-sm text-ink-2">Least notice (minutes)<input className="field mt-1 tabular" type="number" min={0} step={15} value={notice} onChange={(e) => setNotice(Number(e.target.value))} /></label>
          <label className="text-sm text-ink-2">Gap after each booking (minutes)<input className="field mt-1 tabular" type="number" min={0} step={5} value={buffer} onChange={(e) => setBuffer(Number(e.target.value))} /></label>
          <label className="text-sm text-ink-2">Book up to (days ahead)<input className="field mt-1 tabular" type="number" min={1} max={365} value={advance} onChange={(e) => setAdvance(Number(e.target.value))} /></label>
        </div>
      </section>

      <section className="mt-6 card p-6">
        <h2 className="serif text-2xl">Be found by AI assistants</h2>
        <label className="mt-4 flex items-start gap-3">
          <input type="checkbox" className="mt-1.5" checked={listed} onChange={(e) => setListed(e.target.checked)} />
          <span>
            <span className="font-medium">List {business.name} in the Open Counter directory</span>
            <span className="block text-sm text-ink-2 mt-0.5">Customers can then ask an assistant like Alexa+ to "book a haircut at {business.name}" without your link. Only your name, services, prices and hours are shared; never your customers.</span>
          </span>
        </label>
      </section>

      <section className="mt-6 card p-6 !border-warn/30" aria-labelledby="delete-heading">
        <h2 id="delete-heading" className="serif text-2xl">Delete this business</h2>
        <p className="text-sm text-ink-2 mt-1 max-w-2xl">
          Removes {business.name}, its booking links and every customer record Open Counter holds for it. This can't be undone.
          {business.calendar === 'google' ? ' Appointments already in your Google Calendar stay there.' : ''}
        </p>
        <label className="block text-sm text-ink-2 mt-4">Type <strong className="text-ink">{business.name}</strong> to confirm
          <input className="field mt-1 max-w-md" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" />
        </label>
        <button className="btn mt-4 bg-warn text-white hover:bg-[#8F3415]" onClick={remove} disabled={deleting || confirmName.trim() !== business.name.trim()}>
          <Trash2 className="w-4 h-4" aria-hidden />{deleting ? 'Deleting…' : 'Delete business'}
        </button>
        {delErr && <p className="mt-3 text-warn" role="alert">{delErr}</p>}
      </section>

      <div className="sticky bottom-0 mt-8 py-4 bg-gradient-to-t from-canvas via-canvas to-transparent flex flex-wrap items-center gap-4">
        <button className="btn btn-amber" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        {msg && <p className={msg.ok ? 'text-ok' : 'text-warn'} role="status">{msg.text}</p>}
      </div>
    </Page>
  );
}
