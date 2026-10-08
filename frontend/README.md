# Open Counter frontend

React 19 + Vite + Tailwind. The first visual draft came from Google AI Studio (the design brief is
`docs/ozza-frontend-prompt.md`); we then rewrote the screens and wired every one to the real API. There is no mock data
anywhere: every number, slot and booking comes from the Open Counter API.

- `src/lib/api.ts`: typed client for `docs/API.md`.
- `src/lib/dialog-core.js`: the booking dialog, a copy of `public/dialog.js` (tested by `src/dialog.test.ts` in the
  backend). Do not edit it here; change `public/dialog.js` and copy it over.
- `src/lib/voice.ts`: microphone capture with silence detection, then server-side Whisper (`/api/transcribe`).

Views: owner dashboard, customer booking, voice assistant (Ozza), onboarding interview, API explorer. Customer links
look like `/?business=<slug>&view=booking` or `&view=assistant` and need no sign-in.

## Run
- Production: from the repo root, `npm run build:frontend` builds this app into `public/`, and `npm run deploy:cf`
  does that automatically. The Worker then serves it at `/` on the same origin as the API.
- Development: run the local Worker (`npm run dev:local` in the repo root), then here `cp .env.example .env`,
  `npm install`, `npm run dev`. Vite proxies `/api`, `/auth` and `/mcp` to `OPEN_COUNTER_API`.
