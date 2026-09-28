"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Database, LoaderCircle, Save } from "lucide-react";
import { getIngestionConfig, getIngestionStatus, updateIngestionConfig, type IngestionConfig, type IngestionStatus } from "@/api";
import { Button } from "@/components/ui/button";
import { ApiErrorView } from "@/components/ui/error-states";

const emptyConfig: IngestionConfig = { alerts_path: "", speed: 100000, max_gap_seconds: 0.2 };

export default function SourceConfigurationPage() {
  const [config, setConfig] = useState<IngestionConfig>(emptyConfig);
  const [status, setStatus] = useState<IngestionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getIngestionConfig(), getIngestionStatus()])
      .then(([nextConfig, nextStatus]) => {
        if (cancelled) return;
        setConfig({ ...nextConfig, alerts_path: nextConfig.alerts_path ?? "" });
        setStatus(nextStatus);
      })
      .catch((reason) => { if (!cancelled) setError(reason); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [attempt]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const updated = await updateIngestionConfig({ ...config, alerts_path: config.alerts_path || null });
      setConfig({ ...updated, alerts_path: updated.alerts_path ?? "" });
      setSaved(true);
    } catch (reason) {
      setError(reason);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="w-full max-w-5xl space-y-6 pb-16">
      <div>
        <p className="font-b3 font-semibold uppercase tracking-wider text-neutral-700">Ingestion</p>
        <h1 className="mt-1 font-h4 font-bold tracking-tight text-neutral-1000">Source configuration.</h1>
        <p className="font-b2 text-neutral-800">Preview and edit the alert source used by the ingestion process.</p>
      </div>

      {process.env.NEXT_PUBLIC_USE_MOCK === "true" && <div className="rounded-[3px] border border-primary-300 bg-primary-100/50 px-4 py-3 font-b2 text-primary-900">Demo mode · changes stay in frontend memory and no backend request is sent.</div>}
      {loading && <p role="status" className="flex items-center gap-2 font-b2"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Loading demo configuration…</p>}
      {!loading && error !== null && <ApiErrorView error={error} onRetry={() => {
        setLoading(true);
        setError(null);
        setAttempt((value) => value + 1);
      }} />}

      {!loading && error === null && <>
        <div className="grid gap-4 sm:grid-cols-3">
          <article className="rounded-[8px] border border-neutral-300 bg-background p-4"><p className="font-b3 text-neutral-700">Ingested alerts</p><p className="mt-1 font-h6">{status?.alert_count.toLocaleString() ?? 0}</p></article>
          <article className="rounded-[8px] border border-neutral-300 bg-background p-4"><p className="font-b3 text-neutral-700">Earliest alert</p><p className="mt-1 font-b2 font-semibold">{status?.earliest_alert_timestamp ?? "Not available"}</p></article>
          <article className="rounded-[8px] border border-neutral-300 bg-background p-4"><p className="font-b3 text-neutral-700">Latest alert</p><p className="mt-1 font-b2 font-semibold">{status?.latest_alert_timestamp ?? "Not available"}</p></article>
        </div>

        <form onSubmit={save} className="space-y-5 rounded-[8px] border border-primary-200 bg-primary-100/50 p-5">
          <div className="flex items-center gap-2"><Database className="size-5 text-primary-700" aria-hidden="true" /><h2 className="font-h7 font-semibold">Alert replay source</h2></div>
          <label className="block font-b2 font-semibold">Alerts path
            <input value={config.alerts_path ?? ""} onChange={(event) => setConfig((value) => ({ ...value, alerts_path: event.target.value }))} className="mt-1.5 h-10 w-full rounded-[3px] border border-primary-400 bg-background px-3 font-b2 outline-none focus:ring-2 focus:ring-primary-300" />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block font-b2 font-semibold">Replay speed
              <input type="number" min="1" value={config.speed} onChange={(event) => setConfig((value) => ({ ...value, speed: Number(event.target.value) }))} className="mt-1.5 h-10 w-full rounded-[3px] border border-primary-400 bg-background px-3 font-b2 outline-none focus:ring-2 focus:ring-primary-300" />
            </label>
            <label className="block font-b2 font-semibold">Maximum gap (seconds)
              <input type="number" min="0" step="0.1" value={config.max_gap_seconds} onChange={(event) => setConfig((value) => ({ ...value, max_gap_seconds: Number(event.target.value) }))} className="mt-1.5 h-10 w-full rounded-[3px] border border-primary-400 bg-background px-3 font-b2 outline-none focus:ring-2 focus:ring-primary-300" />
            </label>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving} className="bg-primary-700 px-5 text-white hover:bg-primary-800 disabled:opacity-60">{saving ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}Save configuration</Button>
            {saved && <p role="status" className="flex items-center gap-1 font-b2 text-green-500"><CheckCircle2 className="size-4" aria-hidden="true" />Demo configuration saved.</p>}
          </div>
        </form>
      </>}
    </section>
  );
}
