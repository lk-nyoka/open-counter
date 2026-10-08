import React, { useEffect, useState } from 'react';
import { RefreshCw, CalendarDays, Store, Eye } from 'lucide-react';
import { Business } from './types';
import { api, getAuthToken, setAuthToken } from './lib/api';
import { useLocation, go } from './lib/router';
import { TopBar, Page } from './components/Shell';
import { Ozza } from './components/Ozza';
import { Home } from './screens/Home';
import { Talk } from './screens/Talk';
import { Book } from './screens/Book';
import { Owner } from './screens/Owner';
import { Settings } from './screens/Settings';
import { Setup } from './screens/Setup';
import { Developers } from './screens/Developers';

const PUBLIC_DEMO = 'demo-barber';
type Me = { merchant: { email?: string; demo?: boolean; name?: string }; businesses: { slug: string; name: string }[] };

/** Arriving back from Google: #token=… (other domain) or ?welcome=<slug> / ?signedin=1 (same domain). Turn it into the owner screen. */
function absorbReturn() {
  const frag = new URLSearchParams(window.location.hash.slice(1));
  if (frag.get('token')) setAuthToken(frag.get('token'));
  const q = new URLSearchParams(window.location.search);
  const welcome = frag.get('welcome') || q.get('welcome');
  if (frag.get('token') || welcome || q.get('signedin')) {
    const n = new URLSearchParams({ s: 'owner' });
    if (welcome) { n.set('business', welcome); n.set('welcome', welcome); }
    window.history.replaceState(null, '', `${window.location.pathname}?${n}`);
  }
}

function Loading({ text = 'Loading…' }: { text?: string }) {
  return <Page narrow><div className="pt-24 flex flex-col items-center gap-6 text-ink-2"><Ozza state="thinking" size={120} /><p>{text}</p></div></Page>;
}

export default function App() {
  const loc = useLocation();
  const [me, setMe] = useState<Me | null>(null);
  const [meReady, setMeReady] = useState(false);
  const [owned, setOwned] = useState<Record<string, Business>>({});
  const [pub, setPub] = useState<Record<string, Business>>({});
  const [google, setGoogle] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);

  async function loadMe(): Promise<Me | null> {
    try { const m = await api.getMe(); setMe(m); return m; }
    catch (e: any) { if (e.status === 401) { if (getAuthToken()) setAuthToken(null); setMe(null); return null; } throw e; }
  }

  useEffect(() => {
    absorbReturn();
    window.dispatchEvent(new Event('oc:navigate'));
    api.getConfig().then((c) => setGoogle(!!c.googleSignIn)).catch(() => {});
    if (loc.customerLink) { setMeReady(true); return; } // customers never touch owner data
    loadMe().catch((e) => setError(e.message)).finally(() => setMeReady(true));
  }, []);

  const signedIn = !!me;
  const ownerScreens = loc.screen === 'owner' || loc.screen === 'settings';
  const ownedSlugs = me?.businesses.map((b) => b.slug) ?? [];
  // Which business is on screen: the one in the URL, else the owner's first, else the public demo.
  const slug = loc.business || (ownerScreens ? ownedSlugs[0] : ownedSlugs[0] || PUBLIC_DEMO) || null;
  const isMine = !!slug && ownedSlugs.includes(slug) && !loc.customerLink;
  const business = slug ? (isMine ? owned[slug] : pub[slug] ?? owned[slug]) : undefined;

  useEffect(() => {
    if (!meReady || !slug || business) return;
    if (ownerScreens && !isMine) return;
    setError(null);
    (isMine ? api.getMerchantBusiness(slug).then((b) => setOwned((o) => ({ ...o, [slug]: b })))
      : api.getPublicBusiness(slug).then((b) => setPub((p) => ({ ...p, [slug]: b }))))
      .catch((e) => setError(e.status === 404 ? 'That business does not exist.' : e.message));
  }, [meReady, slug, isMine, !!business, ownerScreens]);

  async function startDemo() {
    setDemoBusy(true); setError(null);
    try {
      const r = await api.loginDemo();
      await loadMe();
      go('owner', r.business?.slug);
    } catch (e: any) { setError(e.message); }
    finally { setDemoBusy(false); }
  }

  async function created(newSlug: string) {
    await loadMe();
    const b = await api.getMerchantBusiness(newSlug);
    setOwned((o) => ({ ...o, [newSlug]: b }));
    window.history.pushState(null, '', `${window.location.pathname}?s=owner&business=${newSlug}&welcome=${newSlug}`);
    window.dispatchEvent(new Event('oc:navigate'));
    window.scrollTo({ top: 0 });
  }

  async function signOut() {
    await api.logout().catch(() => {});
    setMe(null); setOwned({});
    go('home');
  }

  const changed = (b: Business) => setOwned((o) => ({ ...o, [b.slug]: b }));

  function screen() {
    if (!meReady) return <Loading />;
    if (error) return (
      <Page narrow>
        <div className="pt-20 flex flex-col items-center text-center">
          <Ozza state="confused" size={130} />
          <h1 className="serif text-3xl mt-8">Something went wrong.</h1>
          <p className="text-ink-2 mt-2 max-w-md">{error}</p>
          <div className="mt-6 flex gap-3">
            <button className="btn btn-primary" onClick={() => window.location.reload()}><RefreshCw className="w-4 h-4" aria-hidden />Try again</button>
            {!loc.customerLink && <button className="btn btn-ghost" onClick={() => { setError(null); go('home'); }}>Go home</button>}
          </div>
        </div>
      </Page>
    );

    switch (loc.screen) {
      case 'home': return <Home signedIn={signedIn} onDemo={startDemo} demoBusy={demoBusy} />;
      case 'setup': return <Setup signedIn={signedIn} onCreated={created} />;
      case 'talk': return business ? <Talk business={business} /> : <Loading />;
      case 'book': return business ? <Book business={business} customerLink={loc.customerLink} /> : <Loading />;
      case 'developers': return business ? <Developers business={business} /> : <Loading />;
      case 'owner':
      case 'settings':
        if (!signedIn || !slug) return <SignIn google={google} onDemo={startDemo} demoBusy={demoBusy} />;
        if (!isMine) return <SignIn google={google} onDemo={startDemo} demoBusy={demoBusy} note="That business isn't on this account." />;
        if (!business) return <Loading text="Opening your business…" />;
        return loc.screen === 'owner'
          ? <Owner business={business} businesses={(me!.businesses as any) as Business[]} merchant={me!.merchant} onSwitch={(s) => go('owner', s)} onChanged={changed} />
          : <Settings business={business} onSaved={changed} />;
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar screen={loc.screen} customerName={loc.customerLink ? business?.name ?? '' : null} signedIn={signedIn} onSignOut={signOut} business={isMine ? slug : null} />
      <div className="flex-1">{screen()}</div>
      <footer className="border-t hairline">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-3">
          <span>Open Counter</span>
          <a className="hover:text-ink" href="/privacy.html">Privacy</a>
          <a className="hover:text-ink" href="/terms.html">Terms</a>
          {!loc.customerLink && <a className="hover:text-ink" href="https://github.com/lk-nyoka/open-counter" target="_blank" rel="noreferrer">Open source (Apache 2.0)</a>}
        </div>
      </footer>
    </div>
  );
}

/** The owner side when nobody is signed in: three plain ways in. */
function SignIn({ google, onDemo, demoBusy, note }: { google: boolean; onDemo: () => void; demoBusy: boolean; note?: string }) {
  return (
    <Page narrow>
      <div className="pt-14 flex flex-col items-center text-center rise">
        <Ozza size={140} />
        <h1 className="serif text-4xl mt-8">Your business, by voice.</h1>
        <p className="text-ink-2 mt-2 max-w-md">{note ?? 'Set up in one conversation, or sign in to see your bookings.'}</p>
        <div className="mt-8 flex flex-col gap-3 w-full max-w-sm">
          <button className="btn btn-primary" onClick={() => go('setup')}><Store className="w-4 h-4" aria-hidden />Set up my business</button>
          {google && <a className="btn btn-ghost" href={api.googleSignInUrl()}><CalendarDays className="w-4 h-4" aria-hidden />Sign in with Google</a>}
          <button className="btn btn-ghost" onClick={onDemo} disabled={demoBusy}><Eye className="w-4 h-4" aria-hidden />{demoBusy ? 'Opening a demo…' : 'Look around a demo business'}</button>
        </div>
      </div>
    </Page>
  );
}
