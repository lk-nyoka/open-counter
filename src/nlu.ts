import { DateTime } from "luxon";
import type { BusinessSpec, Service } from "./spec.js";
import { aiJson, type AiBinding } from "./ai.js";

/**
 * Understanding what the caller said. This module only EXTRACTS (intent, service, date, time, name).
 * It never decides availability or talks to the calendar: the dialog code and the MCP server do that.
 * A deterministic parser runs first; the language model only fills fields the parser could not.
 */

export type Intent = "book" | "services" | "price" | "hours" | "cancel" | "greeting" | "thanks" | "none";
export type Awaiting = "service" | "date" | "time" | "name" | "confirm" | "code" | "cancelConfirm" | "offerBook" | null;
export type PartOfDay = "morning" | "afternoon" | "evening";

export interface Nlu {
  intent: Intent;
  serviceId?: string;
  /** Several services matched equally well (e.g. "beard" with "Beard trim" and "Haircut and beard"). */
  serviceOptions?: string[];
  date?: string; // YYYY-MM-DD in the business time zone
  time?: string; // HH:MM, 24-hour
  partOfDay?: PartOfDay;
  name?: string;
  bookingId?: string;
  yes?: boolean;
  no?: boolean;
  /** "the first one" = 1, "the last one" = -1 */
  choice?: number;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WD_RE = "(sun|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat)(?:day|nesday|sday|urday|rsday)?";
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, thirty: 30, "forty five": 45, "forty-five": 45 };
const NUM_WORD = "(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";

/** Lower-case, unify spelling, keep digits, ":" and "'" (for names like O'Neil). */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”"]/g, " ")
    .replace(/\b([ap])\.\s?m\.?/g, "$1m")
    .replace(/\bcolour/g, "color")
    .replace(/\bhair[\s-]+cut/g, "haircut")
    .replace(/[^a-z0-9:'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lev(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

const FILLER = new Set(["and", "with", "the", "a", "an", "of", "for", "full", "hair", "service", "session", "treatment"]);
const wordLike = (w: string, n: string) =>
  w === n || (n.length >= 4 && w.length >= 4 && (w.startsWith(n) || n.startsWith(w))) || (n.length >= 5 && lev(w, n) <= 1);

/** True when the text mentions this service by name or by its distinctive words (fuzzy, e.g. "colouring" for "Color"). */
export function mentions(text: string, serviceName: string): boolean {
  const t = ` ${normalize(text)} `, n = normalize(serviceName);
  if (t.includes(` ${n} `) || t.replace(/ /g, "").includes(n.replace(/ /g, ""))) return true;
  const key = n.split(" ").filter((w) => !FILLER.has(w) && w.length >= 3);
  const words = t.trim().split(" ");
  return key.length > 0 && key.every((k) => words.some((w) => wordLike(w, k)));
}

/** Match the caller's words to the business's services. Returns the best match, or several when ambiguous. */
export function matchService(text: string, services: Service[]): { id?: string; options?: string[] } {
  const t = ` ${normalize(text)} `;
  const words = t.trim().split(" ");
  const scored = services.map((s) => {
    const n = normalize(s.name);
    if (t.includes(` ${n} `) || t.replace(/ /g, "").includes(n.replace(/ /g, ""))) return { s, score: 100 + n.length };
    const key = n.split(" ").filter((w) => !FILLER.has(w) && w.length >= 3);
    if (!key.length) return { s, score: 0 };
    const hit = key.filter((k) => words.some((w) => wordLike(w, k))).length;
    return { s, score: hit === key.length ? 50 + hit : hit ? 10 * hit : 0 };
  });
  const best = Math.max(0, ...scored.map((x) => x.score));
  if (!best) return {};
  const top = scored.filter((x) => x.score === best).map((x) => x.s.id);
  return top.length === 1 ? { id: top[0] } : { options: top };
}

/** Resolve a spoken date to YYYY-MM-DD in the business time zone. */
export function parseDate(text: string, today: DateTime): string | undefined {
  const t = normalize(text);
  if (/\b(today|tonight|this (afternoon|evening|morning))\b/.test(t)) return today.toISODate()!;
  if (/\bday after (tomorrow|tmrw)\b/.test(t)) return today.plus({ days: 2 }).toISODate()!;
  if (/\b(tomorrow|tmrw|tomorow|tommorow|tomorrows)\b/.test(t)) return today.plus({ days: 1 }).toISODate()!;
  let m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
  if (m) return fix(Number(m[1]), Number(m[2]), Number(m[3]));
  const mon = `(${MONTHS.map((x) => x.slice(0, 3) + "[a-z]*").join("|")})`;
  m = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?: of)? ${mon}\\b`).exec(t) ?? null;
  if (m) return monthDay(Number(m[1]), m[2]);
  m = new RegExp(`\\b${mon} (?:the )?(\\d{1,2})(?:st|nd|rd|th)?\\b`).exec(t);
  if (m) return monthDay(Number(m[2]), m[1]);
  m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(text); // day-first, as written in South Africa
  if (m) { const y = m[3] ? Number(m[3].length === 2 ? "20" + m[3] : m[3]) : today.year; const r = fix(y, Number(m[2]), Number(m[1])); return r && !m[3] && r < today.toISODate()! ? fix(y + 1, Number(m[2]), Number(m[1])) : r; }
  m = /\bthe (\d{1,2})(?:st|nd|rd|th)\b/.exec(t);
  if (m) { let d = today.set({ day: Number(m[1]) }); if (!d.isValid || d.day !== Number(m[1])) return undefined; if (d < today.startOf("day")) d = d.plus({ months: 1 }); return d.toISODate()!; }
  m = new RegExp(`\\b(next |this |on |coming )?${WD_RE}\\b`).exec(t);
  if (m) {
    const want = WEEKDAYS.findIndex((w) => w.startsWith(m![2].slice(0, 3)));
    let add = (want - (today.weekday % 7) + 7) % 7;
    if (add === 0 && m[1]?.trim() === "next") add = 7;
    return today.plus({ days: add }).toISODate()!;
  }
  return undefined;

  function fix(y: number, mo: number, d: number) { const x = DateTime.fromObject({ year: y, month: mo, day: d }, { zone: today.zone }); return x.isValid ? x.toISODate()! : undefined; }
  function monthDay(d: number, monWord: string) {
    const mo = MONTHS.findIndex((x) => x.startsWith(monWord.slice(0, 3))) + 1;
    const r = fix(today.year, mo, d);
    return r && r < today.toISODate()! ? fix(today.year + 1, mo, d) : r;
  }
}

const hh = (h: number, m: number) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
const numOf = (s: string) => (/^\d+$/.test(s) ? Number(s) : NUM[s]);

/** Resolve a spoken time to HH:MM. Without am/pm, 1 to 7 means afternoon (nobody books 3am). */
export function parseTime(text: string, opts: { bare?: boolean } = {}): { time?: string; partOfDay?: PartOfDay } {
  const t = normalize(text).replace(/\bo ?clock\b/g, "oclock");
  const partOfDay: PartOfDay | undefined = /\b(morning|am\b)/.test(t) && !/\bpm\b/.test(t) ? "morning" : /\b(afternoon|lunch ?time|after lunch)\b/.test(t) ? "afternoon" : /\b(evening|tonight|after work)\b/.test(t) ? "evening" : undefined;
  const out = (h: number, m: number, ap?: string) => {
    if (!(h >= 0 && h <= 23 && m >= 0 && m < 60)) return { partOfDay };
    if (ap === "pm" && h < 12) h += 12;
    else if (ap === "am" && h === 12) h = 0;
    else if (!ap && h >= 1 && h <= 7) h += 12;
    else if (!ap && h < 12 && (partOfDay === "afternoon" || partOfDay === "evening")) h += 12;
    return { time: hh(h, m), partOfDay };
  };
  if (/\b(noon|midday|12 ?pm)\b/.test(t)) return { time: "12:00", partOfDay };
  let m = new RegExp(`\\bhalf past (\\d{1,2}|${NUM_WORD})\\b(?: ?(am|pm))?`).exec(t);
  if (m) return out(numOf(m[1]), 30, m[3]);
  m = new RegExp(`\\bquarter (past|after|to) (\\d{1,2}|${NUM_WORD})\\b(?: ?(am|pm))?`).exec(t);
  if (m) { const h = numOf(m[2]); return m[1] === "to" ? out(h - 1, 45, m[4]) : out(h, 15, m[4]); }
  m = /\b(\d{1,2})[:h.](\d{2})\s?(am|pm)?\b/.exec(t);
  if (m) return out(Number(m[1]), Number(m[2]), m[3]);
  m = /\b(\d{1,2})\s?(am|pm|oclock)\b/.exec(t);
  if (m) return out(Number(m[1]), 0, m[2] === "oclock" ? undefined : m[2]);
  m = new RegExp(`\\b${NUM_WORD}(?: (fifteen|thirty|forty[ -]five))?\\s?(am|pm|oclock)\\b`).exec(t);
  if (m) return out(numOf(m[1]), m[2] ? NUM[m[2].replace(" ", "-")] ?? NUM[m[2]] : 0, m[3] === "oclock" ? undefined : m[3]);
  m = new RegExp(`\\b(?:at|around|about|by|for) (\\d{1,2}|${NUM_WORD})(?: (fifteen|thirty|forty[ -]five|\\d{2}))?\\b(?! ?(minutes?|mins?|people|days?|weeks?|hours?|th|st|nd|rd))`).exec(t);
  if (m) return out(numOf(m[1]), m[3] ? (/^\d+$/.test(m[3]) ? Number(m[3]) : NUM[m[3].replace(" ", "-")] ?? NUM[m[3]]) : 0);
  if (opts.bare) {
    m = new RegExp(`^(?:um |uh |at |around )?(\\d{1,2}|${NUM_WORD})(?: (fifteen|thirty|forty[ -]five|\\d{2}))?(?: please)?$`).exec(t);
    if (m) return out(numOf(m[1]), m[3] ? (/^\d+$/.test(m[3]) ? Number(m[3]) : NUM[m[3].replace(" ", "-")] ?? NUM[m[3]]) : 0);
  }
  return { partOfDay };
}

const NOT_NAMES = new Set([
  ...WEEKDAYS, ...MONTHS, "today", "tomorrow", "tonight", "morning", "afternoon", "evening", "noon", "a", "an", "the", "not", "sure", "looking", "calling",
  "interested", "available", "here", "fine", "good", "free", "trying", "going", "wanting", "after", "booking", "book", "just", "also", "still", "really",
  "very", "so", "ready", "back", "new", "late", "early", "done", "busy", "it", "that", "this", "me", "you", "yes", "no", "okay", "ok", "hoping", "wondering",
  "coming", "in", "on", "at", "for", "my", "to", "from", "with", "please", "thanks", "thank", "hi", "hello", "hey", "sorry", "um", "uh", "well", "next",
  "appointment", "an", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "happy", "glad", "fine", "able",
]);
const title = (s: string) => s.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");

/** Extract the caller's name. Conservative: a wrong name is worse than asking. */
export function parseName(raw: string, services: Service[], awaitingName: boolean): string | undefined {
  const serviceWords = new Set(services.flatMap((s) => normalize(s.name).split(" ")));
  const ok = (w: string) => /^[a-z][a-z'\-]{1,30}$/.test(w) && !NOT_NAMES.has(w) && !serviceWords.has(w);
  const t = normalize(raw);
  const strip = (w?: string) => w?.replace(/'s$/, "");
  let m = /\b(?:my name is|my name's|name is|names|i am|i'm|im|this is|call me|it's|its|under the name(?: of)?|book it under|put it under|under)\s+([a-z][a-z'\-]+)(?:\s+([a-z][a-z'\-]+))?/.exec(t);
  if (m) { const a = strip(m[1])!, b = strip(m[2]); if (ok(a)) return title([a, b && ok(b) ? b : ""].join(" ").trim()); }
  // "for Nicholas": only when the original text capitalised it (speech engines capitalise names).
  const cap = /\bfor ([A-Z][a-z'\-]+)(?:\s+([A-Z][a-z'\-]+))?/.exec(raw.replace(/'s\b/g, ""));
  if (cap && ok(cap[1].toLowerCase())) return title([cap[1], cap[2] && ok(cap[2].toLowerCase()) ? cap[2] : ""].join(" ").trim());
  if (awaitingName) {
    const words = t.replace(/^(it is|it's|its|my name is|name is|i am|i'm|im|this is|yes|yeah|sure|okay|ok)\s+/, "").replace(/\s+(please|thanks|thank you)$/, "").split(" ");
    if (words.length >= 1 && words.length <= 3 && words.every(ok)) return title(words.join(" "));
  }
  return undefined;
}

const YES = /^(yes|yeah|yep|yup|yes please|sure|correct|that's right|thats right|right|ok|okay|confirm|confirmed|please do|go ahead|book it|do it|sounds good|perfect|great|absolutely|definitely|of course|that works|fine)\b/;
const NO = /^(no|nope|nah|not really|don't|do not|wrong|that's wrong|stop|never mind|nevermind)\b/;

/** The deterministic parser. Precise on dates, times, names and service names. */
export function parseUtterance(text: string, spec: BusinessSpec, now: Date, awaiting: Awaiting = null): Nlu {
  const t = normalize(text);
  const today = DateTime.fromJSDate(now, { zone: spec.timezone }).startOf("day");
  const r: Nlu = { intent: "none" };
  const svc = matchService(text, spec.services);
  if (svc.id) r.serviceId = svc.id; else if (svc.options) r.serviceOptions = svc.options;
  const date = parseDate(text, today); if (date) r.date = date;
  const tm = parseTime(text, { bare: awaiting === "time" });
  if (tm.time) r.time = tm.time;
  if (tm.partOfDay) r.partOfDay = tm.partOfDay;
  const name = parseName(text, spec.services, awaiting === "name"); if (name) r.name = name;
  const code = /\b([0-9a-f]{32})\b/.exec(t); if (code) r.bookingId = code[1];
  if (YES.test(t)) r.yes = true;
  else if (NO.test(t)) r.no = true;
  const ch = /\b(?:the )?(first|second|third|fourth|last|1st|2nd|3rd|4th)( one| option)?\b/.exec(t);
  if (ch && (ch[2] || (awaiting === "time" && t.split(" ").length <= 4))) r.choice = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, last: -1 }[ch[1]];

  if (/\b(cancel|call off|can't make it|cant make it|won't make it)\b/.test(t) && awaiting !== "confirm") r.intent = "cancel";
  else if (/\b(book|booking|appointment|schedule|reserve|slot|available|availability|come in|make it|change it|move it|instead|fit me in|get a|get an|i want|i'd like|i would like|i need|can i have|can i get)\b/.test(t) || r.serviceId && (r.date || r.time)) r.intent = "book";
  else if (/\b(what services|which services|services|what do you (offer|do|have)|menu|options|treatments)\b/.test(t)) r.intent = "services";
  else if (/\b(how much|price|prices|cost|costs|charge|rate|rates|expensive|cheap)\b/.test(t)) r.intent = "price";
  else if (/\b(hours|open|opening|close|closing|when are you|what time do you)\b/.test(t)) r.intent = "hours";
  else if (/\b(thank|thanks|cheers)\b/.test(t)) r.intent = "thanks";
  else if (/^(hi|hello|hey|good (morning|afternoon|evening)|howzit|sawubona|molo)\b/.test(t)) r.intent = "greeting";
  else if (r.serviceId || r.date || r.time || r.name || r.choice) r.intent = "book";
  return r;
}

const NLU_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: ["book", "services", "price", "hours", "cancel", "greeting", "thanks", "none"] },
    service: { type: "string" },
    date: { type: "string" },
    time: { type: "string" },
    name: { type: "string" },
  },
  required: ["intent"],
};

function nluPrompt(spec: BusinessSpec, now: Date, awaiting: Awaiting): string {
  const today = DateTime.fromJSDate(now, { zone: spec.timezone }).startOf("day");
  const days = Array.from({ length: 8 }, (_, i) => { const d = today.plus({ days: i }); return `${d.toISODate()} ${d.toFormat("cccc")}${i === 0 ? " (today)" : i === 1 ? " (tomorrow)" : ""}`; }).join("; ");
  return `You extract booking details from what a caller said to ${spec.name}. The text comes from speech recognition and may contain sound-alike mistakes.
Services: ${spec.services.map((s) => s.name).join(", ")}.
Dates: ${days}.
The assistant is currently waiting for: ${awaiting ?? "nothing in particular"}.
Return JSON: intent (book | services | price | hours | cancel | greeting | thanks | none), service (exact name from the list, or empty), date (YYYY-MM-DD or empty), time (24-hour HH:MM or empty), name (the caller's own name, or empty).
Only fill a field when the caller actually said it. Never guess.`;
}

/** Deterministic first; the model fills only what is still missing, and its answers are validated. */
export async function understand(ai: AiBinding | undefined, models: string[], spec: BusinessSpec, text: string, now: Date, awaiting: Awaiting, budget: () => Promise<boolean> = async () => true): Promise<Nlu & { usedModel: boolean }> {
  const det = parseUtterance(text, spec, now, awaiting);
  const needsModel = ai && (det.intent === "none" || (det.intent === "book" && !det.serviceId && !det.serviceOptions && awaiting === "service")) && !det.yes && !det.no && !det.bookingId;
  if (!needsModel || !(await budget())) return { ...det, usedModel: false };
  try {
    const o = await aiJson(ai!, models, [{ role: "system", content: nluPrompt(spec, now, awaiting) }, { role: "user", content: text.slice(0, 500) }], NLU_SCHEMA, 120, "nlu");
    const today = DateTime.fromJSDate(now, { zone: spec.timezone }).startOf("day");
    const out: Nlu = { ...det };
    if (det.intent === "none" && typeof o.intent === "string" && ["book", "services", "price", "hours", "cancel", "greeting", "thanks"].includes(o.intent)) out.intent = o.intent as Intent;
    if (!out.serviceId && typeof o.service === "string" && o.service.trim()) { const m = matchService(o.service, spec.services); if (m.id) out.serviceId = m.id; }
    if (!out.date && typeof o.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.date)) { const d = DateTime.fromISO(o.date, { zone: spec.timezone }); if (d.isValid && d >= today && d <= today.plus({ days: spec.maxAdvanceDays })) out.date = o.date; }
    if (!out.time && typeof o.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(o.time)) out.time = o.time;
    if (!out.name && typeof o.name === "string") { const n = parseName(`my name is ${o.name}`, spec.services, false); if (n && normalize(text).includes(normalize(n).split(" ")[0])) out.name = n; }
    return { ...out, usedModel: true };
  } catch {
    return { ...det, usedModel: false }; // the model is optional: the parser alone still works
  }
}
