// A scripted stand-in for Workers AI, used by tests and by `npm run dev:local`.
// It only exercises the plumbing. It says nothing about how the real model behaves.
import type { AiBinding } from "../ai.js";

const INTERVIEW_TURNS: Record<string, unknown>[] = [
  { reply: "Nice to meet you! Which currency do you charge in, and what do you offer?", name: "Sam's Barber", timezone: "Africa/Johannesburg" },
  { reply: "Got it. When are you open?", currency: "ZAR", addServices: [{ name: "Haircut", durationMin: 30, price: 120 }, { name: "Full colour", durationMin: 120, price: 600, neverByVoice: true }] },
  { reply: "Recorded. Should any service never be booked by voice?", setHours: [1, 2, 3, 4, 5].map((day) => ({ day, open: "09:00", close: "17:00" })) },
  { reply: "Noted. Any minimum notice or gap between appointments?", askedVoice: true },
  { reply: "Thanks!", minNoticeMin: 60, bufferMin: 0, askedRules: true },
];

export class FakeAI implements AiBinding {
  calls = 0;
  async run(model: string, input: any) {
    this.calls++;
    if (model.includes("whisper")) return { text: "I would like to book a haircut" };
    const msgs: { role: string; content: string }[] = input.messages;
    const sys = msgs[0].content;
    const last = msgs[msgs.length - 1].content;
    if (sys.startsWith("You set up a booking assistant")) {
      const turn = msgs.filter((m) => m.role === "user").length - 1;
      return { response: INTERVIEW_TURNS[Math.min(turn, INTERVIEW_TURNS.length - 1)] };
    }
    // assistant
    const svc = /^(\S+): /m.exec(sys)?.[1] ?? "haircut";
    const today = /Today is \S+ (\d{4}-\d\d-\d\d)/.exec(sys)?.[1] ?? "2026-10-07";
    const d = new Date(today + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 2); while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
    const date = d.toISOString().slice(0, 10);
    const hex = /\b[0-9a-f]{32}\b/.exec(last)?.[0];
    if (last.startsWith("TOOL_RESULT check_availability")) {
      const times = last.match(/\d\d:\d\d/g)?.slice(0, 3) ?? [];
      return { response: { say: times.length ? `I have ${times.join(", ")} available. Which suits you?` : "Sorry, nothing is free that day.", tool: "none" } };
    }
    if (last.startsWith("TOOL_RESULT book")) return { response: { say: /"ok":true/.test(last) ? "All booked. See you then!" : "I couldn't book that. Shall we try another time?", tool: "none" } };
    if (last.startsWith("TOOL_RESULT cancel")) return { response: { say: "Your booking is cancelled.", tool: "none" } };
    if (hex) return { response: { say: "Cancelling that now.", tool: "cancel", bookingId: hex } };
    const time = /\b(\d\d:\d\d)\b/.exec(last)?.[1];
    if (time) return { response: { say: `Booking ${time} for you.`, tool: "book", serviceId: svc, date, time, customerName: /for (\w+)/i.exec(last)?.[1] ?? "Guest" } };
    if (/book|appointment|haircut/i.test(last)) return { response: { say: "Let me check what's free.", tool: "check_availability", serviceId: svc, date } };
    return { response: { say: "I can help you book an appointment. What would you like?", tool: "none" } };
  }
}
