# Open Counter

Let customers book a small business by talking to an AI assistant. The owner describes the business in plain
words, connects Google Calendar with one click, and gets an MCP server that Alexa+ (or any MCP assistant) can use.
The server, not the AI, enforces the owner's rules.

- **Owner side:** `/interview.html` (set up by conversation) → Google sign-in → `/dashboard.html` (bookings,
  channels, revenue, pause switch, edit services and hours, walk-ins, share links).
- **Customer side:** `/assistant.html` (voice assistant), `/book.html` (booking form). No login, no owner data.
- **AI assistants:** `/mcp/{slug}`: MCP 2025-11-25, Streamable HTTP, stateless. Tools: `get_business_info`,
  `get_quote`, `check_availability`, `book`, `cancel`. `/protocol.html` shows the raw protocol.
- **Judges / try-out:** "Explore a demo dashboard" on `/` creates a demo business on the built-in calendar.
  No Google account needed.

The API a frontend builds on is documented in [docs/API.md](docs/API.md).

## Run locally (no accounts)
```
npm install
npm test                 # type-safe unit, API and end-to-end tests
npm run dev:local        # http://localhost:8792  (real Worker code, SQLite D1, scripted fake AI)
```

## Deploy free: Cloudflare Workers + D1 + Workers AI (no credit card)
```
npm run deploy:cf                                                        # demo mode
npm run deploy:cf -- --key <service-account.json> --calendar <calendarId> # demo business on a real Google Calendar
   --oauth <client_secret_....json>      # add: "Sign in with Google" for owners
   --frontend https://your-frontend.app  # add: allow a frontend on another domain
```
The script type-checks and runs every test first (nothing ships if one fails), creates or updates the D1 tables,
deploys, stores secrets encrypted, and checks that the live build label matches the code. It keeps one stable
session secret in `.oc-secrets.json` (git-ignored). Keep key files outside the repo.

Google sign-in setup: Google Cloud → Google Auth Platform → External app, add test users, create a **Web
application** client with redirect URI `https://<your-worker>/auth/google/callback`, download its JSON and pass it
with `--oauth`. In Google's testing mode only listed test users can sign in and links expire after 7 days; the
dashboard shows "Reconnect Google Calendar" when that happens.

## How it is built
- **Bookings are safe under concurrency.** `book` re-checks every owner rule server-side, then claims every
  15-minute grid unit the appointment spans in one atomic D1 statement, re-reads the calendar while holding the
  lock, and writes the event with `id = bookingId`. Failures release the locks; `idempotencyKey` makes retries safe.
- **Calendars.** Each business routes to the owner's own Google Calendar (OAuth, refresh token AES-GCM encrypted
  at rest), the built-in D1 calendar, or a shared service-account calendar. Owner events block times
  automatically; events marked "free" do not.
- **Prompt-injection defence.** Only start/end times leave the calendar adapters: the `BusyInterval` type has no
  text field. Tool results are structured JSON.
- **AI that can't make things up.** Interviewer: the model proposes fields, a parser reads the owner's own words,
  code validates everything and writes each reply from what actually changed; voice rules are found anywhere in a
  paragraph. Assistant: Whisper (primed with the business's service names) → deterministic understanding of
  services, dates, times and names (`src/nlu.ts`), the model only filling gaps → a dialog in code
  (`public/dialog.js`) built from real MCP results. A confirmation is the only way `customerConfirmed` becomes
  true. Both keep working if the model is down or the free allowance is used up.
- **Owner and customer data never mix.** `/api/merchant/*` requires a signed session (HMAC, HttpOnly cookie or
  bearer token) and only returns that owner's businesses; `/api/public/*` returns what any customer may see.
- **Every booking is tagged with its channel** (voice page, web page, other MCP assistant, owner) for the dashboard.

An AWS SAM/Lambda/DynamoDB path (`template.yaml`, `src/lambda.ts`) is kept for the AWS Builder challenge; it needs
an AWS account.
