# ChatBot KGCS frontend

### Investigation API

The frontend proxies `/backend/*` to `http://127.0.0.1:8000` by default, avoiding
browser CORS issues. Set server-side `INVESTIGATION_API_URL` to change that
destination, and `NEXT_PUBLIC_INVESTIGATION_API_KEY` when the API requires a
key. Mock cases are used only when `NEXT_PUBLIC_USE_MOCK=true`; request failures
otherwise remain visible. The proxy allows up to 120 seconds for investigations.

Import endpoint functions from `@/api`. The shared client attaches the key,
tracks pending requests, and preserves each case's first discovery lookback
in session storage (with an in-memory fallback).

For new screens, render `ApiErrorView` for request errors and wrap each returned
report or transcript item in `TurnResult` so a non-null `turn.error` renders as
a pipeline failure. Use `InvestigationLoader` for estimated investigation stages
and `useApiLoading` for request state.

### FR2 — Case investigation

Select **Investigate** from `/cases` to open `/cases/[caseId]`. The selected case
and its original discovery window are carried into the investigation. Direct
links accept `?lookback_hours=720`; successful cases are added to local history.

The loading card estimates four stages at 0, 12, 26, and 42 seconds: Reviewing
evidence, Correlating related alerts, Building investigation findings, and
Preparing report CTA. These are not live backend events. The last stage stays
active for long requests, and report actions appear only after a successful
response. Fast responses can finish before all estimated stages are shown.

The result includes case details, expandable evidence lists, investigation
findings, and an attack-graph relationship preview. **View report** opens the full
findings, analysis, mitigations, priority, confidence, and citations;
**Download report** exports them as Markdown. Network/auth errors support retry,
404s can expand the discovery window, and pipeline failures suppress the report.

With `NEXT_PUBLIC_USE_MOCK=true`, a clearly labeled demo report completes after
48 seconds so all four loading stages can be previewed without backend calls.

Run checks from this directory:

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm lint
pnpm build
```

Run the development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.
