import type { D1Like } from "./adapters/d1.js";
import { AiError, probeModels, type AiBinding, type Msg } from "./ai.js";
import type { CalendarPort } from "./ports.js";
import { BusinessSpecSchema, type BusinessSpec } from "./spec.js";
import { understand, type Awaiting } from "./nlu.js";
import { DateTime } from "luxon";
import { GREETING, interviewTurn, missing, sanitizeDraft } from "./interview.js";
import { allow, countPublished, deletePublished, putPublished } from "./store.js";
import { serviceAccountEmail } from "./adapters/google.js";
import { originAllowed, handleAccounts, type AccountsEnv } from "./accounts.js";
import { oauthConfigured } from "./auth.js";
import type { Deps } from "./ports.js";

export interface ApiEnv extends AccountsEnv {
  DB: D1Like;
  AI?: AiBinding;
  DEMO_MODE?: string;
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  ASSISTANT_MODEL?: string;
  INTERVIEW_MODEL?: string;
  /** Global cap on AI calls per day, protecting the free Workers AI allowance (10,000 neurons/day). */
  AI_DAILY_CALLS?: string;
  WHISPER_MODEL?: string;
}
export interface ApiCtx {
  resolve(slug: string): Promise<BusinessSpec | null>;
  calendar: CalendarPort;
  now(): Date;
  /** Everything the booking tools need for one business; `channel` tags where a booking came from. */
  deps(spec: BusinessSpec, channel: string): Deps;
  fetch?: typeof fetch;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const hex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "business";

// Tried in order; the first one that works is remembered. Override with a comma-separated list in ASSISTANT_MODEL / INTERVIEW_MODEL.
// Both lists start with the strongest model that supports JSON-schema mode on the free plan (see /api/ai-check).
const ASSISTANT_MODELS = ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/meta/llama-4-scout-17b-16e-instruct", "@cf/meta/llama-3.1-8b-instruct-fp8"];
const INTERVIEW_MODELS = ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/meta/llama-4-scout-17b-16e-instruct", "@cf/meta/llama-3.1-8b-instruct-fp8"];
/** Shown on the pages, so you can see at a glance which version is live. Bump on every release. */
export const BUILD = "2026-10-08-v6";
const WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo";
const models = (env: string | undefined, dflt: string[]) => { const l = (env ?? "").split(",").map((x) => x.trim()).filter(Boolean); return l.length ? l : dflt; };
const UNITS = { llm: 3, stt: 1 }; // the daily cap is counted in units: one language-model call = 3, one transcription = 1

function aiFailure(e: unknown, what: string): Response {
  console.error(`${what} ai failed`, e);
  const detail = e instanceof AiError ? e.attempts.map((a) => `${a.model} [${a.mode}]: ${a.error}`).slice(0, 6) : [String((e as Error)?.message ?? e).slice(0, 200)];
  return json({ error: "ai_failed", message: "The AI model did not answer. Please try again.", detail }, 502);
}

async function readJson(req: Request): Promise<any | null> {
  const text = await req.text();
  if (text.length > 20_000) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function cleanMsgs(x: unknown): Msg[] {
  if (!Array.isArray(x)) return [];
  return x.slice(-20).filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string").map((m) => ({ role: m.role, content: String(m.content).slice(0, 2500) }));
}

async function aiAllowed(env: ApiEnv, req: Request, cost = UNITS.llm): Promise<Response | null> {
  if (!env.AI) return json({ error: "ai_unavailable", message: "AI is not enabled on this deployment." }, 503);
  const ip = req.headers.get("cf-connecting-ip") ?? "local";
  const day = 86_400;
  const cap = Number(env.AI_DAILY_CALLS ?? 200) * UNITS.llm;
  if (!(await allow(env.DB, "ai:global", cap, day, cost))) return json({ error: "daily_limit", message: "The free AI allowance for today is used up. Try again tomorrow, or use the manual booking page." }, 429);
  if (!(await allow(env.DB, `ai:${ip}`, 180, 3600, cost))) return json({ error: "rate_limited", message: "Too many requests. Please wait a few minutes." }, 429);
  return null;
}

/** CORS for allow-listed frontends on other domains (FRONTEND_ORIGINS). Same-site pages need none of this. */
function withCors(res: Response, origin: string | null, env: ApiEnv): Response {
  if (!origin || !originAllowed(env, origin)) return res;
  const h = new Headers(res.headers);
  h.set("access-control-allow-origin", origin);
  h.set("access-control-allow-credentials", "true");
  h.append("vary", "origin");
  return new Response(res.body, { status: res.status, headers: h });
}

export async function handleApi(req: Request, env: ApiEnv, ctx: ApiCtx): Promise<Response> {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    if (!origin || !originAllowed(env, origin)) return new Response(null, { status: 403 });
    return withCors(new Response(null, { status: 204, headers: { "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS", "access-control-allow-headers": "content-type, authorization", "access-control-max-age": "86400" } }), origin, env);
  }
  return withCors(await route(req, env, ctx), origin, env);
}

async function route(req: Request, env: ApiEnv, ctx: ApiCtx): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // Writes only from this site or an allow-listed frontend: several endpoints spend the free AI allowance.
  const origin = req.headers.get("origin");
  if (req.method !== "GET" && origin && origin !== url.origin && !originAllowed(env, origin)) return json({ error: "forbidden" }, 403);

  try {
    const acc = await handleAccounts(req, env, { resolve: ctx.resolve, deps: ctx.deps, now: ctx.now, fetch: ctx.fetch });
    if (acc) return acc;

    if (path === "/api/config" && req.method === "GET") {
      return json({ demo: env.DEMO_MODE === "1" || !env.GOOGLE_SERVICE_ACCOUNT_JSON, serviceAccountEmail: serviceAccountEmail(env.GOOGLE_SERVICE_ACCOUNT_JSON) ?? null, ai: !!env.AI, googleSignIn: oauthConfigured(env), greeting: GREETING, build: BUILD, pushKey: (env as { VAPID_PUBLIC_KEY?: string }).VAPID_PUBLIC_KEY ?? null });
    }

    if (path === "/api/interview" && req.method === "POST") {
      const body = await readJson(req);
      if (!body) return json({ error: "bad_request" }, 400);
      const text = String(body.text ?? "").slice(0, 1200).trim();
      if (!text) return json({ reply: GREETING, draft: sanitizeDraft(body.draft), missing: missing(sanitizeDraft(body.draft)), complete: false, warnings: [] });
      // The model is optional here too: over budget or down, the owner's own words are still parsed and validated.
      const ai = env.AI && !(await aiAllowed(env, req)) ? env.AI : undefined;
      return json(await interviewTurn(ai, models(env.INTERVIEW_MODEL, INTERVIEW_MODELS), body.draft, cleanMsgs(body.messages), text));
    }

    // Understanding only: the page's dialog code decides every reply from real MCP results.
    // The parser always runs; the language model is used only when the parser is unsure, and only within the AI budget.
    if (path === "/api/assistant" && req.method === "POST") {
      const body = await readJson(req);
      const spec = body && typeof body.business === "string" ? await ctx.resolve(body.business) : null;
      if (!spec) return json({ error: "unknown_business" }, 404);
      const text = typeof body.text === "string" ? body.text.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 500) : "";
      if (!text) return json({ error: "bad_request" }, 400);
      const AW = ["service", "date", "time", "name", "confirm", "code", "codeName", "cancelConfirm", "offerBook"];
      const awaiting = (AW.includes(body.awaiting) ? body.awaiting : null) as Awaiting;
      const now = ctx.now();
      const r = await understand(env.AI, models(env.ASSISTANT_MODEL, ASSISTANT_MODELS), spec, text, now, awaiting, async () => !(await aiAllowed(env, req)));
      return json({ ...r, today: DateTime.fromJSDate(now, { zone: spec.timezone }).toISODate() });
    }

    // Diagnostics: which models answer on this account, and in which mode? Open /api/ai-check in a browser.
    if (path === "/api/ai-check" && req.method === "GET") {
      const blocked = await aiAllowed(env, req, UNITS.llm * 4); if (blocked) return blocked;
      const list = [...new Set([...models(env.ASSISTANT_MODEL, ASSISTANT_MODELS), ...models(env.INTERVIEW_MODEL, INTERVIEW_MODELS)])];
      return json({ results: await probeModels(env.AI!, list) });
    }

    // Speech to text with Whisper. The business name and services are passed as a vocabulary hint, which fixes most mishearings.
    if (path === "/api/transcribe" && req.method === "POST") {
      const buf = await req.arrayBuffer();
      if (!buf.byteLength || buf.byteLength > 2_000_000) return json({ error: "bad_audio", message: "Audio missing or too long." }, 400);
      const blocked = await aiAllowed(env, req, UNITS.stt); if (blocked) return blocked;
      const spec = await ctx.resolve(url.searchParams.get("business") ?? "");
      const lang = /^[a-z]{2}$/.test(url.searchParams.get("lang") ?? "") ? url.searchParams.get("lang")! : undefined;
      const hint = spec ? `Booking call for ${spec.name}. Services: ${spec.services.map((x) => x.name).join(", ")}. Words: appointment, book, cancel, tomorrow, Monday, Tuesday, Wednesday, Thursday, Friday.`.slice(0, 400) : undefined;
      let bin = ""; const bytes = new Uint8Array(buf); for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      try {
        const out = await env.AI!.run(env.WHISPER_MODEL ?? WHISPER_MODEL, { audio: btoa(bin), vad_filter: true, ...(lang ? { language: lang } : {}), ...(hint ? { initial_prompt: hint } : {}) });
        const text = String(out?.text ?? out?.response ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
        return json({ text });
      } catch (e) { return aiFailure(e, "transcribe"); }
    }

    if (path === "/api/publish" && req.method === "POST") {
      const body = await readJson(req);
      if (!body) return json({ error: "bad_request" }, 400);
      const ip = req.headers.get("cf-connecting-ip") ?? "local";
      if (!(await allow(env.DB, `pub:${ip}`, 5, 3600))) return json({ error: "rate_limited", message: "Too many publishes. Try again later." }, 429);
      if ((await countPublished(env.DB)) >= 300) return json({ error: "capacity", message: "This demo is at capacity." }, 503);

      const d = sanitizeDraft(body.draft);
      const essentials = missing({ ...d, askedVoice: true, askedRules: true });
      if (essentials.length) return json({ error: "incomplete", message: `Still missing: ${essentials.join(", ")}.` }, 400);

      const demo = env.DEMO_MODE === "1" || !env.GOOGLE_SERVICE_ACCOUNT_JSON;
      let calendarId = String(body.calendarId ?? "").replace(/[\u0000-\u001f\s]/g, "").slice(0, 200);
      if (!calendarId && !demo) return json({ error: "calendar_required", message: "Enter the Google Calendar ID you shared." }, 400);

      let spec: BusinessSpec | undefined;
      for (let i = 0; i < 5 && !spec; i++) {
        const slug = `${slugify(d.name!)}-${hex(2)}`;
        if (await ctx.resolve(slug)) continue;
        spec = BusinessSpecSchema.parse({
          slug, name: d.name, timezone: d.timezone, currency: d.currency, calendarId: calendarId || `demo-${slug}`,
          hours: d.hours, minNoticeMin: d.minNoticeMin ?? 60, bufferMin: d.bufferMin ?? 0, services: d.services,
        });
      }
      if (!spec) return json({ error: "slug_collision" }, 500);

      if (!demo) {
        try { const n = ctx.now(); await ctx.calendar.listBusy(spec.calendarId, n.toISOString(), new Date(n.getTime() + 86_400_000).toISOString()); }
        catch { return json({ error: "calendar_not_accessible", message: `I could not read that calendar. Share it with ${serviceAccountEmail(env.GOOGLE_SERVICE_ACCOUNT_JSON)} (permission: Make changes to events) and check the ID.` }, 400); }
      }
      const ownerKey = hex(32);
      if (!(await putPublished(env.DB, spec, ownerKey, Math.floor(ctx.now().getTime() / 1000)))) return json({ error: "slug_collision" }, 500);
      return json({ ok: true, slug: spec.slug, endpoint: `${url.origin}/mcp/${spec.slug}`, assistantUrl: `${url.origin}/?business=${spec.slug}&view=assistant`, ownerKey, demo });
    }

    const del = /^\/api\/business\/([a-z0-9-]+)$/.exec(path);
    if (del && req.method === "DELETE") {
      const ok = await deletePublished(env.DB, del[1], req.headers.get("x-owner-key") ?? "");
      return ok ? json({ ok: true }) : json({ error: "not_found_or_wrong_key" }, 404);
    }
    return json({ error: "not_found" }, 404);
  } catch (e) {
    console.error("api error", e);
    return json({ error: "server_error", message: "Something went wrong. Please try again." }, 500);
  }
}
