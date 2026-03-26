import { NextRequest } from "next/server";
import { db } from "@/db/client";
import { inArray } from "drizzle-orm";
import {
  salesOrders,
  deliveries,
  deliveryItems,
  billingDocuments,
  billingDocumentItems,
  journalEntries,
  payments,
} from "@/db/schema";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type FlowEntity = { type: string; id: string; data: Record<string, unknown> };
type FlowStep = {
  step: string;
  status: "found" | "missing" | "cancelled";
  entities: FlowEntity[];
};
type TraceResult = {
  flow: FlowStep[];
  isComplete: boolean;
  issues: string[];
};

/* ------------------------------------------------------------------ */
/*  Forward-trace helpers (return IDs of the next O2C step)           */
/* ------------------------------------------------------------------ */

async function fwdSOtoDeliveries(soIds: string[]): Promise<string[]> {
  if (!soIds.length) return [];
  const rows = await db
    .selectDistinct({ id: deliveryItems.delivery_document })
    .from(deliveryItems)
    .where(inArray(deliveryItems.reference_sd_document, soIds));
  return rows.map((r) => r.id);
}

async function fwdDeliveriesToBilling(delIds: string[]): Promise<string[]> {
  if (!delIds.length) return [];
  const rows = await db
    .selectDistinct({ id: billingDocumentItems.billing_document })
    .from(billingDocumentItems)
    .where(inArray(billingDocumentItems.reference_sd_document, delIds));
  return rows.map((r) => r.id);
}

async function fwdBillingToJE(billIds: string[]): Promise<string[]> {
  if (!billIds.length) return [];
  const rows = await db
    .selectDistinct({ id: journalEntries.accounting_document })
    .from(journalEntries)
    .where(inArray(journalEntries.reference_document, billIds));
  return rows.map((r) => r.id);
}

async function fwdJEtoPayment(jeAccDocs: string[]): Promise<string[]> {
  if (!jeAccDocs.length) return [];
  const rows = await db
    .selectDistinct({ id: journalEntries.clearing_accounting_document })
    .from(journalEntries)
    .where(inArray(journalEntries.accounting_document, jeAccDocs));
  return rows
    .map((r) => r.id)
    .filter((d): d is string => d != null && d !== "");
}

/* ------------------------------------------------------------------ */
/*  Backward-trace helpers                                            */
/* ------------------------------------------------------------------ */

async function bkDeliveryToSO(delIds: string[]): Promise<string[]> {
  if (!delIds.length) return [];
  const rows = await db
    .selectDistinct({ id: deliveryItems.reference_sd_document })
    .from(deliveryItems)
    .where(inArray(deliveryItems.delivery_document, delIds));
  return rows
    .map((r) => r.id)
    .filter((d): d is string => d != null && d !== "");
}

async function bkBillingToDelivery(billIds: string[]): Promise<string[]> {
  if (!billIds.length) return [];
  const rows = await db
    .selectDistinct({ id: billingDocumentItems.reference_sd_document })
    .from(billingDocumentItems)
    .where(inArray(billingDocumentItems.billing_document, billIds));
  return rows
    .map((r) => r.id)
    .filter((d): d is string => d != null && d !== "");
}

async function bkJEtoBilling(jeAccDocs: string[]): Promise<string[]> {
  if (!jeAccDocs.length) return [];
  const rows = await db
    .selectDistinct({ id: journalEntries.reference_document })
    .from(journalEntries)
    .where(inArray(journalEntries.accounting_document, jeAccDocs));
  return rows
    .map((r) => r.id)
    .filter((d): d is string => d != null && d !== "");
}

async function bkPaymentToJE(payAccDocs: string[]): Promise<string[]> {
  if (!payAccDocs.length) return [];
  const rows = await db
    .selectDistinct({ id: journalEntries.accounting_document })
    .from(journalEntries)
    .where(inArray(journalEntries.clearing_accounting_document, payAccDocs));
  return rows.map((r) => r.id);
}

/* ------------------------------------------------------------------ */
/*  Data fetchers                                                     */
/* ------------------------------------------------------------------ */

async function fetchSOs(ids: string[]) {
  if (!ids.length) return [];
  return db
    .select()
    .from(salesOrders)
    .where(inArray(salesOrders.sales_order, ids));
}

async function fetchDeliveries(ids: string[]) {
  if (!ids.length) return [];
  return db
    .select()
    .from(deliveries)
    .where(inArray(deliveries.delivery_document, ids));
}

async function fetchBillingDocs(ids: string[]) {
  if (!ids.length) return [];
  return db
    .select()
    .from(billingDocuments)
    .where(inArray(billingDocuments.billing_document, ids));
}

async function fetchJEs(accDocs: string[]) {
  if (!accDocs.length) return [];
  return db
    .select()
    .from(journalEntries)
    .where(inArray(journalEntries.accounting_document, accDocs));
}

async function fetchPayments(accDocs: string[]) {
  if (!accDocs.length) return [];
  return db
    .select()
    .from(payments)
    .where(inArray(payments.accounting_document, accDocs));
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function dedup<T extends Record<string, unknown>>(
  rows: T[],
  key: string,
): T[] {
  const seen = new Map<string, T>();
  for (const row of rows) {
    const k = String(row[key]);
    if (!seen.has(k)) seen.set(k, row);
  }
  return [...seen.values()];
}

function buildStep(
  stepName: string,
  entityType: string,
  idKey: string,
  rows: Record<string, unknown>[],
): FlowStep {
  if (rows.length === 0) {
    return { step: stepName, status: "missing", entities: [] };
  }

  const entities: FlowEntity[] = rows.map((r) => ({
    type: entityType,
    id: String(r[idKey]),
    data: r as Record<string, unknown>,
  }));

  if (entityType === "billing_document") {
    const allCancelled = rows.every(
      (r) => r.billing_document_is_cancelled === true,
    );
    return {
      step: stepName,
      status: allCancelled ? "cancelled" : "found",
      entities,
    };
  }

  return { step: stepName, status: "found", entities };
}

/* ------------------------------------------------------------------ */
/*  Core O2C trace                                                    */
/* ------------------------------------------------------------------ */

const VALID_TYPES = new Set([
  "sales_order",
  "delivery",
  "billing_document",
  "journal_entry",
  "payment",
]);

async function traceO2C(
  entityType: string,
  entityId: string,
): Promise<TraceResult> {
  const issues: string[] = [];

  // ── Phase 1: backward trace to the root (sales order) ─────────────
  let soIds: string[] = [];
  let bkDelIds: string[] = [];
  let bkBillIds: string[] = [];
  let bkJEIds: string[] = [];

  switch (entityType) {
    case "sales_order":
      soIds = [entityId];
      break;

    case "delivery":
      bkDelIds = [entityId];
      soIds = await bkDeliveryToSO(bkDelIds);
      break;

    case "billing_document":
      bkBillIds = [entityId];
      bkDelIds = await bkBillingToDelivery(bkBillIds);
      soIds = await bkDeliveryToSO(bkDelIds);
      break;

    case "journal_entry":
      bkJEIds = [entityId];
      bkBillIds = await bkJEtoBilling(bkJEIds);
      bkDelIds = await bkBillingToDelivery(bkBillIds);
      soIds = await bkDeliveryToSO(bkDelIds);
      break;

    case "payment":
      bkJEIds = await bkPaymentToJE([entityId]);
      bkBillIds = await bkJEtoBilling(bkJEIds);
      bkDelIds = await bkBillingToDelivery(bkBillIds);
      soIds = await bkDeliveryToSO(bkDelIds);
      break;
  }

  // ── Phase 2: forward trace from root (or earliest available) ──────
  // Each step falls back to backward-trace results when the parent is empty
  const delIds = soIds.length
    ? await fwdSOtoDeliveries(soIds)
    : bkDelIds;

  const billIds = delIds.length
    ? await fwdDeliveriesToBilling(delIds)
    : bkBillIds;

  const jeIds = billIds.length
    ? await fwdBillingToJE(billIds)
    : bkJEIds;

  let payIds = jeIds.length ? await fwdJEtoPayment(jeIds) : [];

  // Guarantee the starting entity appears in its own step
  if (entityType === "payment" && !payIds.includes(entityId)) {
    payIds = [...payIds, entityId];
  }

  // ── Phase 3: fetch full entity data in parallel ───────────────────
  const [soData, delData, billData, jeData, payData] = await Promise.all([
    fetchSOs(soIds),
    fetchDeliveries(delIds),
    fetchBillingDocs(billIds),
    fetchJEs(jeIds),
    fetchPayments(payIds),
  ]);

  // JE and payment tables have composite PKs — deduplicate to doc level
  const uniqueJE = dedup(jeData, "accounting_document");
  const uniquePay = dedup(payData, "accounting_document");

  // ── Phase 4: build response flow ──────────────────────────────────
  const flow: FlowStep[] = [
    buildStep("Sales Order", "sales_order", "sales_order", soData),
    buildStep("Delivery", "delivery", "delivery_document", delData),
    buildStep(
      "Billing Document",
      "billing_document",
      "billing_document",
      billData,
    ),
    buildStep("Journal Entry", "journal_entry", "accounting_document", uniqueJE),
    buildStep("Payment", "payment", "accounting_document", uniquePay),
  ];

  // ── Phase 5: detect issues ────────────────────────────────────────
  if (soData.length > 0 && delData.length === 0) {
    issues.push(
      `No delivery found for sales order ${soIds.join(", ")}`,
    );
  }
  if (delData.length > 0 && billData.length === 0) {
    issues.push(
      `No billing document found for delivery ${delIds.join(", ")}`,
    );
  }
  for (const b of billData) {
    if (b.billing_document_is_cancelled) {
      issues.push(`Billing document ${b.billing_document} is cancelled`);
    }
  }
  if (billData.length > 0 && uniqueJE.length === 0) {
    issues.push(
      `No journal entry found for billing document ${billIds.join(", ")}`,
    );
  }
  if (uniqueJE.length > 0 && uniquePay.length === 0) {
    for (const je of uniqueJE) {
      issues.push(
        `No payment found for journal entry ${je.accounting_document}`,
      );
    }
  }

  const isComplete = flow.every((s) => s.status === "found");

  return { flow, isComplete, issues };
}

/* ------------------------------------------------------------------ */
/*  POST /api/trace                                                   */
/* ------------------------------------------------------------------ */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { entityType, entityId } = body;

    if (!entityType || !entityId) {
      return Response.json(
        { error: "entityType and entityId are required" },
        { status: 400 },
      );
    }

    if (!VALID_TYPES.has(entityType)) {
      return Response.json(
        {
          error: `Invalid entity type: ${entityType}. Must be one of: ${[...VALID_TYPES].join(", ")}`,
        },
        { status: 400 },
      );
    }

    const result = await traceO2C(entityType, String(entityId));
    return Response.json(result);
  } catch (err) {
    console.error("Trace failed:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
