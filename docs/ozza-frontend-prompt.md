# Ozza: frontend build prompt for Open Counter

How to use this file:

1. Open **Google AI Studio → Build** (aistudio.google.com, free, no card).
2. Attach two files from the project: `docs/API.md` and `public/dialog.js`.
3. Paste everything in the **PROMPT** section below as your first message.
4. When the first version runs, use the **Follow-up prompts** at the bottom one at a time.
5. Export to GitHub (or download the ZIP) and hand it back. It gets merged into the Open Counter repo and served
   from the same Cloudflare address as the backend: no extra hosting, no CORS, one repo for the judges.

Ozza's video clips are made separately. Use the **Ozza asset prompts** section at the end.

---

## PROMPT

You are a world-class product designer and senior frontend engineer. Build the complete frontend for
**Open Counter**, a voice-first booking product, as a single-page web app. The backend already exists and is
documented in the attached `API.md`. Do not build or mock a backend.

### 1. Product in one paragraph

Open Counter lets a small business (barber, salon, clinic, studio) take bookings by voice through any AI
assistant, such as Alexa+, using the Model Context Protocol (MCP). The owner sets the business up by simply
talking. Customers book by talking. The face of the product is **Ozza**, a Welsh Corgi companion who listens,
thinks, works and celebrates. This is not a chatbot screen: it should feel like sitting across from a calm,
brilliant assistant who quietly handles the work. Ozza only ever says and shows things that come from the real
backend: no invented features, no fake data, no placeholder numbers.

### 2. Tech and hard rules

- **Stack:** React 18, TypeScript, Vite, Tailwind CSS, Framer Motion, lucide-react icons. Client-side only, no
  server code. Output a static build (`dist/`).
- **No AI calls from the frontend.** Do not use the Gemini API, any SDK key, or any model. All understanding,
  transcription and booking go through the Open Counter API.
- **API base:** read `import.meta.env.VITE_API_BASE`. Default to `""` (same origin). Put every call in one
  typed client, `src/api/client.ts`, with the request and response types from `API.md`.
- **Auth:** the owner session token lives in `localStorage` key `oc_token`. Send it as
  `Authorization: Bearer <token>`. Also send `credentials: "include"` so same-origin cookies work.
- **Errors:** every error response is `{ error, message }`. Show and speak `message` calmly; branch on
  `error`. Never invent a reason.
- **Dialog logic is provided.** Copy the attached `dialog.js` into `src/lib/dialog.js` unchanged and use its
  `createDialog({ info, tool, understand })`. Do not reimplement booking logic.
- **Routes:**
  - `/` welcome
  - `/setup` owner setup conversation
  - `/home` owner home
  - `/b/:slug` customer booking with Ozza
  - `/auth/done` reads the sign-in token from the URL fragment
- **Performance:** the first screen is interactive in under 2 s on a mid-range phone. Lazy-load everything
  except the idle Ozza clip. Animate only transform and opacity. Target 60 fps.

### 3. Design language

- **Feel:** Apple-level calm and precision, the depth of visionOS, the speed of Linear and Raycast, and the
  warmth of a Pixar character. Original, not a copy of any product.
- **Canvas:** pure white `#FFFFFF`, huge whitespace, no sidebars, no tables on the main stage, no clutter.
  Information appears only when needed, as floating glass "islands".
- **Colour tokens (CSS variables):**
  - text: ink `#0B0B0F`, secondary `#5F6470`, tertiary `#9AA0AA`
  - lines: `rgba(15,23,42,0.08)`
  - accent: warm corgi amber `#E39B3B` (for Ozza's glow and primary actions)
  - focus: blue `#2F6BFF`
  - status: success `#169C68`, attention `#D9483B` (never used alone; always paired with an icon and words)
  - Meets WCAG AA contrast and is colour-blind safe.
- **Glass islands:**
  - background `rgba(255,255,255,0.72)`, `backdrop-filter: blur(24px) saturate(140%)`
  - 1px border `rgba(15,23,42,0.06)`, radius 24px
  - shadow `0 1px 1px rgba(0,0,0,.04), 0 18px 48px -16px rgba(15,23,42,.18)`
  - inner padding 20 to 24px
  - on hover: lift 2px and deepen the shadow
- **Type:** Inter (Google Fonts). Display 34/40 at weight 600 with tracking -0.02em. Title 20/26 at 600.
  Body 16/24 at 400. Caption 13/18 at 500 in the secondary colour. Use tabular numbers for times and money.
  Sentence case everywhere.
- **Spacing:** 4px grid. Generous: islands sit at least 24px from each other and from Ozza.
- **Motion (Framer Motion springs):**
  - default `{ type: "spring", stiffness: 260, damping: 30, mass: 0.9 }`
  - gentle `{ stiffness: 140, damping: 22 }`
  - islands enter: opacity 0→1, y 14→0, scale 0.98→1, blur 8px→0, staggered 60 ms
  - islands leave: reverse, 180 ms
  - buttons press to scale 0.97
  - Nothing snaps; nothing bounces more than once.
- **Light:** a soft radial glow behind Ozza (amber, about 12% opacity) that breathes slowly (6 s cycle).
  It brightens briefly on success. Subtle time-of-day tint over the white:
  - morning: cool
  - afternoon: neutral
  - evening: warm
  - night: very soft blue
  - The tint is never more than 4% so the canvas still reads as white.
- **Depth:** background glow → ambient particles (very sparse, slow, only while listening) → glass islands →
  workflow visual → Ozza → captions → notifications. On desktop a pointer parallax of at most 6px; none on touch
  or reduced motion.

### 4. Ozza, the companion

Ozza is a lifelike Welsh Corgi: warm, calm, professional, quietly delighted to help. Like the world's best
executive assistant, Ozza is patient and confident, never sarcastic, never childish, never overwhelming.

**Rendering.** Ozza is a set of short looping video clips on a pure white background. Because the canvas is
also white, they blend seamlessly with no visible edges.

- **Files:** `public/ozza/{state}.mp4` and `.webm`, plus `public/ozza/poster.jpg`.
- **States:** `idle`, `listening`, `thinking`, `working`, `speaking`, `happy`, `confused`, `error`.
- **Player:** build an `<Ozza state=... />` component that:
  - crossfades between two stacked `<video muted playsinline loop>` elements in 280 ms;
  - preloads `idle` and lazy-loads the rest on first use;
  - holds a state for at least 1.2 s to avoid flicker;
  - falls back to the poster image with a gentle CSS breathing scale (1→1.01, 4 s) if a clip is missing or
    reduced motion is on.
- **Size:** 46vh tall on desktop, max 520px; 34vh on mobile. Always centred. Ozza is the hero of every screen.
- **Halo:** under Ozza, an elliptical floor shadow plus a ring of light that reacts to state:
  - listening: an amber ring whose radius follows the live microphone level;
  - thinking: a slow rotating soft gradient halo;
  - working: up to three small glass "tool chips" orbit slowly, labelled with the real step, e.g. "Checking
    the diary", "Booking", "Cancelling", "Connecting Google Calendar";
  - happy: a short warm bloom.
  - No spinners or progress bars anywhere.

**State machine.** Ozza's state is driven only by real events:

| State | When |
|---|---|
| idle | nothing happening |
| listening | microphone open (set at once when the mic button is pressed) |
| thinking | a request to `/api/assistant`, `/api/interview` or `/api/transcribe` is in flight |
| working | an MCP tool call is in flight (from the `tool` callback) or the go-live sequence is running |
| speaking | a reply is being spoken (text-to-speech) |
| happy | the result contains `booked`, setup completed, or a booking was cancelled successfully |
| confused | the reply starts with "Sorry, I didn't catch that" or asks the user to repeat |
| error | network failure or 5xx. Calm, reassuring copy; never alarming red full-screen states |

### 5. Voice-first interaction

- **Composer:** fixed at the bottom centre, max-width 720px. One pill-shaped input (56px tall, glass) with
  placeholder **"Ask Ozza anything…"** and a 48px round microphone button on the right (amber when active).
  Enter sends. Typing makes the composer glow faintly.
- **Microphone:** record with `MediaRecorder` (`audio/webm;codecs=opus`, falling back to `audio/mp4`) with
  `echoCancellation`, `noiseSuppression` and `autoGainControl` on. Detect speech with a WebAudio analyser:
  - calibrate the noise floor over the first 400 ms;
  - speech threshold = max(0.02, 3 × floor);
  - stop after 2.2 s of silence once speech has started, after 25 s maximum, or after 8 s if no speech.
  - Pressing the button again stops early.
  - Then POST the audio to `/api/transcribe?business=<slug>&lang=<2-letter browser language>`.
  - Ignore empty results and the phantom phrases "thank you", "thanks for watching" and "you".
  - Live waveform: 24 thin bars inside the ring, driven by the analyser.
- **Text-to-speech:** `speechSynthesis`. Pick the best available English voice in this order: a "Natural" or
  "Neural" voice, Google UK/US English, Samantha, then any `en-*`. Rate 1.0, pitch 1.0. Provide a speaker toggle.
  Never block the UI if no voice exists (time out after 2 s plus 90 ms per character).
- **Captions:** every spoken line appears as a floating glass caption above the composer and dissolves after
  `3 s + 60 ms per word`. A small "Transcript" button (keyboard `T`) opens a glass sheet with the full
  conversation, for accessibility and for judges.
- **Interrupting:** if the user presses the mic or starts typing while Ozza speaks, stop speaking at once.

### 6. Screens and flows

**6.1 Welcome `/`**

- Ozza (idle, then a short `happy` on load) with one line beneath: **"Hi, I'm Ozza. I help small businesses
  take bookings by voice."**
- Three glass choice chips below:
  - **Set up my business** → `/setup`
  - **Book an appointment** → `/b/demo-barber`
  - **Explore a demo business**: POST `/api/auth/demo` with `{}`, store the `token`, go to
    `/home?welcome=<business.slug>`.
- Top-right: a quiet text link **Owner sign-in**. If `GET /api/auth/config` says `google: true`, it goes to
  `/auth/google/start?return=<origin>/auth/done`; otherwise it opens the demo option.
- Bottom-left, tiny caption: `build <GET /api/config → build>`.

**6.2 Owner setup `/setup`, a conversation, not a form**

- First Ozza line: `GET /api/config → greeting` (spoken and captioned).
- Each user turn: POST `/api/interview` with `{ draft, messages, text }`. Keep the returned `draft` in state and
  send it back next turn. `messages` holds the last 12 `{ role: "user" | "assistant", content }` items.
- **Living checklist:** seven small glass islands orbit loosely around Ozza: Business, Time zone, Currency,
  Services, Opening hours, Voice rule, Booking rules.
  - Each one is "waiting" (outline, secondary text) or "captured" (solid glass, the captured value in short form,
    a check icon).
  - The keys come from `missing`: `name, timezone, currency, services, hours, voiceRule, bookingRules`.
  - When an item flips to captured it does a gentle spring pop and Ozza glances at it.
  - Captured values come from the returned `draft`:
    - Services: `name · 30 min · 120 ZAR`, with "not by voice" tags.
    - Hours: grouped days.
    - Voice rule: "All bookable by voice" or "Not by voice: Colour".
    - Rules: "2 h notice · 10 min gap".
- When `complete` is true, the checklist collapses into one **Summary** island showing everything, with two
  actions:
  - **Connect Google Calendar and go live** (only if `/api/auth/config.google`): POST `/api/drafts {draft}`,
    then navigate to `/auth/google/start?draft=<draftId>&return=<origin>/auth/done`.
  - **Use the built-in calendar**: POST `/api/drafts`, then POST `/api/auth/demo {draftId}`. Store the token and
    run the go-live sequence.
- **Go-live sequence (the "AI workspace").** The stage transforms: Ozza moves slightly up and to the left (spring),
  and a vertical chain of glass nodes connected by softly glowing lines appears on the right:
  1. Understanding your business ✓
  2. Building your schedule rules ✓
  3. Creating your MCP tools ✓
  4. Connecting your calendar ✓
  5. Testing a booking ✓
  6. Live ✓
  - Each node lights in turn (a pulse travels along the line; the check draws itself).
  - Steps 1 to 3 complete when the draft is accepted.
  - Step 4 completes when sign-in returns.
  - Step 5 completes when `GET /api/merchant/businesses/<slug>/health` returns `calendar: "ok"`.
  - Step 6 completes when `GET /api/merchant/businesses/<slug>` succeeds.
  - Minimum 450 ms per node so people can read it. If a step fails, that node turns to a calm attention state
    with the server's `message` and a **Try again** button.
  - Then Ozza is `happy` and the screen settles into `/home`.

**6.3 `/auth/done`.** Read `#token=…&welcome=…` from the fragment, store the token, clear the fragment, then go to
`/home?welcome=<slug>` (or `/home`). If there is no token, show a friendly sign-in-failed island with a retry.

**6.4 Owner home `/home`.** Ozza at the centre; data lives in floating islands arranged around Ozza in a
balanced layout:
- desktop: up to 3 on each side;
- tablet: two rows;
- mobile: a horizontal snap carousel below Ozza.
- Islands never overlap and re-flow with springs when one opens or closes.

Data sources (token required). If there are several businesses, show a small business switcher at the top.

| Island | Source | Shows |
|---|---|---|
| Today | `GET /api/merchant/businesses/:slug/stats` | `today.bookings` large; `today.revenue` with currency; the next booking time and customer |
| This week | same | `week.bookings`, `week.revenue`, `week.cancelled` |
| Upcoming | `GET …/bookings?status=confirmed` | next 5: time (`startLocal`), service, customer, channel badge. "See all" opens a glass sheet with the full list, show-cancelled toggle and a Cancel action per row (`POST …/bookings/:id/cancel`, with a confirm step) |
| Booked via | `stats.byChannel` | Voice, Booking page, AI assistants (MCP), You, as small proportional bars with labels |
| Your rules | `GET …/:slug` | services with prices and durations, hours, notice, gap, voice-blocked services. "Edit" opens a sheet (see below) |
| Connected | `GET …/:slug` + `…/health` | Google Calendar (owner email, healthy/needs reconnect), MCP endpoint with copy, share links (voice assistant, booking page) with copy and a QR code generated in the browser |
| Status | `acceptingBookings` | a large calm toggle, "Taking bookings" or "Paused", via `PATCH …/:slug { acceptingBookings }` |

Channel badges: Voice 🎙, Web 🌐, AI assistant (MCP) 🤖, You ✍️. Always icon plus word.

- **Welcome banner:** if `?welcome=` is present, a celebratory island: "You're live. Customers can now book you
  by voice." with the share links. Ozza is `happy`.
- **Reconnect:** if `health.calendar === "reconnect"`, show a gentle island: "Your Google Calendar link needs a
  refresh" with a **Reconnect** button (`/auth/google/start?return=<origin>/auth/done`).
- **Edit sheet:** a glass sheet sliding up from the bottom (spring).
  - Services table: name, minutes, price, "bookable by voice" switch, add and remove.
  - Hours: seven rows with an open/closed switch and time pickers.
  - Notice and gap number fields.
  - Save → `PATCH …/:slug`. Show the server `message` inline on 400.
  - Ozza says "Saved. Assistants see the change straight away."
- **Add a booking (walk-in):** a small "+" island. Pick service, day, then free times from
  `GET …/:slug/availability?serviceId&date`, enter the name, then `POST …/:slug/bookings`.
- **Owner voice commands.** Ozza understands a small honest set by matching words in the text. Do not send these
  to the AI.

| The owner says (any phrasing containing) | Ozza does |
|---|---|
| "today" / "what's on" | speaks today's count and the next booking from stats and bookings |
| "tomorrow" | lists tomorrow's bookings |
| "this week" | week summary |
| "pause" / "stop taking" | asks to confirm, then PATCH `acceptingBookings: false` |
| "resume" / "start taking" | asks to confirm, then PATCH `acceptingBookings: true` |
| "link" / "share" | opens the Connected island and copies the voice link |
| "edit" / "change prices" / "hours" | opens the edit sheet |
| anything else | "I can tell you about today, tomorrow or this week, pause or resume bookings, or share your link." |

- **Sign out:** a quiet link in the top-right menu. POST `/api/auth/logout`, clear `oc_token`, go to `/`.
- **Signed-out guard:** a 401 on `/home` routes to `/` with a gentle "Please sign in again" caption.

**6.5 Customer booking `/b/:slug`, Ozza speaking for the business**

- **On load:**
  - `GET /api/public/businesses/:slug` → `info`.
  - Initialise MCP: POST `/mcp/:slug` with JSON-RPC `initialize` (`protocolVersion: "2025-11-25"`,
    `clientInfo: { name: "open-counter-ozza", version: "1.0.0" }`), then `tools/list`.
  - Headers on every MCP call: `content-type: application/json`, `accept: application/json, text/event-stream`,
    `x-oc-channel: voice`.
- **Create the dialog:** `createDialog({ info, tool, understand })` where:
  - `tool(name, args)` = POST `/mcp/:slug` `{ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }`
    and return `result.structuredContent`. While it runs, Ozza is `working` with a chip naming the step.
  - `understand(text, awaiting)` = POST `/api/assistant` `{ business: slug, text, awaiting }`. While it runs,
    Ozza is `thinking`.
- **Greeting:** Ozza speaks `dialog.greeting()`.
- **Each user turn:** `const r = await dialog.handle(text)`.
  - Speak and caption `r.say`.
  - If `r.confirm`: show a centred **confirmation island** with service, `when`, price and currency, and name,
    plus large **Yes, book it** and **No** buttons. They call `dialog.confirm(true | false)`. Saying "yes" also
    works through `handle`.
  - If `r.booked`: show a **booked island** with a check animation, the service, `startLocal`, the booking code
    in monospace with a copy button, an **Add to my calendar** button (generate a `.ics` file in the browser from
    `start`/`end`) and **Cancel this booking** (send the text "cancel" to the dialog, which handles it). Ozza is
    `happy`.
- **Live booking island:** a small floating island shows what Ozza has understood so far. Use the slots from the
  latest replies; keep it in sync with `dialog.state` (`serviceId`, `date`, `time`, `name`). When the reply
  offers times (`dialog.state.offered`), show them as tappable glass time chips. Tapping one sends that time as
  text, e.g. "2:30 pm".
- **Info island:** business name, today's hours and a services menu with prices. Services not bookable by voice
  show "Book directly with <business>".
- **Paused businesses:** the dialog already answers politely; also show a calm banner.
- **Footer caption:** "Powered by Open Counter · MCP 2025-11-25" in tertiary text.

### 7. Micro-interactions

- **Hover:** hovering Ozza or an island triggers a tiny lift; pressed buttons compress.
- **Typing:** Ozza switches to `listening` after 300 ms of typing and back to `idle` 1.5 s after typing stops.
- **New island:** when an island appears, Ozza's clip stays the same but the halo brightens toward that side for
  600 ms (a "glance").
- **Success:** a 400 ms warm bloom across the canvas, at most 6% intensity.
- **Long waits (over 4 s):** a caption appears: "Still on it…". Never a spinner.
- **Copy buttons:** they change to "Copied" for 1.2 s.

### 8. Accessibility (required, not optional)

- **Keyboard:**
  - Tab order: composer, mic, islands left to right.
  - Shortcuts: `/` or `Ctrl+K` focuses the composer, `M` toggles the mic, `T` opens the transcript, `Esc` closes
    sheets and stops speech.
  - Visible 2px blue focus rings.
- **Screen readers:**
  - Ozza has `role="img"` and an `aria-label` describing the state ("Ozza is listening").
  - Captions use `aria-live="polite"`. Islands are landmarks with headings.
  - Confirmation and booking results are announced.
- **Respect user settings:** `prefers-reduced-motion` (poster image and fades only, no parallax or particles) and
  `prefers-contrast: more` (solid white islands, darker borders). Text scales with browser zoom up to 200%
  without overlap.
- **Touch and contrast:** all touch targets at least 44px. All text meets WCAG AA.
- **Every voice action has a visible button or typed equivalent.**

### 9. Quality bar

Every component looks custom: no default browser styling, no lorem ipsum, no placeholder avatars, no empty
states without a friendly line from Ozza. Empty states use the real situation, e.g. "No bookings yet. Share your
voice link and they'll appear here." Loading uses skeleton glass shimmer, never spinners. The result must be good
enough for a product-launch keynote and still fast, accessible and honest. Every number on screen comes from the
API.

---

## Follow-up prompts (send one at a time after the first build)

1. "Wire the typed API client against `API.md` exactly; list any field you could not match."
2. "Polish motion: check every island enter/exit uses the springs in section 3, add the go-live node chain
   animation, and verify reduced-motion mode."
3. "Make the mobile layout perfect at 375px wide: Ozza on top, islands in a snap carousel, composer above the
   keyboard."
4. "Accessibility pass: keyboard-only walkthrough of setup, home and booking; fix every focus and label issue."
5. "Remove anything that is not backed by the API (fake data, mock numbers, unused features)."

---

## Ozza asset prompts (images and video, made separately)

Make one master image first, then animate it into 8 short loops so Ozza stays the same dog in every clip.

**Tools (free tiers):**
- **Master image:** Gemini (Imagen / "Nano Banana") or ChatGPT image.
- **Clips:** image-to-video with Adobe Firefly first (daily free generations, no watermark). Kling AI or Luma
  Dream Machine are alternatives, but their free tiers add watermarks.
- **Settings:** keep clips 4 to 5 s, 16:9 or 4:5, and ask for a seamless loop.

**Master image prompt**

> Photorealistic studio portrait of a friendly adult Pembroke Welsh Corgi, red and white coat, sitting and facing
> the camera, upper body and front paws visible, centred. Pure white seamless background (#FFFFFF), no floor line,
> no props, no text. Soft cinematic daylight from the upper left, gentle fill, natural soft shadow directly under
> the dog only. Ultra-detailed realistic fur, natural wet nose, warm intelligent brown eyes with catch lights,
> ears up. Calm, kind, professional expression. Shot on an 85mm lens, f/4, shallow depth of field, physically
> based realism, Pixar-level appeal but fully photorealistic, not cartoon.

**Per-state video prompts** (image-to-video from the master image; add to each: "Seamless loop, camera locked
off, pure white background stays pure white, same lighting, no other objects, no text, 5 seconds.")

| File | Prompt |
|---|---|
| `idle` | The corgi breathes gently, blinks slowly once, ears twitch slightly, looks a little to the left then back to the camera. Very subtle, calm. |
| `listening` | The corgi perks both ears forward, tilts its head slightly to one side, attentive eyes on the camera, a soft hint of a smile. |
| `thinking` | The corgi looks up and to the right as if thinking, one slow blink, ears rotate slightly, then returns its gaze. |
| `working` | The corgi looks down and slightly to the side with a focused, confident expression, small nod, ears alert. |
| `speaking` | The corgi faces the camera with warm eye contact, mouth opening and closing gently as if talking calmly, small natural head movements. |
| `happy` | The corgi's face brightens into a happy open-mouth smile, ears perk up, a small excited wiggle as if wagging its tail. |
| `confused` | The corgi tilts its head curiously to one side, ears asymmetric, a questioning look at the camera. |
| `error` | The corgi gives a soft, empathetic look with ears slightly back, a slow reassuring blink. Calm, not sad. |

**Export:** trim each clip to a clean loop. Export MP4 (H.264) and WebM (VP9), each at most 1.5 MB at 720p. Save
them as `public/ozza/<state>.mp4` / `.webm`. Save a still from `idle` as `public/ozza/poster.jpg`.
