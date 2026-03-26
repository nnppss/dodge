import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";
import * as schema from "../src/db/schema";

dotenv.config({ path: path.resolve(__dirname, "..", ".env.local") });

const connection = neon(process.env.DATABASE_URL!);
const db = drizzle(connection, { schema });

const CLEANED_DIR = path.resolve(__dirname, "..", "data", "cleaned");
const CHUNK_SIZE = 50;

function readJson(filename: string): Record<string, unknown>[] {
  const filePath = path.join(CLEANED_DIR, filename);
  if (!fs.existsSync(filePath)) {
    console.warn(`  Skipping ${filename} — file not found`);
    return [];
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

async function batchInsert<T extends Record<string, unknown>>(
  table: Parameters<typeof db.insert>[0],
  rows: T[],
  tableName: string,
) {
  if (rows.length === 0) {
    console.log(`  Inserted 0 rows into ${tableName}`);
    return;
  }

  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    await db.insert(table).values(chunk as any).onConflictDoNothing();
    inserted += chunk.length;
  }
  console.log(`  Inserted ${inserted} rows into ${tableName}`);
}

// ─── STEP 1: Load Entity Data ────────────────────────────────────────────────

async function loadEntities() {
  console.log("\n=== STEP 1: Loading entity data ===\n");

  await batchInsert(
    schema.salesOrders,
    readJson("sales_orders.json"),
    "sales_orders",
  );

  await batchInsert(
    schema.salesOrderItems,
    readJson("sales_order_items.json"),
    "sales_order_items",
  );

  await batchInsert(
    schema.deliveries,
    readJson("deliveries.json"),
    "deliveries",
  );

  await batchInsert(
    schema.deliveryItems,
    readJson("delivery_items.json"),
    "delivery_items",
  );

  await batchInsert(
    schema.billingDocuments,
    readJson("billing_documents.json"),
    "billing_documents",
  );

  await batchInsert(
    schema.billingDocumentItems,
    readJson("billing_document_items.json"),
    "billing_document_items",
  );

  await batchInsert(
    schema.journalEntries,
    readJson("journal_entries.json"),
    "journal_entries",
  );

  await batchInsert(
    schema.payments,
    readJson("payments.json"),
    "payments",
  );

  const customersRaw = readJson("customers.json");
  const customersMapped = customersRaw.map((row) => {
    const { business_partner, ...rest } = row;
    return { customer_id: business_partner, ...rest };
  });
  await batchInsert(schema.customers, customersMapped, "customers");

  await batchInsert(
    schema.customerAddresses,
    readJson("customer_addresses.json"),
    "customer_addresses",
  );

  await batchInsert(
    schema.products,
    readJson("products.json"),
    "products",
  );

  await batchInsert(
    schema.productDescriptions,
    readJson("product_descriptions.json"),
    "product_descriptions",
  );

  await batchInsert(
    schema.plants,
    readJson("plants.json"),
    "plants",
  );
}

// ─── STEP 2: Build Graph Edges ───────────────────────────────────────────────

const EDGE_QUERIES = [
  {
    label: "Sales Order → Customer (SOLD_TO)",
    sql: `INSERT INTO graph_edges (source_type, source_id, target_type, target_id, edge_type)
          SELECT DISTINCT 'sales_order', sales_order, 'customer', sold_to_party, 'SOLD_TO'
          FROM sales_orders WHERE sold_to_party IS NOT NULL`,
  },
  {
    label: "Sales Order → Sales Order Item (HAS_ITEM)",
    sql: `INSERT INTO graph_edges (source_type, source_id, target_type, target_id, edge_type)
          SELECT DISTINCT 'sales_order', sales_order, 'sales_order_item',
            sales_order || '-' || sales_order_item, 'HAS_ITEM'
          FROM sales_order_items`,
  },
  {
    label: "Sales Order Item → Product (CONTAINS_PRODUCT)",
    sql: `INSERT INTO graph_edges (source_type, source_id, target_type, target_id, edge_type)
          SELECT DISTINCT 'sales_order_item', sales_order || '-' || sales_order_item,
            'product', material, 'CONTAINS_PRODUCT'
          FROM sales_order_items WHERE material IS NOT NULL`,
  },
  {
    label: "Sales Order Item → Plant (PRODUCED_AT)",
    sql: `INSERT INTO graph_edges (source_type, source_id, target_type, target_id, edge_type)
          SELECT DISTINCT 'sales_order_item', sales_order || '-' || sales_order_item,
            'plant', production_plant, 'PRODUCED_AT'
          FROM sales_order_items WHERE production_plant IS NOT NULL`,
  },
  {
    label: "Delivery → Delivery Item (HAS_ITEM)",
    sql: `INSERT INTO graph_edges (source_type, source_id, target_type, target_id, edge_type)
          SELECT DISTINCT 'delivery', delivery_document, 'delivery_item',
            delivery_document || '-' || delivery_document_item, 'HAS_ITEM'
          FROM delivery_items`,
  },
  {
    label: "Delivery Item → Sales Order (FULFILLS_ORDER)",
    sql: `INSERT INTO graph_edges (source_type, source_id, target_type, target_id, edge_type)
          SELECT DISTINCT 'delivery_item', delivery_document || '-' || delivery_document_item,
            'sales_order', reference_sd_document, 'FULFILLS_ORDER'
          FROM delivery_items WHERE reference_sd_document IS NOT NULL`,
  },
  {
    label: "Delivery Item → Plant (SHIPS_FROM)",
    sql: `INSERT INTO graph_edges (source_type, source_id, target_type, target_id, edge_type)
          SELECT DISTINCT 'delivery_item', delivery_document || '-' || delivery_document_item,
            'plant', plant, 'SHIPS_FROM'
          FROM delivery_items WHERE plant IS NOT NULL`,
  },
  {
    label: "Billing Document → Billing Document Item (HAS_ITEM)",
    sql: `INSERT INTO graph_edges (source_type, source_id, target_type, target_id, edge_type)
          SELECT DISTINCT 'billing_document', billing_document, 'billing_document_item',
            billing_document || '-' || billing_document_item, 'HAS_ITEM'
          FROM billing_document_items`,
  },
  {
    label: "Billing Document Item → Delivery (BILLS_DELIVERY)",
    sql: `INSERT INTO graph_edges (source_type, source_id, target_type, target_id, edge_type)
          SELECT DISTINCT 'billing_document_item', billing_document || '-' || billing_document_item,
            'delivery', reference_sd_document, 'BILLS_DELIVERY'
          FROM billing_document_items WHERE reference_sd_document IS NOT NULL`,
  },
  {
    label: "Billing Document → Journal Entry (GENERATES_JOURNAL_ENTRY)",
    sql: `INSERT INTO graph_edges (source_type, source_id, target_type, target_id, edge_type)
          SELECT DISTINCT 'billing_document', billing_document, 'journal_entry',
            accounting_document, 'GENERATES_JOURNAL_ENTRY'
          FROM billing_documents WHERE accounting_document IS NOT NULL`,
  },
  {
    label: "Journal Entry → Billing Document (REFERENCES_BILLING)",
    sql: `INSERT INTO graph_edges (source_type, source_id, target_type, target_id, edge_type)
          SELECT DISTINCT 'journal_entry', accounting_document, 'billing_document',
            reference_document, 'REFERENCES_BILLING'
          FROM journal_entries WHERE reference_document IS NOT NULL`,
  },
  {
    label: "Journal Entry → Payment (CLEARED_BY)",
    sql: `INSERT INTO graph_edges (source_type, source_id, target_type, target_id, edge_type)
          SELECT DISTINCT 'journal_entry', accounting_document, 'payment',
            clearing_accounting_document, 'CLEARED_BY'
          FROM journal_entries WHERE clearing_accounting_document IS NOT NULL`,
  },
  {
    label: "Billing Document → Customer (BILLED_TO)",
    sql: `INSERT INTO graph_edges (source_type, source_id, target_type, target_id, edge_type)
          SELECT DISTINCT 'billing_document', billing_document, 'customer',
            sold_to_party, 'BILLED_TO'
          FROM billing_documents WHERE sold_to_party IS NOT NULL`,
  },
  {
    label: "Customer → Address (HAS_ADDRESS)",
    sql: `INSERT INTO graph_edges (source_type, source_id, target_type, target_id, edge_type)
          SELECT DISTINCT 'customer', business_partner, 'address',
            business_partner, 'HAS_ADDRESS'
          FROM customer_addresses`,
  },
  {
    label: "Product → Description (HAS_DESCRIPTION)",
    sql: `INSERT INTO graph_edges (source_type, source_id, target_type, target_id, edge_type)
          SELECT DISTINCT 'product', product, 'product_description',
            product || '-' || language, 'HAS_DESCRIPTION'
          FROM product_descriptions`,
  },
];

async function buildGraphEdges() {
  console.log("\n=== STEP 2: Building graph edges ===\n");

  console.log("  Clearing existing graph_edges...");
  await db.execute(sql`DELETE FROM graph_edges`);

  for (const edge of EDGE_QUERIES) {
    await db.execute(sql.raw(edge.sql));
    console.log(`  Built: ${edge.label}`);
  }

  console.log("\n--- Edge Summary ---\n");
  const summary = await db.execute(
    sql`SELECT edge_type, COUNT(*) as count FROM graph_edges GROUP BY edge_type ORDER BY count ASC`,
  );
  for (const row of summary.rows) {
    console.log(`  ${String(row.edge_type).padEnd(30)} ${row.count}`);
  }
  console.log();
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Starting data ingestion...");
  await loadEntities();
  await buildGraphEdges();
  console.log("Data ingestion complete.");
}

main().catch((err) => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});
