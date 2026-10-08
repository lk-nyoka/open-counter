import { useEffect, useState } from 'react';

export type Screen = 'home' | 'talk' | 'book' | 'owner' | 'settings' | 'setup' | 'developers';
const SCREENS: Screen[] = ['home', 'talk', 'book', 'owner', 'settings', 'setup', 'developers'];

/** Where we are, kept in the URL (?s=owner&business=slug) so every screen can be linked and the back button works. */
export function readLocation(): { screen: Screen; business: string | null; customerLink: boolean } {
  const q = new URLSearchParams(window.location.search);
  const view = q.get('view');
  // Customer links shared by owners: /?business=<slug>&view=assistant|booking
  if (q.get('business') && (view === 'assistant' || view === 'booking')) return { screen: view === 'assistant' ? 'talk' : 'book', business: q.get('business'), customerLink: true };
  const s = q.get('s') as Screen | null;
  return { screen: s && SCREENS.includes(s) ? s : 'home', business: q.get('business'), customerLink: false };
}

export function go(screen: Screen, business?: string | null) {
  const q = new URLSearchParams();
  if (screen !== 'home') q.set('s', screen);
  if (business) q.set('business', business);
  const url = `${window.location.pathname}${q.toString() ? `?${q}` : ''}`;
  window.history.pushState(null, '', url);
  window.dispatchEvent(new Event('oc:navigate'));
  window.scrollTo({ top: 0 });
}

export function useLocation() {
  const [loc, setLoc] = useState(readLocation);
  useEffect(() => {
    const on = () => setLoc(readLocation());
    window.addEventListener('popstate', on);
    window.addEventListener('oc:navigate', on);
    return () => { window.removeEventListener('popstate', on); window.removeEventListener('oc:navigate', on); };
  }, []);
  return loc;
}
