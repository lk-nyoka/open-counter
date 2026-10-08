"""
End-to-end check of the concierge against a running Open Counter server, without any language model:
Strands calls each MCP tool directly, and the client-side confirmation hook is exercised both ways.

    python smoke_test.py                                   # live server
    python smoke_test.py --server http://localhost:8792/mcp
"""
import argparse, json, sys, uuid
from datetime import datetime, timedelta
from concierge import build_agent, DEFAULT_SERVER


class NoModel:  # direct tool calls never reach a model
    pass


def data(result):
    for block in result.get("content", []):
        try:
            return json.loads(block["text"])
        except (KeyError, TypeError, ValueError):
            continue
    return {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--server", default=DEFAULT_SERVER)
    a = ap.parse_args()
    answers = iter(["n", "y"])
    lines = []
    agent, _ = build_agent(a.server, model="no-model-needed", ask=lambda q: (lines.append(q), next(answers))[1], out=lambda s: lines.append(s))
    t = agent.tool

    names = sorted(agent.tool_names)
    assert {"find_business", "check_availability", "book", "cancel"} <= set(names), names
    print("tools:", ", ".join(names))

    found = data(t.find_business(query="haircut"))
    biz = found["businesses"][0]["business"]
    print("found:", found["summary"])

    day = datetime.now() + timedelta(days=2)
    while day.weekday() > 4:
        day += timedelta(days=1)
    av = data(t.check_availability(business=biz, serviceId="haircut", date=day.strftime("%Y-%m-%d")))
    slot = av["slots"][len(av["slots"]) // 2]
    print("free:", av["summary"])

    rb = data(t.book(business=biz, serviceId="haircut", start=slot["start"], customerName="Strands Smoke Test", customerConfirmed=False))
    assert rb["code"] == "confirmation_required", rb
    print("read-back:", rb["message"])

    key = "strands-smoke-" + uuid.uuid4().hex[:12]
    refused = t.book(business=biz, serviceId="haircut", start=slot["start"], customerName="Strands Smoke Test", customerConfirmed=True, idempotencyKey=key)
    assert refused.get("status") == "error", refused
    print("human said no -> client gate stopped the booking:", refused["content"][0]["text"][:80])

    booked = data(t.book(business=biz, serviceId="haircut", start=slot["start"], customerName="Strands Smoke Test", customerConfirmed=True, idempotencyKey=key))
    assert booked.get("confirmed"), booked
    print("booked:", booked["summary"])
    print("checks:", len(booked["checks"]))

    gone = data(t.cancel(business=biz, bookingId=booked["bookingId"]))
    assert gone.get("cancelled"), gone
    print("cancelled:", gone["summary"])
    print("\nOK: Strands -> MCP -> Open Counter, both confirmation gates working.")


if __name__ == "__main__":
    sys.exit(main())
