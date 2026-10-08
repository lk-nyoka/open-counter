// Web Push: encryption checked by an independent decryptor (node:crypto, not WebCrypto), VAPID by signature
// verification, and the whole path: an owner subscribes, a customer books through MCP, the owner's phone is notified.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createECDH, createPublicKey, hkdfSync, createDecipheriv, generateKeyPairSync, randomBytes, verify } from "node:crypto";
import { DateTime } from "luxon";
import { encryptPayload, vapidHeader, b64url, unb64url, type VapidKeys } from "./webpush.js";
import worker from "./worker.js";
import { d1Shim } from "./dev/d1-shim.js";
import { FakeAI } from "./dev/fake-ai.js";

/** What a browser does with a push message (RFC 8291), written separately with node:crypto. */
function browserDecrypt(body: Uint8Array, uaPrivate: ReturnType<typeof createECDH>, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const cipher = body.subarray(21 + idlen);
  const ecdh = uaPrivate.computeSecret(asPublic);
  const uaPublic = uaPrivate.getPublicKey();
  const ikm = Buffer.from(hkdfSync("sha256", ecdh, auth, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]), 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const d = createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, "last-record delimiter");
  return plain.subarray(0, plain.length - 1).toString("utf8");
}

function browserSubscription() {
  const ua = createECDH("prime256v1"); ua.generateKeys();
  const auth = randomBytes(16);
  return { ua, auth, sub: { endpoint: "https://push.example.net/send/abc123", keys: { p256dh: b64url(ua.getPublicKey()), auth: b64url(auth) } } };
}

function vapidKeys(): VapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = privateKey.export({ format: "jwk" }) as JsonWebKey;
  const pub = publicKey.export({ format: "jwk" }) as JsonWebKey;
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(unb64url(pub.x!)), Buffer.from(unb64url(pub.y!))]);
  return { publicKey: b64url(raw), privateJwk: jwk, subject: "https://example.com" };
}

test("push payload encryption (RFC 8291) decrypts with an independent implementation", async () => {
  const { ua, auth, sub } = browserSubscription();
  const msg = JSON.stringify({ title: "New booking", body: "Haircut, Fri 9 Oct, 3:00 pm" });
  const body = await encryptPayload(sub, new TextEncoder().encode(msg));
  assert.equal(browserDecrypt(body, ua, auth), msg);
});

test("VAPID header (RFC 8292) is a valid ES256 JWT for the push service origin", async () => {
  const v = vapidKeys();
  const h = await vapidHeader("https://fcm.googleapis.com/fcm/send/x", v, 1_800_000_000);
  const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(h)!;
  assert.equal(k, v.publicKey);
  const [hd, cl, sig] = jwt.split(".");
  const claims = JSON.parse(Buffer.from(unb64url(cl)).toString());
  assert.equal(claims.aud, "https://fcm.googleapis.com");
  assert.equal(claims.exp, 1_800_000_000 + 12 * 3600);
  const pub = createPublicKey({ key: { kty: "EC", crv: "P-256", x: v.privateJwk.x, y: v.privateJwk.y }, format: "jwk" });
  assert.ok(verify("sha256", Buffer.from(`${hd}.${cl}`), { key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(unb64url(sig))));
});

const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; });

test("an owner's phone is notified when a customer books, never for the owner's own bookings", async () => {
  const v = vapidKeys();
  const env = { DB: d1Shim().d1, AI: new FakeAI(), DEMO_MODE: "1", SESSION_SECRET: "x".repeat(40), VAPID_PUBLIC_KEY: v.publicKey, VAPID_PRIVATE_JWK: JSON.stringify(v.privateJwk) } as never;
  const O = "https://t.example";
  const pending: Promise<unknown>[] = [];
  const exec = { waitUntil: (p: Promise<unknown>) => { pending.push(p); } };
  const call = (path: string, body?: unknown, extra: Record<string, string> = {}) => worker.fetch(new Request(O + path, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", origin: O, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) }), env, exec);

  const cfg: any = await (await call("/api/config")).json();
  assert.equal(cfg.pushKey, v.publicKey);
  const demo = await call("/api/auth/demo", {});
  const { token, business } = (await demo.json()) as any;
  const auth = { authorization: `Bearer ${token}` };
  const { ua, auth: secret, sub } = browserSubscription();
  assert.equal((await call("/api/merchant/push", sub, auth)).status, 200);

  const sent: { url: string; headers: Headers; body: Uint8Array }[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    if (String(url).startsWith("https://push.example.net/")) { sent.push({ url: String(url), headers: new Headers(init.headers), body: new Uint8Array(init.body) }); return new Response(null, { status: 201 }); }
    return realFetch(url, init);
  }) as typeof fetch;

  let day = DateTime.now().setZone("Africa/Johannesburg").plus({ days: 2 });
  while (day.weekday > 5) day = day.plus({ days: 1 });
  const rpc = async (name: string, args: object) => ((await (await call(`/mcp/${business.slug}`, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })).json()) as any).result.structuredContent;
  const av = await rpc("check_availability", { serviceId: "haircut", date: day.toISODate() });
  const b = await rpc("book", { serviceId: "haircut", start: av.slots[3].start, customerName: "Naledi", customerConfirmed: true });
  assert.equal(b.confirmed, true);
  await Promise.all(pending);
  assert.equal(sent.length, 1, "one notification for the owner's one device");
  assert.equal(sent[0].headers.get("content-encoding"), "aes128gcm");
  assert.match(sent[0].headers.get("authorization")!, /^vapid t=.+, k=/);
  const msg = JSON.parse(browserDecrypt(sent[0].body, ua, secret));
  assert.equal(msg.title, "New booking · Demo Salon");
  assert.match(msg.body, /^Haircut, \w{3} \d+ \w{3}, \d+:\d{2} [AP]M, for Naledi\. Booked through an AI assistant\.$/);
  assert.equal(msg.url, `/?s=owner&business=${business.slug}`);

  // The owner's own walk-in booking does not ping their own phone.
  sent.length = 0;
  const r = await call(`/api/merchant/businesses/${business.slug}/bookings`, { serviceId: "haircut", start: av.slots[10].start, customerName: "Walk-in" }, auth);
  assert.equal(r.status, 201);
  await Promise.all(pending);
  assert.equal(sent.length, 0);

  // An expired subscription is removed when the push service says it is gone.
  globalThis.fetch = (async (url: any, init: any) => (String(url).startsWith("https://push.example.net/") ? new Response(null, { status: 410 }) : realFetch(url, init))) as typeof fetch;
  await rpc("book", { serviceId: "haircut", start: av.slots[16].start, customerName: "Thabo", customerConfirmed: true });
  await Promise.all(pending);
  sent.length = 0;
  globalThis.fetch = (async (url: any, init: any) => { if (String(url).startsWith("https://push.example.net/")) { sent.push({} as never); return new Response(null, { status: 201 }); } return realFetch(url, init); }) as typeof fetch;
  await rpc("book", { serviceId: "haircut", start: av.slots[20].start, customerName: "Zanele", customerConfirmed: true });
  await Promise.all(pending);
  assert.equal(sent.length, 0, "the gone subscription was deleted");
  globalThis.fetch = realFetch;
});
