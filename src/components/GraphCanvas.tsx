"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  MiniMap,
  Background,
  BackgroundVariant,
  useReactFlow,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { RotateCcw, AlertCircle } from "lucide-react";

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Types                                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

interface ApiNode {
  id: string;
  type: string;
  label: string;
  data: Record<string, unknown>;
}

interface ApiEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}

interface ApiResponse {
  nodes: ApiNode[];
  edges: ApiEdge[];
}

export interface GraphCanvasProps {
  onNodeInspect: (nodeType: string, nodeId: string) => void;
  highlightNodes?: string[];
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Constants                                                                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

const TYPE_COLORS: Record<string, string> = {
  sales_order: "#3B82F6",
  delivery: "#10B981",
  billing_document: "#F59E0B",
  journal_entry: "#8B5CF6",
  payment: "#06B6D4",
  customer: "#6B7280",
  product: "#EC4899",
  plant: "#84CC16",
};

const TYPE_LABELS: Record<string, string> = {
  sales_order: "Sales Order",
  delivery: "Delivery",
  billing_document: "Billing Document",
  journal_entry: "Journal Entry",
  payment: "Payment",
  customer: "Customer",
  product: "Product",
  plant: "Plant",
};

const KEY_METRIC: Record<string, string> = {
  sales_order: "total_net_amount",
  delivery: "overall_goods_movement_status",
  billing_document: "total_net_amount",
  journal_entry: "amount_in_transaction_currency",
  payment: "amount_in_transaction_currency",
  customer: "business_partner_full_name",
  product: "product",
  plant: "plant_name",
};

const DEFAULT_EDGE_OPTIONS = {
  type: "straight" as const,
  animated: false,
  style: { stroke: "#64748b", strokeWidth: 1.2, opacity: 0.5 },
  labelStyle: { fontSize: 9, fill: "#475569", fontWeight: 500 },
  labelBgStyle: { fill: "#ffffff", fillOpacity: 0.92, stroke: "#e2e8f0", strokeWidth: 0.5, rx: 4, ry: 4 },
  labelBgPadding: [6, 3] as [number, number],
};

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Helpers                                                                   */
/* ═══════════════════════════════════════════════════════════════════════════ */

async function fetchGraphApi(query?: string): Promise<ApiResponse | null> {
  try {
    const url = query ? `/api/graph?${query}` : "/api/graph";
    const res = await fetch(url);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function parseNodeId(id: string): [string, string] | null {
  const idx = id.indexOf(":");
  if (idx === -1) return null;
  return [id.slice(0, idx), id.slice(idx + 1)];
}

let _edgeUid = 0;

function makeEdgeId(): string {
  return `ge-${++_edgeUid}-${Date.now().toString(36)}`;
}

function edgeSig(source: string, target: string): string {
  return source < target ? `${source}\u2192${target}` : `${target}\u2192${source}`;
}

function apiNodeToRfNode(
  n: ApiNode,
  position: { x: number; y: number },
): Node {
  if (n.type === "cluster") {
    const entityType = (n.data.entityType as string) ?? "";
    return {
      id: n.id,
      type: "cluster",
      position,
      data: {
        label: n.label,
        count: n.data.count,
        entityType,
        color: TYPE_COLORS[entityType] ?? "#6B7280",
        highlighted: false,
      },
    };
  }

  const entityType = n.type;
  const color = TYPE_COLORS[entityType] ?? "#6B7280";
  const metricKey = KEY_METRIC[entityType];
  const metricValue = metricKey ? (n.data[metricKey] ?? null) : null;

  return {
    id: n.id,
    type: "entity",
    position,
    data: {
      label: n.label,
      entityType,
      color,
      metricValue,
      highlighted: false,
    },
  };
}

function layoutAroundPoint(apiNodes: ApiNode[], cx: number, cy: number): Node[] {
  const count = apiNodes.length;
  if (count === 0) return [];

  const baseRadius = 200;
  const ringGap = 120;
  const perRing = 14;

  return apiNodes.map((n, i) => {
    const ringIdx = Math.floor(i / perRing);
    const posInRing = i % perRing;
    const nodesInThisRing = Math.min(perRing, count - ringIdx * perRing);
    const radius = baseRadius + ringIdx * ringGap;
    const offsetAngle = ringIdx * 0.25;
    const angle = offsetAngle + (2 * Math.PI * posInRing) / nodesInThisRing - Math.PI / 2;
    return apiNodeToRfNode(n, {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  });
}

function toRfEdges(apiEdges: ApiEdge[], existingEdgeSigs: Set<string>): Edge[] {
  return apiEdges
    .filter((e) => !existingEdgeSigs.has(edgeSig(e.source, e.target)))
    .map((e) => ({
      id: makeEdgeId(),
      source: e.source,
      target: e.target,
      label: e.label,
    }));
}

function resolveLayout(
  allNodes: Node[],
  centerId: string,
  childIds: Set<string>,
): Node[] {
  const center = allNodes.find((n) => n.id === centerId);
  if (!center) return allNodes;

  const cx = center.position.x;
  const cy = center.position.y;

  let maxChildDist = 0;
  for (const n of allNodes) {
    if (!childIds.has(n.id)) continue;
    const dist = Math.hypot(n.position.x - cx, n.position.y - cy);
    maxChildDist = Math.max(maxChildDist, dist);
  }

  const safeRadius = maxChildDist + 100;

  return allNodes.map((n) => {
    if (n.id === centerId || childIds.has(n.id)) return n;

    const dx = n.position.x - cx;
    const dy = n.position.y - cy;
    const dist = Math.hypot(dx, dy);

    if (dist < safeRadius) {
      if (dist < 1) {
        const angle = Math.random() * 2 * Math.PI;
        return {
          ...n,
          position: {
            x: cx + safeRadius * Math.cos(angle),
            y: cy + safeRadius * Math.sin(angle),
          },
        };
      }
      const scale = safeRadius / dist;
      return {
        ...n,
        position: {
          x: cx + dx * scale,
          y: cy + dy * scale,
        },
      };
    }
    return n;
  });
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Custom node: Cluster                                                      */
/* ═══════════════════════════════════════════════════════════════════════════ */

function ClusterNode({ data, selected }: NodeProps) {
  const color = (data as Record<string, unknown>).color as string;
  const highlighted = (data as Record<string, unknown>).highlighted as boolean;
  const count = (data as Record<string, unknown>).count as number;
  const label = (data as Record<string, unknown>).label as string;
  const active = highlighted || selected;

  return (
    <div
      className="graph-sphere"
      style={{
        width: 120,
        height: 120,
        borderRadius: "50%",
        background: `radial-gradient(circle at 30% 25%, rgba(255,255,255,0.4) 0%, ${color}B3 22%, ${color}99 55%, ${color}66 100%)`,
        border: `1.5px solid ${color}70`,
        boxShadow: active
          ? `0 0 36px ${color}70, 0 0 72px ${color}35, inset 0 0 18px rgba(255,255,255,0.2)`
          : `0 0 20px ${color}40, 0 0 40px ${color}18, inset 0 0 14px rgba(255,255,255,0.15)`,
        display: "flex",
        flexDirection: "column" as const,
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
        transform: active ? "scale(1.1)" : "scale(1)",
        backdropFilter: "blur(4px)",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} id="tl" style={{ opacity: 0 }} />
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: "#fff",
          lineHeight: 1.2,
          textShadow: "0 1px 8px rgba(0,0,0,0.25)",
        }}
      >
        {count}
      </div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: "rgba(255,255,255,0.92)",
          textShadow: "0 1px 4px rgba(0,0,0,0.2)",
          textAlign: "center",
          lineHeight: 1.2,
          maxWidth: 96,
          marginTop: 2,
        }}
      >
        {label}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} id="sr" style={{ opacity: 0 }} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Custom node: Entity                                                       */
/* ═══════════════════════════════════════════════════════════════════════════ */

function EntityNode({ data, selected }: NodeProps) {
  const color = (data as Record<string, unknown>).color as string;
  const highlighted = (data as Record<string, unknown>).highlighted as boolean;
  const label = (data as Record<string, unknown>).label as string;
  const active = highlighted || selected;

  return (
    <div
      className="graph-sphere"
      style={{
        width: 72,
        height: 72,
        borderRadius: "50%",
        background: `radial-gradient(circle at 30% 25%, rgba(255,255,255,0.35) 0%, ${color}A6 22%, ${color}80 55%, ${color}55 100%)`,
        border: `1.5px solid ${color}60`,
        boxShadow: active
          ? `0 0 24px ${color}60, 0 0 48px ${color}28, inset 0 0 12px rgba(255,255,255,0.2)`
          : `0 0 14px ${color}35, 0 0 28px ${color}12, inset 0 0 10px rgba(255,255,255,0.12)`,
        display: "flex",
        flexDirection: "column" as const,
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
        transform: active ? "scale(1.12)" : "scale(1)",
        backdropFilter: "blur(3px)",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left} id="tl" style={{ opacity: 0 }} />
      <div
        style={{
          fontSize: 8.5,
          fontWeight: 600,
          color: "rgba(255,255,255,0.95)",
          textShadow: "0 1px 4px rgba(0,0,0,0.3)",
          textAlign: "center",
          lineHeight: 1.15,
          maxWidth: 58,
          overflow: "hidden",
          textOverflow: "ellipsis",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical" as const,
        }}
      >
        {label}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} id="sr" style={{ opacity: 0 }} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Node type registry (stable reference — defined outside component)         */
/* ═══════════════════════════════════════════════════════════════════════════ */

const nodeTypes: NodeTypes = {
  cluster: ClusterNode,
  entity: EntityNode,
};

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Legend                                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

function GraphLegend({ entityTypes }: { entityTypes: string[] }) {
  if (entityTypes.length === 0) return null;

  return (
    <div className="absolute bottom-3 left-3 z-10 flex items-center gap-3 rounded-full border border-white/40 bg-white/50 backdrop-blur-md px-4 py-2 shadow-sm">
      {entityTypes.map((et) => {
        const c = TYPE_COLORS[et] ?? "#6B7280";
        return (
          <div key={et} className="flex items-center gap-1.5">
            <span
              className="h-3 w-3 rounded-full shrink-0"
              style={{
                background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.3), ${c}CC 50%, ${c}80 100%)`,
                boxShadow: `0 0 6px ${c}60`,
              }}
            />
            <span className="text-[11px] text-muted-foreground font-medium">
              {TYPE_LABELS[et] ?? et}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Skeleton loader                                                           */
/* ═══════════════════════════════════════════════════════════════════════════ */

const SKELETON_POSITIONS = [
  { x: 50, y: 20 }, { x: 20, y: 45 }, { x: 80, y: 45 },
  { x: 35, y: 75 }, { x: 65, y: 75 },
];

function GraphSkeleton() {
  return (
    <div className="flex items-center justify-center h-full w-full">
      <div className="relative w-72 h-56">
        {SKELETON_POSITIONS.map((pos, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-muted/40 animate-pulse"
            style={{
              left: `${pos.x}%`,
              top: `${pos.y}%`,
              width: 56,
              height: 56,
              transform: "translate(-50%, -50%)",
              animationDelay: `${i * 0.15}s`,
              boxShadow: "0 0 20px rgba(0,0,0,0.04)",
            }}
          />
        ))}
        <p className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-xs text-muted-foreground whitespace-nowrap">
          Loading graph…
        </p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Error state                                                               */
/* ═══════════════════════════════════════════════════════════════════════════ */

function GraphError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full w-full gap-3 text-center px-8">
      <AlertCircle className="size-8 text-muted-foreground/60" />
      <div>
        <p className="text-sm font-medium text-foreground">
          Unable to load graph
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Something went wrong while fetching the graph data.
        </p>
      </div>
      <button
        onClick={onRetry}
        className="flex items-center gap-1.5 rounded-lg border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors mt-1"
      >
        <RotateCcw className="size-3.5" />
        Retry
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Inner component (must be inside ReactFlowProvider)                        */
/* ═══════════════════════════════════════════════════════════════════════════ */

function GraphCanvasInner({ onNodeInspect, highlightNodes = [] }: GraphCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [visibleTypes, setVisibleTypes] = useState<string[]>([]);
  const expandedClusters = useRef(new Set<string>());
  const expandedEntities = useRef(new Set<string>());
  const clusterChildren = useRef(new Map<string, string[]>());
  const initialData = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const fetchIdRef = useRef(0);
  const { fitView, getNodes, getEdges } = useReactFlow();

  /* ── Fetch graph data ──────────────────────────────────────────────────── */

  const loadGraph = useCallback(() => {
    const id = ++fetchIdRef.current;
    setLoading(true);
    setError(false);

    fetchGraphApi().then((resp) => {
      if (id !== fetchIdRef.current) return;

      if (!resp) {
        setLoading(false);
        setError(true);
        return;
      }

      const cx = 400;
      const cy = 300;
      const radius = 250;
      const count = resp.nodes.length;

      const rfNodes: Node[] = resp.nodes.map((n, i) => {
        const angle = (2 * Math.PI * i) / count - Math.PI / 2;
        return apiNodeToRfNode(n, {
          x: cx + radius * Math.cos(angle),
          y: cy + radius * Math.sin(angle),
        });
      });

      const rfEdges: Edge[] = resp.edges.map((e) => ({
        id: makeEdgeId(),
        source: e.source,
        target: e.target,
        label: e.label,
      }));

      initialData.current = { nodes: rfNodes, edges: rfEdges };
      expandedClusters.current.clear();
      expandedEntities.current.clear();

      const types = [...new Set(resp.nodes.map((n) => (n.data.entityType as string) ?? n.type))].filter(Boolean);
      setVisibleTypes(types);

      setNodes(rfNodes);
      setEdges(rfEdges);
      setLoading(false);
      setTimeout(() => fitView({ padding: 0.2 }), 50);
    });
  }, [setNodes, setEdges, fitView]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadGraph(); }, []);

  /* ── Sync highlight prop → node data ───────────────────────────────────── */

  useEffect(() => {
    const hlSet = new Set(highlightNodes);
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: { ...n.data, highlighted: hlSet.has(n.id) },
      })),
    );
  }, [highlightNodes, setNodes]);

  /* ── Reset to cluster view ─────────────────────────────────────────────── */

  const handleResetView = useCallback(() => {
    if (!initialData.current) return;
    expandedClusters.current.clear();
    expandedEntities.current.clear();
    clusterChildren.current.clear();
    setNodes(initialData.current.nodes);
    setEdges(initialData.current.edges);
    setTimeout(() => fitView({ padding: 0.2, duration: 400 }), 50);
  }, [setNodes, setEdges, fitView]);

  /* ── Toggle-expand cluster / expand entity ─────────────────────────────── */

  const onNodeClick = useCallback(
    async (_event: ReactMouseEvent, node: Node) => {
      /* ── Cluster: toggle expand / collapse ─────────────────────────────── */
      if (node.type === "cluster") {
        const entityType = node.data.entityType as string;

        if (expandedClusters.current.has(entityType)) {
          expandedClusters.current.delete(entityType);
          const childIds = new Set(clusterChildren.current.get(node.id) ?? []);
          clusterChildren.current.delete(node.id);
          for (const id of childIds) expandedEntities.current.delete(id);

          const curNodes = getNodes();
          const curEdges = getEdges();

          setNodes(curNodes.filter((n) => !childIds.has(n.id)));
          setEdges(
            curEdges.filter(
              (e) => !childIds.has(e.source) && !childIds.has(e.target),
            ),
          );
          setTimeout(() => fitView({ padding: 0.2, duration: 400 }), 50);
          return;
        }

        expandedClusters.current.add(entityType);
        const resp = await fetchGraphApi(`expand=${entityType}`);
        if (!resp) return;

        const curNodes = getNodes();
        const curEdges = getEdges();

        const existingIds = new Set(curNodes.map((n) => n.id));
        const newApiNodes = resp.nodes.filter((n) => !existingIds.has(n.id));
        const newRfNodes = layoutAroundPoint(
          newApiNodes,
          node.position.x,
          node.position.y,
        );

        clusterChildren.current.set(
          node.id,
          newRfNodes.map((n) => n.id),
        );

        const sigs = new Set(curEdges.map((e) => edgeSig(e.source, e.target)));
        const hubEdges: Edge[] = newRfNodes
          .filter((n) => !sigs.has(edgeSig(node.id, n.id)))
          .map((n) => ({ id: makeEdgeId(), source: node.id, target: n.id }));

        const allSigs = new Set([
          ...sigs,
          ...hubEdges.map((e) => edgeSig(e.source, e.target)),
        ]);
        const interEdges = toRfEdges(resp.edges, allSigs);

        const childIdSet = new Set(newRfNodes.map((n) => n.id));
        const allNodes = resolveLayout(
          [...curNodes, ...newRfNodes],
          node.id,
          childIdSet,
        );
        const allEdges = [...curEdges, ...hubEdges, ...interEdges];

        setNodes(allNodes);
        setEdges(allEdges);
        setTimeout(() => fitView({ padding: 0.15, duration: 400 }), 50);
        return;
      }

      /* ── Entity: expand neighbors ──────────────────────────────────────── */
      if (node.type === "entity") {
        const parsed = parseNodeId(node.id);
        if (!parsed) return;
        const [entityType, entityId] = parsed;

        if (expandedEntities.current.has(node.id)) {
          setNodes((prev) =>
            prev.map((n) =>
              n.id === node.id
                ? { ...n, data: { ...n.data, highlighted: true } }
                : n,
            ),
          );
          return;
        }
        expandedEntities.current.add(node.id);

        const resp = await fetchGraphApi(
          `expand=${entityType}&id=${entityId}`,
        );
        if (!resp) return;

        const curNodes = getNodes();
        const curEdges = getEdges();

        const highlighted = curNodes.map((n) =>
          n.id === node.id
            ? { ...n, data: { ...n.data, highlighted: true } }
            : n,
        );

        const existingIds = new Set(highlighted.map((n) => n.id));
        const newApiNodes = resp.nodes.filter((n) => !existingIds.has(n.id));
        const newRfNodes = layoutAroundPoint(
          newApiNodes,
          node.position.x,
          node.position.y,
        );

        const sigs = new Set(curEdges.map((e) => edgeSig(e.source, e.target)));
        const newEdges = toRfEdges(resp.edges, sigs);

        let allNodes: Node[] = [...highlighted, ...newRfNodes];
        const allEdges = [...curEdges, ...newEdges];

        if (newRfNodes.length > 0) {
          const childIdSet = new Set(newRfNodes.map((n) => n.id));
          allNodes = resolveLayout(allNodes, node.id, childIdSet);
        }

        setNodes(allNodes);
        setEdges(allEdges);
        setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 50);
      }
    },
    [setNodes, setEdges, fitView, getNodes, getEdges],
  );

  /* ── Double-click / context-menu → inspect panel ───────────────────────── */

  const handleInspect = useCallback(
    (_event: ReactMouseEvent, node: Node) => {
      _event.preventDefault();
      const parsed = parseNodeId(node.id);
      if (!parsed) return;
      onNodeInspect(parsed[0], parsed[1]);
    },
    [onNodeInspect],
  );

  /* ── Render ────────────────────────────────────────────────────────────── */

  if (loading) return <GraphSkeleton />;
  if (error) return <GraphError onRetry={loadGraph} />;

  return (
    <div className="h-full w-full relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={handleInspect}
        onNodeContextMenu={handleInspect}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
        fitView
        minZoom={0.05}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
        className="graph-canvas"
      >
        <Background variant={BackgroundVariant.Dots} gap={40} size={0.5} color="#e2e8f0" />
        <MiniMap
          nodeColor={(n) => {
            const c = n.data?.color;
            return typeof c === "string" ? c : "#6B7280";
          }}
          nodeStrokeWidth={0}
          nodeBorderRadius={50}
          maskColor="rgba(0,0,0,0.04)"
          style={{ borderRadius: 12, border: "1px solid rgba(0,0,0,0.06)" }}
          pannable
          zoomable
        />
      </ReactFlow>

      {/* Reset View button */}
      <button
        onClick={handleResetView}
        className="absolute top-3 right-3 z-10 flex items-center gap-1.5 rounded-full border border-white/40 bg-white/50 backdrop-blur-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-white/80 shadow-sm transition-all"
      >
        <RotateCcw className="size-3.5" />
        Reset View
      </button>

      {/* Legend */}
      <GraphLegend entityTypes={visibleTypes} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Exported wrapper with ReactFlowProvider                                   */
/* ═══════════════════════════════════════════════════════════════════════════ */

export default function GraphCanvas(props: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
