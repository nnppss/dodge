import { NextRequest } from "next/server";
import { db } from "@/db/client";
import { eq, or, and, Column } from "drizzle-orm";
import {
  salesOrders,
  deliveries,
  billingDocuments,
  journalEntries,
  payments,
  customers,
  products,
  productDescriptions,
  plants,
  graphEdges,
} from "@/db/schema";

/* eslint-disable @typescript-eslint/no-explicit-any */
const ENTITY_CONFIG: Record<string, { table: any; column: string }> = {
  sales_order: { table: salesOrders, column: "sales_order" },
  delivery: { table: deliveries, column: "delivery_document" },
  billing_document: { table: billingDocuments, column: "billing_document" },
  journal_entry: { table: journalEntries, column: "accounting_document" },
  payment: { table: payments, column: "accounting_document" },
  customer: { table: customers, column: "customer_id" },
  product: { table: products, column: "product" },
  plant: { table: plants, column: "plant" },
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const colonIdx = id.indexOf(":");
  if (colonIdx === -1) {
    return Response.json(
      { error: "Invalid ID format. Expected entityType:entityId" },
      { status: 400 },
    );
  }

  const entityType = id.slice(0, colonIdx);
  const entityId = id.slice(colonIdx + 1);

  const config = ENTITY_CONFIG[entityType];
  if (!config) {
    return Response.json(
      { error: `Unknown entity type: ${entityType}` },
      { status: 400 },
    );
  }

  try {
    const { table, column } = config;
    const pkCol = table[column] as Column;

    const rows = await db
      .select()
      .from(table)
      .where(eq(pkCol, entityId));

    if (rows.length === 0) {
      return Response.json(
        { error: `${entityType} ${entityId} not found` },
        { status: 404 },
      );
    }

    let entity: Record<string, unknown> = { ...rows[0] };

    if (entityType === "product") {
      const descRows = await db
        .select({ product_description: productDescriptions.product_description })
        .from(productDescriptions)
        .where(
          and(
            eq(productDescriptions.product, entityId),
            eq(productDescriptions.language, "EN"),
          ),
        );
      if (descRows.length > 0) {
        entity.product_description = descRows[0].product_description;
      }
    }

    const edges = await db
      .select()
      .from(graphEdges)
      .where(
        or(
          and(
            eq(graphEdges.source_type, entityType),
            eq(graphEdges.source_id, entityId),
          ),
          and(
            eq(graphEdges.target_type, entityType),
            eq(graphEdges.target_id, entityId),
          ),
        ),
      );

    const connections = edges.map((e) => {
      const isSource = e.source_type === entityType && e.source_id === entityId;
      return {
        type: e.edge_type,
        connectedType: isSource ? e.target_type : e.source_type,
        connectedId: isSource ? e.target_id : e.source_id,
        direction: isSource ? "outgoing" : "incoming",
      };
    });

    return Response.json({ entity, connections });
  } catch (err) {
    console.error("Node lookup failed:", err);
    return Response.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
