import { aiJson, type AiBinding, type Msg } from "./ai.js";

/** What the interviewer collects. Converted to a full BusinessSpec at publish time. */
export interface Draft {
  name?: string;
  timezone?: string;
  currency?: string;
  minNoticeMin?: number;
  bufferMin?: number;
  hours: { day: number; open: string; close: string }[];
  services: { id: string; name: string; durationMin: number; price: number; bookableByVoice: boolean }[];
  askedVoice: boolean;
  askedRules: boolean;
  /** Turns spent after the essentials were complete: guarantees the interview ends even if the model forgets a flag. */
  extra: number;
}

export const emptyDraft = (): Draft => ({ hours: [], services: [], askedVoice: false, askedRules: false, extra: 0 });

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "service";

export function validTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length > 60) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
}

function cleanHours(x: unknown): Draft["hours"] {
  if (!Array.isArray(x)) return [];
  const out: Draft["hours"] = [];
  for (const h of x.slice(0, 21)) {
    const day = Number(h?.day);
    if (Number.isInteger(day) && day >= 0 && day <= 6 && HHMM.test(h?.open) && HHMM.test(h?.close) && h.open < h.close) out.push({ day, open: h.open, close: h.close });
  }
  return out;
}

function cleanService(x: any, taken: Set<string>): Draft["services"][number] | null {
  const name = clean(x?.name, 60);
  const num = (v: unknown) => (typeof v === "number" ? v : Number((/\d+(?:[.,]\d+)?/.exec(String(v ?? ""))?.[0] ?? "").replace(",", ".")));
  const durationMin = Math.round(num(x?.durationMin));
  const price = num(x?.price);
  if (!name || !Number.isFinite(durationMin) || durationMin < 5 || durationMin > 600 || !Number.isFinite(price) || price < 0 || price > 1_000_000) return null;
  let id = slugify(name), n = 2;
  while (taken.has(id)) id = `${slugify(name)}-${n++}`;
  taken.add(id);
  return { id, name, durationMin, price: Math.round(price * 100) / 100, bookableByVoice: x?.neverByVoice !== true };
}

/** Sanitise a draft that came from the browser. Never trust it. */
/** Models sometimes wrap values in stray quotes/commas ("Africa/Johannesburg","). Keep only legal characters. */
const tidy = (v: unknown) => { const t = String(v ?? ""); return /^[A-Za-z]{3}$/.test(t.trim()) ? t.trim() : (/[A-Za-z_]+(?:\/[A-Za-z_+\-0-9]+)+/.exec(t)?.[0] ?? (/^\W*([A-Za-z]{3,5})\W*$/.exec(t)?.[1] ?? "")); };
const CITY_ZONES: [RegExp, string, string?][] = [
  [/johannesburg|south africa|cape town|durban|pretoria|soweto|gqeberha|\bzar\b|\brands?\b/i, "Africa/Johannesburg", "ZAR"],
  [/nairobi|kenya/i, "Africa/Nairobi", "KES"], [/lagos|nigeria/i, "Africa/Lagos", "NGN"], [/london|\buk\b|united kingdom/i, "Europe/London", "GBP"],
  [/new york/i, "America/New_York", "USD"], [/los angeles|california/i, "America/Los_Angeles", "USD"], [/sydney|australia/i, "Australia/Sydney", "AUD"],
];
const DAYNAMES: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
function to24(h: string, m: string | undefined, ap: string | undefined, fallbackPm: boolean): string | null {
  let hh = Number(h); const mm = Number(m ?? 0); if (!(hh >= 0 && hh <= 24 && mm < 60)) return null;
  const a = (ap ?? "").toLowerCase();
  if (a === "pm" && hh < 12) hh += 12; else if (a === "am" && hh === 12) hh = 0; else if (!a && fallbackPm && hh < 12 && hh <= 8) hh += 12;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
/** Deterministic backup for the plain facts, used only for fields the model failed to fill. Output still passes the same validators. */
export function heuristicPatch(text: string): Record<string, unknown> {
  const t = text.replace(/[\u201c\u201d"]/g, " ");
  const out: Record<string, unknown> = {};
  for (const [re, tz, cur] of CITY_ZONES) if (re.test(t)) { out.timezone = tz; if (cur) out.currency = cur; break; }
  if (!out.currency) { if (/\$|dollars?|usd/i.test(t)) out.currency = "USD"; else if (/€|euros?/i.test(t)) out.currency = "EUR"; else if (/£|pounds?/i.test(t)) out.currency = "GBP"; }
  const svc: any[] = [];
  const re = /([A-Za-z][A-Za-z &'\-]{1,40}?)[,:\-]?\s+(\d{1,3})\s*(?:minutes?|mins?|m)\b[,\s]*(?:for\s*)?(?:R|\$|€|£|zar)?\s*(\d+(?:[.,]\d+)?)/gi;
  for (const m of t.matchAll(re)) {
    const name = m[1].replace(/^(?:services?|and|also|plus)\s*[:,]?\s+/i, "").replace(/^.*\.\s+/, "").trim();
    if (name) svc.push({ name, durationMin: Number(m[2]), price: Number(m[3].replace(",", ".")) });
  }
  const re2 = /([A-Za-z][A-Za-z &'\-]{1,40}?)\s*\(\s*(\d{1,3})\s*(?:minutes?|mins?|m)\s*[,;\-]?\s*(?:R|\$|€|£|zar)?\s*(\d+(?:[.,]\d+)?)\s*\)/gi;
  for (const m of t.matchAll(re2)) { const name = m[1].replace(/^(?:services?|and|also|plus)\s*[:,]?\s+/i, "").trim(); if (name && !svc.some((x) => x.name.toLowerCase() === name.toLowerCase())) svc.push({ name, durationMin: Number(m[2]), price: Number(m[3].replace(",", ".")) }); }
  if (svc.length) out.addServices = svc;
  const days = "(sun|mon|tue|wed|thu|fri|sat)[a-z]*";
  const time = "(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?";
  const hre = new RegExp(`${days}(?:\\s*(?:to|-|–|through|until)\\s*${days})?[^0-9]{0,20}${time}\\s*(?:to|-|–|until|till)\\s*${time}`, "gi");
  const hours: any[] = [];
  for (const m of t.matchAll(hre)) {
    const a = DAYNAMES[m[1].toLowerCase()], b = m[2] ? DAYNAMES[m[2].toLowerCase()] : a;
    const close = to24(m[6], m[7], m[8], true), open = to24(m[3], m[4], m[5] || (m[8] && Number(m[3]) < Number(m[6]) ? m[8] : undefined), false);
    if (open === null || close === null || open >= close) continue;
    for (let d = a, n = 0; n < 7; n++, d = (d + 1) % 7) { hours.push({ day: d, open, close }); if (d === b) break; }
  }
  if (hours.length) out.setHours = hours;
  const notice = /(\d+)\s*(hours?|hrs?|minutes?|mins?)\s*(?:ahead|notice|in advance|before)/i.exec(t);
  if (notice) out.minNoticeMin = Number(notice[1]) * (/^h/i.test(notice[2]) ? 60 : 1);
  const gap = /(\d+)[\s-]*(?:minutes?|mins?)[\s-]*(?:between|gap|buffer|break)/i.exec(t);
  if (gap) out.bufferMin = Number(gap[1]);
  if (/never\s+(?:be\s+)?book(?:ed)?[^.]{0,30}voice|call us for that/i.test(t)) out.askedVoice = true;
  return out;
}

export function sanitizeDraft(x: any): Draft {
  const d = emptyDraft();
  if (!x || typeof x !== "object") return d;
  const name = clean(x.name, 80); if (name) d.name = name;
  if (validTimezone(tidy(x.timezone))) d.timezone = tidy(x.timezone);
  if (typeof x.currency === "string" && /^[A-Za-z]{3}$/.test(x.currency)) d.currency = x.currency.toUpperCase();
  if (Number.isInteger(x.minNoticeMin) && x.minNoticeMin >= 0 && x.minNoticeMin <= 10080) d.minNoticeMin = x.minNoticeMin;
  if (Number.isInteger(x.bufferMin) && x.bufferMin >= 0 && x.bufferMin <= 120) d.bufferMin = x.bufferMin;
  d.hours = cleanHours(x.hours);
  const taken = new Set<string>();
  for (const s of (Array.isArray(x.services) ? x.services : []).slice(0, 20)) {
    const c = cleanService({ ...s, neverByVoice: s?.bookableByVoice === false }, taken);
    if (c) d.services.push(c);
  }
  d.askedVoice = x.askedVoice === true; d.askedRules = x.askedRules === true;
  d.extra = Number.isInteger(x.extra) ? Math.min(Math.max(x.extra, 0), 10) : 0;
  return d;
}

/** Apply the model's patch. Invalid parts are ignored and reported, never trusted. */
export function applyPatch(draft: Draft, p: Record<string, unknown>): { draft: Draft; warnings: string[] } {
  const d: Draft = JSON.parse(JSON.stringify(draft));
  const warnings: string[] = [];
  if (p.name !== undefined && p.name !== null && p.name !== "") { const n = clean(p.name, 80); if (n) d.name = n; }
  if (p.timezone) { if (validTimezone(tidy(p.timezone))) d.timezone = tidy(p.timezone); else warnings.push(`"${clean(p.timezone, 40)}" is not a valid IANA time zone`); }
  if (p.currency) { if (/^[A-Za-z]{3}$/.test(tidy(p.currency))) d.currency = tidy(p.currency).toUpperCase(); else warnings.push("currency must be a 3-letter code"); }
  if (Number.isInteger(p.minNoticeMin) && (p.minNoticeMin as number) >= 0 && (p.minNoticeMin as number) <= 10080) d.minNoticeMin = p.minNoticeMin as number;
  if (Number.isInteger(p.bufferMin) && (p.bufferMin as number) >= 0 && (p.bufferMin as number) <= 120) d.bufferMin = p.bufferMin as number;
  if (Array.isArray(p.setHours) && p.setHours.length) {
    const h = cleanHours(p.setHours);
    if (h.length) d.hours = h; else warnings.push("opening hours were not valid (use 24-hour HH:MM, opening before closing)");
  }
  if (Array.isArray(p.removeServices)) {
    const rm = p.removeServices.map((x) => clean(x, 60).toLowerCase());
    d.services = d.services.filter((s) => !rm.includes(s.name.toLowerCase()));
  }
  if (Array.isArray(p.addServices)) {
    const taken = new Set(d.services.map((s) => s.id));
    for (const raw of p.addServices.slice(0, 20)) {
      const c = cleanService(raw, taken);
      if (!c) { warnings.push(`a service was skipped (needs a name, duration 5-600 min and a price)`); continue; }
      const same = d.services.findIndex((s) => s.name.toLowerCase() === c.name.toLowerCase());
      if (same >= 0) { taken.delete(c.id); d.services[same] = { ...c, id: d.services[same].id }; } else d.services.push(c);
    }
  }
  if (p.askedVoice === true) d.askedVoice = true;
  if (p.askedRules === true) d.askedRules = true;
  return { draft: d, warnings };
}

const essentialsDone = (d: Draft) => !!(d.name && d.timezone && d.currency && d.services.length && d.hours.length);

export type MissingKey = "name" | "timezone" | "currency" | "services" | "hours" | "voiceRule" | "bookingRules";

export function missing(d: Draft): MissingKey[] {
  const m: MissingKey[] = [];
  if (!d.name) m.push("name");
  if (!d.timezone) m.push("timezone");
  if (!d.currency) m.push("currency");
  if (!d.services.length) m.push("services");
  if (!d.hours.length) m.push("hours");
  if (!m.length) { // essentials done: ask the two optional rule questions, but never loop forever
    if (!d.askedVoice && d.extra < 3) m.push("voiceRule");
    if (!d.askedRules && d.extra < 3) m.push("bookingRules");
  }
  return m;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function summarize(d: Draft): string {
  const byWin = new Map<string, number[]>();
  for (const h of d.hours) byWin.set(`${h.open}-${h.close}`, [...(byWin.get(`${h.open}-${h.close}`) ?? []), h.day]);
  const hours = [...byWin].map(([w, days]) => `${days.sort().map((x) => DAYS[x]).join(", ")} ${w}`).join("; ");
  const svc = d.services.map((s) => `${s.name} (${s.durationMin} min, ${s.price} ${d.currency}${s.bookableByVoice ? "" : ", not bookable by voice"})`).join("; ");
  return `${d.name} (${d.timezone}). Hours: ${hours}. Services: ${svc}. Minimum notice ${d.minNoticeMin ?? 60} min, gap between appointments ${d.bufferMin ?? 0} min.`;
}

export const GREETING = "Hi! I'll set up a booking assistant for your business. First, what is your business called, and which city or time zone are you in?";

const SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    name: { type: "string" },
    timezone: { type: "string" },
    currency: { type: "string" },
    minNoticeMin: { type: "integer" },
    bufferMin: { type: "integer" },
    setHours: { type: "array", items: { type: "object", properties: { day: { type: "integer" }, open: { type: "string" }, close: { type: "string" } }, required: ["day", "open", "close"] } },
    addServices: { type: "array", items: { type: "object", properties: { name: { type: "string" }, durationMin: { type: "integer" }, price: { type: "number" }, neverByVoice: { type: "boolean" } }, required: ["name", "durationMin", "price"] } },
    removeServices: { type: "array", items: { type: "string" } },
    askedVoice: { type: "boolean" },
    askedRules: { type: "boolean" },
  },
  required: ["reply"],
};

const ASK: Record<MissingKey, string> = {
  name: "the business name",
  timezone: "the time zone (map the city to an IANA name like Africa/Johannesburg)",
  currency: "the currency (3-letter code like ZAR)",
  services: "the services: name, how many minutes each takes, and the price",
  hours: "the opening hours for each day of the week",
  voiceRule: "whether any service must NEVER be booked by voice (e.g. needs a consultation first). Then set askedVoice=true",
  bookingRules: "the minimum notice customers must give and any gap needed between appointments. Then set askedRules=true",
};

function systemPrompt(d: Draft, miss: MissingKey[]): string {
  return `You set up a booking assistant for a small business owner by interviewing them. Be warm and brief.
Current draft: ${JSON.stringify({ name: d.name, timezone: d.timezone, currency: d.currency, minNoticeMin: d.minNoticeMin, bufferMin: d.bufferMin, hours: d.hours, services: d.services.map((s) => ({ name: s.name, durationMin: s.durationMin, price: s.price, neverByVoice: !s.bookableByVoice })) })}
Still needed, in order: ${miss.length ? miss.map((k) => ASK[k]).join("; ") : "nothing; ask if they want to change anything"}.
Rules: record ONLY what the owner actually said; never invent values. Fill the JSON fields from their latest message: setHours (all days they gave, day 0=Sunday..6=Saturday, 24-hour HH:MM; Mon-Fri 9 to 5 means 5 entries), addServices, removeServices, name, timezone, currency, minNoticeMin (minutes), bufferMin (minutes). If they say a service must never be booked by voice set neverByVoice=true. If they say there is none, set askedVoice=true with no change. In "reply" confirm briefly what you recorded, then ask ONE question about the first thing still needed. Reply JSON only.`;
}

export interface InterviewResult { reply: string; draft: Draft; missing: MissingKey[]; complete: boolean; warnings: string[] }

export async function interviewTurn(ai: AiBinding, models: string[], draftIn: unknown, history: Msg[], userText: string): Promise<InterviewResult> {
  const draft = sanitizeDraft(draftIn);
  if (!history.length && !userText) return { reply: GREETING, draft, missing: missing(draft), complete: false, warnings: [] };

  const before = missing(draft);
  const out = await aiJson(ai, models, [{ role: "system", content: systemPrompt(draft, before) }, ...history.slice(-10), { role: "user", content: userText }], SCHEMA, 700, "interview");
  const model = applyPatch(draft, out);
  let next = model.draft; const warnings = model.warnings;
  // Backup: fill only what the model left empty, from the owner's own words.
  const h = heuristicPatch(userText); const fill: Record<string, unknown> = {};
  if (!next.timezone && h.timezone) fill.timezone = h.timezone;
  if (!next.currency && h.currency) fill.currency = h.currency;
  if (h.addServices) fill.addServices = h.addServices; // merged by name, so nothing the model got right is lost
  if (h.setHours) fill.setHours = h.setHours;
  if (h.minNoticeMin !== undefined) fill.minNoticeMin = h.minNoticeMin; // the owner's own stated numbers beat the model's
  if (h.bufferMin !== undefined) fill.bufferMin = h.bufferMin;
  if (h.askedVoice) fill.askedVoice = true;
  if (h.minNoticeMin !== undefined || h.bufferMin !== undefined) fill.askedRules = true;
  if (Object.keys(fill).length) { const r = applyPatch(next, fill); next = r.draft; if (next.timezone) warnings.length = 0; }
  if (essentialsDone(draft)) next.extra = Math.min(next.extra + 1, 10); // answered a rules question (or chatted) after the essentials
  const miss = missing(next);
  const complete = miss.length === 0;
  let reply = clean(out.reply, 600) || "Sorry, could you say that again?";
  if (warnings.length) reply += ` (Note: ${warnings.join("; ")}.)`;
  if (complete) reply = `Great, here's what I have: ${summarize(next)} Tell me if anything needs changing. Otherwise, connect your calendar and publish below.`;
  return { reply, draft: next, missing: miss, complete, warnings };
}
