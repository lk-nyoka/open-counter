# Alexa+ add-on (MCP Toolkit)

Open Counter is built to be one Alexa+ add-on for every business on it: the add-on registers the directory endpoint `https://open-counter.opencounter.workers.dev/mcp`, and customers book any listed business by name.

`addon.json` is a draft listing written against the documented fields and limits (name ≤ 30 characters, short description ≤ 123, 3–4 example phrases, HTTPS privacy and terms URLs, six icon sizes, a 600×900 carousel image and a 1200×600 banner). The images are served from `public/addon/`.

## What the server already meets

| Alexa+ MCP requirement | Status |
|---|---|
| MCP spec 2025-11-25, Streamable HTTP | Yes |
| HTTPS, remotely reachable | Yes (Cloudflare Workers) |
| Round trip under 500 ms | Business info ~100 ms. Availability is served from a 30-second cache; the first, uncached read of a Google calendar can exceed 500 ms |
| MCP Apps visuals (optional) | Booking card `ui://open-counter/booking-card.html` |
| Never return an empty result | Closed or full days return the reason and the next free time |
| Customer knows what they commit to | `book` books only details the server read back (signed `confirmationToken`, 15 minutes) |
| Authentication | Not needed: booking is public, like phoning the shop. Customer cancels with their booking code |

## Why it is not deployed to Alexa+ yet

Deploying needs the Alexa AI CLI, which is installed from AWS CodeArtifact. That requires an AWS account (a payment card at sign-up), and the MCP Toolkit is available in the United States only. Steps, once those are available:

```
npm install -g @alexa-ai/cli
alexa-ai configure
alexa-ai new mcp --name "Open Counter" --locale en-US --mcp-server-url https://open-counter.opencounter.workers.dev/mcp
# copy the values from addon.json into addon-package/addon.json
alexa-ai deploy
```

Until then the web app's "Book by voice" screen is the simulated Alexa+ experience: speech in, the same MCP server, spoken replies, and the same booking card content.
