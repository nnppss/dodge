"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, RotateCcw } from "lucide-react";

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Types                                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

interface Connection {
  type: string;
  connectedType: string;
  connectedId: string;
  direction: string;
}

interface NodeData {
  entity: Record<string, unknown>;
  connections: Connection[];
}

export interface NodeDetailProps {
  nodeType: string;
  nodeId: string;
  isOpen: boolean;
  onClose: () => void;
  onNodeInspect?: (nodeType: string, nodeId: string) => void;
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

const BADGE_PREFIX: Record<string, string> = {
  sales_order: "SO",
  delivery: "DLV",
  billing_document: "BDoc",
  journal_entry: "JE",
  payment: "PAY",
  customer: "Cust",
  product: "Prod",
  plant: "Plant",
};

const AMOUNT_FIELDS = new Set([
  "total_net_amount",
  "net_amount",
  "amount_in_transaction_currency",
  "amount_in_company_code_currency",
]);

const HIDDEN_FIELDS = new Set(["metadata"]);

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Helpers                                                                   */
/* ═══════════════════════════════════════════════════════════════════════════ */

function fieldLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(key: string, value: unknown): string {
  if (value == null || value === "") return "\u2014";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (AMOUNT_FIELDS.has(key) && typeof value === "number") {
    return `\u20B9${value.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function connectionLabel(c: Connection): string {
  const prefix = BADGE_PREFIX[c.connectedType] ?? c.connectedType;
  return `${prefix} ${c.connectedId}`;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Component                                                                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

export default function NodeDetail({
  nodeType,
  nodeId,
  isOpen,
  onClose,
  onNodeInspect,
}: NodeDetailProps) {
  const [data, setData] = useState<NodeData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const fetchNode = useCallback(() => {
    if (!nodeType || !nodeId) return;

    setLoading(true);
    setError(false);
    setData(null);

    let cancelled = false;

    fetch(`/api/node/${nodeType}:${nodeId}`)
      .then((res) => {
        if (!res.ok) throw new Error("fetch failed");
        return res.json();
      })
      .then((json: NodeData) => {
        if (!cancelled) setData(json);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [nodeType, nodeId]);

  useEffect(() => {
    const cleanup = fetchNode();
    return cleanup;
  }, [fetchNode]);

  const color = TYPE_COLORS[nodeType] ?? "#6B7280";
  const typeLabel = TYPE_LABELS[nodeType] ?? nodeType;

  const entityFields = data
    ? Object.entries(data.entity).filter(
        ([k, v]) => !HIDDEN_FIELDS.has(k) && v != null && v !== "",
      )
    : [];

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open: boolean) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" className="flex flex-col sm:max-w-md">
        {/* ── Header ──────────────────────────────────────────────────── */}
        <SheetHeader className="pb-0">
          <div className="flex items-center gap-2.5">
            <span
              className="inline-block h-3 w-3 rounded-full shrink-0"
              style={{ backgroundColor: color }}
            />
            <SheetTitle className="text-lg">
              {typeLabel} {nodeId}
            </SheetTitle>
          </div>
          <SheetDescription>
            All fields and connected entities
          </SheetDescription>
        </SheetHeader>

        <Separator />

        {/* ── Body ────────────────────────────────────────────────────── */}
        <ScrollArea className="flex-1 min-h-0 px-4">
          {loading && <LoadingSkeleton />}

          {error && (
            <div className="flex flex-col items-center gap-2.5 py-10 text-center">
              <AlertCircle className="size-6 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">
                Unable to load details for this entity.
              </p>
              <button
                onClick={fetchNode}
                className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
              >
                <RotateCcw className="size-3" />
                Retry
              </button>
            </div>
          )}

          {!loading && !error && data && (
            <dl className="space-y-2.5 py-1">
              {entityFields.map(([key, value]) => (
                <div key={key} className="grid grid-cols-[40%_1fr] gap-x-3">
                  <dt className="text-xs font-medium text-muted-foreground truncate py-0.5">
                    {fieldLabel(key)}
                  </dt>
                  <dd className="text-sm text-foreground break-words py-0.5">
                    {formatValue(key, value)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </ScrollArea>

        {/* ── Footer: Connected entities ──────────────────────────────── */}
        {data && data.connections.length > 0 && (
          <>
            <Separator />
            <div className="px-4 pb-4 space-y-2.5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Connected Entities
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {dedupeConnections(data.connections).map((c) => {
                  const badgeColor =
                    TYPE_COLORS[c.connectedType] ?? "#6B7280";
                  return (
                    <button
                      key={`${c.connectedType}:${c.connectedId}`}
                      type="button"
                      onClick={() =>
                        onNodeInspect?.(c.connectedType, c.connectedId)
                      }
                      className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
                    >
                      <Badge
                        variant="outline"
                        className="cursor-pointer gap-1.5 px-2.5 py-1 h-auto text-xs hover:bg-accent transition-colors"
                      >
                        <span
                          className="inline-block h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: badgeColor }}
                        />
                        {connectionLabel(c)}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Sub-components                                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

function LoadingSkeleton() {
  return (
    <div className="space-y-3 py-2">
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="grid grid-cols-[40%_1fr] gap-x-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ))}
    </div>
  );
}

function dedupeConnections(connections: Connection[]): Connection[] {
  const seen = new Set<string>();
  return connections.filter((c) => {
    const key = `${c.connectedType}:${c.connectedId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
