import React, { useState } from 'react';
import { Check, Copy, CalendarPlus } from 'lucide-react';

export interface Check { id: string; label: string; ok: boolean }

/** .ics file so the customer can add the appointment to their own calendar. Built in the browser from real times. */
function icsFor(title: string, startIso: string, endIso: string, code: string) {
  const f = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Open Counter//EN', 'BEGIN:VEVENT', `UID:${code}@open-counter`, `DTSTAMP:${f(new Date().toISOString())}`,
    `DTSTART:${f(startIso)}`, `DTEND:${f(endIso)}`, `SUMMARY:${title}`, `DESCRIPTION:Booking code ${code}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  return URL.createObjectURL(new Blob([body], { type: 'text/calendar' }));
}

/**
 * The booking receipt: every rule the server checked before it booked, then the result.
 * The checks come from the server's own response (`checks`), never from the page.
 */
export function Receipt({ booking, business, onCancel }: {
  booking: { bookingId: string; service: string; startLocal: string; start: string; end: string; checks?: Check[] };
  business: string;
  onCancel?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const checks = booking.checks ?? [];
  return (
    <section className="card p-6 sm:p-7 rise text-left" aria-label="Booking receipt">
      <p className="eyebrow">Booking receipt</p>
      <h3 className="serif text-2xl sm:text-3xl mt-2">{booking.service}, {booking.startLocal}</h3>
      <p className="text-ink-2 mt-1">at {business}</p>

      {checks.length > 0 && (
        <>
          <p className="text-sm text-ink-2 mt-5 mb-2">Ozza understood the request. Then the counter checked every rule before booking it:</p>
          <ol className="space-y-1.5">
            {checks.map((c, i) => (
              <li key={c.id} className="tick flex items-start gap-2.5 text-[15px]" style={{ animationDelay: `${120 + i * 110}ms` }}>
                <span className={`mt-0.5 grid place-items-center w-5 h-5 rounded-full shrink-0 ${c.ok ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn'}`}>
                  <Check className="w-3.5 h-3.5" strokeWidth={3} aria-hidden />
                </span>
                <span>{c.label}<span className="sr-only">{c.ok ? ' (passed)' : ' (failed)'}</span></span>
              </li>
            ))}
          </ol>
        </>
      )}

      <div className="mt-6 pt-5 border-t hairline flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <p className="eyebrow">Booking code</p>
          <code className="text-[13px] break-all">{booking.bookingId}</code>
        </div>
        <button className="btn btn-ghost" onClick={() => { navigator.clipboard?.writeText(booking.bookingId); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
          <Copy className="w-4 h-4" aria-hidden />{copied ? 'Copied' : 'Copy code'}
        </button>
        <a className="btn btn-ghost" href={icsFor(`${booking.service} at ${business}`, booking.start, booking.end, booking.bookingId)} download="booking.ics">
          <CalendarPlus className="w-4 h-4" aria-hidden />Add to my calendar
        </a>
        {onCancel && <button className="btn btn-ghost text-warn" onClick={onCancel}>Cancel booking</button>}
      </div>
    </section>
  );
}
