"use client";

import { Save, TriangleAlert } from "lucide-react";
import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react";

interface ConfigurationValues {
  alertsPath: string;
  speed: string;
  maxGap: string;
}

export interface ObservedIngestionData {
  alertCount: number;
  earliest: string;
  latest: string;
  configuredPath: string | null;
}

interface SourceConfigurationProps {
  initialConfig?: ConfigurationValues;
  observedData?: ObservedIngestionData;
}

const STORAGE_KEY = "kgcs_ingestion_config_preview";
const STORAGE_EVENT = "kgcs-ingestion-config-change";

const DEFAULT_CONFIG: ConfigurationValues = {
  alertsPath: "data/alerts.jsonl",
  speed: "1",
  maxGap: "0.2",
};

const DEFAULT_OBSERVED_DATA: ObservedIngestionData = {
  alertCount: 999,
  earliest: "mm/dd/yyyy, 00:00 PM UTC+7",
  latest: "mm/dd/yyyy, 00:00 PM UTC+7",
  configuredPath: "data/alerts.jsonl",
};

type ConfigurationErrors = Partial<Record<keyof ConfigurationValues, string>>;

function readStoredConfig(raw: string, fallback: ConfigurationValues): ConfigurationValues {
  try {
    const stored: unknown = JSON.parse(raw || "null");
    if (!stored || typeof stored !== "object") return fallback;
    const candidate = stored as Partial<ConfigurationValues>;
    return {
      alertsPath: typeof candidate.alertsPath === "string" ? candidate.alertsPath : fallback.alertsPath,
      speed: typeof candidate.speed === "string" ? candidate.speed : fallback.speed,
      maxGap: typeof candidate.maxGap === "string" ? candidate.maxGap : fallback.maxGap,
    };
  } catch {
    return fallback;
  }
}

function subscribeToStoredConfig(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  window.addEventListener(STORAGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(STORAGE_EVENT, callback);
  };
}

function getStoredConfigSnapshot(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function getStoredConfigServerSnapshot(): string {
  return "";
}

export default function SourceConfiguration({
  initialConfig = DEFAULT_CONFIG,
  observedData = DEFAULT_OBSERVED_DATA,
}: SourceConfigurationProps) {
  const storedSnapshot = useSyncExternalStore(
    subscribeToStoredConfig,
    getStoredConfigSnapshot,
    getStoredConfigServerSnapshot,
  );
  const storedConfig = useMemo(
    () => readStoredConfig(storedSnapshot, initialConfig),
    [initialConfig, storedSnapshot],
  );
  const [draftConfig, setDraftConfig] = useState<ConfigurationValues | null>(null);
  const config = draftConfig ?? storedConfig;
  const [errors, setErrors] = useState<ConfigurationErrors>({});
  const [saved, setSaved] = useState(false);

  const updateField = (field: keyof ConfigurationValues, value: string) => {
    setDraftConfig((current) => ({ ...(current ?? config), [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setSaved(false);
  };

  const validate = (): ConfigurationErrors => {
    const nextErrors: ConfigurationErrors = {};
    const speed = Number(config.speed);
    const maxGap = Number(config.maxGap);

    if (!config.alertsPath.trim()) nextErrors.alertsPath = "Alerts path is required.";
    if (!Number.isFinite(speed) || speed <= 0) nextErrors.speed = "Use a number greater than 0.";
    if (!Number.isFinite(maxGap) || maxGap < 0) nextErrors.maxGap = "Use 0 or a positive number.";
    return nextErrors;
  };

  const saveConfiguration = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setSaved(false);
      return;
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      window.dispatchEvent(new Event(STORAGE_EVENT));
    } catch {
      // The in-memory state remains usable when browser storage is unavailable.
    }
    setDraftConfig(config);
    setSaved(true);
  };

  const configuredPath = observedData.configuredPath || storedConfig.alertsPath || "Not configured";

  return (
    <div className="-m-5 min-h-[calc(100vh-84px)] bg-background px-5 py-5 text-black-600 md:-m-8">
      <div className="flex flex-col gap-5">
        <div>
          <h1 className="font-h4">Source configuration.</h1>
          <p className="font-b1">Configure the replay source and inspect data already ingested.</p>
        </div>

        <aside role="note" aria-labelledby="ingestion-restart-title" className="flex items-start gap-3 border border-yellow-300 bg-yellow-100/35 p-4 text-yellow-500">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <div className="space-y-1">
            <h2 id="ingestion-restart-title" className="font-b1 font-semibold">Saving does not start or restart ingestion</h2>
            <p className="font-b2 text-neutral-900">
              Changes are stored for the next run. An operator must restart the separate ingestion process manually before the new configuration is used.
            </p>
            <p className="font-b3 text-neutral-800">This source replays alerts from a file; it is not a live SIEM connection.</p>
          </div>
        </aside>

        <div className="grid items-start gap-2.5 lg:grid-cols-[1.2fr_1fr]">
          <form onSubmit={saveConfiguration} className="flex flex-col gap-5 bg-primary-100 p-5">
            <div>
              <h2 className="font-h6">Configuration</h2>
              <p className="font-b2">Values used by the replay process.</p>
            </div>

            <div className="flex flex-col gap-3">
              <label htmlFor="alerts-path" className="flex flex-col gap-0.5 font-b3">
                <span>ALERTS PATH</span>
                <input
                  id="alerts-path"
                  name="alertsPath"
                  value={config.alertsPath}
                  onChange={(event) => updateField("alertsPath", event.target.value)}
                  aria-invalid={Boolean(errors.alertsPath)}
                  aria-describedby={errors.alertsPath ? "alerts-path-error" : undefined}
                  className="h-7 rounded-[4px] border border-primary-700 bg-transparent px-2 font-b3 text-black-300 outline-none focus:border-primary-900 focus:ring-1 focus:ring-primary-700 aria-invalid:border-red-400"
                />
                {errors.alertsPath && <span id="alerts-path-error" className="text-red-400">{errors.alertsPath}</span>}
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label htmlFor="replay-speed" className="flex flex-col gap-0.5 font-b3">
                  <span>REPLAY SPEED</span>
                  <input
                    id="replay-speed"
                    name="speed"
                    type="number"
                    min="0"
                    step="0.1"
                    value={config.speed}
                    onChange={(event) => updateField("speed", event.target.value)}
                    aria-invalid={Boolean(errors.speed)}
                    aria-describedby={errors.speed ? "replay-speed-error" : undefined}
                    className="h-7 rounded-[4px] border border-primary-700 bg-transparent px-2 font-b3 text-black-300 outline-none focus:border-primary-900 focus:ring-1 focus:ring-primary-700 aria-invalid:border-red-400"
                  />
                  {errors.speed && <span id="replay-speed-error" className="text-red-400">{errors.speed}</span>}
                </label>
                <label htmlFor="max-gap" className="flex flex-col gap-0.5 font-b3">
                  <span>MAX GAP (SECONDS)</span>
                  <input
                    id="max-gap"
                    name="maxGap"
                    type="number"
                    min="0"
                    step="0.1"
                    value={config.maxGap}
                    onChange={(event) => updateField("maxGap", event.target.value)}
                    aria-invalid={Boolean(errors.maxGap)}
                    aria-describedby={errors.maxGap ? "max-gap-error" : undefined}
                    className="h-7 rounded-[4px] border border-primary-700 bg-transparent px-2 font-b3 text-black-300 outline-none focus:border-primary-900 focus:ring-1 focus:ring-primary-700 aria-invalid:border-red-400"
                  />
                  {errors.maxGap && <span id="max-gap-error" className="text-red-400">{errors.maxGap}</span>}
                </label>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button type="submit" className="inline-flex items-center gap-2 rounded-[3px] border-[1.5px] border-primary-600 bg-primary-600 px-3.5 py-2 font-b2 text-white transition-colors hover:bg-primary-700">
                <Save aria-hidden="true" className="size-5" />
                Save Configuration
              </button>
              {saved && <span role="status" className="font-b3 text-primary-900">Saved locally</span>}
            </div>
          </form>

          <section className="flex flex-col gap-5 bg-primary-100 p-5">
            <div>
              <h2 className="font-h6">Observed Data</h2>
              <p className="font-b2">What the API can currently report.</p>
            </div>
            <dl className="space-y-3">
              <div>
                <dt className="font-b2">Alerts Ingested</dt>
                <dd className="font-b1 font-bold">{observedData.alertCount}</dd>
              </div>
              <div>
                <dt className="font-b2">Earliest</dt>
                <dd className="font-b1 font-bold">{observedData.earliest}</dd>
              </div>
              <div>
                <dt className="font-b2">Latest</dt>
                <dd className="font-b1 font-bold">{observedData.latest}</dd>
              </div>
              <div>
                <dt className="font-b2">Configured path</dt>
                <dd className="font-b1 font-bold wrap-anywhere">{configuredPath}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
