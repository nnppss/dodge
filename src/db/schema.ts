import {
  pgTable,
  text,
  real,
  boolean,
  serial,
  jsonb,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";

// ── Sales Orders ────────────────────────────────────────────────────────────

export const salesOrders = pgTable("sales_orders", {
  sales_order: text("sales_order").primaryKey(),
  sales_order_type: text("sales_order_type"),
  sales_organization: text("sales_organization"),
  distribution_channel: text("distribution_channel"),
  organization_division: text("organization_division"),
  sales_group: text("sales_group"),
  sales_office: text("sales_office"),
  sold_to_party: text("sold_to_party"),
  creation_date: text("creation_date"),
  created_by_user: text("created_by_user"),
  last_change_date_time: text("last_change_date_time"),
  total_net_amount: real("total_net_amount"),
  overall_delivery_status: text("overall_delivery_status"),
  overall_ord_reltd_billg_status: text("overall_ord_reltd_billg_status"),
  overall_sd_doc_reference_status: text("overall_sd_doc_reference_status"),
  transaction_currency: text("transaction_currency"),
  pricing_date: text("pricing_date"),
  requested_delivery_date: text("requested_delivery_date"),
  header_billing_block_reason: text("header_billing_block_reason"),
  delivery_block_reason: text("delivery_block_reason"),
  incoterms_classification: text("incoterms_classification"),
  incoterms_location1: text("incoterms_location1"),
  customer_payment_terms: text("customer_payment_terms"),
  total_credit_check_status: text("total_credit_check_status"),
});

// ── Sales Order Items ───────────────────────────────────────────────────────

export const salesOrderItems = pgTable(
  "sales_order_items",
  {
    sales_order: text("sales_order").notNull(),
    sales_order_item: text("sales_order_item").notNull(),
    sales_order_item_category: text("sales_order_item_category"),
    material: text("material"),
    requested_quantity: real("requested_quantity"),
    requested_quantity_unit: text("requested_quantity_unit"),
    transaction_currency: text("transaction_currency"),
    net_amount: real("net_amount"),
    material_group: text("material_group"),
    production_plant: text("production_plant"),
    storage_location: text("storage_location"),
    sales_document_rjcn_reason: text("sales_document_rjcn_reason"),
    item_billing_block_reason: text("item_billing_block_reason"),
  },
  (t) => [primaryKey({ columns: [t.sales_order, t.sales_order_item] })],
);

// ── Deliveries ──────────────────────────────────────────────────────────────

export const deliveries = pgTable("deliveries", {
  delivery_document: text("delivery_document").primaryKey(),
  shipping_point: text("shipping_point"),
  creation_date: text("creation_date"),
  creation_time: text("creation_time"),
  actual_goods_movement_date: text("actual_goods_movement_date"),
  actual_goods_movement_time: text("actual_goods_movement_time"),
  last_change_date: text("last_change_date"),
  overall_goods_movement_status: text("overall_goods_movement_status"),
  overall_picking_status: text("overall_picking_status"),
  overall_proof_of_delivery_status: text("overall_proof_of_delivery_status"),
  hdr_general_incompletion_status: text("hdr_general_incompletion_status"),
  header_billing_block_reason: text("header_billing_block_reason"),
  delivery_block_reason: text("delivery_block_reason"),
});

// ── Delivery Items ──────────────────────────────────────────────────────────

export const deliveryItems = pgTable(
  "delivery_items",
  {
    delivery_document: text("delivery_document").notNull(),
    delivery_document_item: text("delivery_document_item").notNull(),
    actual_delivery_quantity: real("actual_delivery_quantity"),
    batch: text("batch"),
    delivery_quantity_unit: text("delivery_quantity_unit"),
    item_billing_block_reason: text("item_billing_block_reason"),
    last_change_date: text("last_change_date"),
    plant: text("plant"),
    reference_sd_document: text("reference_sd_document"),
    reference_sd_document_item: text("reference_sd_document_item"),
    storage_location: text("storage_location"),
  },
  (t) => [
    primaryKey({ columns: [t.delivery_document, t.delivery_document_item] }),
  ],
);

// ── Billing Documents ───────────────────────────────────────────────────────

export const billingDocuments = pgTable("billing_documents", {
  billing_document: text("billing_document").primaryKey(),
  billing_document_type: text("billing_document_type"),
  creation_date: text("creation_date"),
  creation_time: text("creation_time"),
  last_change_date_time: text("last_change_date_time"),
  billing_document_date: text("billing_document_date"),
  billing_document_is_cancelled: boolean(
    "billing_document_is_cancelled",
  ).default(false),
  cancelled_billing_document: text("cancelled_billing_document"),
  total_net_amount: real("total_net_amount"),
  transaction_currency: text("transaction_currency"),
  company_code: text("company_code"),
  fiscal_year: text("fiscal_year"),
  accounting_document: text("accounting_document"),
  sold_to_party: text("sold_to_party"),
});

// ── Billing Document Items ──────────────────────────────────────────────────

export const billingDocumentItems = pgTable(
  "billing_document_items",
  {
    billing_document: text("billing_document").notNull(),
    billing_document_item: text("billing_document_item").notNull(),
    material: text("material"),
    billing_quantity: real("billing_quantity"),
    billing_quantity_unit: text("billing_quantity_unit"),
    net_amount: real("net_amount"),
    transaction_currency: text("transaction_currency"),
    reference_sd_document: text("reference_sd_document"),
    reference_sd_document_item: text("reference_sd_document_item"),
  },
  (t) => [
    primaryKey({ columns: [t.billing_document, t.billing_document_item] }),
  ],
);

// ── Journal Entries ─────────────────────────────────────────────────────────

export const journalEntries = pgTable(
  "journal_entries",
  {
    company_code: text("company_code").notNull(),
    fiscal_year: text("fiscal_year").notNull(),
    accounting_document: text("accounting_document").notNull(),
    gl_account: text("gl_account"),
    reference_document: text("reference_document"),
    cost_center: text("cost_center"),
    profit_center: text("profit_center"),
    transaction_currency: text("transaction_currency"),
    amount_in_transaction_currency: real("amount_in_transaction_currency"),
    company_code_currency: text("company_code_currency"),
    amount_in_company_code_currency: real("amount_in_company_code_currency"),
    posting_date: text("posting_date"),
    document_date: text("document_date"),
    accounting_document_type: text("accounting_document_type"),
    accounting_document_item: text("accounting_document_item").notNull(),
    assignment_reference: text("assignment_reference"),
    last_change_date_time: text("last_change_date_time"),
    customer: text("customer"),
    financial_account_type: text("financial_account_type"),
    clearing_date: text("clearing_date"),
    clearing_accounting_document: text("clearing_accounting_document"),
    clearing_doc_fiscal_year: text("clearing_doc_fiscal_year"),
  },
  (t) => [
    primaryKey({
      columns: [
        t.company_code,
        t.fiscal_year,
        t.accounting_document,
        t.accounting_document_item,
      ],
    }),
  ],
);

// ── Payments ────────────────────────────────────────────────────────────────

export const payments = pgTable(
  "payments",
  {
    company_code: text("company_code").notNull(),
    fiscal_year: text("fiscal_year").notNull(),
    accounting_document: text("accounting_document").notNull(),
    accounting_document_item: text("accounting_document_item").notNull(),
    clearing_date: text("clearing_date"),
    clearing_accounting_document: text("clearing_accounting_document"),
    clearing_doc_fiscal_year: text("clearing_doc_fiscal_year"),
    amount_in_transaction_currency: real("amount_in_transaction_currency"),
    transaction_currency: text("transaction_currency"),
    amount_in_company_code_currency: real("amount_in_company_code_currency"),
    company_code_currency: text("company_code_currency"),
    customer: text("customer"),
    invoice_reference: text("invoice_reference"),
    invoice_reference_fiscal_year: text("invoice_reference_fiscal_year"),
    sales_document: text("sales_document"),
    sales_document_item: text("sales_document_item"),
    posting_date: text("posting_date"),
    document_date: text("document_date"),
    assignment_reference: text("assignment_reference"),
    gl_account: text("gl_account"),
    financial_account_type: text("financial_account_type"),
    profit_center: text("profit_center"),
    cost_center: text("cost_center"),
  },
  (t) => [
    primaryKey({
      columns: [
        t.company_code,
        t.fiscal_year,
        t.accounting_document,
        t.accounting_document_item,
      ],
    }),
  ],
);

// ── Customers ───────────────────────────────────────────────────────────────

export const customers = pgTable("customers", {
  customer_id: text("customer_id").primaryKey(),
  customer: text("customer"),
  business_partner_category: text("business_partner_category"),
  business_partner_full_name: text("business_partner_full_name"),
  business_partner_name: text("business_partner_name"),
  form_of_address: text("form_of_address"),
  industry: text("industry"),
  organization_bp_name1: text("organization_bp_name1"),
  organization_bp_name2: text("organization_bp_name2"),
  business_partner_is_blocked: boolean(
    "business_partner_is_blocked",
  ).default(false),
  creation_date: text("creation_date"),
  last_change_date: text("last_change_date"),
});

// ── Customer Addresses ──────────────────────────────────────────────────────

export const customerAddresses = pgTable("customer_addresses", {
  business_partner: text("business_partner").primaryKey(),
  address_id: text("address_id"),
  city_name: text("city_name"),
  country: text("country"),
  region: text("region"),
  street_name: text("street_name"),
  postal_code: text("postal_code"),
  address_time_zone: text("address_time_zone"),
});

// ── Products ────────────────────────────────────────────────────────────────

export const products = pgTable("products", {
  product: text("product").primaryKey(),
  product_type: text("product_type"),
  cross_plant_status: text("cross_plant_status"),
  creation_date: text("creation_date"),
  created_by_user: text("created_by_user"),
  last_change_date: text("last_change_date"),
  is_marked_for_deletion: boolean("is_marked_for_deletion").default(false),
  product_old_id: text("product_old_id"),
  gross_weight: real("gross_weight"),
  weight_unit: text("weight_unit"),
  net_weight: real("net_weight"),
  product_group: text("product_group"),
  base_unit: text("base_unit"),
  division: text("division"),
  industry_sector: text("industry_sector"),
});

// ── Product Descriptions ────────────────────────────────────────────────────

export const productDescriptions = pgTable(
  "product_descriptions",
  {
    product: text("product").notNull(),
    language: text("language").notNull(),
    product_description: text("product_description"),
  },
  (t) => [primaryKey({ columns: [t.product, t.language] })],
);

// ── Plants ──────────────────────────────────────────────────────────────────

export const plants = pgTable("plants", {
  plant: text("plant").primaryKey(),
  plant_name: text("plant_name"),
  valuation_area: text("valuation_area"),
  plant_customer: text("plant_customer"),
  plant_supplier: text("plant_supplier"),
  factory_calendar: text("factory_calendar"),
  sales_organization: text("sales_organization"),
  address_id: text("address_id"),
  plant_category: text("plant_category"),
  language: text("language"),
});

// ── Graph Edges ─────────────────────────────────────────────────────────────

export const graphEdges = pgTable(
  "graph_edges",
  {
    id: serial("id").primaryKey(),
    source_type: text("source_type").notNull(),
    source_id: text("source_id").notNull(),
    target_type: text("target_type").notNull(),
    target_id: text("target_id").notNull(),
    edge_type: text("edge_type").notNull(),
    metadata: jsonb("metadata"),
  },
  (t) => [
    index("idx_graph_edges_source").on(t.source_type, t.source_id),
    index("idx_graph_edges_target").on(t.target_type, t.target_id),
    index("idx_graph_edges_type").on(t.edge_type),
  ],
);
