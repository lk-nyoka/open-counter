import React, { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { api } from '../lib/api';

type State = 'loading' | 'unavailable' | 'unsupported' | 'ios' | 'off' | 'on' | 'denied' | 'working';

const keyBytes = (b64: string) => {
  const s = b64.replace(/-/g, '+').replace(/_/g, '/'); const p = s + '==='.slice((s.length + 3) % 4);
  return Uint8Array.from(atob(p), (c) => c.charCodeAt(0));
};

/** "Tell me on this phone when someone books": Web Push, no app store, no SMS costs. */
export function NotifyCard() {
  const [state, setState] = useState<State>('loading');
  const [key, setKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const c = await api.getConfig().catch(() => null);
      if (!c?.pushKey) { setState('unavailable'); return; }
      setKey(c.pushKey);
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const installed = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { setState(ios && !installed ? 'ios' : 'unsupported'); return; }
      if (Notification.permission === 'denied') { setState('denied'); return; }
      const reg = await navigator.serviceWorker.register('/sw.js').catch(() => null);
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? 'on' : 'off');
    })();
  }, []);

  async function enable() {
    setErr(null); setState('working');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState(perm === 'denied' ? 'denied' : 'off'); return; }
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key!) });
      await api.savePush(sub.toJSON());
      setState('on');
    } catch (e: any) { setErr(e.message || 'Could not turn on notifications.'); setState('off'); }
  }

  async function disable() {
    setErr(null); setState('working');
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) { await api.deletePush(sub.endpoint).catch(() => {}); await sub.unsubscribe(); }
      setState('off');
    } catch (e: any) { setErr(e.message || 'Could not turn off notifications.'); setState('on'); }
  }

  if (state === 'loading' || state === 'unavailable') return null;
  return (
    <section className="card p-6" aria-labelledby="notify-heading">
      <h2 id="notify-heading" className="serif text-2xl">New booking alerts</h2>
      {state === 'on' && <p className="text-ink-2 mt-1">This device gets a notification the moment a customer books.</p>}
      {(state === 'off' || state === 'working') && <p className="text-ink-2 mt-1">Get a notification on this phone or computer whenever a customer books, even when Open Counter is closed.</p>}
      {state === 'ios' && <p className="text-ink-2 mt-1">On iPhone, first add Open Counter to your Home Screen: tap Share, then "Add to Home Screen". Open it from there and turn alerts on.</p>}
      {state === 'unsupported' && <p className="text-ink-2 mt-1">This browser can't show booking alerts. Try Chrome, Edge, Firefox or Safari.</p>}
      {state === 'denied' && <p className="text-ink-2 mt-1">Notifications are blocked for this site. Allow them in your browser's site settings, then reload.</p>}
      <div className="mt-4">
        {state === 'on' && <button className="btn btn-ghost" onClick={disable}><BellOff className="w-4 h-4" aria-hidden />Turn off on this device</button>}
        {(state === 'off' || state === 'working') && <button className="btn btn-primary" onClick={enable} disabled={state === 'working'}><Bell className="w-4 h-4" aria-hidden />{state === 'working' ? 'Turning on…' : 'Turn on booking alerts'}</button>}
      </div>
      {err && <p className="mt-3 text-warn" role="alert">{err}</p>}
    </section>
  );
}
