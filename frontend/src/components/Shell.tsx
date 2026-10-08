import React from 'react';
import { go, Screen } from '../lib/router';

/** Calm top bar: the wordmark and at most three plain links. Customers on a shared link see only the business name. */
export function TopBar({ screen, customerName, signedIn, onSignOut, business }: { screen: Screen; customerName?: string | null; signedIn: boolean; onSignOut: () => void; business?: string | null }) {
  const link = (s: Screen, text: string) => (
    <button onClick={() => go(s, business)} className={`px-3 py-2 rounded-full text-[14px] transition-colors ${screen === s ? 'text-ink bg-surface border hairline' : 'text-ink-2 hover:text-ink'}`} aria-current={screen === s ? 'page' : undefined}>
      {text}
    </button>
  );
  return (
    <header className="sticky top-0 z-30 backdrop-blur-md bg-canvas/80 border-b hairline">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-3">
        <button onClick={() => (customerName ? undefined : go('home'))} className="flex items-baseline gap-2 mr-auto" aria-label="Open Counter home">
          <span className="serif text-[22px] leading-none">Open Counter</span>
          {customerName && <span className="text-ink-3 text-sm hidden sm:inline">· {customerName}</span>}
        </button>
        {!customerName && (
          <nav className="flex items-center gap-1" aria-label="Main">
            {link('owner', signedIn ? 'My business' : 'For businesses')}
            {link('talk', 'Book by voice')}
            <span className="hidden sm:inline">{link('developers', 'Developers')}</span>
            {signedIn && <button onClick={onSignOut} className="px-3 py-2 text-[14px] text-ink-3 hover:text-ink hidden sm:inline">Sign out</button>}
          </nav>
        )}
      </div>
    </header>
  );
}

export function Page({ children, narrow = false }: { children: React.ReactNode; narrow?: boolean }) {
  return <main className={`${narrow ? 'max-w-3xl' : 'max-w-6xl'} mx-auto px-4 sm:px-6 pb-24`}>{children}</main>;
}
