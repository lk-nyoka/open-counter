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
      if (process.env.FAKE_REPLY_ONLY) return { response: { reply: "Recorded everything you said." } }; // a model that records nothing
      const turn = msgs.filter((m) => m.role === "user").length - 1;
      return { response: INTERVIEW_TURNS[Math.min(turn, INTERVIEW_TURNS.length - 1)] };
    }
    // Understanding (NLU): a deliberately weak stand-in, so tests prove the deterministic parser carries the load.
    if (/^ ?(i|we) (had|want|need) (the same|my usual)/i.test(last)) return { response: { intent: "book", service: "Haircut" } };
    return { response: { intent: "none" } };
  }
}
