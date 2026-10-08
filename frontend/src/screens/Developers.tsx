import React, { useState } from 'react';
import { Copy, Check, Play, ExternalLink } from 'lucide-react';
import { Business } from '../types';
import { API_BASE } from '../lib/api';
import { Page } from '../components/Shell';

const TOOLS = [
  ['find_business', 'Directory only: finds listed businesses by name or service, so one add-on serves every business.'],
  ['get_business_info', 'Name, time zone, hours and services with prices. Assistants call this first.'],
  ['get_quote', 'Price and duration of one service.'],
  ['check_availability', 'Free start times for a service on one date, from the live calendar.'],
  ['book', "Books a slot. Refused unless the customer said yes, the time is free, and every rule passes."],
  ['cancel', 'Cancels a booking made through the counter.'],
];

const GATES = [
  'The business is accepting bookings',
  'The service may be booked by voice',
  'The time is inside opening hours',
  'Enough notice is given',
  'The calendar is free (your own events count)',
  'A lock is taken so two assistants can never take the same slot',
  'The customer said yes to the read-back',
  'The event is written to the calendar',
];

/** MCP responses can arrive as JSON or as one server-sent event. */
async function readRpc(r: Response) {
  const t = await r.text();
  const data = t.trim().startsWith('{') ? t : t.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('');
  try { return JSON.parse(data); } catch { return { raw: t }; }
}

/** For developers and judges: the MCP endpoint, the tools, the rules, and a live call against the real server. */
export function Developers({ business }: { business: Business }) {
  const base = API_BASE || window.location.origin;
  const endpoint = `${base}/mcp/${business.slug}`;
  const directory = `${base}/mcp`;
  const config = JSON.stringify({ mcpServers: { [business.slug]: { type: 'http', url: endpoint } } }, null, 2);
  const [copied, setCopied] = useState<string | null>(null);
  const [out, setOut] = useState<string>('');
  const [running, setRunning] = useState<string | null>(null);

  const copy = (k: string, v: string) => { navigator.clipboard?.writeText(v); setCopied(k); setTimeout(() => setCopied(null), 1500); };

  async function run(kind: 'list' | 'info' | 'avail' | 'find') {
    setRunning(kind); setOut('');
    const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: business.timezone }).format(new Date(Date.now() + 864e5));
    const svc = business.services.find((s) => s.bookableByVoice);
    const url = kind === 'find' ? directory : endpoint;
    const params = kind === 'info' ? { name: 'get_business_info', arguments: {} }
      : kind === 'avail' ? { name: 'check_availability', arguments: { serviceId: svc?.id, date: tomorrow } }
      : { name: 'find_business', arguments: { query: svc?.name ?? business.name } };
    const body = kind === 'list' ? { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} } : { jsonrpc: '2.0', id: 1, method: 'tools/call', params };
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-oc-channel': 'mcp' }, body: JSON.stringify(body) });
      const j = await readRpc(r);
      const shown = kind === 'list'
        ? { tools: (j.result?.tools ?? []).map((t: any) => ({ name: t.name, title: t.title, annotations: t.annotations, input: Object.keys(t.inputSchema?.properties ?? {}), ui: t._meta?.ui?.resourceUri })) }
        : (j.result?.structuredContent ?? j);
      setOut(`POST ${url}\n→ ${body.method}${kind !== 'list' ? ` ${params.name}` : ''}\n\n${JSON.stringify(shown, null, 2)}`);
    } catch (e: any) { setOut(`Request failed: ${e.message}`); }
    finally { setRunning(null); }
  }

  const CopyBtn = ({ k, v }: { k: string; v: string }) => (
    <button className="btn btn-ghost !min-h-9 !px-3 text-sm shrink-0" onClick={() => copy(k, v)} aria-label={`Copy ${k}`}>
      {copied === k ? <Check className="w-4 h-4 text-ok" aria-hidden /> : <Copy className="w-4 h-4" aria-hidden />}{copied === k ? 'Copied' : 'Copy'}
    </button>
  );

  return (
    <Page>
      <header className="pt-10 rise max-w-3xl">
        <p className="eyebrow">For developers</p>
        <h1 className="serif text-4xl sm:text-5xl mt-3">Any AI assistant can book {business.name}.</h1>
        <p className="text-lg text-ink-2 mt-3">Open Counter is a Model Context Protocol server (spec 2025-11-25, Streamable HTTP, stateless) built for Alexa+ and any other assistant. The assistant understands the customer; the counter checks every rule before anything is booked.</p>
      </header>

      <section className="mt-10 card p-6">
        <p className="eyebrow">One add-on for every business</p>
        <div className="mt-3 flex items-center gap-3">
          <code className="flex-1 min-w-0 truncate rounded-xl bg-canvas border hairline px-4 py-3 text-[14px]">{directory}</code>
          <CopyBtn k="directory" v={directory} />
        </div>
        <p className="text-sm text-ink-2 mt-2">Finds and books any business whose owner listed it. This is the endpoint an Alexa+ add-on registers.</p>
        <p className="eyebrow mt-6">Just {business.name}</p>
        <div className="mt-3 flex items-center gap-3">
          <code className="flex-1 min-w-0 truncate rounded-xl bg-canvas border hairline px-4 py-3 text-[14px]">{endpoint}</code>
          <CopyBtn k="endpoint" v={endpoint} />
        </div>
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-ink-2">Client config (JSON)</summary>
          <div className="mt-3 relative">
            <pre className="rounded-xl bg-ink text-white/90 p-4 text-[13px] overflow-x-auto">{config}</pre>
            <div className="absolute top-2 right-2"><CopyBtn k="config" v={config} /></div>
          </div>
        </details>
      </section>

      <div className="mt-6 grid lg:grid-cols-2 gap-6">
        <section className="card p-6">
          <h2 className="serif text-2xl">Tools</h2>
          <p className="text-ink-2 text-[15px] mt-1">Each has a title, read-only or destructive annotations, an output schema, and a <code>summary</code> written to be said aloud.</p>
          <ul className="mt-4 space-y-3">
            {TOOLS.map(([n, d]) => <li key={n}><code className="text-[14px] text-amber-deep">{n}</code><p className="text-ink-2 text-[15px]">{d}</p></li>)}
          </ul>
        </section>
        <section className="card p-6">
          <h2 className="serif text-2xl">Eight checks on every booking</h2>
          <p className="text-ink-2 text-[15px] mt-1">The model proposes; the server decides. A refusal names the check that failed.</p>
          <ol className="mt-4 space-y-2">
            {GATES.map((g, i) => <li key={g} className="flex gap-3 text-[15px]"><span className="serif text-amber-deep w-5 tabular">{i + 1}</span>{g}</li>)}
          </ol>
        </section>
      </div>

      <section className="mt-6 card p-6">
        <h2 className="serif text-2xl">A booking card on screens</h2>
        <p className="text-ink-2 text-[15px] mt-1 max-w-3xl">
          <code>check_availability</code>, <code>book</code> and <code>cancel</code> link to an MCP Apps view, <code>ui://open-counter/booking-card.html</code>.
          On a device with a screen, such as an Echo Show, the host shows free times to tap, the read-back with a "Yes, book it" button, and the receipt with every check ticked.
          Taps go back through the assistant, so the conversation stays in charge.
        </p>
      </section>

      <section className="mt-6 card p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="serif text-2xl mr-auto">Try it live</h2>
          <button className="btn btn-ghost" onClick={() => run('list')} disabled={!!running}><Play className="w-4 h-4" aria-hidden />tools/list</button>
          <button className="btn btn-ghost" onClick={() => run('find')} disabled={!!running}><Play className="w-4 h-4" aria-hidden />find_business</button>
          <button className="btn btn-ghost" onClick={() => run('info')} disabled={!!running}><Play className="w-4 h-4" aria-hidden />get_business_info</button>
          <button className="btn btn-amber" onClick={() => run('avail')} disabled={!!running}><Play className="w-4 h-4" aria-hidden />check_availability (tomorrow)</button>
        </div>
        <pre className="mt-4 rounded-xl bg-ink text-white/90 p-4 text-[13px] overflow-auto max-h-[460px] min-h-24" aria-live="polite">{running ? 'Calling the real server…' : out || 'Press a button to call the MCP server. Nothing here is mocked.'}</pre>
      </section>

      <p className="mt-8 text-ink-2">
        More: <a className="underline underline-offset-4 inline-flex items-center gap-1" href="/protocol.html" target="_blank" rel="noreferrer">protocol notes<ExternalLink className="w-3.5 h-3.5" aria-hidden /></a>
      </p>
    </Page>
  );
}
