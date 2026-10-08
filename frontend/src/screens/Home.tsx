import React from 'react';
import { ArrowRight, Store, Mic, Code2 } from 'lucide-react';
import { Ozza } from '../components/Ozza';
import { Page } from '../components/Shell';
import { go } from '../lib/router';

/** The front door: one sentence, Ozza, three plain choices, then how it works. */
export function Home({ signedIn, onDemo, demoBusy }: { signedIn: boolean; onDemo: () => void; demoBusy: boolean }) {
  return (
    <Page>
      <section className="pt-10 sm:pt-16 pb-12 grid lg:grid-cols-[1.1fr_1fr] gap-10 items-center">
        <div className="rise">
          <p className="eyebrow">Voice bookings for small businesses</p>
          <h1 className="serif text-[44px] sm:text-[64px] leading-[1.02] mt-4">Let customers book you <em className="text-amber-deep">by talking.</em></h1>
          <p className="text-lg text-ink-2 mt-5 max-w-xl">
            Describe your business to Ozza in plain words. Customers can then book by voice, on your own link or through AI
            assistants like Alexa+. Bookings land in your Google Calendar, and every rule you set is checked before anything is booked.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button className="btn btn-primary" onClick={() => go(signedIn ? 'owner' : 'setup')}>
              <Store className="w-4 h-4" aria-hidden />{signedIn ? 'Open my business' : 'Set up my business'}
            </button>
            <button className="btn btn-ghost" onClick={() => go('talk')}><Mic className="w-4 h-4" aria-hidden />Try booking by voice</button>
          </div>
          {!signedIn && (
            <button className="mt-4 text-sm text-ink-2 underline underline-offset-4 decoration-line-2 hover:text-ink" onClick={onDemo} disabled={demoBusy}>
              {demoBusy ? 'Opening a demo business…' : 'Or look around a demo business first, no sign-in needed'}
            </button>
          )}
        </div>
        <div className="grid place-items-center rise-2">
          <Ozza state="idle" size={typeof window !== 'undefined' && window.innerWidth < 640 ? 210 : 300} />
          <p className="mt-8 text-ink-2 text-center">Hi, I'm <span className="serif text-ink text-lg">Ozza</span>. I take bookings so you can keep working.</p>
        </div>
      </section>

      <section className="border-t hairline pt-12">
        <p className="eyebrow">How it works</p>
        <div className="grid md:grid-cols-3 gap-8 mt-6">
          {[
            ['I', 'Tell Ozza about your business', 'Your services, prices, hours, and anything that must never be booked by voice. One conversation, about three minutes.'],
            ['II', 'Connect your calendar', 'One click with Google. Your own appointments block those times automatically.'],
            ['III', 'Customers book by talking', 'On your link or through any AI assistant. Ozza understands; the counter checks every rule and shows a receipt.'],
          ].map(([n, t, d]) => (
            <div key={n}>
              <p className="serif italic text-amber-deep text-xl">{n}</p>
              <h2 className="serif text-2xl mt-1">{t}</h2>
              <p className="text-ink-2 mt-2 leading-relaxed">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-16 card p-6 sm:p-8 grid md:grid-cols-[1fr_auto] gap-6 items-center">
        <div>
          <p className="eyebrow">Why you can trust it</p>
          <p className="serif text-2xl sm:text-3xl mt-2 leading-snug">The AI understands. The counter decides.</p>
          <p className="text-ink-2 mt-2 max-w-2xl">
            Ozza only works out what the customer meant. Opening hours, notice, voice-blocked services, double bookings and the
            customer's "yes" are all checked by the server, every time, and nothing is ever made up.
          </p>
        </div>
        <button className="btn btn-ghost" onClick={() => go('developers')}><Code2 className="w-4 h-4" aria-hidden />For developers<ArrowRight className="w-4 h-4" aria-hidden /></button>
      </section>
    </Page>
  );
}
