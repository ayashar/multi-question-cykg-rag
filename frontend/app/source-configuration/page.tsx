"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Database, LoaderCircle, Save } from "lucide-react";
import { getIngestionConfig, getIngestionStatus, updateIngestionConfig, type IngestionConfig, type IngestionStatus } from "@/api";
import { Button } from "@/components/ui/button";
import { ApiErrorView } from "@/components/ui/error-states";

const emptyConfig: IngestionConfig = { alerts_path: "", speed: 100000, max_gap_seconds: 0.2 };
const INGESTION_STATUS_REFRESH_MS = 5000;

type ActivityLogEntry = {
  id: number;
  timestamp: number;
  message: string;
  tone: "info" | "success" | "error";
};

function formatActivityTime(timestamp: number): string {
  return new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}

export default function SourceConfigurationPage() {
  const isDemoMode = process.env.NEXT_PUBLIC_USE_MOCK === "true";
  const [config, setConfig] = useState<IngestionConfig>(emptyConfig);
  const [status, setStatus] = useState<IngestionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [statusRefreshError, setStatusRefreshError] = useState(false);
  const statusRef = useRef<IngestionStatus | null>(null);
  const activityIdRef = useRef(0);
  const statusRefreshErrorRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const addActivity = (message: string, tone: ActivityLogEntry["tone"]) => {
      const entry: ActivityLogEntry = {
        id: ++activityIdRef.current,
        timestamp: Date.now(),
        message,
        tone,
      };
      setActivityLog((entries) => [entry, ...entries].slice(0, 8));
    };
    const recordStatus = (nextStatus: IngestionStatus) => {
      const previousStatus = statusRef.current;
      statusRef.current = nextStatus;
      setStatus(nextStatus);
      setLastCheckedAt(Date.now());
      setStatusRefreshError(false);
      statusRefreshErrorRef.current = false;

      if (!previousStatus) {
        addActivity(`Connected: ${nextStatus.alert_count.toLocaleString()} alerts available.`, "success");
      } else if (
        previousStatus.alert_count !== nextStatus.alert_count ||
        previousStatus.latest_alert_timestamp !== nextStatus.latest_alert_timestamp
      ) {
        addActivity(`Detected an ingestion update: ${nextStatus.alert_count.toLocaleString()} alerts available.`, "success");
      }
    };

    Promise.all([getIngestionConfig(), getIngestionStatus()])
      .then(([nextConfig, nextStatus]) => {
        if (cancelled) return;
        setLoadError(null);
        setConfig({ ...nextConfig, alerts_path: nextConfig.alerts_path ?? "" });
        recordStatus(nextStatus);
      })
      .catch((reason) => {
        if (!cancelled) {
          addActivity("Could not load ingestion status.", "error");
          setLoadError(reason);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    const refreshTimer = window.setInterval(() => {
      void getIngestionStatus()
        .then((nextStatus) => {
          if (!cancelled) recordStatus(nextStatus);
        })
        .catch(() => {
          if (cancelled || statusRefreshErrorRef.current) return;
          statusRefreshErrorRef.current = true;
          setStatusRefreshError(true);
          addActivity("Status refresh failed; showing the last known status.", "error");
        });
    }, INGESTION_STATUS_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
    };
  }, [attempt]);

  async function save() {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const updated = await updateIngestionConfig({ ...config, alerts_path: config.alerts_path || null });
      setConfig({ ...updated, alerts_path: updated.alerts_path ?? "" });
      setSaved(true);
    } catch (reason) {
      setSaveError(reason);
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
      {loading && <p role="status" aria-live="polite" className="flex items-center gap-2 font-b2"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />{isDemoMode ? "Loading demo configuration…" : "Loading source configuration…"}</p>}
      {!loading && loadError !== null && <ApiErrorView error={loadError} onRetry={() => {
        setLoading(true);
        setLoadError(null);
        setAttempt((value) => value + 1);
      }} />}

      {!loading && loadError === null && <>
        <div className="grid gap-4 sm:grid-cols-3">
          <article className="rounded-[8px] border border-neutral-300 bg-background p-4"><p className="font-b3 text-neutral-700">Ingested alerts</p><p className="mt-1 font-h6">{status?.alert_count.toLocaleString() ?? 0}</p></article>
          <article className="rounded-[8px] border border-neutral-300 bg-background p-4"><p className="font-b3 text-neutral-700">Earliest alert</p><p className="mt-1 font-b2 font-semibold">{status?.earliest_alert_timestamp ?? "Not available"}</p></article>
          <article className="rounded-[8px] border border-neutral-300 bg-background p-4"><p className="font-b3 text-neutral-700">Latest alert</p><p className="mt-1 font-b2 font-semibold">{status?.latest_alert_timestamp ?? "Not available"}</p></article>
        </div>

        <section aria-labelledby="ingestion-activity-title" className="rounded-[8px] border border-neutral-300 bg-background p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="ingestion-activity-title" className="font-h7 font-semibold">Ingestion activity</h2>
              <p className="font-b2 text-neutral-700">Status snapshots from the ingestion API, refreshed every 5 seconds.</p>
            </div>
            {lastCheckedAt !== null && <p className="font-b3 text-neutral-700">Last checked {formatActivityTime(lastCheckedAt)}</p>}
          </div>
          {statusRefreshError && <p role="status" className="mt-3 rounded-[4px] bg-yellow-100 px-3 py-2 font-b3 text-yellow-800">The latest status check failed. Showing the last known status.</p>}
          <ol className="mt-4 space-y-2" aria-label="Ingestion status activity">
            {activityLog.length > 0 ? activityLog.map((entry) => (
              <li key={entry.id} className="flex items-start gap-3 rounded-[4px] bg-neutral-100 px-3 py-2 font-b3">
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${entry.tone === "error" ? "bg-red-500" : entry.tone === "success" ? "bg-green-500" : "bg-neutral-500"}`} aria-hidden="true" />
                <span className="min-w-0 flex-1">{entry.message}</span>
                <time className="shrink-0 text-neutral-600" dateTime={new Date(entry.timestamp).toISOString()}>{formatActivityTime(entry.timestamp)}</time>
              </li>
            )) : <li className="font-b3 text-neutral-700">Waiting for the first ingestion status response…</li>}
          </ol>
          <p className="mt-4 font-b3 text-neutral-700">This is not the raw backend terminal log; the backend currently exposes status only.</p>
        </section>

        <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="space-y-5 rounded-[8px] border border-primary-200 bg-primary-100/50 p-5">
          <div className="flex items-center gap-2"><Database className="size-5 text-primary-700" aria-hidden="true" /><h2 className="font-h7 font-semibold">Alert replay source</h2></div>
          <label className="block font-b2 font-semibold">Alerts path
            <input disabled={saving} value={config.alerts_path ?? ""} onChange={(event) => { setSaved(false); setSaveError(null); setConfig((value) => ({ ...value, alerts_path: event.target.value })); }} className="mt-1.5 h-10 w-full rounded-[3px] border border-primary-400 bg-background px-3 font-b2 outline-none focus:ring-2 focus:ring-primary-300 disabled:cursor-not-allowed disabled:opacity-60" />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block font-b2 font-semibold">Replay speed
              <input disabled={saving} type="number" min="1" value={config.speed} onChange={(event) => { setSaved(false); setSaveError(null); setConfig((value) => ({ ...value, speed: Number(event.target.value) })); }} className="mt-1.5 h-10 w-full rounded-[3px] border border-primary-400 bg-background px-3 font-b2 outline-none focus:ring-2 focus:ring-primary-300 disabled:cursor-not-allowed disabled:opacity-60" />
            </label>
            <label className="block font-b2 font-semibold">Maximum gap (seconds)
              <input disabled={saving} type="number" min="0" step="0.1" value={config.max_gap_seconds} onChange={(event) => { setSaved(false); setSaveError(null); setConfig((value) => ({ ...value, max_gap_seconds: Number(event.target.value) })); }} className="mt-1.5 h-10 w-full rounded-[3px] border border-primary-400 bg-background px-3 font-b2 outline-none focus:ring-2 focus:ring-primary-300 disabled:cursor-not-allowed disabled:opacity-60" />
            </label>
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving} className="bg-primary-700 px-5 text-white hover:bg-primary-800 disabled:opacity-60">{saving ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}Save configuration</Button>
            {saving && <p role="status" aria-live="polite" className="font-b2 text-neutral-700">Saving configuration…</p>}
            {saved && <p role="status" aria-live="polite" className="flex items-center gap-1 font-b2 text-green-500"><CheckCircle2 className="size-4" aria-hidden="true" />{isDemoMode ? "Demo configuration saved locally." : "Configuration saved successfully."}</p>}
          </div>
          {saveError !== null && <ApiErrorView error={saveError} onRetry={() => void save()} />}
        </form>
      </>}
    </section>
  );
}
