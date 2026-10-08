# Open Counter

**Let customers book a small business by talking to an AI assistant.** The owner describes the business in one
spoken conversation, connects Google Calendar with one click, and is bookable through Alexa+ (or any MCP assistant),
a voice page and a booking page. The AI understands; the server decides: every rule is checked before anything is
booked, and the customer sees a receipt of each check.

Live: **https://open-counter.opencounter.workers.dev** · Built for the Amazon *Build, Ship, Shape* hackathon, Alexa+ track · Apache 2.0

## Try it in three minutes (no account needed)

1. **Book by voice** (top bar). Say or type "Book a haircut tomorrow". Ozza offers real free times, reads the booking
   back, and books only after you say yes. The receipt shows the eight checks the server ran.
2. **Set up a business.** Press *Set up my business*, then *Try an example barbershop* (or describe your own in one
   paragraph, including "never book colour by voice"). Watch the checklist fill in, then *Go live with the built-in diary*.
3. **Owner view.** Your bookings, where each came from (voice, web, AI assistant), a pause switch, walk-ins, and
   *Services and hours*, where you can also list the business in the directory.
4. **Developers.** The MCP endpoints, tools, the eight checks, and buttons that call the live server.

## What an assistant sees (the Alexa+ part)

An MCP server, spec **2025-11-25**, Streamable HTTP, stateless, on Cloudflare Workers.

- `POST /mcp` is the **directory**: one Alexa+ add-on can find and book any listed business
  ("book a haircut at Corner Cuts"). `POST /mcp/{slug}` serves a single business.
- Tools: `find_business`, `get_business_info`, `get_quote`, `check_availability`, `book`, `cancel`. Each has a title,
  read-only or destructive annotations, an output schema, and a `summary` written to be said aloud. Times come as
  "Tuesday 13 October at 10:30 am", never as ISO timestamps.
- **The customer always knows what they commit to.** `book` refuses until it is called again with
  `customerConfirmed: true` after the read-back. Refusals name the rule that failed (`failedCheck`) and offer the next
  free time.
- **Never an empty answer.** A closed or full day returns why, and `nextAvailable`.
- **A booking card on screens (MCP Apps).** `ui://open-counter/booking-card.html` shows free times to tap, the read-back
  with "Yes, book it", and the receipt. Taps go back through the assistant.
- **Agent Skill.** [`skills/open-counter-booking/SKILL.md`](skills/open-counter-booking/SKILL.md) teaches any agent the
  safe booking flow.
- **Add-on listing.** [`alexa-addon/`](alexa-addon/) has a draft `addon.json` and the listing images.

Full contract: [docs/API.md](docs/API.md).

## AWS Builder: a Strands Agents client

[`agents/strands-concierge/`](agents/strands-concierge/) is a booking concierge built with the Strands Agents SDK. It
loads Open Counter's MCP tools through Strands' `MCPClient`, and a Strands hook adds a second, client-side confirmation
gate: no `book` call with `customerConfirmed: true` runs until the person types yes. It works with Amazon Bedrock or,
for builders without an AWS account, with free model providers (Gemini, Workers AI, Ollama). `smoke_test.py` checks
the whole path and both gates without any model.

## How it is built

- **Race-safe bookings.** `book` re-checks every owner rule on the server, claims every 15-minute grid unit the
  appointment spans in one atomic D1 statement, re-reads the live calendar while holding the lock, and writes the
  event with `id = bookingId`. Ten simultaneous requests for one slot produce exactly one booking (tested).
  `idempotencyKey` makes retries safe.
- **Fast enough for voice.** Business info answers in about 100 ms. Availability for Google calendars comes from a
  30-second cache that every write clears; booking never trusts the cache.
- **Calendars.** The owner's own Google Calendar (OAuth, refresh token AES-GCM encrypted), the built-in D1 diary, or a
  shared service-account calendar. Owner events block times automatically.
- **Prompt-injection defence.** Only start and end times leave the calendar adapters: the `BusyInterval` type has no
  text field.
- **AI that can't make things up.** Speech: Whisper primed with the business's service names. Understanding:
  deterministic parsing (`src/nlu.ts`) with the model only filling gaps. Dialog: code (`public/dialog.js`) built from
  real MCP results. Setup interview: the model proposes, a parser reads the owner's own words, code validates. All of
  it keeps working if the model is down or the free AI allowance runs out.
- **Owner and customer data never mix.** `/api/merchant/*` needs a signed session and only returns that owner's
  businesses; `/api/public/*` returns what any customer may see.
- **Abuse limits.** Per business (40 bookings an hour), per customer name (5 a day), per connection on the web pages,
  and a daily AI budget.
- **Housekeeping.** A daily cron deletes demo accounts after two days. Deleting a business deletes its bookings.
  [Privacy](public/privacy.html) and [terms](public/terms.html) pages are served by the app.

## Run locally (no accounts)

```
npm install
npm test               # 72 tests: tools, locks, MCP surface, accounts, NLU, dialog, interview
npm run dev:local      # http://localhost:8792 (real Worker code, SQLite as D1, scripted fake AI)
```

## Deploy free: Cloudflare Workers + D1 + Workers AI (no credit card)

```
npm run deploy:cf                                                         # demo mode
npm run deploy:cf -- --key <service-account.json> --calendar <calendarId> # demo business on a real Google Calendar
    --oauth <client_secret_....json>     # add "Sign in with Google" for owners
```

The script type-checks and runs every test first (nothing ships if one fails), builds the frontend, creates or
updates the D1 tables, deploys, stores secrets encrypted, and checks the live build label. Keep key files outside
the repo.

Google sign-in: Google Cloud → Google Auth Platform → create a **Web application** client with redirect URI
`https://<your-worker>/auth/google/callback`, then pass its JSON with `--oauth`. While the app's publishing status is
*Testing*, only listed test users can sign in and links expire after 7 days.

## Repository map

| Path | What |
|---|---|
| `src/tools.ts`, `src/slots.ts` | Booking rules, the eight checks, voice-ready results |
| `src/server.ts`, `src/ui/booking-card.ts` | MCP servers (directory and per business), the MCP Apps card |
| `src/worker.ts` | Cloudflare entry: routing, caching, limits, cron |
| `src/accounts.ts`, `src/auth.ts`, `src/store.ts` | Owner accounts, Google OAuth, D1 storage |
| `src/nlu.ts`, `public/dialog.js`, `src/interview.ts` | Understanding, dialog, setup interview |
| `frontend/` | React app (built into `public/`) |
| `skills/`, `alexa-addon/` | Agent Skill, Alexa+ add-on listing |
| `agents/strands-concierge/` | Strands Agents client (AWS Builder) |
| `docs/` | API contract, friction log |

Built during the hackathon window (first commit 7 October 2026). The AWS SAM/Lambda/DynamoDB path
(`template.yaml`, `src/lambda.ts`) is kept for when an AWS account is available.

## Licence

Apache 2.0. See [LICENSE](LICENSE).
