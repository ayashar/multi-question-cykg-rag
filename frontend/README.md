# ChatBot KGCS frontend

### Frontend demo mode

The frontend runs in self-contained demo mode by default. Cases, investigations,
reports, time-range results, attack graphs, chat endpoint responses, ingestion
status, and source configuration all use local dummy data and do not contact the
backend. This makes every implemented screen available with only:

```bash
pnpm dev
```

Set `NEXT_PUBLIC_USE_MOCK=false` before starting or building the frontend to use
the real investigation API. Demo source-configuration changes are kept only in
frontend memory, while investigation history uses browser local storage.

### Investigation API

The frontend handles `/backend/*` with a server-side Next.js route and forwards
requests to `http://127.0.0.1:8000` by default, avoiding browser CORS issues.
Set server-only `INVESTIGATION_API_URL` to change that destination and
`INVESTIGATION_API_KEY` when the API requires a key. The key is added by the
Next.js server and is never included in browser JavaScript. When live mode is
enabled, request failures remain visible and the server route allows up to 120
seconds for investigations.

Import endpoint functions from `@/api`. The shared client tracks pending requests
and preserves each case's first discovery lookback in session storage (with an
in-memory fallback).

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

In demo mode, a clearly labeled report completes in under a second without a
backend call. The longer four-stage sequence remains available in live mode.

### FR3 — Manual time-range investigation

Manual investigations are persisted in browser local storage so their original
time range and completed result survive refreshes and later browser sessions.
The form rejects future dates and ranges longer than 31 days by default. Set
`NEXT_PUBLIC_MAX_TIME_RANGE_DAYS` to a positive number to change that UI limit.

The current API cannot reconstruct an attack graph from an explicit start/end
range, so the frontend marks that view unavailable for manual investigations
instead of sending an ordinary lookback request that could resolve a different
case.

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
