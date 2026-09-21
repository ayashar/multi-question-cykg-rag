import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Fingerprint,
  Lightbulb,
  ShieldCheck,
} from "lucide-react";
import type { TurnRecord } from "@/api";
import { TurnResult } from "@/components/ui/error-states";
import { cn } from "@/lib/utils";

interface ReportViewProps {
  turn: TurnRecord;
  onRetry?: () => void;
}

const priorityStyles: Record<string, string> = {
  ignore: "border-green-200 bg-green-100/45 text-green-500",
  monitor: "border-yellow-200 bg-yellow-100/45 text-yellow-500",
  escalate: "border-red-200 bg-red-100/45 text-red-500",
};

const confidenceStyles: Record<string, string> = {
  low: "border-red-300 bg-red-100/45 text-red-500",
  medium: "border-yellow-300 bg-yellow-100/45 text-yellow-500",
  high: "border-green-300 bg-green-100/45 text-green-500",
};

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}

function mitreUrl(technique: string): string | null {
  const match = technique.toUpperCase().match(/^(T\d{4})(?:\.(\d{3}))?$/);
  if (!match) return null;
  return `https://attack.mitre.org/techniques/${match[1]}${match[2] ? `/${match[2]}` : ""}/`;
}

export default function ReportView({ turn, onRetry }: ReportViewProps) {
  return (
    <TurnResult turn={turn} onRetry={onRetry}>
      <article className="w-full max-w-5xl space-y-5" aria-labelledby="report-title">
        <header className="rounded-[3px] border border-neutral-300 bg-background p-5 shadow-xs">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <div className="mb-2 flex items-center gap-2 text-primary-700">
                <Bot className="h-4 w-4" aria-hidden="true" />
                <span className="font-b3 font-bold uppercase tracking-wider">AI-generated analysis</span>
              </div>
              <h1 id="report-title" className="font-h5 font-bold text-neutral-1000">
                Investigation Report
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-b3 text-neutral-700">
                <span className="inline-flex items-center gap-1.5">
                  <Fingerprint className="h-3.5 w-3.5" aria-hidden="true" />
                  <code className="font-mono font-semibold text-neutral-900">{turn.case_id}</code>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                  {formatTimestamp(turn.timestamp)} · {turn.latency_seconds.toFixed(1)}s
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {turn.recommended_priority && (
                <span className={cn("rounded-[3px] border px-3 py-1.5 font-b3 font-bold uppercase", priorityStyles[turn.recommended_priority])}>
                  Priority: {turn.recommended_priority}
                </span>
              )}
              {turn.confidence && (
                <span className={cn("rounded-[3px] border px-3 py-1.5 font-b3 font-bold uppercase", confidenceStyles[turn.confidence])}>
                  Confidence: {turn.confidence}
                </span>
              )}
            </div>
          </div>

          {turn.confidence === "low" && (
            <div role="note" className="mt-4 flex items-start gap-2 rounded-[3px] border border-red-200 bg-red-100/30 p-3 font-b3 text-red-500">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              This assessment has low confidence. Treat its conclusions as preliminary and verify the cited evidence.
            </div>
          )}
        </header>

        <section className="rounded-[3px] border border-neutral-300 bg-background p-5 shadow-xs">
          <h2 className="mb-3 flex items-center gap-2 font-h7 font-bold text-neutral-1000">
            <ShieldCheck className="h-5 w-5 text-primary-700" aria-hidden="true" />
            Summary
          </h2>
          <p className="whitespace-pre-wrap font-b2 leading-6 text-neutral-900">
            {turn.answer || "No summary was returned."}
          </p>
        </section>

        {turn.critical_analysis && (
          <section className="rounded-[3px] border border-neutral-300 bg-background p-5 shadow-xs">
            <h2 className="mb-3 flex items-center gap-2 font-h7 font-bold text-neutral-1000">
              <Lightbulb className="h-5 w-5 text-primary-700" aria-hidden="true" />
              Critical Analysis
            </h2>
            <p className="whitespace-pre-wrap font-b2 leading-6 text-neutral-900">{turn.critical_analysis}</p>
          </section>
        )}

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-[3px] border border-neutral-300 bg-background p-5 shadow-xs">
            <h2 className="mb-3 font-h7 font-bold text-neutral-1000">Mitigation Suggestions</h2>
            {turn.mitigation_suggestions.length > 0 ? (
              <ol className="space-y-3">
                {turn.mitigation_suggestions.map((suggestion, index) => (
                  <li key={`${suggestion}-${index}`} className="flex gap-2.5 font-b2 leading-5 text-neutral-900">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-400" aria-hidden="true" />
                    <span>{suggestion}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="font-b2 text-neutral-700">No mitigation suggestions were returned.</p>
            )}
          </section>

          <section className="rounded-[3px] border border-neutral-300 bg-background p-5 shadow-xs">
            <h2 className="mb-3 font-h7 font-bold text-neutral-1000">MITRE ATT&amp;CK</h2>
            {turn.mitre_techniques.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {turn.mitre_techniques.map((technique) => {
                  const href = mitreUrl(technique);
                  return href ? (
                    <a
                      key={technique}
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-[3px] border border-primary-300 bg-primary-100/50 px-2.5 py-1 font-b3 font-bold text-primary-800 hover:bg-primary-100"
                    >
                      {technique}
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      <span className="sr-only">opens MITRE ATT&amp;CK in a new tab</span>
                    </a>
                  ) : (
                    <span key={technique} className="rounded-[3px] border border-primary-300 bg-primary-100/50 px-2.5 py-1 font-b3 font-bold text-primary-800">
                      {technique}
                    </span>
                  );
                })}
              </div>
            ) : (
              <p className="font-b2 text-neutral-700">No techniques were identified.</p>
            )}

            {turn.cited_entities.length > 0 && (
              <div className="mt-5 border-t border-neutral-200 pt-4">
                <h3 className="mb-2 font-b3 font-bold uppercase tracking-wide text-neutral-700">Cited entities</h3>
                <div className="flex flex-wrap gap-2">
                  {turn.cited_entities.map((entity) => (
                    <code key={entity} className="rounded-[3px] bg-neutral-100 px-2 py-1 font-mono text-xs text-neutral-900">
                      {entity}
                    </code>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      </article>
    </TurnResult>
  );
}
