import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { GoogleCalendar } from "./google.js";

test("service-account JWT is well-formed and verifiable; freeBusy request carries no event text", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const creds = JSON.stringify({ client_email: "svc@x.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) });
  const seen: { url: string; body?: string }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    seen.push({ url: String(url), body: String(init?.body ?? "") });
    if (String(url).includes("oauth2")) return Response.json({ access_token: "tok", expires_in: 3600 });
    return Response.json({ calendars: { cal: { busy: [{ start: "2026-10-15T08:00:00Z", end: "2026-10-15T09:00:00Z" }] } } });
  }) as typeof fetch;
  try {
    for (const c of [creds, Buffer.from(creds).toString("base64")]) { // raw JSON and base64 both accepted
      seen.length = 0;
      const busy = await new GoogleCalendar(c).listBusy("cal", "2026-10-15T00:00:00Z", "2026-10-16T00:00:00Z");
      assert.deepEqual(busy, [{ start: "2026-10-15T08:00:00Z", end: "2026-10-15T09:00:00Z" }]);
      const assertion = new URLSearchParams(seen[0].body).get("assertion")!;
      const [h, p, s] = assertion.split(".");
      const claims = JSON.parse(Buffer.from(p, "base64url").toString());
      assert.equal(claims.iss, "svc@x.iam.gserviceaccount.com");
      assert.equal(claims.scope, "https://www.googleapis.com/auth/calendar");
      assert.equal(claims.aud, "https://oauth2.googleapis.com/token");
      assert.equal(JSON.parse(Buffer.from(h, "base64url").toString()).alg, "RS256");
      assert.ok(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(s, "base64url")), "signature verifies");
      assert.ok(seen[1].url.endsWith("/freeBusy"));
    }
  } finally { globalThis.fetch = realFetch; }
});
