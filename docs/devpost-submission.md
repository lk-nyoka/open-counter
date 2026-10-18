# Devpost submission (copy and paste, field by field)

Replace `YOUTUBE_LINK` with the video link before pasting.

---

## Project overview

**Project name** (max 60)
```
Open Counter
```

**Elevator pitch** (max 200, this one is 170)
```
Customers book a small business just by talking, through Alexa+ or any AI assistant. The AI understands; the counter decides: 8 checks, a signed read-back, and a receipt.
```

---

## Project details

### About the project (Markdown)

```markdown
## Inspiration
A barber with clippers in hand can't answer the phone. A stylist halfway through a colour can't reply to messages. Every missed call is a missed booking, and in one phone study of 142 UK small businesses, 47% missed the first call. Most independent businesses in Johannesburg, where I live, still take bookings exactly that way.

AI assistants like Alexa+ can now act for customers. But a booking is a promise. An assistant that invents a free slot, books a service the owner only does after a consultation, or books without a clear "yes" costs a small business money and trust. I wanted the assistant to be the friendly front desk, and something reliable to be the counter.

## What it does
**For customers:** say "a haircut on Tuesday afternoon, I'm Thandi". Ozza, the corgi guide, offers only times that are really free in the owner's calendar, reads the booking back word for word, and books nothing until the customer says yes. The customer gets a **receipt of every rule the server checked** and a six-character code they can say out loud to cancel later.

**For owners:** set up in one spoken conversation, the way you'd brief a new receptionist: services, prices, hours, and rules like "never book colour by voice". Connect Google Calendar with one click. Get a phone alert for every booking, from the voice page, the booking page or any AI assistant.

**For AI assistants (Alexa+ and any MCP client):** one MCP server for every listed business (`/mcp`, starting with `find_business`), tools written to be spoken aloud, and an MCP Apps booking card for screens like Echo Show.

## How I built it
**The AI understands; the counter decides.** A deterministic parser goes first, and a language model may only fill gaps; it can never invent a day or time. Every decision that matters happens in code, in **eight checks on every booking**:

1. The business is accepting bookings
2. The service is allowed by voice
3. The time is inside opening hours
4. Notice and gaps between appointments are respected
5. The calendar is free, re-checked while the slot is held
6. The slot is **locked in one atomic database statement**, so ten simultaneous requests produce exactly one booking (tested)
7. The booking matches a **read-back the server itself signed**, bound to the business, service, time and name, so an assistant cannot skip the read-back or book something different
8. The event is written to the calendar idempotently

A refusal names the rule that failed (`failedCheck`) and, when a day is closed or full, offers the next free time. Nothing is ever answered with an empty list.

**Stack:** MCP TypeScript SDK (spec 2025-11-25, Streamable HTTP, stateless) on Cloudflare Workers, D1 and Workers AI (Whisper for speech, a Llama model for gap-filling), Google Calendar API with OAuth, Web Push (RFC 8291/8292) written on WebCrypto with no library, React for the web app, and a **Strands Agents** concierge in Python. All of it runs free with no card.

**Voice-first tool design:** every tool has a title, annotations, an output schema and a `summary` written to be said aloud. Times read as "Tuesday 20 October at 3 pm", never as timestamps. Booking codes are spelled out: "Z H 7, X R 2".

**Tests:** 84 automated tests run the real Worker code against SQLite standing in for D1. They cover time zones, concurrency, forged and expired read-back tokens, prompt injection in calendar titles, isiZulu and Afrikaans day words, and Web Push encryption checked by an independent decryptor. The deploy script refuses to ship if one fails.

## Challenges I ran into
- **A small model invented availability.** I moved every decision into code; the model only understands.
- **"Confirmed" can't just be a flag.** My first version trusted `customerConfirmed: true`. Now the server signs each read-back and books only those exact details. The human "yes" stays the assistant's job, and my Strands client enforces it with a hook.
- **I couldn't deploy to Alexa+ itself.** The Alexa AI CLI needs an AWS account (which needs a card) and the MCP Toolkit is US-only. So I built to the documented requirements, prepared the add-on listing, and built a simulated Alexa+ experience: a voice page that speaks to the same MCP server.
- **The 500 ms budget against a remote calendar.** A first, uncached Google Calendar read from South Africa takes 0.5 to 1.3 s. A 30-second cache brings repeat calls to about 35 ms, and booking never trusts the cache. The first call can still miss the budget, and I say so.

## Accomplishments that I'm proud of
- A real booking flow from voice to the owner's Google Calendar to a notification on the owner's iPhone.
- One add-on for every business, instead of one per barber.
- A receipt that makes the AI's safety visible to customers.
- Trying to break it, and watching it refuse: blocked services, closed days, skipped read-backs, ten assistants racing for one slot.

## What I learned
For actions that cost real money, the model should propose and the server should decide, and customers trust what they can see checked.

## What's next for Open Counter
Staff and chairs, WhatsApp (the channel South African customers already use), deposits to cut no-shows, SMS reminders, and a live Alexa+ add-on as soon as the toolkit is open to me.

## Honest status
The MCP server meets the documented Alexa+ requirements I could find, but it has not run on Alexa+ itself. The voice page is the simulated Alexa+ experience. The Strands concierge ran end to end with Gemini; the Amazon Bedrock path is in the code but was not run, because I have no AWS account. The demo film's voice-over is my own voice, cloned with Chatterbox (open source).
```

### Built with (tags, up to 25)
```
alexa-plus, model-context-protocol, mcp-apps, strands-agents, typescript, javascript, python, react, vite, tailwindcss, cloudflare-workers, cloudflare-d1, workers-ai, whisper, llama, gemini, google-calendar-api, google-oauth, web-push, webcrypto, zod, luxon, sqlite, playwright, node.js
```

### "Try it out" links
```
https://open-counter.opencounter.workers.dev
https://github.com/lk-nyoka/open-counter
https://open-counter.opencounter.workers.dev/mcp
https://github.com/lk-nyoka/mcp-apps-vanilla
```

### Image gallery (3:2, in this order)
Upload from `docs/gallery/`: `01-open-counter.jpg` (thumbnail), `02-eight-checks-receipt.jpg`,
`03-voice-read-back.jpg`, `04-refusal-names-the-rule.jpg`, `05-ten-assistants-one-slot.jpg`,
`06-owner-setup-by-talking.jpg`, `07-mcp-apps-booking-card.jpg`, `08-developers-live-mcp.jpg`.

### Video demo link
```
YOUTUBE_LINK
```

---

## Additional info (for judges)

| Field | Answer |
|---|---|
| Upload a file | Optional. Skip, or upload a zip of `docs/` |
| Submitter Type | Individual |
| Organization Name | N/A |
| Country of Residence | South Africa |
| Canadian province | N/A |
| Primary Track(s) | Alexa+ |
| Code repository URL | https://github.com/lk-nyoka/open-counter |
| New or existing before 31 Aug 2026? | New |
| AWS Builder Mini Challenge? | Yes |
| Open Source Mini Challenge? | Yes |
| Contribution URL | https://github.com/lk-nyoka/mcp-apps-vanilla |
| Project Repository URL | https://github.com/lk-nyoka/open-counter |
| GitHub Username | lk-nyoka |
| Friction Log | https://github.com/lk-nyoka/open-counter/blob/main/docs/friction-log.md |
| Project Testing Link | https://open-counter.opencounter.workers.dev |

### AWS Builder: Which AWS services did you incorporate and how?
```
Strands Agents SDK (AWS's open-source agent framework), in agents/strands-concierge/:

- MCPClient loads Open Counter's MCP tools over Streamable HTTP, so the agent books through the same server an Alexa+ add-on would use.
- A BeforeToolCallEvent hook is a second, human safety gate: it cancels any book call with customerConfirmed: true until the person at the keyboard types "y" for that exact booking. The server's own gate is a signed read-back; together they cover "was it read back?" and "did a person say yes?". The same hook adds an idempotency key if the model forgot one.
- An AfterToolCallEvent hook prints the server's receipt of checks.
- Direct tool calls (agent.tool.book(...)) power a model-free smoke test of the whole path, including a forged read-back token being refused.

Model providers are pluggable: Amazon Bedrock by default, or Gemini, Workers AI or Ollama. To be precise: I ran the concierge end to end with Gemini (it found the business, offered real times, read back, waited for two yeses and wrote the booking to Google Calendar). The Bedrock path is in the code but was not run, because I have no AWS account (creating one needs a payment card). An AWS SAM / Lambda / DynamoDB deployment (template.yaml, src/lambda.ts, a DynamoDB lock adapter) is written but not deployed for the same reason.
```

### Open Source: what you did, how it works, why it matters
```
What: mcp-apps-vanilla is a new Apache-2.0 project made during the hackathon: a dependency-free MCP Apps view (about 30 lines of protocol) plus test-host.html, a page that plays the host, so anyone can build and test a visual card in a plain browser. Open Counter's booking card is built the same way, and Open Counter itself is also open source (Apache 2.0).

How it works: the view sends ui/initialize, renders each ui/notifications/tool-result, reports its size with ui/notifications/size-changed, and sends ui/message back so the conversation stays in charge. The test host answers those messages and replays sample tool results.

Why it matters: the MCP Apps docs describe the SDK but not the raw protocol (method names, MIME type text/html;profile=mcp-app, metadata keys), so I read the package source to build the card. This project documents that protocol in working code. It loads nothing from the network, so it passes strict content security policies, which lowers the barrier for brands building visual Alexa+ experiences on Echo Show.
```

### Feature requests
```
1. Card-free, time-boxed developer path to deploy MCP add-ons (public npm CLI, no AWS account for development). Alexa+. Today the path is closed to students and builders outside the US without a card, exactly the people building for small local businesses. CRITICAL.
2. MCP Toolkit and web simulator available outside the US for development. Alexa+. Builders elsewhere can't test what they build, even if their first customers are in the US. CRITICAL.
3. One requirements checklist page with rule IDs (latency p50/p99 and region, response size, auth, accessibility). Alexa+. Design to the rules from day one. IMPORTANT.
4. Per-add-on vocabulary hint for speech recognition (business and service names). Alexa+. Names like "Corner Cuts" are the most misheard words in a booking. IMPORTANT.
5. State the supported MCP Apps version and metadata key, with a raw-protocol example. Alexa+ / MCP Apps. IMPORTANT.
6. One-off Kiro credits for registered hackathon participants. Kiro. The free tier can run out before a challenge that asks for Kiro. IMPORTANT.
7. Server option to require a minimum MCP protocol version. MCP TypeScript SDK. Silent down-negotiation hides client bugs. NICE-TO-HAVE.
8. Validate the model id when a Strands agent is created. Strands Agents. Retired model ids fail mid-conversation today. NICE-TO-HAVE.
9. A "human approval for a tool" cookbook recipe. Strands Agents. The hook pattern is powerful but not obvious. NICE-TO-HAVE.
```

### Feedback Question 1: Which tools, APIs and SDKs did you use and for what?
```
- Alexa+ MCP integration docs and design guide: the target platform; I built a self-hosted MCP server (spec 2025-11-25, Streamable HTTP) to its requirements, plus a draft addon.json.
- MCP TypeScript SDK (@modelcontextprotocol/sdk 1.32): both MCP servers (a directory for every business, and one per business), stateless on Cloudflare Workers.
- MCP Apps: the booking card (free times, read-back, receipt) for screens like Echo Show.
- Strands Agents SDK: a booking concierge client with a human-approval hook (AWS Builder).
- Kiro: planned for AWS Builder; free credits ran out first.
- AWS SAM, Lambda, DynamoDB: written deployment path, not deployed (no AWS account).
- Cloudflare Workers, D1, Workers AI (Whisper, Llama): hosting, database with atomic slot locks, speech-to-text, gap-filling.
- Google Calendar API and OAuth: owners' calendars, free/busy, idempotent event writes.
```

### Feedback Question 2: What worked well?
```
- Alexa+: choosing MCP as the integration standard means my one server already works with any MCP client. The design guidance ("never return an empty result", "the customer always knows what they are committing to") changed my design for the better. MCP Apps makes an Echo Show card possible with plain HTML.
- MCP TypeScript SDK: WebStandardStreamableHTTPServerTransport runs on Workers with no Node shims; registerTool with titles, annotations, output schemas and _meta is clean; output validation is skipped on isError results, which is exactly right for refusals.
- MCP Apps: once found, the protocol is small and clear (ui/initialize, ui/notifications/tool-result, ui/message).
- Strands Agents: MCP over Streamable HTTP worked first time; hooks are the right abstraction for human-in-the-loop safety; direct tool calls made a model-free test of the whole path possible; provider choice let me build with no AWS account.
- Cloudflare: free with no card, fast deploys, bulk secrets.
- Google Calendar: free/busy without reading event text; event ids I choose make retries idempotent.
```

### Feedback Question 3: What needs work?
```
- Alexa+: I could not deploy. The Alexa AI CLI installs from AWS CodeArtifact (needs an AWS account, which needs a card), the toolkit is US-only, and Windows isn't on the development OS list. Hard requirements are scattered (the 500 ms latency limit is only in the quickstart), the certification checklist is "coming in a future revision", and the docs don't say which MCP Apps version and metadata key Alexa+ reads.
- MCP TypeScript SDK: it silently negotiates down to an older protocol version when a client asks; a warning or a "require 2025-11-25" option would help. Zod raw-shape typing fights optional spreads.
- MCP Apps: the overview page omits the raw protocol (method names, MIME type, both metadata keys); I read the package source, then published mcp-apps-vanilla to fill the gap.
- Strands Agents: a retired Gemini model id surfaced as a 404 deep inside the first conversation; validate models when the agent is created. The hook API needed reading the source; a cookbook entry would help.
- Kiro: free credits ran out before the AWS Builder challenge and reset after the deadline.
- AWS SAM: no card-free path for students; sam was missing from PATH on Windows with no hint.
- Google OAuth: sensitive-scope verification needs a custom domain, and the unverified-app warning reduces trust for small-business owners.
Full reproductions: https://github.com/lk-nyoka/open-counter/blob/main/docs/friction-log.md
```

### Feedback Question 4: Onboarding (zero to hello world)?
```
- Alexa+: reading was easy, doing was blocked. The hackathon page didn't link the MCP Toolkit, so I found it days in, and deploying needs an AWS account.
- MCP TypeScript SDK: smooth; the Web Standard transport worked on Workers without shims.
- MCP Apps: slow, because the raw protocol had to be read from the package source.
- Strands Agents: pip install "strands-agents[gemini]" and a working MCP agent in under an hour.
- Cloudflare: quick, with no card needed.
- Google Calendar: straightforward for free/busy and events; OAuth verification is the slow part.
```

### Feedback Question 5: Would you build with these again?
```
Yes. Alexa+ as an MCP client is the right bet for voice commerce, and I'd ship Open Counter as an add-on the day the toolkit is open to me. Strands is what I'd use for an Alexa+-style agent on AWS once I have an account, and the MCP SDK and MCP Apps are the foundation I'd build on again. The one thing that would change my experience most is a card-free, non-US developer path.
```

### Eligibility checkboxes
Tick all three only if they're true for you (18 or older; eligible country; not an employee or agent of Amazon or Devpost).

### Which AI tools have you leveraged?
```
Claude (Anthropic) as my coding and review assistant for implementation, code review, writing docs, and producing the demo film (scenes rendered in code, synthesized sound). Chatterbox (open source, Resemble AI) to clone my own voice for the voice-over. Inside the product: Cloudflare Workers AI (Whisper for speech-to-text, a Llama model for gap-filling) and Gemini as the model for the Strands concierge.
```

### Level of learning
Pick the highest option (for example "Significant").

### Did you gain AI value you can use in your career?
Yes.
