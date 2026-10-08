# Product feedback

For the Devpost "product feedback" field: every tool, API and SDK we used, what we used it for, what worked, what needs
work, how onboarding felt, and whether we'd build with it again. Detailed reproductions are in
[friction-log.md](friction-log.md).

## Alexa+ (MCP integration path and docs)

- **Used for:** the target platform. We built a self-hosted MCP server (spec 2025-11-25, Streamable HTTP) designed to the Alexa+ MCP Toolkit docs and design guide, plus a draft `addon.json`.
- **Worked well:**
  - Choosing MCP as the integration standard. Our one server already works with any MCP client, and Alexa+ fits in without a separate skill model.
  - The design guidance is genuinely useful: "never return an empty result", "declare only what you honour", "the customer always knows what they are committing to". Each one changed our design.
  - MCP Apps support makes a booking card on Echo Show possible with plain HTML.
- **Needs work:**
  - We could not deploy. The Alexa AI CLI is installed from AWS CodeArtifact (an AWS account, which needs a card), the toolkit is US-only, and the development OS list leaves out Windows.
  - Hard requirements are scattered. The 500 ms latency limit is only in the quickstart.
  - The certification checklist is "coming in a future revision".
  - The docs don't say which MCP Apps version and metadata key Alexa+ reads.
- **Onboarding:** reading was easy; doing was blocked. The hackathon page didn't link the MCP Toolkit, so we found it days in.
- **Would we build again?** Yes. Alexa+ as an MCP client is the right bet, and we'd ship Open Counter as an add-on the day the toolkit is open to us.

## Model Context Protocol: TypeScript SDK (`@modelcontextprotocol/sdk` 1.32)

- **Used for:** both MCP servers (directory and per business), stateless, on Cloudflare Workers.
- **Worked well:**
  - `WebStandardStreamableHTTPServerTransport` runs on Workers with no Node shims.
  - `registerTool` with titles, annotations, output schemas and `_meta`.
  - Output validation is skipped on `isError` results, which is exactly right for refusals.
- **Needs work:**
  - Silent negotiation down to an older protocol version when a client asks for one. A warning or a server option to require 2025-11-25 would help.
  - Zod raw-shape typing fights optional spreads (`{...B, serviceId}`).
- **Would we build again?** Yes.

## MCP Apps (`@modelcontextprotocol/ext-apps`)

- **Used for:** the booking card (free times, read-back, receipt).
- **Worked well:** the protocol is small and clear once found: `ui/initialize`, `ui/notifications/tool-result`, `ui/message`.
- **Needs work:** the overview page omits the raw protocol (method names, the MIME type `text/html;profile=mcp-app`, both metadata keys); we read the package source. We published `mcp-apps-vanilla` to fill that gap.
- **Would we build again?** Yes.

## Strands Agents SDK (AWS Builder)

- **Used for:** the booking concierge client.
  - `MCPClient(url=…)` as a tool provider.
  - `BeforeToolCallEvent` with `cancel_tool` for a client-side confirmation gate, and to add a missing idempotency key.
  - `AfterToolCallEvent` for receipts.
  - Direct tool calls (`agent.tool.book(...)`) for a model-free smoke test.
  - Gemini, OpenAI-compatible and Ollama providers.
- **Worked well:**
  - MCP over Streamable HTTP worked first time.
  - Hooks are the right abstraction for human-in-the-loop safety.
  - Direct tool calls made a deterministic test of the whole path possible without a model.
  - Provider choice let us build with no AWS account.
- **Needs work:**
  - A retired Gemini model id surfaced as a 404 deep inside the first conversation; validating the model when the agent is created would help.
  - The hook API shape needed reading the source; a cookbook entry ("require human approval for a tool") would help.
- **Onboarding:** `pip install "strands-agents[gemini]"` and a working MCP agent in under an hour.
- **Would we build again?** Yes, and it's what we'd use for an Alexa+-style agent on AWS once we have an account.

## Kiro

- **Used for:** planned for the AWS Builder challenge. We had used Kiro earlier in the month on other work.
- **Worked well:** the spec-driven flow, in that earlier use.
- **Needs work:** the free tier ran out before the AWS Builder challenge, with credits resetting after the deadline (see friction log).
- **Would we build again?** Yes, with credits.

## AWS (SAM, Lambda, DynamoDB)

- **Used for:** the original deployment plan; the SAM template and DynamoDB lock adapter are still in the repo.
- **Needs work:** no card-free path for students, and `sam` was missing from the PATH on Windows with no hint.
- **Would we build again?** Yes, once we have an account. The code is ready.

## Cloudflare Workers, D1, Workers AI (hosting)

- **Used for:** hosting, the database (atomic slot locks, ledger), Whisper speech-to-text, a Llama model for gap-filling, and a cron trigger.
- **Worked well:** free with no card, fast deploys, `secret bulk`, static assets with `_headers` and `_redirects`.
- **Needs work:** small models need strict validation.
- **Would we build again?** Yes.

## Google Calendar API and Google OAuth

- **Used for:** owners' own calendars (OAuth) and the demo calendar (service account).
- **Worked well:** free/busy without reading event text; event ids we choose make retries idempotent.
- **Needs work:** sensitive-scope verification needs a custom domain; unverified apps show a warning, which reduces trust for small-business owners.
