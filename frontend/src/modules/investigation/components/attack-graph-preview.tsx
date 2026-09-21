"use client";

import { useEffect, useState } from "react";
import { ArrowRight, GitMerge, LoaderCircle } from "lucide-react";
import { getAttackGraph, type CaseAttackGraph } from "@/api";
import { ApiErrorView } from "@/components/ui/error-states";
import { cn } from "@/lib/utils";

const nodeColors: Record<string, string> = {
  alert: "border-red-200 bg-red-100/30 text-red-500",
  host: "border-blue-200 bg-blue-100/35 text-blue-500",
  ip: "border-blue-200 bg-blue-100/35 text-blue-500",
  user: "border-primary-200 bg-primary-100 text-primary-900",
  mitre_technique: "border-green-200 bg-green-100/40 text-green-500",
};

export const MANUAL_ATTACK_GRAPH_UNAVAILABLE =
  "Attack graph is unavailable for manual time-range investigations because the API only reconstructs graphs for lookback-derived cases.";

export default function AttackGraphPreview({ caseId, lookbackHours, expanded = false, manualTimeRange = false }: {
  caseId: string; lookbackHours?: number; expanded?: boolean; manualTimeRange?: boolean;
}) {
  const [graph, setGraph] = useState<CaseAttackGraph | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);
  const demo = process.env.NEXT_PUBLIC_USE_MOCK === "true";

  useEffect(() => {
    if (demo || manualTimeRange) return;
    let cancelled = false;
    getAttackGraph(caseId, lookbackHours).then((value) => {
      if (value.case_id !== caseId) throw new Error("The returned attack graph belongs to a different case.");
      if (!cancelled) setGraph(value);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason : new Error("Could not load the attack graph."));
    });
    return () => { cancelled = true; };
  }, [caseId, lookbackHours, attempt, demo, manualTimeRange]);

  if (manualTimeRange) return <p className="font-b2 text-neutral-800">{MANUAL_ATTACK_GRAPH_UNAVAILABLE}</p>;
  if (demo) return <p className="font-b2 text-neutral-800">A live investigation is needed to reconstruct the attack graph. Demo mode only includes case metadata.</p>;
  if (error) return <ApiErrorView error={error} onRetry={() => { setError(null); setAttempt(attempt + 1); }} />;
  if (!graph) return <p role="status" className="flex items-center gap-2 py-8 font-b2"><LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />Loading attack graph…</p>;
  if (!graph.nodes.length) return <p className="py-8 font-b2 text-neutral-800">No graph evidence was returned for this case.</p>;

  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges = expanded ? graph.edges : graph.edges.slice(0, 3);
  const renderNode = (id: string) => {
    const node = nodes.get(id);
    return <div className={cn("min-w-0 flex-1 rounded-md border px-3 py-2", nodeColors[node?.type ?? ""] ?? "border-neutral-300 bg-neutral-100")}>
      <p className="text-[10px] font-semibold uppercase tracking-wide">{node?.type.replaceAll("_", " ") ?? "Entity"}</p>
      <p className="mt-1 font-b3 font-semibold wrap-anywhere">{node?.label ?? id}</p>
    </div>;
  };

  return <div className="space-y-3">
    <p className="flex items-center gap-2 font-b3 text-neutral-800"><GitMerge aria-hidden="true" className="size-4" />{graph.nodes.length} entities · {graph.edges.length} relationships</p>
    {graph.root_cause_alert_id && <p className="font-b3 wrap-anywhere"><span className="font-semibold">Root-cause candidate: </span>{graph.root_cause_alert_id}</p>}
    <ul className="space-y-3">
      {edges.map((edge, i) => <li key={i} className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        {renderNode(edge.source)}
        <div className="flex shrink-0 items-center justify-center gap-1 text-center text-[10px] text-neutral-800 sm:w-24 sm:flex-col">
          <span>{edge.relation.replaceAll("_", " ")}</span><ArrowRight aria-hidden="true" className="size-4" />
        </div>
        {renderNode(edge.target)}
      </li>)}
    </ul>
    {!edges.length && <div className="grid gap-2 sm:grid-cols-2">{(expanded ? graph.nodes : graph.nodes.slice(0, 4)).map((node) => <div key={node.id}>{renderNode(node.id)}</div>)}</div>}
    {!expanded && graph.edges.length > edges.length && <p className="font-b3 text-neutral-800">{graph.edges.length - edges.length} more relationships in the full view.</p>}
  </div>;
}
