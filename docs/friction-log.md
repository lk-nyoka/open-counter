# Friction log

Everything that slowed us down while building Open Counter for the Alexa+ track, written so the teams behind each tool
can act on it. Each entry gives the task, the steps we took, what we expected and what actually happened, a severity,
our workaround and a suggestion.

Severity: **High** blocked or changed the plan · **Medium** cost hours · **Low** cost minutes.

| # | Tool | Task | Severity |
|---|---|---|---|
| 1 | Alexa+ MCP Toolkit | Deploy as an Alexa+ add-on | High |
| 2 | Hackathon resources / Alexa+ docs | Find a way to test on Alexa+ | High |
| 3 | AWS account | Host on AWS within the free tier | High |
| 4 | Alexa+ MCP requirements | Meet the latency requirement | Medium |
| 5 | MCP Apps on Alexa+ | Link a tool to a visual card | Medium |
| 6 | Alexa+ certification docs | Self-check before submitting | Medium |
| 7 | Alexa+ / MCP spec | Confirm the negotiated protocol version | Medium |
| 8 | Language models for voice booking | Let a model run the booking dialog | High |
| 9 | Speech recognition | Hear service names reliably | Medium |
| 10 | Kiro | Use Kiro for the AWS Builder challenge | Medium |
| 11 | AWS SAM CLI on Windows | Build and deploy with SAM | Low |
| 12 | Strands Agents + Gemini | Run the Strands client on a free model | Low |

---

### 1. Alexa+ MCP Toolkit: deploy as an Alexa+ add-on (High)

- **Task:** register Open Counter's MCP server as an Alexa+ add-on and test it in the web simulator.
- **Steps:**
  1. Read the MCP Toolkit overview and quickstart.
  2. Tried `npm install -g @alexa-ai/cli` from public npm.
  3. Read "Set Up Your Development Environment".
- **Expected:** a free developer account would be enough to install the CLI and deploy to the development stage.
- **Actual:**
  - The CLI is installed from AWS CodeArtifact, after creating an IAM user and AWS profiles, which needs an AWS account and a payment card.
  - The toolkit is available in the US only.
  - The supported development OS list is macOS and Ubuntu, not Windows.
  - We are a student team in South Africa on Windows with no card.
- **Workaround:**
  - Built the simulated Alexa+ path: a voice page that speaks real MCP to the same server.
  - Wrote `alexa-addon/addon.json` against the documented fields and limits, so deploying is one command once access exists.
- **Suggestion:** publish the Alexa AI CLI on public npm, allow a card-free developer path (even time-boxed) for registered hackathon participants, and state country and OS limits on the hackathon page.

### 2. Hackathon resources / Alexa+ docs: find a way to test on Alexa+ (High)

- **Task:** test the voice flow end to end on Alexa+.
- **Steps:**
  1. Read the Alexa+ section of the hackathon resources page.
  2. Searched developer.amazon.com.
  3. Found the MCP Toolkit pages days later.
- **Expected:** a link from the hackathon page to an Alexa+ test surface.
- **Actual:** the resources page names no simulator and suggests simulating Alexa+ in a web app. The web simulator exists, but only after deploying an add-on (see entry 1).
- **Workaround:** a simulated Alexa-style client in our web app.
- **Suggestion:** link the MCP Toolkit quickstart, Local Inspector and web simulator from the hackathon resources page, with a one-line note on who can use them.

### 3. AWS account: host on AWS within the free tier (High)

- **Task:** deploy the MCP server with AWS SAM (Lambda + DynamoDB).
- **Steps:**
  1. Wrote `template.yaml` and a DynamoDB lock adapter.
  2. Tried to create an AWS account.
  3. Ran `sam deploy`.
- **Expected:** a free-tier path for a student entry.
- **Actual:** account creation needs a payment card, so `sam deploy` stopped at "Unable to locate credentials".
- **Workaround:**
  - Moved hosting to Cloudflare Workers + D1 (no card).
  - Kept the SAM template and the DynamoDB adapter in the repo.
  - Used the open-source Strands Agents SDK for the AWS Builder challenge.
- **Suggestion:** hackathon credits that can be redeemed without a card, or a sandbox account for registered participants.

### 4. Alexa+ MCP requirements: meet the latency requirement (Medium)

- **Task:** answer within Alexa+'s latency budget.
- **Steps:**
  1. Measured round trips from South Africa.
  2. Found the requirement in the quickstart.
- **Expected:** all hard requirements on one page.
- **Actual:** "under 500 ms round trip" appears only in the quickstart, not on the overview or the design guide. A tool that reads a remote calendar (Google) took 460–1,290 ms.
- **Workaround:**
  - A 30-second availability cache that every write clears.
  - Booking always re-reads the live calendar while holding the slot lock, so the cache can never cause a wrong booking.
  - Warm calls now answer in about 35 ms.
- **Suggestion:** one requirements checklist page (latency, response size, auth), saying whether 500 ms is p50 or p99, measured from where, and whether one slow first call fails certification.

### 5. MCP Apps on Alexa+: link a tool to a visual card (Medium)

- **Task:** show a booking card on screens such as Echo Show.
- **Steps:**
  1. Read the MCP Apps overview linked from the hackathon page.
  2. Read the `@modelcontextprotocol/ext-apps` package source to find the exact keys and methods.
- **Expected:** the Alexa+ docs to state which MCP Apps version and metadata keys Alexa+ reads.
- **Actual:**
  - The extension has its own protocol version (2026-01-26) alongside MCP 2025-11-25.
  - Tools can carry two keys (`_meta.ui.resourceUri` and the older `ui/resourceUri`).
  - The overview page has no raw-protocol example.
- **Workaround:**
  - Sent both keys.
  - Wrote the card against the postMessage protocol directly, with no SDK, and tested it in a simulated host.
  - Published that approach as the open-source `mcp-apps-vanilla`.
- **Suggestion:** a short "Alexa+ supports MCP Apps version X, reads key Y" note, and a raw-protocol example for teams that can't add a bundler.

### 6. Alexa+ certification docs: self-check before submitting (Medium)

- **Task:** check our server against Amazon's certification rules.
- **Steps:**
  1. Read "Certify your MCP add-on", the certification guidelines, and the design guide overview and its sub-pages.
- **Expected:** a checklist we could test against.
- **Actual:** the certify page says the rubric and checklist "will be added in a future revision". Most concrete rules are spread across sub-pages.
- **Workaround:**
  - Applied every rule we could find: never return an empty result, declare only what you honour, the customer always knows what they commit to.
  - Wrote a test for each.
- **Suggestion:** publish the draft checklist with rule IDs (the Local Inspector already emits IDs such as `VR-01`).

### 7. Alexa+ / MCP spec: confirm the negotiated protocol version (Medium)

- **Task:** be sure we serve spec 2025-11-25.
- **Steps:**
  1. Checked the TypeScript SDK's latest version.
  2. Tested with our own clients.
- **Expected:** a client asking for an older version to be told clearly.
- **Actual:** our early test clients were hard-coded to 2025-06-18, and negotiation silently succeeded on the older version.
- **Workaround:** the protocol page and our tests now request 2025-11-25, and a test asserts the server answers with it.
- **Suggestion:** state in the Alexa+ docs which version Alexa+ sends, and whether servers should refuse older ones.

### 8. Language models for voice booking: let a model run the dialog (High)

- **Task:** let a free 8B model run the booking conversation with tools.
- **Steps:**
  1. Strict system prompt.
  2. Tool calling.
  3. Live tests by voice.
- **Expected:** the model would only offer times returned by `check_availability`.
- **Actual:** it invented availability and looped ("I made a mistake again").
- **Workaround:**
  - Moved every decision into code.
  - The model only extracts what the customer meant, and only fills gaps the parser left.
  - It may not supply a day or time the customer didn't say.
  - The server enforces the read-back.
- **Suggestion:** document this "the model proposes, the server decides" pattern for Alexa+ MCP authors, with a server-side confirmation example.

### 9. Speech recognition: hear service names reliably (Medium)

- **Task:** understand "haircut", "beard trim" and local names by voice.
- **Steps:**
  1. Browser speech recognition.
  2. Whisper.
  3. A vocabulary hint.
- **Expected:** common service words recognised.
- **Actual:** browser recognition heard "selection" and "section" for "haircut".
- **Workaround:** server-side Whisper primed with each business's service names, plus a parser that tolerates sound-alikes.
- **Suggestion:** a documented way for an Alexa+ add-on to give Alexa a per-business vocabulary.

### 10. Kiro: use Kiro for the AWS Builder challenge (Medium)

- **Task:** build a feature with Kiro.
- **Steps:**
  1. Installed Kiro.
  2. Used it earlier in the month.
  3. Returned for the challenge.
- **Expected:** enough free credits to build one feature.
- **Actual:** the free tier's monthly credits were used up and reset after the deadline. Add-on credits aren't sold on the free tier.
- **Workaround:** used the open-source Strands Agents SDK (no account needed) with a free model provider.
- **Suggestion:** a one-off credit grant for registered participants, or count Kiro usage from earlier in the hackathon window.

### 11. AWS SAM CLI on Windows: build and deploy with SAM (Low)

- **Task:** run `sam build` on Windows.
- **Steps:**
  1. Followed the install docs.
  2. Opened a new PowerShell.
- **Expected:** `sam` on the PATH.
- **Actual:** "not recognised", and the error gives no install hint.
- **Workaround:** skipped SAM (see entry 3).
- **Suggestion:** print the install link when `sam` is missing, in the docs and in `sam init` templates.

### 12. Strands Agents + Gemini: run the Strands client on a free model (Low)

- **Task:** run the concierge with `GeminiModel`.
- **Steps:**
  1. Installed `strands-agents[gemini]`.
  2. Set a free key.
  3. Started a conversation.
- **Expected:** it would work with the documented example model id.
- **Actual:** `404 NOT_FOUND`, because `gemini-2.5-flash` is no longer available to new keys. The error surfaced deep in a stack trace after the first message, not at start-up.
- **Workaround:** the concierge checks a list of current model ids at start-up and uses the first one the key can reach.
- **Suggestion:** Strands providers could validate the model id when the agent is created and suggest available ones.
