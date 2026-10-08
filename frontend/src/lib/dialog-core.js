// Open Counter booking dialog. Pure logic, no DOM: the page and the tests both use it.
// The language model only helps UNDERSTAND the caller (see /api/assistant). Every reply here is
// written by code from real MCP results, so the assistant cannot invent availability, prices or bookings.

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const CURRENCY_WORDS = { ZAR: "rand", USD: "dollars", EUR: "euros", GBP: "pounds", KES: "shillings", NGN: "naira", AUD: "dollars" };

export const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = (iso) => new Date(iso + "T12:00:00Z").getUTCDay();

/** "15:00" -> "3 pm", "14:15" -> "2:15 pm" (reads well aloud and on screen). */
/** "K7P-Q2M" -> "K 7 P, Q 2 M": letter by letter, so it can be heard and repeated. */
export function sayCode(c) { return String(c).split("-").map((p) => p.split("").join(" ")).join(", "); }

export function sayTime(t) {
  let h = Number(t.slice(0, 2)); const m = t.slice(3, 5); const ap = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return m === "00" ? `${h} ${ap}` : `${h}:${m} ${ap}`;
}
export function sayList(items) {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function createDialog({ info, tool, understand }) {
  const st = { serviceId: null, date: null, time: null, part: null, name: null, awaiting: null, offered: [], suggestDate: null, today: null, lastBooking: null, idemKey: null };
  const cache = new Map(); // "service|date" -> { ok, list: [HH:MM], map: {HH:MM: slot}, message }
  const svc = (id) => info.services.find((s) => s.id === id);
  const money = (p) => `${p} ${CURRENCY_WORDS[info.currency] || info.currency}`;
  const sayDay = (iso) => {
    if (iso === st.today) return "today";
    if (st.today && iso === addDays(st.today, 1)) return "tomorrow";
    const d = new Date(iso + "T12:00:00Z");
    return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}`;
  };
  const onDay = (iso) => { const d = sayDay(iso); return d === "today" || d === "tomorrow" ? d : "on " + d; };
  const aService = (s) => `${/^[aeiou]/i.test(s.name) ? "an" : "a"} ${s.name.toLowerCase()}`;
  const serviceList = () => sayList(info.services.map((s) => `${s.name} (${money(s.price)})`));
  const hoursText = () => {
    const by = new Map();
    for (const h of info.hours) by.set(`${h.open}|${h.close}`, [...(by.get(`${h.open}|${h.close}`) || []), h.day]);
    const parts = [...by].map(([w, days]) => {
      days.sort((a, b) => a - b);
      const run = days.length > 2 && days.every((d, i) => i === 0 || d === days[i - 1] + 1);
      const label = run ? `${DAY_NAMES[days[0]]} to ${DAY_NAMES[days[days.length - 1]]}` : sayList(days.map((d) => DAY_NAMES[d]));
      const [o, c] = w.split("|");
      return `${label} from ${sayTime(o)} to ${sayTime(c)}`;
    });
    const closed = DAY_NAMES.filter((_, i) => !info.hours.some((h) => h.day === i));
    return parts.length ? `We're open ${sayList(parts)}${closed.length ? `, and closed on ${sayList(closed)}` : ""}.` : "We don't have opening hours set up yet.";
  };
  const reply = (say, extra = {}) => ({ say, ...extra });

  async function slotsFor(serviceId, date) {
    const key = `${serviceId}|${date}`;
    if (cache.has(key)) return cache.get(key);
    const r = await tool("check_availability", { serviceId, date });
    const v = r && r.ok
      ? { ok: true, list: r.slots.map((s) => s.start.slice(11, 16)), map: Object.fromEntries(r.slots.map((s) => [s.start.slice(11, 16), s])) }
      : { ok: false, code: r && r.code, list: [], map: {}, message: (r && r.message) || "I couldn't check the diary just now." };
    cache.set(key, v);
    return v;
  }

  /** Pick up to n spread-out times, preferring on-the-hour and half-hour, within the asked part of the day. */
  function suggest(list, part, n = 4) {
    let pool = list.filter((t) => { const m = toMin(t); return part === "morning" ? m < 720 : part === "afternoon" ? m >= 720 && m < 1020 : part === "evening" ? m >= 1020 : true; });
    if (!pool.length) pool = list;
    const round = pool.filter((t) => t.endsWith(":00") || t.endsWith(":30"));
    if (round.length >= n) pool = round;
    if (pool.length <= n) return pool;
    return Array.from({ length: n }, (_, i) => pool[Math.round((i * (pool.length - 1)) / (n - 1))]);
  }
  // The closest free times, but spread out: 9:00, 9:15 and 9:30 are one choice said three times.
  function nearest(list, t, n = 3, gap = 45) {
    const picked = [];
    for (const c of [...list].sort((a, b) => Math.abs(toMin(a) - toMin(t)) - Math.abs(toMin(b) - toMin(t)))) {
      if (picked.every((p) => Math.abs(toMin(p) - toMin(c)) >= gap)) picked.push(c);
      if (picked.length === n) break;
    }
    return picked.sort();
  }
  const notice = (m) => (m >= 60 && m % 60 === 0 ? `${m / 60} hour${m === 60 ? "" : "s"}` : `${m} minutes`);
  /** Why a time the customer asked for can't be booked, in the words of the rule that says no. */
  function whyNot(want, date, s, list) {
    const ranges = info.hours.filter((h) => h.day === dow(date));
    const m = toMin(want), end = m + (s ? s.durationMin : 0);
    if (ranges.length) {
      const open = Math.min(...ranges.map((h) => toMin(h.open))), close = Math.max(...ranges.map((h) => toMin(h.close)));
      if (m < open) return { rule: "hours", text: `We open at ${sayTime(ranges.find((h) => toMin(h.open) === open).open)}, so ${sayTime(want)} isn't possible.` };
      if (m >= close) return { rule: "hours", text: `We close at ${sayTime(ranges.find((h) => toMin(h.close) === close).close)}, so ${sayTime(want)} isn't possible.` };
      if (!ranges.some((h) => m >= toMin(h.open) && end <= toMin(h.close))) return { rule: "hours", text: `${s ? s.name : "That"} at ${sayTime(want)} would run past our opening hours.` };
    }
    if (date === st.today && list.length && m < toMin(list[0]) && info.minNoticeMin) return { rule: "notice", text: `We need at least ${notice(info.minNoticeMin)} notice, so ${sayTime(want)} today is too soon.` };
    return { rule: "taken", text: `Sorry, ${sayTime(want)} ${onDay(date)} isn't available; it's already booked.` };
  }

  function ask(what) {
    st.awaiting = what;
    const s = svc(st.serviceId);
    if (what === "service") return `Which service would you like? We offer ${serviceList()}.`;
    if (what === "date") return `What day would you like to come in${s ? ` for ${aService(s)}` : ""}?`;
    if (what === "time") return st.offered.length ? `Which time would you like: ${sayList(st.offered.map(sayTime))}?` : "What time would suit you?";
    if (what === "name") return "What name should I put the booking under?";
    if (what === "code") return "Please read me your booking code. It's six letters and numbers, like K 7 P, Q 2 M.";
    if (what === "codeName") return "And what name is the booking under?";
    if (what === "confirm") return "Shall I book it? Please say yes or no.";
    return "How can I help? I can tell you about our services, prices and hours, or book you in.";
  }

  /** Decide the next step for a booking, using real availability. */
  async function plan(prefix = "") {
    const P = (s, extra) => reply((prefix ? prefix + " " : "") + s, extra);
    const s = svc(st.serviceId);
    if (!s) return P(ask("service"));
    if (!s.bookableByVoice) {
      st.serviceId = null; st.awaiting = null;
      return P(`Sorry, ${s.name} can't be booked through the assistant. Please contact ${info.name} directly for that. Can I help with anything else?`);
    }
    if (!st.date) return P(ask("date"));
    const a = await slotsFor(s.id, st.date);
    if (!a.ok && (a.code === "paused" || a.code === "not_bookable_by_voice")) { cache.clear(); st.serviceId = st.date = st.time = null; st.awaiting = null; return P(`Sorry, ${a.message.charAt(0).toLowerCase() + a.message.slice(1)}`); }
    if (!a.ok) { cache.delete(`${s.id}|${st.date}`); st.date = null; return P(`${a.message} ${ask("date")}`); }
    if (!a.list.length) {
      const closed = !info.hours.some((h) => h.day === dow(st.date));
      const why = closed ? `We're closed on ${DAY_NAMES[dow(st.date)]}s.` : `There's nothing free for ${aService(s)} ${onDay(st.date)}.`;
      let next = null;
      for (let i = 1; i <= 7 && !next; i++) { const d = addDays(st.date, i); const r = await slotsFor(s.id, d); if (r.ok && r.list.length) next = d; }
      st.date = null; st.time = null; st.offered = [];
      if (!next) return P(`${why} I couldn't find a free time in the following week either. ${ask("date")}`);
      st.suggestDate = next; st.awaiting = "date";
      return P(`${why} The next day with free times is ${sayDay(next)}. Would that work?`);
    }
    if (st.time && !a.map[st.time]) {
      const want = st.time, why = whyNot(want, st.date, s, a.list);
      st.time = null; st.awaiting = "time";
      if (why.rule === "hours") {
        // Outside opening hours: offer a spread across that end of the day, not three neighbours.
        st.offered = suggest(a.list, toMin(want) < toMin(a.list[0]) ? "morning" : "afternoon", 3);
        return P(`${why.text} ${onDay(st.date).charAt(0).toUpperCase() + onDay(st.date).slice(1)} I have ${sayList(st.offered.map(sayTime))} free. Which would you like?`);
      }
      st.offered = nearest(a.list, want);
      return P(`${why.text} The closest free times are ${sayList(st.offered.map(sayTime))}. Which would you like?`);
    }
    if (!st.time) {
      st.offered = suggest(a.list, st.part);
      const more = a.list.length > st.offered.length;
      st.awaiting = "time";
      const day = sayDay(st.date);
      return P(`${day.charAt(0).toUpperCase() + day.slice(1)} I have ${sayList(st.offered.map(sayTime))} free${more ? ", among other times" : ""}. Which time suits you?`);
    }
    if (!st.name) return P(`${sayTime(st.time)} ${onDay(st.date)} is free. ${ask("name")}`);
    st.awaiting = "confirm";
    st.idemKey = st.idemKey || (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
    const slot = a.map[st.time];
    // Ask the server for the read-back too: it returns a token that books exactly these details and nothing else.
    const rb = await tool("book", { serviceId: s.id, start: slot.start, customerName: st.name, customerConfirmed: false });
    if (rb && rb.code !== "confirmation_required") { st.awaiting = null; st.time = null; return P(`Sorry, I can't book that: ${(rb && rb.message) || "the booking system didn't answer"}`); }
    st.rbToken = rb.confirmationToken || null;
    return P(`To confirm: ${aService(s)} ${onDay(st.date)} at ${sayTime(st.time)}, ${money(s.price)}, for ${st.name}. Shall I book it?`, {
      confirm: { service: s.name, when: slot.startLocal, price: s.price, currency: info.currency, name: st.name },
    });
  }

  async function book() {
    const s = svc(st.serviceId), a = await slotsFor(s.id, st.date), slot = a.map[st.time];
    if (!slot) { st.time = null; return plan("Sorry, that time is no longer available."); }
    const r = await tool("book", { serviceId: s.id, start: slot.start, customerName: st.name, customerConfirmed: true, confirmationToken: st.rbToken || undefined, idempotencyKey: st.idemKey });
    cache.delete(`${s.id}|${st.date}`);
    if (r && r.ok) {
      st.lastBooking = { id: r.bookingId, code: r.code, service: r.service, when: r.startLocal, on: onDay(st.date), time: st.time };
      st.serviceId = st.date = st.time = st.part = null; st.offered = []; st.awaiting = null; st.idemKey = null;
      const code = r.code ? ` Your booking code is ${sayCode(r.code)}. Keep it in case you need to cancel.` : " Your booking code is on the screen; keep it in case you need to cancel.";
      return reply(`You're booked: ${aService(s)} ${st.lastBooking.on} at ${sayTime(st.lastBooking.time)}.${code} Anything else?`, { booked: r });
    }
    if (r && r.code === "confirmation_required") {
      // The read-back expired (the customer took a while) or the details changed: read it back again.
      st.rbToken = r.confirmationToken || null; st.awaiting = "confirm";
      return reply(`Just to check again: ${aService(s)} ${onDay(st.date)} at ${sayTime(st.time)}, ${money(s.price)}, for ${st.name}. Shall I book it?`);
    }
    st.idemKey = null;
    if (r && (r.code === "slot_taken" || r.code === "busy")) { st.time = null; return plan("Sorry, someone just took that time."); }
    st.awaiting = null;
    return reply(`Sorry, I couldn't book that: ${(r && r.message) || "the booking system didn't answer"}. Would you like to try another time?`);
  }

  async function cancelByCode(code, name) {
    st.pendingCode = null;
    const r = await tool("cancel", { code, customerName: name });
    st.awaiting = null;
    if (r && r.ok) {
      if (st.lastBooking && st.lastBooking.id === r.bookingId) st.lastBooking = null;
      st.serviceId = st.date = st.time = st.part = null; st.offered = []; st.idemKey = null;
      return reply(`Done, booking ${sayCode(code)} is cancelled. Anything else?`, { cancelled: r.bookingId });
    }
    if (r && r.code === "not_found") { st.awaiting = "code"; return reply(`I couldn't find a booking with code ${sayCode(code)} under ${name}. Could you read the code again?`); }
    return reply(`I couldn't cancel that booking: ${(r && r.message) || "the booking system didn't answer"}.`);
  }

  async function cancelBooking(id) {
    const r = await tool("cancel", { bookingId: id });
    st.awaiting = null;
    if (r && r.ok) {
      if (st.lastBooking && st.lastBooking.id === id) st.lastBooking = null;
      st.serviceId = st.date = st.time = st.part = null; st.offered = []; st.idemKey = null; // start fresh after a cancellation
      return reply("Done, your booking is cancelled. Anything else?", { cancelled: id });
    }
    return reply(`I couldn't cancel that booking: ${(r && r.message) || "the booking system didn't answer"}.`);
  }

  async function step(u) {
    if (u.today) st.today = u.today;
    const slotChange = !!(u.serviceId || u.date || u.time || u.choice);

    // A pending booking: only a clear yes books. Anything else either changes details or cancels the read-back.
    if (st.awaiting === "confirm") {
      if (u.yes && !slotChange) return book();
      if (u.no && !slotChange) { st.time = null; st.awaiting = null; st.idemKey = null; return reply("No problem, I haven't booked anything. Would you like a different time or day?"); }
      if (!slotChange && !u.name && u.intent !== "cancel") return reply(ask("confirm"));
      st.idemKey = null;
    }
    if (st.awaiting === "cancelConfirm") {
      if (u.yes) return cancelBooking(st.lastBooking.id);
      if (u.no) { st.awaiting = null; return reply("Okay, I've left your booking as it is. Anything else?"); }
    }

    // Cancelling.
    if (u.bookingId && (u.intent === "cancel" || st.awaiting === "code" || !slotChange)) return cancelBooking(u.bookingId);
    if (st.awaiting === "codeName" && st.pendingCode) {
      if (u.no) { st.awaiting = null; st.pendingCode = null; return reply("Okay, nothing was cancelled. Anything else?"); }
      if (u.name) { st.name = u.name; return cancelByCode(st.pendingCode, u.name); }
      return reply(ask("codeName"));
    }
    if (u.bookingCode && (u.intent === "cancel" || st.awaiting === "code" || !slotChange)) {
      const name = u.name || st.name;
      if (name) return cancelByCode(u.bookingCode, name);
      st.pendingCode = u.bookingCode; st.awaiting = "codeName"; return reply(ask("codeName"));
    }
    if (u.intent === "cancel") {
      if (st.lastBooking) { st.awaiting = "cancelConfirm"; return reply(`Do you want to cancel your ${st.lastBooking.service.toLowerCase()} ${st.lastBooking.on} at ${sayTime(st.lastBooking.time)}?`); }
      return reply(`Sure. ${ask("code")}`);
    }
    if (st.awaiting === "code" && !u.bookingId && !u.bookingCode) {
      if (u.no) { st.awaiting = null; return reply("Okay, nothing was cancelled. Anything else?"); }
      if (!slotChange) return reply(`Sorry, I didn't catch a booking code. ${ask("code")}`);
    }

    // Fill in what we heard.
    if (u.serviceId && u.serviceId !== st.serviceId) { st.serviceId = u.serviceId; st.offered = []; }
    if (u.date && u.date !== st.date) { st.date = u.date; st.offered = []; }
    if (u.yes && st.awaiting === "date" && st.suggestDate && !u.date) st.date = st.suggestDate;
    if (u.date || st.date) st.suggestDate = null;
    if (u.partOfDay) st.part = u.partOfDay;
    if (u.time) st.time = u.time;
    else if (u.choice && st.offered.length) st.time = u.choice === -1 ? st.offered[st.offered.length - 1] : st.offered[u.choice - 1] || null;
    else if (u.yes && st.awaiting === "time" && st.offered.length === 1) st.time = st.offered[0];
    if (u.name) st.name = u.name;

    if (!st.serviceId && u.serviceOptions && u.serviceOptions.length) {
      st.awaiting = "service";
      return reply(`Did you mean ${sayList(u.serviceOptions.map((id) => svc(id).name))}?`.replace(/ and ([^ ]+\?)$/, " or $1"));
    }

    // Questions.
    if (!slotChange && !u.name) {
      if (u.intent === "services") { const r = `We offer ${serviceList()}.`; return reply(st.awaiting && st.awaiting !== "offerBook" ? `${r} ${ask(st.awaiting)}` : `${r} Would you like to book one?`); }
      if (u.intent === "price") return reply(`Our prices are: ${serviceList()}. Would you like to book one?`);
      if (u.intent === "hours") return reply(`${hoursText()}${st.awaiting && st.awaiting !== "offerBook" ? " " + ask(st.awaiting) : ""}`);
      if (u.intent === "thanks") { st.awaiting = null; return reply("You're welcome! Anything else I can help with?"); }
      if (u.intent === "greeting" && !st.awaiting) return reply(`Hi! ${ask(null)}`);
    }
    if (u.intent === "price" && u.serviceId && !u.date && !u.time) {
      const s = svc(u.serviceId);
      st.awaiting = "offerBook";
      return reply(`${s.name} is ${money(s.price)} and takes ${s.durationMin} minutes.${s.bookableByVoice ? " Would you like to book one?" : ` It has to be booked directly with ${info.name}.`}`);
    }
    if (st.awaiting === "offerBook" && u.no) { st.awaiting = null; st.serviceId = null; return reply("No problem. Anything else?"); }

    const progressed = slotChange || u.name || (u.yes && (st.awaiting === "offerBook" || st.awaiting === "date" || st.awaiting === "time")) || u.intent === "book";
    if (progressed) return plan();
    return reply(`Sorry, I didn't catch that. ${ask(st.awaiting)}`);
  }

  return {
    state: st,
    async handle(text) { return step(await understand(text, st.awaiting)); },
    /** The on-screen Yes / No buttons. */
    confirm(yes) { return step(yes ? { intent: "none", yes: true } : { intent: "none", no: true }); },
    greeting() { return `Hi, I'm the booking assistant for ${info.name}. I can tell you about our services, prices and hours, or book you in. What would you like?`; },
  };
}
