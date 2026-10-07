// Sign-in for business owners: Google OAuth (one click = login + calendar link), signed sessions,
// encrypted refresh tokens. WebCrypto only, so it runs on Cloudflare Workers and Node alike.

const enc = new TextEncoder();
const dec = new TextDecoder();

export const b64url = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === "string" ? enc.encode(b) : new Uint8Array(b);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
export const randomHex = (bytes = 16) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

let ephemeral: string | undefined;
/** The secret behind sessions and token encryption. Without one (local dev), a per-process random secret is used. */
export function sessionSecret(env: { SESSION_SECRET?: string }): string {
  if (env.SESSION_SECRET && env.SESSION_SECRET.length >= 32) return env.SESSION_SECRET;
  if (!ephemeral) { ephemeral = randomHex(32); console.warn("SESSION_SECRET is not set: sessions will not survive a restart"); }
  return ephemeral;
}

const keyCache = new Map<string, Promise<CryptoKey>>();
function hkdfKey(secret: string, info: string, usage: "hmac" | "aes"): Promise<CryptoKey> {
  const id = `${info}|${secret}`;
  if (!keyCache.has(id)) {
    keyCache.set(id, (async () => {
      const base = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
      const params = { name: "HKDF", hash: "SHA-256", salt: enc.encode("open-counter"), info: enc.encode(info) };
      return usage === "hmac"
        ? crypto.subtle.deriveKey(params, base, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign", "verify"])
        : crypto.subtle.deriveKey(params, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    })());
  }
  return keyCache.get(id)!;
}

/** "payload.signature", both base64url. Tamper-proof, not secret. */
export async function sign(secret: string, payload: object): Promise<string> {
  const body = b64url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign("HMAC", await hkdfKey(secret, "sign", "hmac"), enc.encode(body));
  return `${body}.${b64url(sig)}`;
}

export async function verify<T extends { exp: number }>(secret: string, token: string | null | undefined, nowSec: number): Promise<T | null> {
  if (!token || token.length > 2000) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hkdfKey(secret, "sign", "hmac"), unb64url(sig), enc.encode(body));
    if (!ok) return null;
    const p = JSON.parse(dec.decode(unb64url(body))) as T;
    return typeof p.exp === "number" && p.exp > nowSec ? p : null;
  } catch { return null; }
}

/** AES-GCM with a random IV: "iv.ciphertext". Used for Google refresh tokens at rest. */
export async function encrypt(secret: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await hkdfKey(secret, "refresh-token", "aes"), enc.encode(plain));
  return `${b64url(iv)}.${b64url(ct)}`;
}
export async function decrypt(secret: string, boxed: string): Promise<string> {
  const [iv, ct] = boxed.split(".");
  return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64url(iv) }, await hkdfKey(secret, "refresh-token", "aes"), unb64url(ct)));
}

// ---------------- Sessions ----------------

export interface Session { m: string; demo?: boolean; exp: number }
export const SESSION_COOKIE = "oc_session";

export function readCookie(req: Request, name: string): string | null {
  const c = req.headers.get("cookie") ?? "";
  for (const part of c.split(/;\s*/)) { const i = part.indexOf("="); if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1)); }
  return null;
}

/** Cookie for pages on this site; "Authorization: Bearer <token>" for a frontend on another domain. */
export async function getSession(req: Request, secret: string, nowSec: number): Promise<Session | null> {
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : readCookie(req, SESSION_COOKIE);
  return verify<Session>(secret, token, nowSec);
}

export function sessionCookie(token: string, maxAgeSec: number, secure: boolean): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? "; Secure" : ""}`;
}
export const clearCookie = (name: string, secure: boolean) => `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;

// ---------------- Google OAuth ----------------

export const GOOGLE_SCOPES = ["openid", "email", "profile", "https://www.googleapis.com/auth/calendar.events"];
export interface OAuthEnv { GOOGLE_OAUTH_CLIENT_ID?: string; GOOGLE_OAUTH_CLIENT_SECRET?: string }
export const oauthConfigured = (env: OAuthEnv) => !!(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET);

export function googleAuthUrl(env: OAuthEnv, redirectUri: string, state: string, loginHint?: string): string {
  const p = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID!, redirect_uri: redirectUri, response_type: "code", scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  });
  if (loginHint) p.set("login_hint", loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export interface GoogleIdentity { sub: string; email: string; name: string | null; picture: string | null; refreshToken: string | null; scopes: string[] }

/** Swap the one-time code for tokens. The id_token comes straight from Google over TLS, so its claims can be read without a JWKS check. */
export async function exchangeCode(env: OAuthEnv, code: string, redirectUri: string, fetcher: typeof fetch = fetch): Promise<GoogleIdentity> {
  const r = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_OAUTH_CLIENT_ID!, client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET!, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`google token exchange ${r.status}`);
  const j = (await r.json()) as { id_token?: string; refresh_token?: string; scope?: string };
  if (!j.id_token) throw new Error("google returned no id_token");
  const claims = JSON.parse(dec.decode(unb64url(j.id_token.split(".")[1]))) as { sub: string; email: string; email_verified?: boolean; name?: string; picture?: string; aud: string; iss: string };
  if (claims.aud !== env.GOOGLE_OAUTH_CLIENT_ID || !/^(https:\/\/)?accounts\.google\.com$/.test(claims.iss)) throw new Error("id_token was not issued for this app");
  if (!claims.email || claims.email_verified === false) throw new Error("google account email is not verified");
  return { sub: claims.sub, email: claims.email, name: claims.name ?? null, picture: claims.picture ?? null, refreshToken: j.refresh_token ?? null, scopes: (j.scope ?? "").split(" ") };
}

const accessCache = new Map<string, { token: string; exp: number }>();
/** A fresh access token for an owner's Google account. Throws "google_reconnect_needed" when the link has expired or was revoked. */
export async function userAccessToken(env: OAuthEnv, merchantId: string, refreshToken: () => Promise<string | null>, fetcher: typeof fetch = fetch): Promise<string> {
  const nowS = Math.floor(Date.now() / 1000);
  const c = accessCache.get(merchantId);
  if (c && c.exp - 60 > nowS) return c.token;
  const rt = await refreshToken();
  if (!rt) throw new Error("google_reconnect_needed");
  const r = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GOOGLE_OAUTH_CLIENT_ID!, client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET!, refresh_token: rt, grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(10_000),
  });
  if (r.status === 400 || r.status === 401) { accessCache.delete(merchantId); throw new Error("google_reconnect_needed"); }
  if (!r.ok) throw new Error(`google refresh ${r.status}`);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  accessCache.set(merchantId, { token: j.access_token, exp: nowS + j.expires_in });
  return j.access_token;
}
export const forgetAccessToken = (merchantId: string) => accessCache.delete(merchantId);
