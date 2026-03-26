"use client";

import { useState } from "react";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ArrowRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Types                                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

interface FlowEntity {
  type: string;
  id: string;
  data: Record<string, unknown>;
}

interface FlowStep {
  step: string;
  status: "found" | "missing" | "cancelled";
  entities: FlowEntity[];
}

export interface TraceFlowProps {
  flow: FlowStep[];
  isComplete: boolean;
  issues: string[];
  entityType: string;
  entityId: string;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Constants                                                                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

const STEP_META: Record<
  string,
  { color: string; icon: string; metricKey: string; prefix: string }
> = {
  "Sales Order": {
    color: "#3B82F6",
    icon: "SO",
    metricKey: "total_net_amount",
    prefix: "sales_order",
  },
  Delivery: {
    color: "#10B981",
    icon: "DLV",
    metricKey: "overall_goods_movement_status",
    prefix: "delivery",
  },
  "Billing Document": {
    color: "#F59E0B",
    icon: "BDoc",
    metricKey: "total_net_amount",
    prefix: "billing_document",
  },
  "Journal Entry": {
    color: "#8B5CF6",
    icon: "JE",
    metricKey: "amount_in_transaction_currency",
    prefix: "journal_entry",
  },
  Payment: {
    color: "#06B6D4",
    icon: "PAY",
    metricKey: "amount_in_transaction_currency",
    prefix: "payment",
  },
};

const AMOUNT_FIELDS = new Set([
  "total_net_amount",
  "net_amount",
  "amount_in_transaction_currency",
  "amount_in_company_code_currency",
]);

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Helpers                                                                   */
/* ═══════════════════════════════════════════════════════════════════════════ */

function formatMetric(key: string, value: unknown): string {
  if (value == null) return "";
  if (AMOUNT_FIELDS.has(key) && typeof value === "number") {
    return `₹${value.toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  const s = String(value);
  return s.length > 20 ? s.slice(0, 18) + "…" : s;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Step card                                                                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

function StepCard({
  step,
  isOrigin,
}: {
  step: FlowStep;
  isOrigin: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = STEP_META[step.step];
  const color = meta?.color ?? "#6B7280";
  const metricKey = meta?.metricKey ?? "";

  const isMissing = step.status === "missing";
  const isCancelled = step.status === "cancelled";
  const hasMultiple = step.entities.length > 1;

  const primary = step.entities[0];
  const metricVal = primary ? formatMetric(metricKey, primary.data[metricKey]) : "";
  const displayId = primary?.id ?? "NONE";

  const borderColor = isMissing
    ? "border-red-400/60"
    : isCancelled
      ? "border-amber-400/60"
      : "border-emerald-400/60";

  const borderStyle = isMissing ? "border-dashed" : "border-solid";

  return (
    <div className="flex flex-col items-center min-w-0">
      <div
        className={`
          relative rounded-lg border-2 ${borderStyle} ${borderColor}
          bg-card px-3 py-2.5 w-[132px]
          transition-all duration-200
          ${isOrigin ? "ring-2 ring-primary/30 ring-offset-1 ring-offset-background" : ""}
        `}
      >
        {/* Step label */}
        <div className="flex items-center gap-1.5 mb-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: color }}
          />
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider truncate">
            {step.step}
          </span>
        </div>

        {/* Entity ID */}
        <div
          className={`text-xs font-mono font-semibold truncate ${
            isMissing ? "text-red-500" : "text-foreground"
          }`}
        >
          {isMissing ? "✗ NONE" : displayId}
        </div>

        {/* Metric */}
        {metricVal && !isMissing && (
          <div className="text-[10px] text-muted-foreground truncate mt-0.5">
            {metricKey === "overall_goods_movement_status"
              ? `Status: ${metricVal}`
              : metricVal}
          </div>
        )}

        {/* Status badge */}
        <div className="flex items-center gap-1 mt-1.5">
          {isMissing ? (
            <>
              <XCircle className="size-3 text-red-500" />
              <span className="text-[10px] font-medium text-red-500">Missing</span>
            </>
          ) : isCancelled ? (
            <>
              <AlertTriangle className="size-3 text-amber-500" />
              <span className="text-[10px] font-medium text-amber-500">Cancelled</span>
            </>
          ) : (
            <>
              <CheckCircle2 className="size-3 text-emerald-500" />
              <span className="text-[10px] font-medium text-emerald-500">Found</span>
            </>
          )}
        </div>

        {/* Multi-entity expand toggle */}
        {hasMultiple && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-0.5 mt-1 text-[10px] text-primary hover:underline"
          >
            {expanded ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            {step.entities.length} {step.step.toLowerCase()}s
          </button>
        )}
      </div>

      {/* Expanded entity list */}
      {hasMultiple && expanded && (
        <div className="mt-1.5 w-[132px] space-y-1 max-h-28 overflow-y-auto">
          {step.entities.map((e) => {
            const mv = formatMetric(metricKey, e.data[metricKey]);
            return (
              <div
                key={e.id}
                className="rounded border bg-muted/60 px-2 py-1 text-[10px]"
              >
                <span className="font-mono font-medium text-foreground">
                  {e.id}
                </span>
                {mv && (
                  <span className="ml-1 text-muted-foreground">{mv}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Main component                                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

export default function TraceFlow({
  flow,
  isComplete,
  issues,
  entityType,
  entityId,
}: TraceFlowProps) {
  return (
    <div className="w-full space-y-3">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          O2C Trace
        </span>
        <Badge
          variant="outline"
          className="text-[10px] px-2 py-0.5 h-auto gap-1"
        >
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{
              backgroundColor:
                Object.values(STEP_META).find((m) => m.prefix === entityType)
                  ?.color ?? "#6B7280",
            }}
          />
          {entityType.replace(/_/g, " ")} {entityId}
        </Badge>
      </div>

      {/* ── Pipeline ────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto pb-1">
        <div className="flex items-start gap-0 min-w-max">
          {flow.map((step, i) => {
            const meta = STEP_META[step.step];
            const isOrigin = meta?.prefix === entityType;

            return (
              <div key={step.step} className="flex items-start">
                <StepCard step={step} isOrigin={isOrigin} />
                {i < flow.length - 1 && (
                  <div className="flex items-center self-center pt-2 px-1">
                    <ArrowRight className="size-4 text-muted-foreground/50" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Flow status ─────────────────────────────────────────────────── */}
      <div
        className={`
          flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium
          ${
            isComplete
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "bg-red-500/10 text-red-600 dark:text-red-400"
          }
        `}
      >
        {isComplete ? (
          <>
            <CheckCircle2 className="size-3.5" />
            Flow Status: Complete
          </>
        ) : (
          <>
            <XCircle className="size-3.5" />
            Flow Status: Incomplete
          </>
        )}
      </div>

      {/* ── Issues ──────────────────────────────────────────────────────── */}
      {issues.length > 0 && (
        <div className="space-y-1">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Issues
          </span>
          <ul className="space-y-0.5">
            {issues.map((issue, i) => (
              <li
                key={i}
                className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400"
              >
                <AlertTriangle className="size-3 mt-0.5 shrink-0" />
                <span>{issue}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
