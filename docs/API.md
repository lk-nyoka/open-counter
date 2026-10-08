# Open Counter API

This is the contract a frontend builds on. Everything is JSON over HTTPS on one origin, for example
`https://open-counter.<you>.workers.dev`. Times are ISO 8601 with an offset; dates are `YYYY-MM-DD` in the
business's own time zone; money is a plain number in the business's currency.

There are three audiences, and they never see each other's data:

| Who | Prefix | Auth |
|---|---|---|
| Business owner | `/api/me`, `/api/merchant/*` | Session (cookie on this site, or `Authorization: Bearer <token>`) |
| Customer | `/api/public/*`, `/api/assistant`, `/api/transcribe` | None (rate-limited) |
| AI assistants (Alexa+, Claude, …) | `/mcp/{slug}` | None. MCP 2025-11-25, Streamable HTTP |

## Errors

Every error has the same shape and a stable `error` code. Show `message` to people; branch on `error`.

```json
{ "error": "signed_out", "message": "Please sign in." }
```

Common codes: `bad_request`, `signed_out` (401), `not_found` (404), `rate_limited` (429), `incomplete`,
`invalid`, `google_not_configured`. Booking refusals come back as `{ "ok": false, "code": "...", "message": "..." }`
with codes `slot_taken`, `busy`, `outside_hours`, `too_soon`, `too_far_ahead`, `not_on_grid`, `invalid_time`,
`confirmation_required`, `not_bookable_by_voice`, `paused`, `unknown_service`.

## Frontends on another domain

Deploy with `--frontend https://your-frontend.app` (comma-separate several; `https://*.preview-host.com` allows
random preview subdomains). That origin then gets CORS on `/api/*` and on `/mcp/{slug}` (allowed headers include
`x-oc-channel`). Hosting the frontend on the same Worker needs none of this. Sign-in from there: send the owner to
`/auth/google/start?return=https://your-frontend.app/after-login`. After Google, they come back to that URL with
`#token=<session>` (and `&welcome=<slug>` for a new business) in the fragment. Keep the token and send it as
`Authorization: Bearer <token>`. The demo login returns the token in its JSON body.

## Owner sign-in

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/auth/config` | | `{ google: bool, demo: true }` |
| POST | `/api/drafts` | `{ draft }` (from `/api/interview`) | `{ draftId }`; 400 `incomplete` lists what is missing |
| GET | `/auth/google/start?draft=<id>&return=<url>` | | 302 to Google. One click signs in **and** links Google Calendar (scope `calendar.events`); with `draft`, the business is created on return |
| GET | `/auth/google/callback` | | Google redirects here. Sets the session, then 302 to `/dashboard.html?welcome=<slug>` or your `return` URL |
| POST | `/api/auth/demo` | `{ draftId? }` | `{ token, merchant, business: { slug, name, links } }`. No Google needed: uses the built-in calendar. Lasts one day |
| POST | `/api/auth/logout` | | Clears the cookie |

## Owner dashboard (signed in)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/me` | `{ merchant: { id, email, name, picture, demo, hasGoogle }, businesses: [{ slug, name, acceptingBookings, calendar, links }] }` |
| POST | `/api/merchant/businesses` | `{ draft, calendar? }` creates another business |
| GET | `/api/merchant/businesses/{slug}` | Full business: services, hours, rules, `calendar` (`google`, `internal` or `shared`), `links` (`assistant`, `booking`, `mcp`) |
| PATCH | `/api/merchant/businesses/{slug}` | Any of `name, timezone, currency, hours, services, minNoticeMin, maxAdvanceDays, slotGranularityMin, bufferMin, acceptingBookings`. Validated; `slug` and the calendar link cannot change. `acceptingBookings: false` pauses all assistant and web bookings |
| DELETE | `/api/merchant/businesses/{slug}` | Unpublish |
| GET | `/api/merchant/businesses/{slug}/stats` | `{ today: { bookings, revenue }, week: { bookings, revenue, cancelled }, upcoming, byChannel: { voice, web, mcp, owner }, next }` |
| GET | `/api/merchant/businesses/{slug}/bookings?from=&to=&status=` | Default: today to 30 days ahead. `status`: `confirmed`, `cancelled`, `all`. Each booking: `id, start, end, startLocal, serviceName, price, customerName, customerPhone, channel, status` |
| POST | `/api/merchant/businesses/{slug}/bookings` | Walk-in / phone booking by the owner: `{ serviceId, start, customerName, customerPhone?, idempotencyKey? }`. Any service, same rules and locks |
| POST | `/api/merchant/businesses/{slug}/bookings/{id}/cancel` | Frees the slot immediately |
| GET | `/api/merchant/businesses/{slug}/availability?serviceId=&date=` | Free times for the owner (includes services customers can't book by voice) |
| GET | `/api/merchant/businesses/{slug}/health` | `{ calendar: "ok" | "reconnect" | "error" }`. Show a "Reconnect Google Calendar" button on `reconnect` |

`channel` tells the owner where a booking came from: `voice` (the voice assistant page), `web` (the booking page),
`mcp` (any other AI assistant over MCP, e.g. Alexa+), `owner` (added from the dashboard).

## Customer side (public)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/public/businesses/{slug}` | Name, time zone, currency, hours, services (with `bookableByVoice`), `acceptingBookings`. Never owner data |
| GET | `/api/public/businesses/{slug}/availability?serviceId=&date=` | `{ ok, slots: [{ start, end, startLocal }] }` |
| POST | `/api/public/businesses/{slug}/bookings` | `{ serviceId, start, customerName, customerPhone?, customerConfirmed: true, idempotencyKey }`. `start` must be one of the returned slots. Returns `{ ok, bookingId, service, startLocal }` (201) or a refusal (409). Reusing the `idempotencyKey` never double-books |
| POST | `/api/public/businesses/{slug}/bookings/{bookingId}/cancel` | The booking id is the customer's secret code |

## Conversation endpoints

| Method | Path | Notes |
|---|---|---|
| POST | `/api/interview` | `{ draft, messages, text }` → `{ reply, draft, missing, complete }`. Send the returned `draft` back each turn. Works even when the AI model is down or over budget |
| POST | `/api/assistant` | `{ business, text, awaiting }` → what the caller meant: `{ intent, serviceId, date, time, partOfDay, name, bookingId, yes, no, choice, today }`. The reply itself is decided by `public/dialog.js` from real availability; reuse that module in any frontend |
| POST | `/api/transcribe?business=&lang=` | Raw audio body (webm/ogg/mp4, up to 2 MB) → `{ text }`. Whisper, primed with the business's service names |
| GET | `/api/config` | `{ googleSignIn, ai, greeting, build }`. `build` shows which version is live |

## MCP (for AI assistants)

Streamable HTTP, stateless JSON-RPC, protocol `2025-11-25`. Two endpoints serve the same tools:

| Endpoint | Use |
|---|---|
| `POST /mcp` | **Directory.** Every business whose owner listed it. Start with `find_business`; every other tool takes `business` (the id it returns). This is what one Alexa+ add-on registers. |
| `POST /mcp/{slug}` | One business. Same tools without the `business` argument. |

Tools (each has a `title`, `annotations`, an `outputSchema`, and a `summary` or `message` written to be said aloud):

| Tool | Annotations | Returns |
|---|---|---|
| `find_business` (directory only) | read-only | `businesses[]` with `business`, `name`, `services`, `timezone`. No match is an error with suggestions, never an empty list. |
| `get_business_info` | read-only | Services, prices, hours, rules, `hoursSummary`, `summary`. |
| `get_quote` | read-only | Price and duration of one service. |
| `check_availability` | read-only, card | `slots[]` with `start` (pass to `book`), `startLocal`, `spoken` ("9 am"). No slots: `reason` (`closed`, `fully_booked`, `past`, `too_far_ahead`), `message`, `nextAvailable`. |
| `book` | not read-only, card | With `customerConfirmed: false`: refusal `confirmation_required` with a human `message` and `readBack`. With `true`: the booking, `when`, `summary`, `bookingId`, a six-character `code` to give the customer (e.g. `K7P-Q2M`, Crockford base32, derived from the id) and `checks[]` (the eight rules passed). |
| `cancel` | destructive, card | Takes `bookingId`, or the short `code` plus `customerName`. Returns `summary`. |

Refusals set `isError: true` and carry `{ ok: false, code, message, failedCheck? }`. `failedCheck` is one of
`accepting`, `voice`, `open`, `notice`, `free`, `lock`, `confirmed`, `written`. `code: "rate_limited"` when a business
gets more than 40 bookings an hour, or one customer name more than 5 a day.

The server enforces hours, notice, buffers, voice-blocked services, the pause switch and double-booking locks,
whatever the assistant sends. Availability is served from a 30-second cache for Google calendars; `book` always
re-reads the live calendar while holding the slot lock.

**Booking card (MCP Apps).** `check_availability`, `book` and `cancel` carry `_meta.ui.resourceUri`
(and the older `_meta["ui/resourceUri"]`) = `ui://open-counter/booking-card.html`, a self-contained
`text/html;profile=mcp-app` resource. It renders free times (tap to ask), the read-back with "Yes, book it", the receipt
with every check, or the refusal with the next free time. Taps are sent back as `ui/message`, so the assistant stays in
charge of the conversation.
