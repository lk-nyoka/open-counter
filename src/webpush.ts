/**
 * Web Push (RFC 8030) with message encryption (RFC 8291, aes128gcm) and VAPID (RFC 8292), on WebCrypto only,
 * so it runs on Cloudflare Workers with no library. Used to tell an owner about a new booking on their phone.
 */

export interface PushSubscriptionJSON { endpoint: string; keys: { p256dh: string; auth: string } }
export interface VapidKeys { publicKey: string; privateJwk: JsonWebKey; subject: string }

const enc = new TextEncoder();
export const b64url = (b: ArrayBuffer | Uint8Array) => {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = ""; for (const x of u) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export const unb64url = (s: string) => {
  const t = s.replace(/-/g, "+").replace(/_/g, "/"); const p = t + "===".slice((t.length + 3) % 4);
  return Uint8Array.from(atob(p), (c) => c.charCodeAt(0));
};
/** WebCrypto wants ArrayBuffer-backed views; TypeScript cannot prove that for every Uint8Array. */
const bs = (u: Uint8Array) => u as unknown as BufferSource;
const concat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", bs(ikm), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: bs(salt), info: bs(info) }, key, length * 8));
}

/** Encrypt one push message for one subscription (RFC 8291). `fixed` exists only so tests can use known values. */
export async function encryptPayload(sub: PushSubscriptionJSON, payload: Uint8Array, fixed?: { salt: Uint8Array; serverKeys: CryptoKeyPair }) {
  const uaPublic = unb64url(sub.keys.p256dh);
  const authSecret = unb64url(sub.keys.auth);
  const serverKeys = fixed?.serverKeys ?? (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeys.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", bs(uaPublic), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, serverKeys.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", bs(cek), "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: bs(nonce) }, key, bs(concat(payload, new Uint8Array([2])))));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/** VAPID authorization header value for a push service origin. */
export async function vapidHeader(endpoint: string, vapid: VapidKeys, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(enc.encode(JSON.stringify({ aud, exp: nowSec + 12 * 3600, sub: vapid.subject })));
  const key = await crypto.subtle.importKey("jwk", vapid.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, bs(enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${vapid.publicKey}`;
}

/** Send one notification. Returns "gone" when the subscription has expired and should be deleted. */
export async function sendPush(sub: PushSubscriptionJSON, message: object, vapid: VapidKeys, fetcher: typeof fetch = fetch): Promise<"ok" | "gone" | "error"> {
  const body = await encryptPayload(sub, enc.encode(JSON.stringify(message)));
  const r = await fetcher(sub.endpoint, {
    method: "POST",
    headers: { "content-encoding": "aes128gcm", "content-type": "application/octet-stream", ttl: "86400", urgency: "high", authorization: await vapidHeader(sub.endpoint, vapid) },
    body: bs(body),
  });
  if (r.status === 404 || r.status === 410) return "gone";
  return r.ok ? "ok" : "error";
}

export function vapidFromEnv(env: { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_JWK?: string; VAPID_SUBJECT?: string }): VapidKeys | null {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_JWK) return null;
  try { return { publicKey: env.VAPID_PUBLIC_KEY, privateJwk: JSON.parse(env.VAPID_PRIVATE_JWK), subject: env.VAPID_SUBJECT ?? "https://github.com/lk-nyoka/open-counter" }; } catch { return null; }
}
