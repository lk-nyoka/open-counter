import { mentions } from "./nlu.js";
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
  const raw = clean(String(x?.name ?? "").replace(/\(.*$/, ""), 60);
  const name = raw.charAt(0).toUpperCase() + raw.slice(1);
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
  const nm = /(?:[Bb]usiness [Nn]ame\s*(?:is|:)\s*|called\s+|named\s+|[Ii] (?:own|run|manage)\s+|[Ww]e are\s+|[Ww]e're\s+|[Oo]wner of\s+|my (?:shop|salon|business|studio|clinic|spa|practice) is\s+)"?([A-Z][\w'&\-]*(?: [A-Z][\w'&\-]*){0,4})/.exec(t);
  if (nm) out.name = nm[1].trim();
  const svc: any[] = [];
  const re = /([A-Za-z][A-Za-z &'\-]{1,40}?)[,:\-]?\s+(\d{1,3}(?:\.\d)?)\s*(minutes?|mins?|m|hours?|hrs?|h)\b[,\s]*(?:for\s*)?(?:R|\$|€|£|zar)?\s*(\d+(?:[.,]\d+)?)/gi;
  for (const m of t.matchAll(re)) {
    const name = m[1].replace(/^(?:services?|and|also|plus|we do|we offer|offer)\s*[:,]?\s+/i, "").replace(/^.*[.;]\s+/, "").trim();
    const mins = Math.round(Number(m[2]) * (/^h/i.test(m[3]) ? 60 : 1));
    if (name) svc.push({ name, durationMin: mins, price: Number(m[4].replace(",", ".")) });
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
  const GROUPS: [RegExp, number[]][] = [[/week ?days|monday to friday|mon-fri/i, [1, 2, 3, 4, 5]], [/week ?ends?/i, [0, 6]], [/every ?day|daily|7 days/i, [0, 1, 2, 3, 4, 5, 6]]];
  if (!hours.length) for (const [g, ds] of GROUPS) {
    const gm = new RegExp(`(?:${g.source})[^0-9]{0,20}${time}\\s*(?:to|-|–|until|till)\\s*${time}|${time}\\s*(?:to|-|–|until|till)\\s*${time}[^0-9]{0,12}(?:${g.source})`, "i").exec(t);
    if (!gm) continue;
    const v = gm[1] !== undefined ? gm.slice(1, 7) : gm.slice(7, 13);
    const close = to24(v[3], v[4], v[5], true), open = to24(v[0], v[1], v[2] || (v[5] && Number(v[0]) < Number(v[3]) ? v[5] : undefined), false);
    if (open && close && open < close) for (const d of ds) hours.push({ day: d, open, close });
  }
  if (hours.length) out.setHours = hours;
  const closed = [...t.matchAll(new RegExp(`closed (?:on )?${days}`, "gi"))].map((m) => DAYNAMES[m[1].toLowerCase()]);
  if (closed.length) out.closedDays = closed;
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
    if (h.length) { const days = new Set(h.map((x) => x.day)); d.hours = [...d.hours.filter((x) => !days.has(x.day)), ...h].sort((a, b) => a.day - b.day || a.open.localeCompare(b.open)); } else warnings.push("opening hours were not valid (use 24-hour HH:MM, opening before closing)");
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
      // Re-listing a service must never silently re-allow voice booking: once blocked, it stays blocked.
      if (same >= 0) { taken.delete(c.id); d.services[same] = { ...c, id: d.services[same].id, bookableByVoice: d.services[same].bookableByVoice && c.bookableByVoice }; } else d.services.push(c);
    }
  }
  if (Array.isArray(p.closedDays)) { const c = new Set(p.closedDays.filter((x) => Number.isInteger(x))); d.hours = d.hours.filter((x) => !c.has(x.day)); }
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

/** What the owner sees: one plain question per missing item. */
const QUESTION: Record<MissingKey, string> = {
  name: "What is your business called?",
  timezone: "Which city or time zone are you in?",
  currency: "Which currency do you charge in (for example rand)?",
  services: "What services do you offer? For each one, tell me how long it takes and the price, for example: Haircut, 30 minutes, R120.",
  hours: "What are your opening hours? For example: Monday to Friday 9am to 5pm, Saturday 9am to 1pm.",
  voiceRule: "Should any service never be booked by the voice assistant, for example one that needs a consultation first? Name it, or say none.",
  bookingRules: "How much notice do customers need to give, and do you need a gap between appointments? For example: 2 hours notice, 10 minutes between customers. Or say no rules.",
};

function hoursLine(d: Draft) {
  const byWin = new Map<string, number[]>();
  for (const h of d.hours) byWin.set(`${h.open}-${h.close}`, [...(byWin.get(`${h.open}-${h.close}`) ?? []), h.day]);
  return [...byWin].map(([w, days]) => `${days.sort((a, b) => a - b).map((x) => DAYS[x]).join(", ")} ${w}`).join("; ");
}

/** Describe exactly what changed in the draft this turn. The owner sees facts, not the model's claims. */
export function describeChanges(a: Draft, b: Draft): string[] {
  const out: string[] = [];
  if (a.name !== b.name && b.name) out.push(`Business: ${b.name}`);
  if (a.timezone !== b.timezone && b.timezone) out.push(`Time zone: ${b.timezone}`);
  if (a.currency !== b.currency && b.currency) out.push(`Currency: ${b.currency}`);
  const svc = (d: Draft) => JSON.stringify(d.services.map((s) => [s.name, s.durationMin, s.price]));
  if (svc(a) !== svc(b) && b.services.length) out.push(`Services: ${b.services.map((s) => `${s.name} (${s.durationMin} min, ${s.price} ${b.currency ?? ""})`.replace(" )", ")")).join(", ")}`);
  if (JSON.stringify(a.hours) !== JSON.stringify(b.hours) && b.hours.length) out.push(`Hours: ${hoursLine(b)}`);
  const blocked = (d: Draft) => d.services.filter((s) => !s.bookableByVoice).map((s) => s.name).join(", ");
  if ((!a.askedVoice && b.askedVoice) || blocked(a) !== blocked(b)) out.push(blocked(b) ? `Not bookable by voice: ${blocked(b)}` : "All services can be booked by voice");
  if (a.minNoticeMin !== b.minNoticeMin || a.bufferMin !== b.bufferMin || (!a.askedRules && b.askedRules)) out.push(`At least ${b.minNoticeMin ?? 60} min notice, ${b.bufferMin ?? 0} min between appointments`);
  return out;
}

const VOICE_CTX = /\b(voice|assistant|alexa|ai|bot|phone|call|calls|online|automatic\w*|by itself|contact|consult\w*|in person|in-person|walk-?ins?|in store|in-store|ask us|speak to|talk to|whatsapp|book(?:ed|ing)? directly)\b/;
const RESTRICT = /\b(no|not|never|cannot|can'?t|don'?t|doesn'?t|won'?t|shouldn'?t|mustn'?t|must|only|needs?|have to|has to|require[sd]?|without|excluded?|exclude|unless)\b/;
const EXCEPT = /\b(?:except(?: for)?|apart from|other than|besides|but not|excluding)\s+([^.;!?\n]+)/g;

/**
 * Find voice-booking rules anywhere in what the owner wrote.
 * "Everything can be booked by voice except colour" / "Color can't be booked by the assistant, they must call us" /
 * "voice booking allowed but no color booking, have to contact store" all block Color, and only Color.
 */
export function voiceRules(text: string, serviceNames: string[]): { blocked: string[]; mentioned: boolean } {
  const blocked = new Set<string>(); let mentioned = false;
  for (const sentence of text.toLowerCase().split(/[.!?\n]+/)) {
    if (!VOICE_CTX.test(sentence)) continue;
    if (/\b(voice|assistant|alexa|ai|bot)\b/.test(sentence)) mentioned = true;
    for (const m of sentence.matchAll(EXCEPT)) { const list = m[1].split(/\bbut\b|\bwhich\b|\bthat\b|\bbecause\b/)[0]; for (const n of serviceNames) if (mentions(list, n)) blocked.add(n); }
    // Judge each clause on its own: "haircuts are fine by voice but colour must be booked in store".
    for (const clause of sentence.split(/\bbut\b|\bhowever\b|\bwhereas\b|\bwhile\b|;|,\s*(?:and\s+)?(?=\w+\s+(?:can|must|should|need|needs|has|have|is|are)\b)/)) {
      const hit = serviceNames.filter((n) => mentions(clause, n));
      if (hit.length && RESTRICT.test(clause)) hit.forEach((n) => blocked.add(n));
    }
    if (blocked.size) mentioned = true;
  }
  return { blocked: [...blocked], mentioned };
}

export interface InterviewResult { reply: string; draft: Draft; missing: MissingKey[]; complete: boolean; warnings: string[]; usedModel: boolean }

/**
 * One interview turn. The model (optional) proposes a patch; the owner's own words are parsed as well; code validates
 * everything and writes the reply from what actually changed. If the model is down or over budget, the interview still works.
 */
export async function interviewTurn(ai: AiBinding | undefined, models: string[], draftIn: unknown, history: Msg[], userText: string): Promise<InterviewResult> {
  const draft = sanitizeDraft(draftIn);
  if (!history.length && !userText) return { reply: GREETING, draft, missing: missing(draft), complete: false, warnings: [], usedModel: false };

  const before = missing(draft);
  let out: Record<string, unknown> = {}; let usedModel = false;
  if (ai) {
    try { out = await aiJson(ai, models, [{ role: "system", content: systemPrompt(draft, before) }, ...history.slice(-10), { role: "user", content: userText }], SCHEMA, 700, "interview"); usedModel = true; }
    catch (e) { console.error("interview model failed; continuing with the parser only", e); }
  }
  const model = applyPatch(draft, out);
  let next = model.draft;
  // The owner's own words: these win over the model wherever they say something concrete.
  const h = heuristicPatch(userText); const fill: Record<string, unknown> = {};
  if (!next.name && h.name) fill.name = h.name;
  if (!next.timezone && h.timezone) fill.timezone = h.timezone;
  if (!next.currency && h.currency) fill.currency = h.currency;
  if (h.addServices) fill.addServices = h.addServices; // merged by name, so nothing the model got right is lost
  if (h.setHours) fill.setHours = h.setHours;
  if (h.closedDays) fill.closedDays = h.closedDays;
  if (h.minNoticeMin !== undefined) fill.minNoticeMin = h.minNoticeMin;
  if (h.bufferMin !== undefined) fill.bufferMin = h.bufferMin;
  if (h.askedVoice) fill.askedVoice = true;
  if (h.minNoticeMin !== undefined || h.bufferMin !== undefined) fill.askedRules = true;
  if (Object.keys(fill).length) next = applyPatch(next, fill).draft;

  const low = userText.toLowerCase();
  // Voice rules can come anywhere, in any phrasing, even inside a long paragraph.
  const vr = voiceRules(userText, next.services.map((x) => x.name));
  if (vr.blocked.length || vr.mentioned) {
    next = { ...next, askedVoice: true, services: next.services.map((x) => (vr.blocked.includes(x.name) ? { ...x, bookableByVoice: false } : x)) };
  } else if (before[0] === "voiceRule" && /^\W*(none|no|nope|nothing|all|every|any|they can|everything|not really)\b/.test(low)) next = { ...next, askedVoice: true };
  // Answering the rules question with "no rules": keep the defaults.
  if (before[0] === "bookingRules" && /^\W*(no|none|nope|nothing|no rules|default|defaults|not really|any ?time|anytime)\b/.test(low)) next = { ...next, askedRules: true };
  if (essentialsDone(draft)) next.extra = Math.min(next.extra + 1, 10); // never loop forever on the optional questions

  const miss = missing(next);
  const complete = miss.length === 0;
  const changes = describeChanges(draft, next);
  let reply: string;
  if (complete) reply = `Great, here's everything: ${summarize(next)} Tell me if anything needs changing. Otherwise, go live below.`;
  else {
    const q = miss[0] === "name" && miss[1] === "timezone" ? "What is your business called, and which city are you in?" : QUESTION[miss[0]];
    reply = changes.length ? `Got it. ${changes.join(". ")}. ${q}` : `Sorry, I didn't pick up any new details from that. ${q}`;
  }
  return { reply, draft: next, missing: miss, complete, warnings: model.warnings, usedModel };
}
