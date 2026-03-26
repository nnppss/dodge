"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import NodeDetail from "@/components/NodeDetail";
import ChatPanel from "@/components/ChatPanel";

const GraphCanvas = dynamic(() => import("@/components/GraphCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full w-full text-muted-foreground text-sm">
      Initializing graph…
    </div>
  ),
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Stat helpers                                                              */
/* ═══════════════════════════════════════════════════════════════════════════ */

interface ClusterStat {
  label: string;
  count: number;
  entityType: string;
  color: string;
}

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

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Resizable Split                                                           */
/* ═══════════════════════════════════════════════════════════════════════════ */

function useResizableSplit(initialFraction = 0.65, minFraction = 0.3, maxFraction = 0.8) {
  const [fraction, setFraction] = useState(initialFraction);
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const newFraction = Math.min(maxFraction, Math.max(minFraction, x / rect.width));
      setFraction(newFraction);
    };
    const onMouseUp = () => {
      if (dragging.current) {
        dragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [minFraction, maxFraction]);

  return { fraction, containerRef, onMouseDown };
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Page                                                                      */
/* ═══════════════════════════════════════════════════════════════════════════ */

export default function Home() {
  const [inspectedNode, setInspectedNode] = useState<{
    type: string;
    id: string;
  } | null>(null);
  const [highlightedNodes, setHighlightedNodes] = useState<string[]>([]);
  const [stats, setStats] = useState<ClusterStat[]>([]);
  const { fraction, containerRef, onMouseDown } = useResizableSplit(0.65);

  useEffect(() => {
    fetch("/api/graph")
      .then((r) => r.json())
      .then((data) => {
        if (!data.nodes) return;
        const parsed: ClusterStat[] = data.nodes.map(
          (n: { label: string; data: { count: number; entityType: string } }) => ({
            label: n.label,
            count: n.data.count,
            entityType: n.data.entityType,
            color: TYPE_COLORS[n.data.entityType] ?? "#6B7280",
          }),
        );
        setStats(parsed);
      })
      .catch(() => {});
  }, []);

  const handleNodeInspect = useCallback(
    (nodeType: string, nodeId: string) => {
      setInspectedNode({ type: nodeType, id: nodeId });
    },
    [],
  );

  const handleCloseDetail = useCallback(() => {
    setInspectedNode(null);
  }, []);

  const statsSummary = stats
    .filter((s) => ["sales_order", "delivery", "billing_document", "customer"].includes(s.entityType))
    .sort((a, b) => {
      const order = ["sales_order", "delivery", "billing_document", "customer"];
      return order.indexOf(a.entityType) - order.indexOf(b.entityType);
    });

  const leftPercent = `${(fraction * 100).toFixed(1)}%`;
  const rightPercent = `${((1 - fraction) * 100).toFixed(1)}%`;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="shrink-0 border-b bg-white">
        <div className="flex items-center justify-between gap-4 px-5 py-3">
          <div className="min-w-0">
            <h1 className="text-lg font-bold tracking-tight text-foreground leading-tight">
              ORDER TO CASH
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              A Graph-Based Data Modeling and Query System
            </p>
          </div>

          {statsSummary.length > 0 && (
            <div className="hidden md:flex items-center gap-1 shrink-0 text-xs text-muted-foreground">
              {statsSummary.map((s, i) => (
                <span key={s.entityType} className="flex items-center gap-1">
                  {i > 0 && <span className="mx-0.5 text-border">·</span>}
                  <span className="tabular-nums font-medium text-foreground/70">{s.count}</span>
                  <span>{s.label}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <main ref={containerRef} className="flex flex-1 min-h-0">
        {/* Graph panel */}
        <div className="relative" style={{ width: leftPercent }}>
          <GraphCanvas
            onNodeInspect={handleNodeInspect}
            highlightNodes={highlightedNodes}
          />
        </div>

        {/* Resizable divider */}
        <div
          onMouseDown={onMouseDown}
          className="w-1 shrink-0 bg-border hover:bg-primary/30 cursor-col-resize transition-colors relative group"
        >
          <div className="absolute inset-y-0 -left-1 -right-1" />
        </div>

        {/* Chat panel */}
        <div className="flex flex-col bg-muted/20" style={{ width: rightPercent }}>
          <ChatPanel onHighlightNodes={setHighlightedNodes} />
        </div>
      </main>

      {/* ── Node detail overlay ─────────────────────────────────────────── */}
      <NodeDetail
        nodeType={inspectedNode?.type ?? ""}
        nodeId={inspectedNode?.id ?? ""}
        isOpen={inspectedNode !== null}
        onClose={handleCloseDetail}
        onNodeInspect={handleNodeInspect}
      />
    </div>
  );
}
