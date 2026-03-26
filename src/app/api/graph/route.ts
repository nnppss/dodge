import { NextRequest } from "next/server";
import { db } from "@/db/client";
import { eq, or, and, sql } from "drizzle-orm";
import * as schema from "@/db/schema";

const TABLE_NAME_MAP: Record<string, string> = {
  sales_order: "sales_orders",
  delivery: "deliveries",
  billing_document: "billing_documents",
  journal_entry: "journal_entries",
  payment: "payments",
  customer: "customers",
  product: "products",
  plant: "plants",
};

const PRIMARY_KEY_MAP: Record<string, string> = {
  sales_order: "sales_order",
  delivery: "delivery_document",
  billing_document: "billing_document",
  journal_entry: "accounting_document",
  payment: "accounting_document",
  customer: "customer_id",
  product: "product",
  plant: "plant",
};

const LABEL_MAP: Record<string, string> = {
  sales_order: "Sales Orders",
  delivery: "Deliveries",
  billing_document: "Billing Documents",
  journal_entry: "Journal Entries",
  payment: "Payments",
  customer: "Customers",
  product: "Products",
  plant: "Plants",
};

const LABEL_PREFIX_MAP: Record<string, string> = {
  sales_order: "SO",
  delivery: "DLV",
  billing_document: "BDoc",
  journal_entry: "JE",
  payment: "PAY",
  customer: "Cust",
  product: "Prod",
  plant: "Plant",
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const expand = searchParams.get("expand");
    const id = searchParams.get("id");

    if (expand && id) {
      return Response.json(await getEntityWithNeighbors(expand, id));
    }

    if (expand) {
      return Response.json(await getExpandedEntities(expand));
    }

    return Response.json(await getClusterOverview());
  } catch (error) {
    console.error("[graph] error:", error);
    return Response.json(
      { error: "Failed to fetch graph data" },
      { status: 500 },
    );
  }
}

// ── Cluster overview ────────────────────────────────────────────────────────

async function getClusterOverview() {
  const countRows = await db.execute(sql`
    SELECT 'sales_order' AS type, COUNT(*)::int AS count FROM sales_orders
    UNION ALL SELECT 'delivery', COUNT(*)::int FROM deliveries
    UNION ALL SELECT 'billing_document', COUNT(*)::int FROM billing_documents
    UNION ALL SELECT 'journal_entry', COUNT(DISTINCT accounting_document)::int FROM journal_entries
    UNION ALL SELECT 'payment', COUNT(DISTINCT accounting_document)::int FROM payments
    UNION ALL SELECT 'customer', COUNT(*)::int FROM customers
    UNION ALL SELECT 'product', COUNT(*)::int FROM products
    UNION ALL SELECT 'plant', COUNT(*)::int FROM plants
  `);

  const edgeRows = await db.execute(sql`
    SELECT DISTINCT source_type, target_type, edge_type FROM graph_edges
  `);

  const nodes = (countRows.rows as { type: string; count: number }[]).map(
    (r) => ({
      id: `cluster:${r.type}`,
      type: "cluster" as const,
      label: LABEL_MAP[r.type] ?? r.type,
      data: { count: r.count, entityType: r.type },
    }),
  );

  const edges = (
    edgeRows.rows as {
      source_type: string;
      target_type: string;
      edge_type: string;
    }[]
  ).map((r, i) => ({
    id: `ce-${i + 1}`,
    source: `cluster:${r.source_type}`,
    target: `cluster:${r.target_type}`,
    label: r.edge_type,
  }));

  return { nodes, edges };
}

// ── Expanded entity list ────────────────────────────────────────────────────

async function getExpandedEntities(entityType: string) {
  const tableName = TABLE_NAME_MAP[entityType];
  if (!tableName) {
    return { nodes: [], edges: [], error: `Unknown entity type: ${entityType}` };
  }

  const pkField = PRIMARY_KEY_MAP[entityType];
  let rows: Record<string, unknown>[];

  if (entityType === "journal_entry" || entityType === "payment") {
    rows = await db
      .execute(
        sql`SELECT DISTINCT ON (accounting_document) * FROM ${sql.identifier(tableName)}`,
      )
      .then((r) => r.rows as Record<string, unknown>[]);
  } else {
    rows = await db
      .execute(sql`SELECT * FROM ${sql.identifier(tableName)}`)
      .then((r) => r.rows as Record<string, unknown>[]);
  }

  const entityIds = rows.map((r) => String(r[pkField]));

  const edgeRows =
    entityIds.length > 0
      ? await db
          .select()
          .from(schema.graphEdges)
          .where(
            or(
              and(
                eq(schema.graphEdges.source_type, entityType),
                sql`${schema.graphEdges.source_id} IN (${sql.join(
                  entityIds.map((eid) => sql`${eid}`),
                  sql`, `,
                )})`,
              ),
              and(
                eq(schema.graphEdges.target_type, entityType),
                sql`${schema.graphEdges.target_id} IN (${sql.join(
                  entityIds.map((eid) => sql`${eid}`),
                  sql`, `,
                )})`,
              ),
            ),
          )
      : [];

  const nodes = rows.map((r) => {
    const entityId = String(r[pkField]);
    return {
      id: `${entityType}:${entityId}`,
      type: entityType,
      label: `${LABEL_PREFIX_MAP[entityType] ?? entityType} ${entityId}`,
      data: r,
    };
  });

  const edges = edgeRows.map((r, i) => ({
    id: `e-${i + 1}`,
    source: `${r.source_type}:${r.source_id}`,
    target: `${r.target_type}:${r.target_id}`,
    label: r.edge_type,
  }));

  return { nodes, edges };
}

// ── Single entity + neighbors ───────────────────────────────────────────────

async function getEntityWithNeighbors(entityType: string, entityId: string) {
  if (!TABLE_NAME_MAP[entityType]) {
    return { nodes: [], edges: [], error: `Unknown entity type: ${entityType}` };
  }

  const edgeRows = await db
    .select()
    .from(schema.graphEdges)
    .where(
      or(
        and(
          eq(schema.graphEdges.source_type, entityType),
          eq(schema.graphEdges.source_id, entityId),
        ),
        and(
          eq(schema.graphEdges.target_type, entityType),
          eq(schema.graphEdges.target_id, entityId),
        ),
      ),
    );

  const neighborKeys = new Map<string, { type: string; id: string }>();
  neighborKeys.set(`${entityType}:${entityId}`, {
    type: entityType,
    id: entityId,
  });

  for (const edge of edgeRows) {
    neighborKeys.set(`${edge.source_type}:${edge.source_id}`, {
      type: edge.source_type,
      id: edge.source_id,
    });
    neighborKeys.set(`${edge.target_type}:${edge.target_id}`, {
      type: edge.target_type,
      id: edge.target_id,
    });
  }

  const nodesByKey = new Map<string, Record<string, unknown>>();

  const grouped = new Map<string, string[]>();
  for (const [, val] of neighborKeys) {
    const existing = grouped.get(val.type) ?? [];
    existing.push(val.id);
    grouped.set(val.type, existing);
  }

  for (const [type, ids] of grouped) {
    if (!TABLE_NAME_MAP[type]) continue;
    const pkField = PRIMARY_KEY_MAP[type];

    const fetched = await fetchEntitiesByIds(type, ids);
    for (const row of fetched) {
      const rowId = String(row[pkField]);
      nodesByKey.set(`${type}:${rowId}`, row);
    }
  }

  const nodes = Array.from(neighborKeys.entries()).map(
    ([key, { type, id }]) => {
      const data = nodesByKey.get(key) ?? {};
      return {
        id: key,
        type,
        label: `${LABEL_PREFIX_MAP[type] ?? type} ${id}`,
        data,
      };
    },
  );

  const edges = edgeRows.map((r, i) => ({
    id: `e-${i + 1}`,
    source: `${r.source_type}:${r.source_id}`,
    target: `${r.target_type}:${r.target_id}`,
    label: r.edge_type,
  }));

  return { nodes, edges };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function fetchEntitiesByIds(
  entityType: string,
  ids: string[],
): Promise<Record<string, unknown>[]> {
  if (ids.length === 0) return [];

  const tableName = TABLE_NAME_MAP[entityType];
  if (!tableName) return [];

  const pkColumn = PRIMARY_KEY_MAP[entityType];
  const uniqueIds = [...new Set(ids)];

  if (entityType === "journal_entry" || entityType === "payment") {
    const result = await db.execute(sql`
      SELECT DISTINCT ON (${sql.identifier(pkColumn)}) *
      FROM ${sql.identifier(tableName)}
      WHERE ${sql.identifier(pkColumn)} IN (${sql.join(
        uniqueIds.map((uid) => sql`${uid}`),
        sql`, `,
      )})
    `);
    return result.rows as Record<string, unknown>[];
  }

  const result = await db.execute(sql`
    SELECT * FROM ${sql.identifier(tableName)}
    WHERE ${sql.identifier(pkColumn)} IN (${sql.join(
      uniqueIds.map((uid) => sql`${uid}`),
      sql`, `,
    )})
  `);
  return result.rows as Record<string, unknown>[];
}
