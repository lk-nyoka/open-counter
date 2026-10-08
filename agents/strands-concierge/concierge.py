"""
Open Counter concierge: a Strands Agents client for Open Counter's MCP server.

It plays the part of a voice assistant such as Alexa+: it understands the customer, calls Open Counter's tools over
MCP (spec 2025-11-25, Streamable HTTP), and books only after the customer says yes. Two independent safety gates:

  1. Client side (this file): a Strands hook stops any `book` call with customerConfirmed=true until the human at the
     keyboard approves that exact service, day, time and price.
  2. Server side (Open Counter): the server refuses a booking that breaks a rule or lacks the confirmation, whatever the
     model sends.

Run:  python concierge.py                      # chat; the model is chosen from your environment (see README)
      python concierge.py --server http://localhost:8792/mcp
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from datetime import datetime

from strands import Agent
from strands.hooks import AfterToolCallEvent, BeforeToolCallEvent, HookProvider, HookRegistry
from strands.tools.mcp import MCPClient

DEFAULT_SERVER = "https://open-counter.opencounter.workers.dev/mcp"

SYSTEM_PROMPT = """You are a booking concierge for independent local businesses on Open Counter.
Use only the Open Counter tools. Never invent a business, service, price or time.
Flow: find_business -> get_business_info -> check_availability -> call book with customerConfirmed=false to get the
read-back -> say it to the customer and wait for a clear yes -> call book with customerConfirmed=true and the same
idempotencyKey. Offer two to four times using each slot's 'spoken' value. If a day has no free times, say the 'message'
and offer 'nextAvailable'. Keep replies short and spoken-friendly: no ISO timestamps, no markdown tables.
Today is {today}."""


def pick_model():
    """Choose a model from the environment. All options except Bedrock have free tiers that need no payment card."""
    if os.getenv("GEMINI_API_KEY"):
        from strands.models.gemini import GeminiModel
        model_id = pick_gemini(os.environ["GEMINI_API_KEY"])
        return GeminiModel(client_args={"api_key": os.environ["GEMINI_API_KEY"]}, model_id=model_id), f"Gemini ({model_id})"
    if os.getenv("CLOUDFLARE_API_TOKEN") and os.getenv("CLOUDFLARE_ACCOUNT_ID"):
        from strands.models.openai import OpenAIModel
        base = f"https://api.cloudflare.com/client/v4/accounts/{os.environ['CLOUDFLARE_ACCOUNT_ID']}/ai/v1"
        return OpenAIModel(client_args={"api_key": os.environ["CLOUDFLARE_API_TOKEN"], "base_url": base},
                           model_id=os.getenv("CF_MODEL", "@cf/meta/llama-4-scout-17b-16e-instruct")), "Cloudflare Workers AI"
    if os.getenv("OLLAMA_HOST") or os.getenv("OLLAMA_MODEL"):
        from strands.models.ollama import OllamaModel
        return OllamaModel(host=os.getenv("OLLAMA_HOST", "http://localhost:11434"), model_id=os.getenv("OLLAMA_MODEL", "qwen2.5:7b")), "Ollama"
    # Amazon Bedrock (needs AWS credentials). Strands' default provider.
    return os.getenv("BEDROCK_MODEL", "us.anthropic.claude-sonnet-4-20250514-v1:0"), "Amazon Bedrock"


# Google retires model names often. Try the one you set, then current names, and use the first your key can reach.
GEMINI_CANDIDATES = ["gemini-3.8-flash", "gemini-flash-latest", "gemini-3-flash", "gemini-2.5-flash"]


def pick_gemini(api_key: str) -> str:
    from google import genai
    client = genai.Client(api_key=api_key)
    wanted = [m for m in [os.getenv("GEMINI_MODEL")] if m] + GEMINI_CANDIDATES
    errors = []
    for model_id in wanted:
        try:
            client.models.get(model=model_id)
            return model_id
        except Exception as e:  # not found, not available to this key, etc.
            errors.append(f"{model_id}: {str(e)[:90]}")
    raise SystemExit("No Gemini model available to this key. Set GEMINI_MODEL to one listed at\n"
                     "https://ai.google.dev/gemini-api/docs/models\nTried:\n  " + "\n  ".join(errors))


class ConfirmBeforeBooking(HookProvider):
    """Client-side gate: a confirmed booking needs the human's own yes, typed here. Also prints every tool call."""

    def __init__(self, ask=input, out=print):
        self.ask, self.out = ask, out
        self.readback: dict | None = None
        self.session = uuid.uuid4().hex

    def register_hooks(self, registry: HookRegistry, **_):
        registry.add_callback(BeforeToolCallEvent, self.before)
        registry.add_callback(AfterToolCallEvent, self.after)

    def before(self, event: BeforeToolCallEvent):
        name, args = event.tool_use["name"], event.tool_use.get("input", {}) or {}
        self.out(f"  ↳ {name}({json.dumps({k: v for k, v in args.items() if k != 'idempotencyKey'})})")
        if name == "book" and not args.get("idempotencyKey"):
            # Models often forget the key. Derive one from what is being booked, so a retry can never double-book.
            import hashlib
            basis = "|".join(str(args.get(k, "")) for k in ("business", "serviceId", "start", "customerName")) + "|" + self.session
            event.tool_use["input"] = {**args, "idempotencyKey": "oc-" + hashlib.sha256(basis.encode()).hexdigest()[:24]}
        if name == "book" and args.get("customerConfirmed") is True:
            rb = self.readback or {}
            summary = f"{rb.get('service', args.get('serviceId'))} at {rb.get('business', args.get('business'))}, {rb.get('when', args.get('start'))}, {rb.get('price', '?')} {rb.get('currency', '')}"
            answer = self.ask(f"\n  Confirm booking: {summary}? [y/N] ").strip().lower()
            if answer not in ("y", "yes"):
                event.cancel_tool = "The customer did not confirm at the keyboard. Nothing was booked. Ask what they would like instead."

    def after(self, event: AfterToolCallEvent):
        if event.tool_use["name"] != "book":
            return
        content = (event.result or {}).get("structuredContent") or {}
        if not content:
            for block in (event.result or {}).get("content", []):
                try:
                    content = json.loads(block.get("text", ""))
                except (TypeError, ValueError):
                    pass
        if content.get("code") == "confirmation_required":
            self.readback = content.get("readBack")
        if content.get("confirmed"):
            self.out(f"\n  ✓ Booked. The server checked: " + "; ".join(c["label"] for c in content.get("checks", [])))
            self.out(f"  Booking code: {content.get('code') or content.get('bookingId')}\n")
            self.readback = None


def build_agent(server: str, model=None, ask=input, out=print):
    client = MCPClient(url=server, application_name="open-counter-strands-concierge")
    chosen, label = (model, "custom") if model is not None else pick_model()
    agent = Agent(
        model=chosen,
        tools=[client],
        system_prompt=SYSTEM_PROMPT.format(today=datetime.now().strftime("%A %d %B %Y")),
        hooks=[ConfirmBeforeBooking(ask=ask, out=out)],
        callback_handler=None,
    )
    return agent, label


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--server", default=os.getenv("OPEN_COUNTER_MCP", DEFAULT_SERVER))
    args = ap.parse_args()
    if not any(os.getenv(k) for k in ("GEMINI_API_KEY", "CLOUDFLARE_API_TOKEN", "OLLAMA_HOST", "OLLAMA_MODEL", "AWS_ACCESS_KEY_ID", "AWS_PROFILE")):
        print("No model configured. Set GEMINI_API_KEY (free at aistudio.google.com), or CLOUDFLARE_ACCOUNT_ID and\n"
              "CLOUDFLARE_API_TOKEN, or OLLAMA_MODEL, or AWS credentials for Bedrock. See README.md.\n"
              "To check the connection without a model: python smoke_test.py")
        return 1
    agent, label = build_agent(args.server)
    print(f"Open Counter concierge · Strands Agents · model: {label}\nMCP server: {args.server}\nAsk to book something, or type 'quit'.\n")
    while True:
        try:
            text = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if text.lower() in ("quit", "exit", "q"):
            break
        if text:
            reply = agent(text)
            print(f"\nConcierge: {reply}\n")


if __name__ == "__main__":
    sys.exit(main())
