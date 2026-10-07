# Open Counter

Publish a small business's bookings to AI assistants over MCP, without writing code.
One multi-tenant, stateless MCP server (Streamable HTTP) at `/mcp/{slug}`, driven by a validated business spec.
Pages: `/` protocol demo, `/assistant.html` voice assistant, `/interview.html` AI interviewer.
Tools: `get_business_info`, `get_quote`, `check_availability`, `book`, `cancel`.
A demo web page at `/` acts as a real MCP client (initialize, tools/list, tools/call) and shows the raw protocol.

## Run locally (no accounts, no credentials)
```
npm install
npm test
OPEN_COUNTER_FAKE=1 npm run dev        # http://localhost:8787  (demo page + /mcp/demo-barber)
```
or on the Cloudflare runtime locally: `npm run dev:cf` (http://localhost:8787, local D1).

## Deploy free: Cloudflare Workers + D1 (no credit card)
```
npm run deploy:cf                                   # demo mode: works immediately, in-memory calendar
npm run deploy:cf -- --key <service-account.json> --calendar <calendarId>   # real Google Calendar
```
The script logs you in (browser approval), creates the D1 database and table, deploys, and stores credentials as encrypted secrets. Keep the key file outside the repo.

## AI features (free Workers AI)
- **Interviewer** (`/interview.html`): the model extracts fields into a draft; code validates every field, tracks what is missing, and the owner reviews before publishing. Published businesses get their own `/mcp/{slug}` endpoint and an owner key (stored only as a hash) for unpublishing.
- **Voice assistant** (`/assistant.html?business=slug`): the model returns `{say, tool, args}` as JSON; the page executes tools against the MCP server, and a confirmation card (button or spoken yes/no) is the only way `customerConfirmed` becomes true. The model never sees raw ISO times: it picks from the availability list.
- Limits: 10,000 free neurons/day. The Worker caps AI calls (`AI_DAILY_CALLS`, per-IP hourly) and the pages fall back to the manual page when the allowance is used up.
- Run the pages locally with a scripted fake model: `npm run dev:local` (http://localhost:8792).

## How double-booking is prevented
1. `book` checks every owner rule server-side (hours, notice, grid, voice-blocked services); it never trusts that the client called `check_availability`.
2. It claims **every 15-minute grid unit** the appointment spans in one atomic statement (D1) or transaction (DynamoDB). Overlapping bookings collide on shared units. Lock rows hold only `{business, slot, bookingId, expiry}`.
3. While holding the lock it re-reads Google free/busy (catches events the owner added by hand), then creates the event with `id = bookingId`.
4. Any failure releases the locks. `cancel` deletes the event and releases the locks. Locks expire 24h after the appointment ends.
5. `idempotencyKey` makes retries return the original booking.

## Prompt-injection defence
Availability is computed from Google's `freeBusy` API, which returns time ranges only. Event titles/descriptions never enter the server, and the `BusyInterval` type has no text field. Tool results are structured JSON. Tested in `src/tools.test.ts`.

## Status
Verified: 28 tests (including the lock SQL on a real SQLite engine and Google JWT signing), the Worker running on the Cloudflare runtime locally (workerd + local D1) passing `scripts/smoke-test.ts`, and the demo page driven end to end in a browser.
**Not yet verified:** the deployed Cloudflare URL and real Google Calendar. Log anything odd in `docs/friction-log.md`.

An AWS SAM/Lambda/DynamoDB path (`template.yaml`, `src/lambda.ts`) is kept for the AWS Builder challenge; it needs an AWS account.
