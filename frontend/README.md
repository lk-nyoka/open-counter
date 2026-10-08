# Open Counter frontend

React 19 + Vite + Tailwind. Generated with Google AI Studio from `docs/ozza-frontend-prompt.md`, then wired to the
real API: there is no mock data anywhere. Every number, slot and booking comes from the Open Counter API.

- `src/lib/api.ts`: typed client for `docs/API.md`.
- `src/lib/dialog-core.js`: the booking dialog, a copy of `public/dialog.js` (tested by `src/dialog.test.ts` in the
  backend). Do not edit it here; change `public/dialog.js` and copy it over.
- `src/lib/voice.ts`: microphone capture with silence detection, then server-side Whisper (`/api/transcribe`).

Views: owner dashboard, customer booking, voice assistant (Ozza), onboarding interview, API explorer. Customer links
look like `/?business=<slug>&view=booking` or `&view=assistant` and need no sign-in.

## Run
- Production: from the repo root, `npm run build:frontend` builds this app into `public/`, and `npm run deploy:cf`
  does that automatically. The Worker then serves it at `/` on the same origin as the API.
- Development: `cp .env.example .env`, `npm install`, `npm run dev` (proxies `/api` and `/mcp` to `VITE_API_BASE`
  through `server.ts`).
