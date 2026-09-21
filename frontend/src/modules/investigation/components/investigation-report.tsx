"use client";

import { Download } from "lucide-react";
import type { Case, TurnRecord } from "@/api";
import { Button } from "@/components/ui/button";
import { TurnResult } from "@/components/ui/error-states";
import MitreBadges from "@/modules/cases/components/mitre-badges";
import { buildInvestigationReport } from "../services/investigation-service";
import { formatInvestigationTime } from "./case-details";

export function DownloadReportButton({ value, turn }: { value: Case; turn: TurnRecord }) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([buildInvestigationReport(value, turn)], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${value.case_id.replace(/[^a-zA-Z0-9_-]/g, "_")}-investigation.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <Button type="button" disabled={turn.error !== null || value.case_id !== turn.case_id} onClick={download}
    className="bg-primary-600 font-b2 text-white hover:bg-primary-700 disabled:opacity-50">
    <Download aria-hidden="true" className="size-4" />Download report
  </Button>;
}

export default function InvestigationReport({ value, turn }: { value: Case; turn: TurnRecord }) {
  return (
    <TurnResult turn={turn}>
      <article aria-labelledby="report-title" className="space-y-6 rounded-[10px] border border-primary-200 bg-background p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-300 pb-5">
          <div>
            <h2 id="report-title" className="font-h6">Investigation report</h2>
            <p className="mt-1 font-b3 text-neutral-800">{formatInvestigationTime(turn.timestamp)} · {turn.latency_seconds.toFixed(1)} seconds</p>
          </div>
          <DownloadReportButton value={value} turn={turn} />
        </div>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-[3px] bg-primary-100/50 p-4"><dt className="font-b2">Recommended priority</dt><dd className="mt-1 font-h7 font-semibold capitalize">{turn.recommended_priority ?? "Not provided"}</dd></div>
          <div className="rounded-[3px] bg-primary-100/50 p-4"><dt className="font-b2">Confidence</dt><dd className="mt-1 font-h7 font-semibold capitalize">{turn.confidence ?? "Not provided"}</dd></div>
        </dl>
        <section className="space-y-2"><h3 className="font-h7 font-semibold">Investigation findings</h3><p className="whitespace-pre-wrap font-b1 wrap-anywhere">{turn.answer || "The investigation returned no narrative."}</p></section>
        <section className="space-y-2"><h3 className="font-h7 font-semibold">Critical analysis</h3><p className="whitespace-pre-wrap font-b1 wrap-anywhere">{turn.critical_analysis || "No critical analysis was provided."}</p></section>
        <section className="space-y-2"><h3 className="font-h7 font-semibold">Mitigation suggestions</h3>
          {turn.mitigation_suggestions.length ? <ul className="list-disc space-y-2 pl-5 font-b1 wrap-anywhere">{turn.mitigation_suggestions.map((suggestion, i) => <li key={i}>{suggestion}</li>)}</ul>
            : <p className="font-b2 text-neutral-800">No mitigation suggestions were provided.</p>}
        </section>
        <section className="space-y-2"><h3 className="font-h7 font-semibold">MITRE ATT&CK</h3><MitreBadges techniques={turn.mitre_techniques} maxVisible={turn.mitre_techniques.length} /></section>
        <section className="space-y-2"><h3 className="font-h7 font-semibold">Cited entities</h3>
          {turn.cited_entities.length ? <ul className="flex flex-wrap gap-2">{turn.cited_entities.map((entity, i) => <li key={i} className="max-w-full rounded-[3px] bg-neutral-100 px-2 py-1 font-mono text-xs wrap-anywhere">{entity}</li>)}</ul>
            : <p className="font-b2 text-neutral-800">No cited entities were provided.</p>}
        </section>
      </article>
    </TurnResult>
  );
}
