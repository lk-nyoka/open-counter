# Devpost submission (copy and paste)

## Project name
Open Counter

## Tagline (one line)
Let customers book a small business by talking, through Alexa+ or any AI assistant. The AI understands; the counter decides.

## Track and mini challenges
- **Primary track:** Alexa+ (self-hosted MCP server, spec 2025-11-25, Streamable HTTP, plus a simulated Alexa+ voice experience)
- **Mini challenges:** AWS Builder (Strands Agents SDK) and Open Source (`mcp-apps-vanilla`)

## About the project

### Inspiration
A barber with clippers in hand can't answer the phone, and every missed call is a missed booking. Independent
businesses still take most bookings by phone or message. AI assistants like Alexa+ can now act for customers, but a
booking is a promise: an assistant that invents a free slot, or books without a clear yes, costs a small business
money and trust. We wanted the assistant to be the friendly front desk, and something reliable to be the counter.

### What it does
- **Owners** set up in one spoken conversation with Ozza, our corgi guide: services, prices, hours, and "never book colour by voice". They connect Google Calendar with one click and get a phone alert for every new booking.
- **Customers** book by talking ("a haircut Friday around 3ish"), on a voice page or through an AI assistant. Ozza offers only real free times, reads the booking back and books only after a yes. The customer gets a receipt of every rule the server checked and a six-character code to cancel later, by voice or on the web.
- **AI assistants** get one MCP server for every listed business (`/mcp`, starting with `find_business`), with tools designed for voice and an MCP Apps booking card for screens.

### How we built it
- **Platform:** Cloudflare Workers, D1 and Workers AI, all free with no card. MCP TypeScript SDK, stateless Streamable HTTP.
- **The counter: 8 checks on every booking.**
  - The business is accepting bookings.
  - The service is allowed by voice.
  - The time is inside opening hours.
  - Notice and gaps between appointments are respected.
  - The calendar is free, re-checked while the slot is held.
  - Atomic slot locks, so ten simultaneous requests produce one booking.
  - The booking matches a read-back the server issued (a signed token bound to the service, time and name), so an assistant cannot skip the read-back or book something different.
  - The event is written to the calendar, idempotently.
- **The AI only understands.** A deterministic parser goes first. The language model may only fill gaps, never invent a day or time. The dialog is written in code from real MCP results.
- **Voice-first tool design.** Titles, annotations, output schemas, a spoken `summary` on every result, and the next free time instead of an empty list.
- **MCP Apps booking card** (`ui://open-counter/booking-card.html`), written against the raw protocol.
- **Web Push alerts.** RFC 8291 and 8292 implemented on WebCrypto, with no library.
- **81 automated tests.** The deploy script refuses to ship if one fails.

### Challenges we ran into
- **A small model invented availability.** We moved every decision into code.
- **We couldn't deploy to Alexa+.** The CLI needs an AWS account, and the toolkit is US-only. So we built the simulated path and an add-on listing ready to deploy.
- **The 500 ms budget against a remote calendar.** A first, uncached Google Calendar read from South Africa takes 0.5 to 1.3 s. A 30-second cache brings repeat calls to about 35 ms, and booking never trusts it; the first call can still miss the budget.
- **"Confirmed" can't just be a flag.** Our first version trusted `customerConfirmed: true`. Now the server signs each read-back and books only those exact details; the human "yes" stays the assistant's job, and our Strands client enforces it with a hook.
- **Spoken booking codes.** We replaced 32-character ids with six-character codes that cancel only together with the customer's name.

### Accomplishments we're proud of
- A real booking flow from voice to the owner's Google Calendar to a notification on the owner's iPhone.
- One add-on for every business.
- A receipt that makes the AI's safety visible to customers.
- A Strands agent booking through the same server with a second, human approval gate.
- Everything free to run.

### What we learned
For transactional voice actions, the model should propose and the server should decide, and customers trust what they
can see checked.

### What's next for Open Counter
1. Staff and chairs.
2. WhatsApp.
3. Deposits.
4. SMS reminders.
5. A live Alexa+ add-on as soon as the toolkit is open to us.

## Built with
`alexa-plus` `model-context-protocol` `mcp-apps` `strands-agents` `typescript` `react` `cloudflare-workers` `cloudflare-d1`
`workers-ai` `whisper` `google-calendar-api` `web-push` `python`

## Links
- **Live app:** https://open-counter.opencounter.workers.dev
- **Repo:** https://github.com/lk-nyoka/open-counter
- **MCP endpoint:** https://open-counter.opencounter.workers.dev/mcp
- **Demo video:** _add link_
- **Screenshots:** https://github.com/lk-nyoka/open-counter/tree/main/docs/screenshots

## Testing instructions for judges
No account is needed. Open the live app:

1. **Book by voice:** say "Book a haircut tomorrow afternoon, I'm Alex". Use a weekday; Demo Barbershop is closed on weekends.
2. **Be the owner:** For businesses, then **Look around a demo business**. The demo is deleted after two days.

For an AI client, connect to `https://open-counter.opencounter.workers.dev/mcp` and call `find_business` with "haircut".

Google sign-in works, but shows "Google hasn't verified this app" because the app is awaiting verification. Choose
Advanced, then Continue.

## AWS Builder: which services and how
We used the **Strands Agents SDK** (`agents/strands-concierge/`) to build a booking concierge that acts like an Alexa+
client:
- Strands' **`MCPClient`** loads Open Counter's MCP tools over Streamable HTTP.
- A **`BeforeToolCallEvent` hook** cancels any `book` call with `customerConfirmed: true` until the human types yes for that exact booking. The same hook adds an idempotency key if the model forgot one.
- An **`AfterToolCallEvent` hook** prints the server's receipt.
- **Direct tool calls** (`agent.tool.book(...)`) power a model-free smoke test of the whole path.

The model provider is pluggable: Amazon Bedrock by default, or Gemini, Workers AI or Ollama. To be precise about what
ran: we ran it end to end with Gemini because we have no AWS account (friction log entry 3); the Bedrock path was not
run, and no AWS service is in the hosted path. The AWS SAM / Lambda / DynamoDB deployment (`template.yaml`,
`src/lambda.ts`, a DynamoDB lock adapter) is written but not deployed.

## Open Source fields
- **Contribution URL:** https://github.com/lk-nyoka/mcp-apps-vanilla
- **Repo URL:** https://github.com/lk-nyoka/open-counter
- **GitHub username:** lk-nyoka
- **What we did, how it works, why it matters:**
  - **What:** `mcp-apps-vanilla` is a new Apache-2.0 project. It's a dependency-free MCP Apps view, about 30 lines of protocol, plus `test-host.html`, which plays the host so anyone can develop a card in a plain browser.
  - **How it works:** the view sends `ui/initialize`, renders each `ui/notifications/tool-result`, reports its size, and can send `ui/message` back to the assistant.
  - **Why it matters:** it loads nothing from the network, so it passes strict content security policies. That lowers the barrier for brands building visual Alexa+ experiences. Open Counter's booking card uses the same approach.

## Built during the hackathon?
Yes. The first commit was on 7 October 2026, and everything in the repository was built during the submission window.

## Product feedback
Paste from [product-feedback.md](product-feedback.md).

## Feature requests (optional)
Paste from [feature-requests.md](feature-requests.md).

## Friction log (optional, up to 10% bonus)
Paste from [friction-log.md](friction-log.md), or link to it on GitHub.
