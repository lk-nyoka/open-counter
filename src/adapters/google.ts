import { DateTime } from "luxon";
import type { BusyInterval, CalendarEvent, CalendarPort, NewEvent } from "../ports.js";

const BASE = "https://www.googleapis.com/calendar/v3";
const SCOPE = "https://www.googleapis.com/auth/calendar";

const b64url = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b);
  let s = "";
  bytes.forEach((x) => (s += String.fromCharCode(x)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/**
 * Google Calendar via service account. The owner shares their calendar with the service
 * account's email ("Make changes to events"). Credentials: raw JSON or base64 of the key file.
 *
 * Auth is done with WebCrypto (works on Cloudflare Workers, Node 20+, and Lambda), so there is no
 * dependency on google-auth-library.
 *
 * Reads use the freeBusy API, which returns time ranges only. No event titles or descriptions
 * ever enter this process, which is the prompt-injection defence at the source.
 */
export class GoogleCalendar implements CalendarPort {
  private cached?: { token: string; exp: number };
  /**
   * Service account: pass the key JSON. An owner's own Google account (signed in with OAuth): pass
   * `accessToken` and `busyFromEvents` (their token may not carry the freeBusy scope, so busy times are
   * read from the event list, keeping only start/end).
   */
  constructor(
    private credentials: string | undefined = process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    private opts: { accessToken?: () => Promise<string>; busyFromEvents?: boolean; fetcher?: typeof fetch } = {},
  ) {}

  private async token(): Promise<string> {
    if (this.opts.accessToken) return this.opts.accessToken();
    const nowS = Math.floor(Date.now() / 1000);
    if (this.cached && this.cached.exp - 60 > nowS) return this.cached.token;
    const raw = this.credentials;
    if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set");
    const c = JSON.parse(raw.trim().startsWith("{") ? raw : atob(raw.trim()));

    const pem = (c.private_key as string).replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
    const der = Uint8Array.from(atob(pem), (ch) => ch.charCodeAt(0));
    const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    const claims = { iss: c.client_email, scope: SCOPE, aud: "https://oauth2.googleapis.com/token", iat: nowS, exp: nowS + 3600 };
    const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify(claims))}`;
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));

    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(sig)}` }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`google token ${r.status}`);
    const j = (await r.json()) as { access_token: string; expires_in: number };
    this.cached = { token: j.access_token, exp: nowS + j.expires_in };
    return j.access_token;
  }

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    return (this.opts.fetcher ?? fetch)(`${BASE}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${await this.token()}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(8000),
    });
  }

  async listBusy(calendarId: string, from: string, to: string): Promise<BusyInterval[]> {
    if (this.opts.busyFromEvents) return this.busyFromEvents(calendarId, from, to);
    const r = await this.call("/freeBusy", {
      method: "POST",
      body: JSON.stringify({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), items: [{ id: calendarId }] }),
    });
    if (!r.ok) throw new Error(`freeBusy ${r.status}`);
    const j = (await r.json()) as { calendars: Record<string, { busy?: BusyInterval[]; errors?: unknown[] }> };
    const cal = j.calendars[calendarId];
    if (!cal || cal.errors?.length) throw new Error("calendar not accessible (is it shared with the service account?)");
    return cal.busy ?? [];
  }

  /** Busy time from the event list. Only start/end leave this function: titles and descriptions are dropped here. */
  private async busyFromEvents(calendarId: string, from: string, to: string): Promise<BusyInterval[]> {
    const q = new URLSearchParams({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "250", fields: "timeZone,items(status,transparency,start,end)" });
    const r = await this.call(`/calendars/${encodeURIComponent(calendarId)}/events?${q}`);
    if (!r.ok) throw new Error(`events.list ${r.status}`);
    const j = (await r.json()) as { timeZone?: string; items?: { status?: string; transparency?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } }[] };
    const out: BusyInterval[] = [];
    for (const e of j.items ?? []) {
      if (e.status === "cancelled" || e.transparency === "transparent") continue; // "Show as available" never blocks
      if (e.start?.dateTime && e.end?.dateTime) out.push({ start: e.start.dateTime, end: e.end.dateTime });
      else if (e.start?.date && e.end?.date) {
        const zone = j.timeZone ?? "UTC"; // an all-day event marked busy blocks the whole day in the calendar's zone
        out.push({ start: DateTime.fromISO(e.start.date, { zone }).toISO()!, end: DateTime.fromISO(e.end.date, { zone }).toISO()! });
      }
    }
    return out;
  }

  async getEvent(calendarId: string, id: string): Promise<CalendarEvent | null> {
    const r = await this.call(`/calendars/${encodeURIComponent(calendarId)}/events/${id}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`events.get ${r.status}`);
    const e = (await r.json()) as { status: string; start?: { dateTime?: string }; end?: { dateTime?: string } };
    if (e.status === "cancelled" || !e.start?.dateTime || !e.end?.dateTime) return null;
    return { id, start: e.start.dateTime, end: e.end.dateTime };
  }

  async createEvent(calendarId: string, ev: NewEvent): Promise<void> {
    // Google event ids: lowercase a-v and 0-9. Our hex bookingId qualifies, and a repeated id is a 409.
    const r = await this.call(`/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: "POST",
      body: JSON.stringify({
        id: ev.id,
        summary: ev.summary,
        description: ev.description,
        start: { dateTime: ev.start, timeZone: ev.timeZone },
        end: { dateTime: ev.end, timeZone: ev.timeZone },
      }),
    });
    if (r.status === 409) {
      if (await this.getEvent(calendarId, ev.id)) return; // retry of a booking that already exists
      throw new Error("idempotency key already used by a cancelled booking");
    }
    if (!r.ok) throw new Error(`events.insert ${r.status}`);
  }

  async deleteEvent(calendarId: string, id: string): Promise<void> {
    const r = await this.call(`/calendars/${encodeURIComponent(calendarId)}/events/${id}`, { method: "DELETE" });
    if (!r.ok && r.status !== 404 && r.status !== 410) throw new Error(`events.delete ${r.status}`);
  }
}

/** The service account's email (public info): the owner needs it to share their calendar. */
export function serviceAccountEmail(credentials?: string): string | undefined {
  try {
    if (!credentials) return undefined;
    const c = JSON.parse(credentials.trim().startsWith("{") ? credentials : atob(credentials.trim()));
    return typeof c.client_email === "string" ? c.client_email : undefined;
  } catch { return undefined; }
}
