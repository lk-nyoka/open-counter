import { aiJson, type AiBinding, type Msg } from "./ai.js";
import type { BusinessSpec } from "./spec.js";
import { DateTime } from "luxon";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function hoursText(spec: BusinessSpec): string {
  const by = new Map<string, number[]>();
  for (const h of spec.hours) by.set(`${h.open}-${h.close}`, [...(by.get(`${h.open}-${h.close}`) ?? []), h.day]);
  return [...by].map(([w, d]) => `${d.sort().map((x) => DAYS[x]).join(",")} ${w}`).join("; ") || "closed";
}

export function assistantPrompt(spec: BusinessSpec, now: Date): string {
  const t = DateTime.fromJSDate(now, { zone: spec.timezone });
  const services = spec.services
    .map((s) => `${s.id}: ${s.name}, ${s.durationMin} min, ${s.price} ${spec.currency}${s.bookableByVoice ? "" : " (NOT bookable by voice)"}`)
    .join("\n");
  return `You are the voice booking assistant for ${spec.name}. Today is ${t.toFormat("cccc yyyy-LL-dd")}, ${t.toFormat("HH:mm")} (${spec.timezone}). Speak in short, friendly sentences: the customer may be listening, not reading.
The customer's words come from speech recognition and may contain mistakes or sound-alikes (for example "selection" or "section" for "haircut"), and slow speakers may be cut off mid-sentence. Interpret them using the services list and the earlier messages, combine fragments, and if you are unsure ask one short clarifying question instead of guessing.
Services:
${services}
Hours: ${hoursText(spec)}
Set "tool" to act; the result comes back as a TOOL_RESULT message. One tool per reply; use "none" when you just talk.
Rules:
1. Never invent availability. Call check_availability (serviceId, date as YYYY-MM-DD) first, then offer at most 3 times close to what they asked.
2. To book you need serviceId, date, time (HH:MM exactly as listed in the availability result) and the customer's name. Ask for what is missing.
3. Read back service, day, time and price and wait for a clear yes. Only then use tool=book; the app will ask them to confirm once more.
4. Never mention tool names or IDs. For a service that is not bookable by voice, say they should contact the business.
5. To cancel, ask for their booking code, then tool=cancel with bookingId.
6. Be honest about errors: if a tool fails, say so and offer another time.
Reply as JSON only: {"say": "what you say aloud", "tool": "none|check_availability|get_quote|book|cancel", plus the arguments that tool needs}.`;
}

export const ASSISTANT_SCHEMA = {
  type: "object",
  properties: {
    say: { type: "string" },
    tool: { type: "string", enum: ["none", "check_availability", "get_quote", "book", "cancel"] },
    serviceId: { type: "string" },
    date: { type: "string" },
    time: { type: "string" },
    customerName: { type: "string" },
    customerPhone: { type: "string" },
    bookingId: { type: "string" },
  },
  required: ["say", "tool"],
};

export interface AssistantReply {
  say: string;
  tool: "none" | "check_availability" | "get_quote" | "book" | "cancel";
  serviceId?: string; date?: string; time?: string; customerName?: string; customerPhone?: string; bookingId?: string;
}

const TOOLS = new Set(["none", "check_availability", "get_quote", "book", "cancel"]);
const str = (x: unknown, max: number) => (typeof x === "string" && x.trim() ? x.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : undefined);

export function normalizeReply(o: Record<string, unknown>): AssistantReply {
  const tool = TOOLS.has(String(o.tool)) ? (o.tool as AssistantReply["tool"]) : "none";
  const say = str(o.say, 600) ?? (tool === "none" ? "Sorry, could you say that again?" : "");
  return { say, tool, serviceId: str(o.serviceId, 40), date: str(o.date, 10), time: str(o.time, 5), customerName: str(o.customerName, 80), customerPhone: str(o.customerPhone, 30), bookingId: str(o.bookingId, 40) };
}

export async function assistantTurn(ai: AiBinding, models: string[], spec: BusinessSpec, history: Msg[], now: Date): Promise<AssistantReply> {
  const out = await aiJson(ai, models, [{ role: "system", content: assistantPrompt(spec, now) }, ...history.slice(-14)], ASSISTANT_SCHEMA, 400, "assistant");
  return normalizeReply(out);
}
