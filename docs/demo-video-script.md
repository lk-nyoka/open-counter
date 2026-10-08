# Demo video script (target 2:50)

Rules from the hackathon: under 3 minutes, public on YouTube or Vimeo, in English, and no third-party trademarks or
copyrighted music unless you have permission. So: no Google, Apple or Alexa logos in close-up, and use music that comes
with your editor or none at all. Record at 1080p. Lead with the best material, because judges may stop early.

Tools: OBS Studio or the Xbox Game Bar (Win+Alt+R) for the screen, and your phone for the notification shot.

| Time | Show | Say (about 150 words a minute) |
|---|---|---|
| 0:00–0:12 | A barber or salon (or a photo of one), then the Open Counter home page with Ozza | "A barber with clippers in hand can't answer the phone. Every missed call is a missed booking. Open Counter lets customers book a small business just by talking." |
| 0:12–0:45 | **Book by voice.** Say: "Can I get a haircut on Tuesday around 3ish? I'm Thandi." Ozza offers times; say "3 is good". The read-back appears; say "Yes". | "Ozza only offers times that are really free in the owner's calendar. It reads the booking back, and nothing is booked until the customer says yes." |
| 0:45–1:00 | Zoom into the receipt: the 8 ticks, then the booking code | "The customer sees a receipt of every rule the server checked: hours, notice, a free calendar, a lock so nobody else can take the slot, and their own yes. The AI understands; the counter decides." |
| 1:00–1:12 | **Phone:** the notification arriving on your iPhone, then the event in Google Calendar | "The owner gets an alert on their phone, and the booking is already in their calendar." |
| 1:12–1:45 | **Setup:** For businesses → Set up → speak a paragraph about a business, including "never book colour by voice". The checklist fills in. Go live. | "Owners set up in one conversation. No forms. Ozza picks out services, prices, hours, and the rule that colour must never be booked by voice. One click connects Google Calendar." |
| 1:45–2:15 | **A real third-party assistant.** In claude.ai, add `https://open-counter.opencounter.workers.dev/mcp` as a custom connector and ask: "Book me a haircut at Demo Barbershop on Monday afternoon, I'm Thandi". Show it calling `find_business`, `check_availability`, the read-back card, then the receipt card. Cut to the Strands terminal approving with `y`. | "This isn't our own app talking to itself. Here a third-party assistant books through Open Counter's MCP server, the same endpoint an Alexa+ add-on registers, and the booking card renders on screen. The server signs every read-back and will only book those exact details. Here a Strands agent does the same, and a hook makes a human approve before anything is written." |
| 2:15–2:35 | **Safety in action:** ask to book colour by voice and get refused; ask for a Sunday and get the next free time | "When a rule says no, the customer hears why, and gets the next free time. Never a dead end." |
| 2:35–2:50 | Back to Ozza on the home page, then the URL and repo on screen | "Open Counter: open source, free to run, and ready for Alexa+. Let your customers book you by talking." |

## Before recording
- Rehearse the claude.ai connector part first (Settings → Connectors → Add custom connector). If your plan can't add one, use the MCP Inspector instead: `npx @modelcontextprotocol/inspector`, transport "Streamable HTTP", the `/mcp` URL, then call the tools and show a refused `book` without a `confirmationToken`.
- Use a weekday for the demo booking, because Demo Barbershop is closed on weekends.
- Turn on booking alerts on your iPhone first, using the Home Screen app.
- Delete test bookings from the demo Google Calendar so the day looks clean.
- Close other tabs and notifications. Use 125% browser zoom so text is readable.
- If you can, include 10 seconds of a real local business owner trying it. That's the strongest possible "impact" moment.
