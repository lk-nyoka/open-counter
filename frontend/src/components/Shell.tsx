import React from 'react';
import { go, Screen } from '../lib/router';

/** Calm top bar: the wordmark and at most three plain links. Customers on a shared link see only the business name. */
export function TopBar({ screen, customerName, signedIn, onSignOut, business }: { screen: Screen; customerName?: string | null; signedIn: boolean; onSignOut: () => void; business?: string | null }) {
  const link = (s: Screen, text: string, short = text) => (
    <button onClick={() => go(s, business)} className={`whitespace-nowrap px-2.5 sm:px-3 py-2 rounded-full text-[14px] transition-colors ${screen === s ? 'text-ink bg-surface border hairline' : 'text-ink-2 hover:text-ink'}`} aria-current={screen === s ? 'page' : undefined}>
      <span className="sm:hidden">{short}</span><span className="hidden sm:inline">{text}</span>
    </button>
  );
  return (
    <header className="sticky top-0 z-30 backdrop-blur-md bg-canvas/80 border-b hairline">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-3">
        <button onClick={() => (customerName ? undefined : go('home'))} className="flex items-baseline gap-2 mr-auto min-w-0" aria-label="Open Counter home">
          <span className="serif text-[20px] sm:text-[22px] leading-none whitespace-nowrap">Open Counter</span>
          {customerName && <span className="text-ink-3 text-sm hidden sm:inline">· {customerName}</span>}
        </button>
        {!customerName && (
          <nav className="flex items-center gap-0.5 sm:gap-1 shrink-0" aria-label="Main">
            {link('owner', signedIn ? 'My business' : 'For businesses', 'Business')}
            {link('talk', 'Book by voice', 'Book')}
            <span className="hidden sm:inline">{link('developers', 'Developers')}</span>
            {signedIn && <button onClick={onSignOut} className="whitespace-nowrap px-2.5 sm:px-3 py-2 text-[14px] text-ink-2 hover:text-ink">Sign out</button>}
          </nav>
        )}
      </div>
    </header>
  );
}

export function Page({ children, narrow = false }: { children: React.ReactNode; narrow?: boolean }) {
  return <main className={`${narrow ? 'max-w-3xl' : 'max-w-6xl'} mx-auto px-4 sm:px-6 pb-24`}>{children}</main>;
}
