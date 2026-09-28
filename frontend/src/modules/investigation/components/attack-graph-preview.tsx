"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from "react";
import { ArrowRight, GitMerge, LoaderCircle, Maximize2, Minus, Move, Plus } from "lucide-react";
import { getAttackGraph, type AttackGraphNode, type CaseAttackGraph } from "@/api";
import { Button } from "@/components/ui/button";
import { ApiErrorView } from "@/components/ui/error-states";
import { cn } from "@/lib/utils";

const nodeColors: Record<string, string> = {
  alert: "border-red-200 bg-red-100 text-red-500",
  host: "border-blue-200 bg-blue-100 text-blue-500",
  ip: "border-blue-200 bg-blue-100 text-blue-500",
  user: "border-primary-300 bg-primary-100 text-primary-900",
  mitre_technique: "border-green-200 bg-green-100 text-green-500",
};

const NODE_WIDTH = 288;
const NODE_HEIGHT = 110;
const HORIZONTAL_GAP = 170;
const VERTICAL_GAP = 52;
const PLANE_PADDING = 72;
const MIN_SCALE = 0.35;
const MAX_SCALE = 2;

interface Position { x: number; y: number }

export interface GraphLayout {
  positions: Map<string, Position>;
  width: number;
  height: number;
  rootNodeId: string | null;
}

interface ViewportTransform { x: number; y: number; scale: number }

function resolveRootNodeId(graph: CaseAttackGraph): string | null {
  if (!graph.root_cause_alert_id) return graph.nodes[0]?.id ?? null;
  const direct = graph.nodes.find((node) => node.id === graph.root_cause_alert_id);
  if (direct) return direct.id;
  const prefixed = `alert:${graph.root_cause_alert_id}`;
  return graph.nodes.some((node) => node.id === prefixed) ? prefixed : graph.nodes[0]?.id ?? null;
}

export function buildGraphLayout(graph: CaseAttackGraph): GraphLayout {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const rootNodeId = resolveRootNodeId(graph);
  const adjacency = new Map<string, Set<string>>();
  for (const id of nodeIds) adjacency.set(id, new Set());
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }

  const levels = new Map<string, number>();
  if (rootNodeId) {
    const queue = [rootNodeId];
    levels.set(rootNodeId, 0);
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      const nextLevel = (levels.get(current) ?? 0) + 1;
      for (const neighbor of adjacency.get(current) ?? []) {
        if (levels.has(neighbor)) continue;
        levels.set(neighbor, nextLevel);
        queue.push(neighbor);
      }
    }
  }

  let lastLevel = Math.max(0, ...levels.values());
  for (const node of graph.nodes) {
    if (!levels.has(node.id)) levels.set(node.id, ++lastLevel);
  }

  const columns = new Map<number, AttackGraphNode[]>();
  for (const node of graph.nodes) {
    const level = levels.get(node.id) ?? 0;
    const column = columns.get(level) ?? [];
    column.push(node);
    columns.set(level, column);
  }
  for (const column of columns.values()) {
    column.sort((a, b) => a.type.localeCompare(b.type) || a.label.localeCompare(b.label));
  }

  const columnCount = Math.max(1, ...columns.keys()) + 1;
  const largestColumn = Math.max(1, ...Array.from(columns.values(), (column) => column.length));
  const width = PLANE_PADDING * 2 + columnCount * NODE_WIDTH + (columnCount - 1) * HORIZONTAL_GAP;
  const height = Math.max(520, PLANE_PADDING * 2 + largestColumn * NODE_HEIGHT + (largestColumn - 1) * VERTICAL_GAP);
  const positions = new Map<string, Position>();

  for (const [level, column] of columns) {
    const columnHeight = column.length * NODE_HEIGHT + Math.max(0, column.length - 1) * VERTICAL_GAP;
    const startY = (height - columnHeight) / 2;
    column.forEach((node, index) => {
      positions.set(node.id, {
        x: PLANE_PADDING + level * (NODE_WIDTH + HORIZONTAL_GAP),
        y: startY + index * (NODE_HEIGHT + VERTICAL_GAP),
      });
    });
  }
  return { positions, width, height, rootNodeId };
}

function GraphNodeCard({ node, rootCause }: { node: AttackGraphNode; rootCause: boolean }) {
  return (
    <article
      aria-label={`${node.type.replaceAll("_", " ")} ${node.label}${rootCause ? ", root cause" : ""}`}
      className={cn(
        "absolute flex flex-col justify-center rounded-[10px] border-3 px-4 py-3 shadow-sm",
        nodeColors[node.type] ?? "border-neutral-400 bg-neutral-100 text-neutral-1000",
        rootCause && "ring-2 ring-red-200 ring-offset-2 ring-offset-[#606060]",
      )}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
    >
      <div className="flex items-center justify-between gap-3 font-b4 font-medium uppercase tracking-wide opacity-80">
        <span>{node.type.replaceAll("_", " ")}</span>
        {rootCause && <span>Root cause</span>}
      </div>
      <p className="mt-2 line-clamp-2 text-lg font-bold leading-tight wrap-anywhere">{node.label}</p>
      {node.timestamp && <p className="mt-1 truncate font-b3">{node.timestamp}</p>}
    </article>
  );
}

function InteractiveAttackGraph({ graph }: { graph: CaseAttackGraph }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ pointerId: -1, x: 0, y: 0, originX: 0, originY: 0 });
  const layout = useMemo(() => buildGraphLayout(graph), [graph]);
  const [transform, setTransform] = useState<ViewportTransform>({ x: 24, y: 24, scale: 1 });
  const [dragging, setDragging] = useState(false);

  const fitGraph = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const scale = Math.min(1, Math.max(MIN_SCALE, Math.min((viewport.clientWidth - 48) / layout.width, (viewport.clientHeight - 48) / layout.height)));
    setTransform({
      scale,
      x: (viewport.clientWidth - layout.width * scale) / 2,
      y: (viewport.clientHeight - layout.height * scale) / 2,
    });
  }, [layout.height, layout.width]);

  useEffect(() => {
    fitGraph();
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(fitGraph);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [fitGraph]);

  const zoomAt = useCallback((nextScale: number, anchorX?: number, anchorY?: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setTransform((current) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
      const x = anchorX ?? viewport.clientWidth / 2;
      const y = anchorY ?? viewport.clientHeight / 2;
      const graphX = (x - current.x) / current.scale;
      const graphY = (y - current.y) / current.scale;
      return { scale, x: x - graphX * scale, y: y - graphY * scale };
    });
  }, []);

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const factor = event.deltaY > 0 ? 0.9 : 1.1;
    zoomAt(transform.scale * factor, event.clientX - bounds.left, event.clientY - bounds.top);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originX: transform.x, originY: transform.y };
    setDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current.pointerId !== event.pointerId) return;
    setTransform((current) => ({
      ...current,
      x: dragRef.current.originX + event.clientX - dragRef.current.x,
      y: dragRef.current.originY + event.clientY - dragRef.current.y,
    }));
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current.pointerId !== event.pointerId) return;
    dragRef.current.pointerId = -1;
    setDragging(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const movement = event.shiftKey ? 80 : 32;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-", "0"].includes(event.key)) event.preventDefault();
    if (event.key === "ArrowLeft") setTransform((value) => ({ ...value, x: value.x + movement }));
    if (event.key === "ArrowRight") setTransform((value) => ({ ...value, x: value.x - movement }));
    if (event.key === "ArrowUp") setTransform((value) => ({ ...value, y: value.y + movement }));
    if (event.key === "ArrowDown") setTransform((value) => ({ ...value, y: value.y - movement }));
    if (event.key === "+" || event.key === "=") zoomAt(transform.scale * 1.15);
    if (event.key === "-") zoomAt(transform.scale / 1.15);
    if (event.key === "0") fitGraph();
  };

  return (
    <div className="space-y-3">
      <div
        ref={viewportRef}
        role="application"
        tabIndex={0}
        aria-label="Interactive attack graph. Drag to move, use the mouse wheel or plus and minus buttons to zoom, and use Fit graph to reset the view."
        className={cn(
          "relative h-[520px] w-full touch-none overflow-hidden rounded-[3px] bg-[#606060] outline-none ring-primary-300 focus-visible:ring-3 md:h-[620px]",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={handleKeyDown}
      >
        <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-[4px] bg-background/95 p-1 shadow-md">
          <Button type="button" size="icon" title="Zoom out" aria-label="Zoom out" className="bg-neutral-200 text-neutral-1000 hover:bg-neutral-300" onClick={() => zoomAt(transform.scale / 1.2)}>
            <Minus aria-hidden="true" className="size-4" />
          </Button>
          <output aria-label="Current zoom" className="min-w-12 text-center font-b3 font-semibold text-neutral-1000">{Math.round(transform.scale * 100)}%</output>
          <Button type="button" size="icon" title="Zoom in" aria-label="Zoom in" className="bg-neutral-200 text-neutral-1000 hover:bg-neutral-300" onClick={() => zoomAt(transform.scale * 1.2)}>
            <Plus aria-hidden="true" className="size-4" />
          </Button>
          <Button type="button" size="icon" title="Fit graph" aria-label="Fit graph" className="bg-primary-600 text-white hover:bg-primary-700" onClick={fitGraph}>
            <Maximize2 aria-hidden="true" className="size-4" />
          </Button>
        </div>

        <div
          className="absolute left-0 top-0 origin-top-left will-change-transform"
          style={{ width: layout.width, height: layout.height, transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}
        >
          <svg aria-hidden="true" className="absolute inset-0 overflow-visible" width={layout.width} height={layout.height}>
            {graph.edges.map((edge, index) => {
              const source = layout.positions.get(edge.source);
              const target = layout.positions.get(edge.target);
              if (!source || !target) return null;
              const sourceIsLeft = source.x <= target.x;
              const x1 = sourceIsLeft ? source.x + NODE_WIDTH : source.x;
              const x2 = sourceIsLeft ? target.x : target.x + NODE_WIDTH;
              const y1 = source.y + NODE_HEIGHT / 2;
              const y2 = target.y + NODE_HEIGHT / 2;
              const controlOffset = Math.max(70, Math.abs(x2 - x1) * 0.45);
              const path = `M ${x1} ${y1} C ${x1 + (sourceIsLeft ? controlOffset : -controlOffset)} ${y1}, ${x2 + (sourceIsLeft ? -controlOffset : controlOffset)} ${y2}, ${x2} ${y2}`;
              const labelX = (x1 + x2) / 2;
              const labelY = (y1 + y2) / 2;
              const labelWidth = Math.max(78, edge.relation.length * 8 + 24);
              return (
                <g key={`${edge.source}-${edge.relation}-${edge.target}-${index}`}>
                  <path d={path} fill="none" stroke="#111111" strokeWidth="3" />
                  <rect x={labelX - labelWidth / 2} y={labelY - 14} width={labelWidth} height="28" rx="10" fill="#fdfdfd" stroke="#111111" strokeWidth="2" />
                  <text x={labelX} y={labelY + 4} textAnchor="middle" fill="#333333" fontSize="11" fontWeight="600" letterSpacing="1.1">{edge.relation.replaceAll("_", " ")}</text>
                </g>
              );
            })}
          </svg>
          {graph.nodes.map((node) => {
            const position = layout.positions.get(node.id);
            if (!position) return null;
            return <div key={node.id} style={{ position: "absolute", left: position.x, top: position.y }}><GraphNodeCard node={node} rootCause={node.id === layout.rootNodeId} /></div>;
          })}
        </div>

        <div className="pointer-events-none absolute bottom-3 left-3 z-20 flex items-center gap-2 rounded-[4px] bg-black-600/70 px-3 py-2 text-white">
          <Move aria-hidden="true" className="size-4" />
          <span className="font-b3">Drag to move · Scroll to zoom</span>
        </div>
      </div>
      <p className="font-b3 text-neutral-800">Keyboard: arrow keys move the graph, +/− zoom, and 0 fits all nodes.</p>
    </div>
  );
}

export const MANUAL_ATTACK_GRAPH_UNAVAILABLE =
  "Attack graph is unavailable for manual time-range investigations because the API only reconstructs graphs for lookback-derived cases.";

export default function AttackGraphPreview({ caseId, lookbackHours, expanded = false, manualTimeRange = false }: {
  caseId: string; lookbackHours?: number; expanded?: boolean; manualTimeRange?: boolean;
}) {
  const [graph, setGraph] = useState<CaseAttackGraph | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (manualTimeRange) return;
    let cancelled = false;
    getAttackGraph(caseId, lookbackHours).then((value) => {
      if (value.case_id !== caseId) throw new Error("The returned attack graph belongs to a different case.");
      if (!cancelled) setGraph(value);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason : new Error("Could not load the attack graph."));
    });
    return () => { cancelled = true; };
  }, [caseId, lookbackHours, attempt, manualTimeRange]);

  if (manualTimeRange) return <p className="font-b2 text-neutral-800">{MANUAL_ATTACK_GRAPH_UNAVAILABLE}</p>;
  if (error) return <ApiErrorView error={error} onRetry={() => { setError(null); setAttempt(attempt + 1); }} />;
  if (!graph) return <p role="status" className="flex items-center gap-2 py-8 font-b2"><LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />Loading attack graph…</p>;
  if (!graph.nodes.length) return <p className="py-8 font-b2 text-neutral-800">No graph evidence was returned for this case.</p>;

  if (expanded) {
    return (
      <div className="space-y-4">
        <div>
          <p className="font-h7 font-bold">{graph.nodes.length} nodes, {graph.edges.length} relationships</p>
          <p className="font-b1">Trace how the returned entities connect. The root cause is highlighted when provided by the backend.</p>
        </div>
        <InteractiveAttackGraph graph={graph} />
      </div>
    );
  }

  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges = graph.edges.slice(0, 3);
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
      {edges.map((edge, index) => <li key={`${edge.source}-${edge.relation}-${edge.target}-${index}`} className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        {renderNode(edge.source)}
        <div className="flex shrink-0 items-center justify-center gap-1 text-center text-[10px] text-neutral-800 sm:w-24 sm:flex-col"><span>{edge.relation.replaceAll("_", " ")}</span><ArrowRight aria-hidden="true" className="size-4" /></div>
        {renderNode(edge.target)}
      </li>)}
    </ul>
    {!edges.length && <div className="grid gap-2 sm:grid-cols-2">{graph.nodes.slice(0, 4).map((node) => <div key={node.id}>{renderNode(node.id)}</div>)}</div>}
    {graph.edges.length > edges.length && <p className="font-b3 text-neutral-800">{graph.edges.length - edges.length} more relationships in the full view.</p>}
  </div>;
}
