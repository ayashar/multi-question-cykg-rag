This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

### Investigation API

The frontend proxies `/backend/*` to `http://127.0.0.1:8000` by default, avoiding
browser CORS issues. Set server-side `INVESTIGATION_API_URL` to change that
destination, and `NEXT_PUBLIC_INVESTIGATION_API_KEY` when the API requires a
key. Mock cases are used only when `NEXT_PUBLIC_USE_MOCK=true`; request failures
otherwise remain visible.

Import endpoint functions from `@/api`. The shared client attaches the key,
tracks pending requests, and preserves each case's first discovery lookback
in session storage (with an in-memory fallback).

For new screens, render `ApiErrorView` for request errors and wrap each returned
report or transcript item in `TurnResult` so a non-null `turn.error` renders as
a pipeline failure. Use `InvestigationLoader` for estimated investigation stages
and `useApiLoading` for request state. Only the cases screen is currently wired.

Run checks from this directory:

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm lint
pnpm build
```

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
