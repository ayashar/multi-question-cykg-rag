# Supabase Auth and Account Data Setup

The frontend uses Supabase Auth with an SSR cookie session. Calling
`supabase.auth.signUp()` creates a user in Supabase's internal `auth.users`
schema, so application code must not create or maintain a separate users table.

## Data ownership model

| Store | Purpose | Ownership |
| --- | --- | --- |
| `auth.users` | Login identity, email, password, and user metadata | Managed by Supabase Auth |
| `public.investigations` | Case snapshot, status, time range, and initial activity log | Private to one `user_id` |
| `public.investigation_turns` | Initial report and follow-up chat turns with their activity logs | Private to one `user_id` |
| Neo4j | Ingested alerts, entities, relationships, and the shared evidence graph | Shared investigation source |

Supabase Row Level Security (RLS) enforces `auth.uid() = user_id` on both
application tables. A browser using the publishable key can therefore read and
write only the signed-in user's rows.

## 1. Create or select a Supabase project

1. Open [Supabase Dashboard](https://supabase.com/dashboard) and select the project.
2. Open **Project Settings → API**.
3. Copy the **Project URL** and **Publishable key**. An older project's `anon`
   key also works.
4. Never put a `service_role` key or database password in a variable whose name
   starts with `NEXT_PUBLIC_`.

## 2. Apply the account-data migration

Run the versioned migration before deploying the frontend:

[`supabase/migrations/202611090001_account_investigations.sql`](../supabase/migrations/202611090001_account_investigations.sql)

For a manually managed project, open **SQL Editor → New query**, paste the
migration, and run it once. The migration is idempotent for tables and indexes,
and recreates the named triggers and RLS policies so their definitions match
the repository.

After it succeeds, verify in **Table Editor** that these tables exist:

- `investigations`
- `investigation_turns`

Then open each table's RLS policy view and confirm RLS is enabled. Do not add a
policy that allows every authenticated user to read all rows.

## 3. Configure local development

From `frontend/`, copy the example file:

```bash
cp .env.example .env.local
```

Set the browser-safe Supabase values and the server-only backend values:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxx
NEXT_PUBLIC_USE_MOCK=false

INVESTIGATION_API_URL=http://127.0.0.1:8000
INVESTIGATION_API_KEY=replace-with-a-long-random-secret
```

The same `INVESTIGATION_API_KEY` must be present in the FastAPI process's root
`.env`. Do not prefix either backend variable with `NEXT_PUBLIC_`; they must
remain available only to the Next.js server.

Restart `pnpm dev` whenever the environment file changes.

## 4. Configure authentication URLs

In **Authentication → URL Configuration**, configure:

- Local **Site URL**: `http://localhost:3000`
- Local **Redirect URL**: `http://localhost:3000/auth/confirm`
- Production **Site URL**: the canonical HTTPS application origin
- Production **Redirect URL**: `https://YOUR_DOMAIN/auth/confirm`

In **Authentication → Providers → Email**:

- enable the Email provider;
- enable new-user signups;
- keep email confirmation enabled when verification is required.

Supabase's default email service is suitable for development. Production should
use custom SMTP with a verified sender domain and monitored delivery limits.

## 5. How account identity reaches the backend

The browser calls the same-origin Next.js route under `/backend/*`. That route:

1. validates the Supabase cookie with `supabase.auth.getUser()`;
2. rejects unauthenticated requests;
3. injects the verified UUID as `X-CSKG-User-ID`;
4. injects `INVESTIGATION_API_KEY` when configured;
5. forwards the request to FastAPI.

FastAPI scopes transcripts, checkpoints, follow-up chat, and live event streams
by `user_id + case_id`. Browser-supplied identity headers are never forwarded by
the Next.js proxy.

## Production notes

- Set `NEXT_PUBLIC_USE_MOCK=false` during the production build.
- Apply database migrations before releasing application code that writes to
  the new tables.
- Keep RLS enabled and use only the publishable key in browser code. A
  `service_role` client bypasses RLS and must never be shipped to the browser.
- Set a long random `INVESTIGATION_API_KEY` in both Next.js and FastAPI. Keep
  FastAPI on a private network when possible; `X-CSKG-User-ID` is trusted only
  because the server-side proxy supplies it.
- Use HTTPS for the public site and configure only exact trusted auth redirect
  URLs in Supabase.
- Enable Supabase backups or point-in-time recovery according to the project's
  retention requirements, and test restoring the two account-data tables.
- The Supabase history is durable, but LangGraph checkpoints and the backend
  audit log still live under `data/checkpoints/` and `data/investigations.jsonl`.
  A multi-replica deployment therefore needs a shared durable checkpointer, or
  a single/sticky investigation worker, before follow-up chat can safely move
  between replicas.
- Never expose the FastAPI service directly without its API key. Direct callers
  could otherwise claim an arbitrary `X-CSKG-User-ID`.
- Rotate secrets through the deployment platform. Do not commit `.env.local`,
  database passwords, API keys, or Supabase service-role keys.

## Verification

1. Sign up at `/signup` and verify the email if confirmation is enabled.
2. Confirm the user appears under **Authentication → Users**.
3. Complete one investigation and send one follow-up message.
4. Confirm one row exists in `investigations` and matching rows exist in
   `investigation_turns`.
5. Sign in as a second test account and confirm the first account's history is
   not visible.
6. Sign back in as the first account and confirm its report, chat, and activity
   logs are restored.

The user's full name is stored as `full_name` in `user_metadata`; Supabase Auth
manages the email and password.
