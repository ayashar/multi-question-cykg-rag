"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { LoaderCircle, Maximize2, Minus, Move, Plus, RotateCcw, Search, X } from "lucide-react";
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

const graphLegendItems = [
  { type: "alert", label: "Alert" },
  { type: "host", label: "Host / IP" },
  { type: "user", label: "User" },
  { type: "mitre_technique", label: "MITRE technique" },
] as const;

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

type GraphFilter = AttackGraphNode["type"] | "all";

interface GraphGroupMeta {
  memberIds: string[];
  startTime: string | null;
  endTime: string | null;
}

interface GraphDisplayModel {
  graph: CaseAttackGraph;
  groups: Map<string, GraphGroupMeta>;
  edgeCounts: Map<string, number>;
}

function edgeKey(edge: Pick<CaseAttackGraph["edges"][number], "source" | "target" | "relation">) {
  return `${edge.source}|${edge.relation}|${edge.target}`;
}

function formatNodeType(type: AttackGraphNode["type"]) {
  return type.replaceAll("_", " ");
}

function formatTimeRange(startTime: string | null, endTime: string | null) {
  if (!startTime) return "No timestamp";
  if (!endTime || startTime === endTime) return startTime;
  return `${startTime} → ${endTime}`;
}

export function createDisplayGraph(graph: CaseAttackGraph, groupAlerts: boolean): GraphDisplayModel {
  if (!groupAlerts) {
    return {
      graph,
      groups: new Map(),
      edgeCounts: new Map(graph.edges.map((edge) => [edgeKey(edge), 1])),
    };
  }

  const neighborContext = new Map<string, string[]>();
  for (const node of graph.nodes) neighborContext.set(node.id, []);
  for (const edge of graph.edges) {
    if (edge.relation === "PRECEDES") continue;
    if (neighborContext.has(edge.source)) neighborContext.get(edge.source)?.push(`${edge.relation}:${edge.target}`);
    if (neighborContext.has(edge.target)) neighborContext.get(edge.target)?.push(`${edge.relation}:${edge.source}`);
  }

  const alertGroups = new Map<string, AttackGraphNode[]>();
  for (const node of graph.nodes.filter((item) => item.type === "alert")) {
    const minute = node.timestamp?.slice(0, 16) ?? "unknown-time";
    const context = [...(neighborContext.get(node.id) ?? [])].sort().join(",");
    const key = [node.label, node.rule_level ?? "unknown-level", minute, context].join("|");
    const group = alertGroups.get(key) ?? [];
    group.push(node);
    alertGroups.set(key, group);
  }

  const nodeToGroup = new Map<string, string>();
  const groups = new Map<string, GraphGroupMeta>();
  const groupedNodes: AttackGraphNode[] = [];
  let groupIndex = 0;
  for (const members of alertGroups.values()) {
    if (members.length < 2) {
      groupedNodes.push(members[0]);
      continue;
    }
    const groupId = `alert-group:${groupIndex}`;
    groupIndex += 1;
    const timestamps = members.map((node) => node.timestamp).filter((timestamp): timestamp is string => Boolean(timestamp)).sort();
    const representative = members[0];
    groupedNodes.push({ ...representative, id: groupId });
    groups.set(groupId, {
      memberIds: members.map((node) => node.id),
      startTime: timestamps[0] ?? null,
      endTime: timestamps.at(-1) ?? null,
    });
    for (const member of members) nodeToGroup.set(member.id, groupId);
  }

  for (const node of graph.nodes) {
    if (node.type !== "alert") groupedNodes.push(node);
    else if (!nodeToGroup.has(node.id)) nodeToGroup.set(node.id, node.id);
  }

  const dedupedEdges = new Map<string, CaseAttackGraph["edges"][number]>();
  const edgeCounts = new Map<string, number>();
  for (const edge of graph.edges) {
    const mapped = {
      ...edge,
      source: nodeToGroup.get(edge.source) ?? edge.source,
      target: nodeToGroup.get(edge.target) ?? edge.target,
    };
    if (mapped.source === mapped.target) continue;
    const key = edgeKey(mapped);
    if (!dedupedEdges.has(key)) dedupedEdges.set(key, mapped);
    edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
  }

  const rootCause = graph.root_cause_alert_id
    ? nodeToGroup.get(`alert:${graph.root_cause_alert_id}`) ?? nodeToGroup.get(graph.root_cause_alert_id) ?? graph.root_cause_alert_id
    : null;

  return {
    graph: {
      ...graph,
      nodes: groupedNodes,
      edges: [...dedupedEdges.values()],
      root_cause_alert_id: rootCause,
    },
    groups,
    edgeCounts,
  };
}

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
  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();
  for (const id of nodeIds) {
    outgoing.set(id, new Set());
    incoming.set(id, new Set());
  }
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    outgoing.get(edge.source)?.add(edge.target);
    incoming.get(edge.target)?.add(edge.source);
  }

  const levels = new Map<string, number>();
  if (rootNodeId) {
    const queue = [rootNodeId];
    levels.set(rootNodeId, 0);
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      const currentLevel = levels.get(current) ?? 0;
      for (const target of outgoing.get(current) ?? []) {
        if (levels.has(target)) continue;
        levels.set(target, currentLevel + 1);
        queue.push(target);
      }
      for (const source of incoming.get(current) ?? []) {
        if (levels.has(source)) continue;
        levels.set(source, currentLevel - 1);
        queue.push(source);
      }
    }
  }

  // Keep incoming relationships on the source side and outgoing relationships
  // on the target side so opposite-looking arrows cannot read as bidirectional.
  const minimumLevel = Math.min(0, ...levels.values());
  for (const [nodeId, level] of levels) levels.set(nodeId, level - minimumLevel);

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

function GraphNodeCard({
  node,
  rootCause,
  groupMeta,
  selected = false,
  dimmed = false,
  dragging = false,
  onSelect,
}: {
  node: AttackGraphNode;
  rootCause: boolean;
  groupMeta?: GraphGroupMeta;
  selected?: boolean;
  dimmed?: boolean;
  dragging?: boolean;
  onSelect?: (nodeId: string) => void;
}) {
  const interactive = Boolean(onSelect);
  const alertCount = groupMeta?.memberIds.length ?? 1;

  return (
    <article
      data-graph-node-id={node.id}
      aria-label={`${formatNodeType(node.type)} ${node.label}${rootCause ? ", root cause" : ""}${alertCount > 1 ? `, ${alertCount} alerts` : ""}`}
      aria-pressed={interactive ? selected : undefined}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? () => onSelect?.(node.id) : undefined}
      onKeyDown={interactive ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect?.(node.id);
        }
      } : undefined}
      className={cn(
        "absolute flex flex-col justify-center rounded-[10px] border-3 px-4 py-3 shadow-sm outline-none transition-opacity focus-visible:ring-3 focus-visible:ring-primary-300",
        nodeColors[node.type] ?? "border-neutral-400 bg-neutral-100 text-neutral-1000",
        rootCause && "ring-2 ring-red-200 ring-offset-2 ring-offset-[#606060]",
        selected && "ring-3 ring-primary-300 ring-offset-2 ring-offset-[#606060]",
        interactive && "cursor-grab",
        dragging && "cursor-grabbing",
        dimmed && "opacity-20",
      )}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
    >
      <div className="flex items-center justify-between gap-3 font-b4 font-medium uppercase tracking-wide opacity-80">
        <span>{formatNodeType(node.type)}</span>
        {rootCause && <span>Root cause</span>}
      </div>
      <p className="mt-2 line-clamp-2 text-lg font-bold leading-tight wrap-anywhere">{node.label}</p>
      {groupMeta ? (
        <p className="mt-1 truncate font-b3">{alertCount} alerts · {formatTimeRange(groupMeta.startTime, groupMeta.endTime)}</p>
      ) : node.timestamp ? (
        <p className="mt-1 truncate font-b3">{node.timestamp}</p>
      ) : null}
    </article>
  );
}

function GraphPlane({
  graph,
  layout,
  positions = layout.positions,
  groups = new Map(),
  edgeCounts = new Map(),
  selectedNodeId = null,
  activeNodeIds,
  draggingNodeId = null,
  onSelectNode,
}: {
  graph: CaseAttackGraph;
  layout: GraphLayout;
  positions?: Map<string, Position>;
  groups?: Map<string, GraphGroupMeta>;
  edgeCounts?: Map<string, number>;
  selectedNodeId?: string | null;
  activeNodeIds?: Set<string>;
  draggingNodeId?: string | null;
  onSelectNode?: (nodeId: string) => void;
}) {
  const hasSelection = Boolean(selectedNodeId);
  const showAllLabels = graph.edges.length <= 24 && !hasSelection;

  return (
    <div className="absolute left-0 top-0 origin-top-left will-change-transform" style={{ width: layout.width, height: layout.height }}>
      <svg aria-hidden="true" className="absolute inset-0 overflow-visible" width={layout.width} height={layout.height}>
        <defs>
          <marker id="attack-graph-arrow" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto" markerUnits="strokeWidth">
            <path d="M 0 0 L 8 4 L 0 8 Z" fill="#111111" />
          </marker>
        </defs>
        {graph.edges.map((edge, index) => {
          const source = positions.get(edge.source);
          const target = positions.get(edge.target);
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
          const connectedToSelection = !selectedNodeId || edge.source === selectedNodeId || edge.target === selectedNodeId;
          const edgeIsActive = !activeNodeIds || (activeNodeIds.has(edge.source) && activeNodeIds.has(edge.target));
          const edgeOpacity = connectedToSelection && edgeIsActive ? 1 : 0.18;
          const count = edgeCounts.get(edgeKey(edge)) ?? 1;
          const relationLabel = `${edge.relation.replaceAll("_", " ")}${count > 1 ? ` ×${count}` : ""}`;
          const labelWidth = Math.max(78, relationLabel.length * 8 + 24);
          const showLabel = (showAllLabels || connectedToSelection) && edgeIsActive;
          return (
            <g key={`${edge.source}-${edge.relation}-${edge.target}-${index}`} opacity={edgeOpacity}>
              <path d={path} fill="none" stroke="#111111" strokeWidth={connectedToSelection ? "3" : "2"} markerEnd="url(#attack-graph-arrow)" />
              {showLabel && <>
                <rect x={labelX - labelWidth / 2} y={labelY - 14} width={labelWidth} height="28" rx="10" fill="#fdfdfd" stroke="#111111" strokeWidth="2" />
                <text x={labelX} y={labelY + 4} textAnchor="middle" fill="#333333" fontSize="11" fontWeight="600" letterSpacing="1.1">{relationLabel}</text>
              </>}
            </g>
          );
        })}
      </svg>
      {graph.nodes.map((node) => {
        const position = positions.get(node.id);
        if (!position) return null;
        return <div key={node.id} style={{ position: "absolute", left: position.x, top: position.y }}>
          <GraphNodeCard
            node={node}
            rootCause={node.id === layout.rootNodeId}
            groupMeta={groups.get(node.id)}
            selected={node.id === selectedNodeId}
            dimmed={Boolean(activeNodeIds && !activeNodeIds.has(node.id))}
            dragging={node.id === draggingNodeId}
            onSelect={onSelectNode}
          />
        </div>;
      })}
    </div>
  );
}

function GraphLegend() {
  return (
    <section aria-labelledby="attack-graph-legend" className="rounded-[4px] border border-neutral-300 bg-background p-3">
      <h3 id="attack-graph-legend" className="font-b3 font-semibold uppercase tracking-wide text-neutral-800">Graph legend</h3>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-2 font-b3 text-neutral-800">
        {graphLegendItems.map((item) => (
          <li key={item.type} className="flex items-center gap-2">
            <span aria-hidden="true" className={cn("size-4 rounded border-2", nodeColors[item.type])} />
            <span>{item.label}</span>
          </li>
        ))}
        <li className="flex items-center gap-2">
          <svg aria-hidden="true" className="h-3 w-7" viewBox="0 0 28 12" focusable="false">
            <path d="M 1 6 H 22" fill="none" stroke="#111111" strokeWidth="2" />
            <path d="M 21 2 L 27 6 L 21 10 Z" fill="#111111" />
          </svg>
          <span>Relationship (source → target)</span>
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="size-4 rounded border-2 border-red-200 ring-2 ring-red-200 ring-offset-1" />
          <span>Root cause</span>
        </li>
      </ul>
    </section>
  );
}

function GraphDetailPanel({
  graph,
  selectedNodeId,
  groups,
  edgeCounts,
  onClose,
}: {
  graph: CaseAttackGraph;
  selectedNodeId: string;
  groups: Map<string, GraphGroupMeta>;
  edgeCounts: Map<string, number>;
  onClose: () => void;
}) {
  const node = graph.nodes.find((item) => item.id === selectedNodeId);
  if (!node) return null;
  const group = groups.get(node.id);
  const relationships = graph.edges.filter((edge) => edge.source === node.id || edge.target === node.id);

  return (
    <aside aria-label="Selected graph node details" className="rounded-[4px] border border-primary-300 bg-primary-100 p-4 text-primary-1000">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-b4 font-semibold uppercase tracking-wide text-primary-700">Selected {formatNodeType(node.type)}</p>
          <h3 className="mt-1 font-h7 font-bold wrap-anywhere">{node.label}</h3>
        </div>
        <Button type="button" size="icon" variant="secondary" aria-label="Close selected node details" title="Close details" onClick={onClose}>
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>
      <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <div><dt className="font-semibold text-primary-700">Node ID</dt><dd className="break-all font-mono">{node.id}</dd></div>
        <div><dt className="font-semibold text-primary-700">Severity</dt><dd>{node.rule_level ?? "Not available"}</dd></div>
        <div className="sm:col-span-2"><dt className="font-semibold text-primary-700">Timestamp</dt><dd>{group ? `${group.memberIds.length} alerts · ${formatTimeRange(group.startTime, group.endTime)}` : node.timestamp ?? "Not available"}</dd></div>
      </dl>
      {group && <div className="mt-3 rounded-[3px] bg-background/70 p-3 text-sm"><p className="font-semibold">Grouped alert IDs</p><p className="mt-1 break-all font-mono">{group.memberIds.slice(0, 8).join(", ")}{group.memberIds.length > 8 ? ` … +${group.memberIds.length - 8} more` : ""}</p></div>}
      <div className="mt-3">
        <p className="font-semibold">Relationships ({relationships.length})</p>
        <ul className="mt-1 space-y-1 text-sm">
          {relationships.slice(0, 8).map((edge) => <li key={edgeKey(edge)}>{edge.relation.replaceAll("_", " ")} {edgeCounts.get(edgeKey(edge)) && (edgeCounts.get(edgeKey(edge)) ?? 1) > 1 ? `×${edgeCounts.get(edgeKey(edge))}` : ""}</li>)}
          {relationships.length > 8 && <li>… {relationships.length - 8} more relationships</li>}
        </ul>
      </div>
    </aside>
  );
}

export function MiniAttackGraph({ graph }: { graph: CaseAttackGraph }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  const displayModel = useMemo(() => createDisplayGraph(graph, true), [graph]);
  const displayGraph = displayModel.graph;
  const layout = useMemo(() => buildGraphLayout(displayGraph), [displayGraph]);
  const rootNode = displayGraph.nodes.find((node) => node.id === layout.rootNodeId);

  const positionPreview = useCallback(() => {
    const viewport = viewportRef.current;
    const plane = planeRef.current;
    if (!viewport || !plane) return;
    const rootPosition = layout.rootNodeId ? layout.positions.get(layout.rootNodeId) : undefined;
    const focus = rootPosition ?? { x: layout.width / 2 - NODE_WIDTH / 2, y: layout.height / 2 - NODE_HEIGHT / 2 };
    const scale = Math.min(0.52, Math.max(0.32, viewport.clientWidth / 1100));
    const x = viewport.clientWidth * 0.28 - (focus.x + NODE_WIDTH / 2) * scale;
    const y = viewport.clientHeight / 2 - (focus.y + NODE_HEIGHT / 2) * scale;
    plane.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  }, [layout.height, layout.positions, layout.rootNodeId, layout.width]);

  useEffect(() => {
    positionPreview();
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(positionPreview);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [positionPreview]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 font-b3 text-neutral-800">
        <p><span className="font-semibold">Root cause:</span> {rootNode?.label ?? "Not available"}</p>
        <p>{graph.nodes.length} nodes · {graph.edges.length} relationships</p>
      </div>
      <div
        ref={viewportRef}
        role="img"
        aria-label={`Attack graph preview with ${graph.nodes.length} nodes and ${graph.edges.length} relationships. Open the full graph to explore it.`}
        className="relative h-[260px] w-full overflow-hidden rounded-[3px] bg-[#606060]"
      >
        <div ref={planeRef} className="pointer-events-none absolute left-0 top-0 origin-top-left" style={{ width: layout.width, height: layout.height }}>
          <GraphPlane graph={displayGraph} layout={layout} groups={displayModel.groups} edgeCounts={displayModel.edgeCounts} />
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black-600/75 to-transparent px-3 pb-3 pt-10 text-white">
          <p className="font-b3">Preview · Open the full graph to zoom, move, and inspect nodes</p>
        </div>
      </div>
      <GraphLegend />
    </div>
  );
}

interface GraphDragState {
  pointerId: number;
  mode: "idle" | "canvas" | "node";
  nodeId: string | null;
  x: number;
  y: number;
  originX: number;
  originY: number;
}

function InteractiveAttackGraph({ graph }: { graph: CaseAttackGraph }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<GraphDragState>({ pointerId: -1, mode: "idle", nodeId: null, x: 0, y: 0, originX: 0, originY: 0 });
  const [groupAlerts, setGroupAlerts] = useState(true);
  const displayModel = useMemo(() => createDisplayGraph(graph, groupAlerts), [graph, groupAlerts]);
  const displayGraph = displayModel.graph;
  const layout = useMemo(() => buildGraphLayout(displayGraph), [displayGraph]);
  const [nodePositions, setNodePositions] = useState<Map<string, Position>>(() => new Map(layout.positions));
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<GraphFilter>("all");
  const [focusMode, setFocusMode] = useState(false);
  const [transform, setTransform] = useState<ViewportTransform>({ x: 24, y: 24, scale: 1 });
  const transformRef = useRef(transform);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [draggingCanvas, setDraggingCanvas] = useState(false);

  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setNodePositions(new Map(layout.positions));
      setSelectedNodeId(null);
      setFocusMode(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [layout]);

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

  const nodeMatches = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return new Set(displayGraph.nodes.filter((node) => {
      const groupText = displayModel.groups.get(node.id)?.memberIds.join(" ") ?? "";
      const searchable = `${node.id} ${node.label} ${groupText}`.toLowerCase();
      return (typeFilter === "all" || node.type === typeFilter) && (!normalizedQuery || searchable.includes(normalizedQuery));
    }).map((node) => node.id));
  }, [displayGraph.nodes, displayModel.groups, query, typeFilter]);

  const focusNodeIds = useMemo(() => {
    if (!focusMode) return null;
    const anchor = selectedNodeId ?? layout.rootNodeId;
    if (!anchor) return new Set<string>();
    const ids = new Set([anchor]);
    for (const edge of displayGraph.edges) {
      if (edge.source === anchor) ids.add(edge.target);
      if (edge.target === anchor) ids.add(edge.source);
    }
    return ids;
  }, [displayGraph.edges, focusMode, layout.rootNodeId, selectedNodeId]);

  const activeNodeIds = useMemo(() => {
    if (!focusNodeIds) return nodeMatches;
    return new Set([...nodeMatches].filter((nodeId) => focusNodeIds.has(nodeId)));
  }, [focusNodeIds, nodeMatches]);

  const selectedNode = selectedNodeId ? displayGraph.nodes.find((node) => node.id === selectedNodeId) : null;
  const handleNativeWheel = useCallback((event: globalThis.WheelEvent) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("button")) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = viewport.getBoundingClientRect();
    const sensitivity = event.ctrlKey ? 0.01 : 0.0025;
    const factor = Math.exp(-event.deltaY * sensitivity);
    zoomAt(transformRef.current.scale * factor, event.clientX - bounds.left, event.clientY - bounds.top);
  }, [zoomAt]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.addEventListener("wheel", handleNativeWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleNativeWheel);
  }, [handleNativeWheel]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button,input,select")) return;
    const nodeId = target.closest("[data-graph-node-id]")?.getAttribute("data-graph-node-id") ?? null;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (nodeId) {
      const position = nodePositions.get(nodeId) ?? layout.positions.get(nodeId);
      if (!position) return;
      dragRef.current = { pointerId: event.pointerId, mode: "node", nodeId, x: event.clientX, y: event.clientY, originX: position.x, originY: position.y };
      setSelectedNodeId(nodeId);
      setDraggingNodeId(nodeId);
      return;
    }
    dragRef.current = { pointerId: event.pointerId, mode: "canvas", nodeId: null, x: event.clientX, y: event.clientY, originX: transform.x, originY: transform.y };
    setDraggingCanvas(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    if (drag.mode === "node" && drag.nodeId) {
      const rawX = drag.originX + (event.clientX - drag.x) / transform.scale;
      const rawY = drag.originY + (event.clientY - drag.y) / transform.scale;
      const columnXs = [...new Set([...layout.positions.values()].map((position) => position.x))];
      const snappedX = columnXs.reduce((closest, x) => Math.abs(x - rawX) < Math.abs(closest - rawX) ? x : closest, columnXs[0] ?? rawX);
      const nextY = Math.max(PLANE_PADDING, Math.min(layout.height - NODE_HEIGHT - PLANE_PADDING, rawY));
      setNodePositions((current) => new Map(current).set(drag.nodeId!, { x: snappedX, y: nextY }));
      return;
    }
    if (drag.mode === "canvas") {
      setTransform((current) => ({
        ...current,
        x: drag.originX + event.clientX - drag.x,
        y: drag.originY + event.clientY - drag.y,
      }));
    }
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = { pointerId: -1, mode: "idle", nodeId: null, x: 0, y: 0, originX: 0, originY: 0 };
    setDraggingNodeId(null);
    setDraggingCanvas(false);
  };

  const moveSelectedNode = (dx: number, dy: number) => {
    if (!selectedNodeId) return;
    setNodePositions((current) => {
      const position = current.get(selectedNodeId) ?? layout.positions.get(selectedNodeId);
      if (!position) return current;
      const next = {
        x: Math.max(PLANE_PADDING, Math.min(layout.width - NODE_WIDTH - PLANE_PADDING, position.x + dx)),
        y: Math.max(PLANE_PADDING, Math.min(layout.height - NODE_HEIGHT - PLANE_PADDING, position.y + dy)),
      };
      return new Map(current).set(selectedNodeId, next);
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const movement = event.shiftKey ? 80 : 32;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-", "0", "Escape"].includes(event.key)) event.preventDefault();
    if (event.key === "Escape") {
      setSelectedNodeId(null);
      setFocusMode(false);
    } else if (event.key === "ArrowLeft") {
      if (selectedNodeId) moveSelectedNode(-movement, 0);
      else setTransform((value) => ({ ...value, x: value.x + movement }));
    } else if (event.key === "ArrowRight") {
      if (selectedNodeId) moveSelectedNode(movement, 0);
      else setTransform((value) => ({ ...value, x: value.x - movement }));
    } else if (event.key === "ArrowUp") {
      if (selectedNodeId) moveSelectedNode(0, -movement);
      else setTransform((value) => ({ ...value, y: value.y + movement }));
    } else if (event.key === "ArrowDown") {
      if (selectedNodeId) moveSelectedNode(0, movement);
      else setTransform((value) => ({ ...value, y: value.y - movement }));
    }
    else if (event.key === "+" || event.key === "=") zoomAt(transform.scale * 1.15);
    else if (event.key === "-") zoomAt(transform.scale / 1.15);
    else if (event.key === "0") fitGraph();
  };

  const resetLayout = () => {
    setNodePositions(new Map(layout.positions));
    setSelectedNodeId(null);
    setFocusMode(false);
    fitGraph();
  };

  return (
    <div className="space-y-3">
      <div className="space-y-3 rounded-[4px] border border-neutral-300 bg-background p-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-52 flex-1">
            <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-neutral-700" />
            <span className="sr-only">Search graph</span>
            <input aria-label="Search graph" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search alert, host, IP, or technique" className="w-full rounded-[3px] border border-neutral-300 bg-background py-2 pl-9 pr-3 font-b3 text-neutral-1000 outline-none focus-visible:ring-3 focus-visible:ring-primary-300" />
          </label>
          <label>
            <span className="sr-only">Filter graph by node type</span>
            <select aria-label="Filter graph by node type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as GraphFilter)} className="rounded-[3px] border border-neutral-300 bg-background px-3 py-2 font-b3 text-neutral-1000 outline-none focus-visible:ring-3 focus-visible:ring-primary-300">
              <option value="all">All node types</option>
              <option value="alert">Alerts</option>
              <option value="host">Hosts</option>
              <option value="ip">IP addresses</option>
              <option value="user">Users</option>
              <option value="mitre_technique">MITRE techniques</option>
            </select>
          </label>
          <Button type="button" variant={groupAlerts ? "primary" : "secondary"} aria-pressed={groupAlerts} onClick={() => setGroupAlerts((value) => !value)}>
            {groupAlerts ? "Grouped alerts" : "Individual alerts"}
          </Button>
          <Button type="button" variant="secondary" disabled={!selectedNodeId && !layout.rootNodeId} onClick={() => { if (!selectedNodeId) setSelectedNodeId(layout.rootNodeId); setFocusMode(true); }}>
            Focus {selectedNodeId ? "selection" : "root"}
          </Button>
          <Button type="button" variant="secondary" onClick={resetLayout}>
            <RotateCcw aria-hidden="true" className="size-4" />Reset layout
          </Button>
        </div>
        <p role="status" className="font-b3 text-neutral-800">Showing {activeNodeIds.size} of {displayGraph.nodes.length} visible nodes · {groupAlerts ? "repeated alerts are grouped" : "individual alerts are shown"}</p>
      </div>

      <div
        ref={viewportRef}
        role="application"
        tabIndex={0}
        aria-label="Interactive attack graph. Drag nodes to reposition them, drag empty space to pan, use the mouse wheel, trackpad pinch, or plus and minus buttons to zoom, and use Fit graph or Reset layout to restore the view."
        className={cn(
          "relative h-[520px] w-full touch-none overscroll-contain overflow-hidden rounded-[3px] bg-[#606060] outline-none ring-primary-300 focus-visible:ring-3 md:h-[620px]",
          draggingNodeId || draggingCanvas ? "cursor-grabbing" : "cursor-grab",
        )}
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
          <GraphPlane graph={displayGraph} layout={layout} positions={nodePositions} groups={displayModel.groups} edgeCounts={displayModel.edgeCounts} selectedNodeId={selectedNodeId} activeNodeIds={activeNodeIds} draggingNodeId={draggingNodeId} onSelectNode={setSelectedNodeId} />
        </div>

        <div className="pointer-events-none absolute bottom-3 left-3 z-20 flex items-center gap-2 rounded-[4px] bg-black-600/70 px-3 py-2 text-white">
          <Move aria-hidden="true" className="size-4" />
          <span className="font-b3">Drag node to reposition · Drag empty space to pan · Wheel or trackpad pinch to zoom</span>
        </div>
      </div>

      {selectedNode && <GraphDetailPanel graph={displayGraph} selectedNodeId={selectedNode.id} groups={displayModel.groups} edgeCounts={displayModel.edgeCounts} onClose={() => setSelectedNodeId(null)} />}
      <GraphLegend />
      <p className="font-b3 text-neutral-800">Keyboard: select a node, then arrow keys move it; without a selection they pan the graph. Press +/− to zoom, 0 to fit, and Escape to clear selection.</p>
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

  return <MiniAttackGraph graph={graph} />;
}
