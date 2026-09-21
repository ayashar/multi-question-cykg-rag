"use client";

import { useId, useState, type ReactNode } from "react";
import type { Case } from "@/api";
import MitreBadges from "@/modules/cases/components/mitre-badges";

export function formatInvestigationTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Not available";
  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta",
  }).format(date)} UTC+7`;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0 space-y-1"><dt className="font-b2 text-primary-900">{label}</dt><dd className="font-b1 font-semibold wrap-anywhere">{children}</dd></div>;
}

export function EvidenceList({ label, values }: { label: string; values: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return (
    <div className="min-w-0 space-y-1">
      <dt className="font-b2 text-primary-900">{label}</dt>
      <dd>
        <ul id={id} className="space-y-1 font-b2 font-semibold wrap-anywhere">
          {(expanded ? values : values.slice(0, 5)).map((value, index) => <li key={`${index}:${value}`}>{value}</li>)}
          {!values.length && <li className="font-normal text-neutral-800">Not available</li>}
        </ul>
        {values.length > 5 && <button type="button" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}
          className="mt-2 cursor-pointer font-b2 text-primary-800 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2">
          {expanded ? "See less" : `See more (${values.length - 5})`}
        </button>}
      </dd>
    </div>
  );
}

export default function CaseDetails({ value }: { value: Case }) {
  const urgency = value.urgency_score >= 70 ? "High" : value.urgency_score >= 40 ? "Medium" : "Low";
  return (
    <section aria-labelledby="case-detail-title" className="rounded-[10px] bg-primary-100 p-5 text-primary-1000">
      <h2 id="case-detail-title" className="font-h6 mb-4">Case Detail</h2>
      <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
        <Field label="Host Name">{value.hosts[0] || "Not available"}</Field>
        <Field label="First Seen">{formatInvestigationTime(value.first_seen)}</Field>
        <Field label="Last Seen">{formatInvestigationTime(value.last_seen)}</Field>
        <Field label="MITRE ATT&CK"><MitreBadges techniques={value.mitre_techniques} maxVisible={value.mitre_techniques.length} /></Field>
        <Field label="Urgency">{value.urgency_score.toFixed(1)} <span className="ml-1">{urgency}</span></Field>
        <Field label="Alert Count">{value.alert_count} alerts</Field>
        <EvidenceList label="Alert IDs" values={value.alert_ids} />
        <EvidenceList label="Hosts" values={value.hosts} />
        <EvidenceList label="Source IPs" values={value.src_ips} />
        {value.dst_users.length > 0 && <EvidenceList label="Destination Users" values={value.dst_users} />}
        {value.sigma_matched_rules.length > 0 && <EvidenceList label="Matched Rules" values={value.sigma_matched_rules} />}
      </dl>
    </section>
  );
}
