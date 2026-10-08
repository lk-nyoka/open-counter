# Open Counter concierge (Strands Agents)

A command-line booking assistant built with the [Strands Agents SDK](https://strandsagents.com) (AWS's open-source agent
framework). It connects to Open Counter's MCP server and behaves the way Alexa+ would: it finds the business, offers
real free times, reads the booking back, and books only after a yes.

It is also Open Counter's reference client: proof that the MCP server works with a third-party agent framework, not
only with our own web app.

## Two safety gates

1. **In the client.** A Strands `BeforeToolCallEvent` hook stops every `book` call with `customerConfirmed: true`
   until the person at the keyboard types `y` for that exact service, day, time and price. Whatever the model decides,
   it cannot book on its own.
2. **On the server.** Open Counter refuses any booking that breaks a rule or lacks the confirmation, whatever the
   client sends, and names the rule that failed.

An `AfterToolCallEvent` hook prints the receipt of every check the server ran.

## Run

Python 3.10 or newer.

```
cd agents/strands-concierge
python -m venv .venv
.venv\Scripts\activate            # Windows   (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt
python smoke_test.py               # no model needed: calls every tool directly and tests both gates
```

Then pick a model (the concierge uses the first one it finds in the environment):

| Model | Set | Cost |
|---|---|---|
| Google Gemini | `GEMINI_API_KEY` (from aistudio.google.com) | Free tier, no card |
| Cloudflare Workers AI | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | Free daily allowance |
| Ollama (on your machine) | `OLLAMA_MODEL=qwen2.5:7b` | Free |
| Amazon Bedrock | AWS credentials (Strands' default) | Paid |

```
set GEMINI_API_KEY=your-key        # PowerShell: $env:GEMINI_API_KEY="your-key"
python concierge.py
```

An example session (the model's wording will vary):

```
You: book a haircut at Demo Barber on Monday morning, my name is Thandi
  ↳ find_business({"query": "Demo Barber"})
  ↳ get_business_info({"business": "demo-barber"})
  ↳ check_availability({"business": "demo-barber", "serviceId": "haircut", "date": "2026-10-12"})
Concierge: Monday morning I have 9 am, 9:30 am, 10 am and 11 am. Which suits you?
You: 10 please
  ↳ book({... "customerConfirmed": false})
Concierge: That's a haircut at Demo Barber, Monday 12 October at 10 am, 120 rand, for Thandi. Shall I book it?
You: yes
  ↳ book({... "customerConfirmed": true})
  Confirm booking: Haircut at Demo Barbershop, Monday 12 October at 10 am, 120 ZAR? [y/N] y
  ✓ Booked. The server checked: The business is taking bookings; ...
```

Point it at another server with `--server http://localhost:8792/mcp` (local) or `OPEN_COUNTER_MCP`.

## How Strands is used

| Strands feature | Where |
|---|---|
| `MCPClient(url=...)` as a tool provider (Streamable HTTP) | `build_agent()` |
| `Agent` with a system prompt and pluggable model providers (Gemini, OpenAI-compatible, Ollama, Bedrock) | `pick_model()`, `build_agent()` |
| Hooks: `BeforeToolCallEvent` with `cancel_tool`, `AfterToolCallEvent` | `ConfirmBeforeBooking` |
| Direct tool calls (`agent.tool.book(...)`) | `smoke_test.py` |
