import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

/* ── Model rotation (toggle on rate-limit) ─────────────────────────────── */
const MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"] as const;
let activeModelIdx = 0;

function getActiveModel(): string {
  return MODELS[activeModelIdx];
}

function toggleModel(): string {
  activeModelIdx = (activeModelIdx + 1) % MODELS.length;
  console.warn(`[llm] Switched to model: ${MODELS[activeModelIdx]}`);
  return MODELS[activeModelIdx];
}

/* ── Free-tier optimization config ──────────────────────────────────────── */
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 60_000;

/* ── In-memory response cache ───────────────────────────────────────────── */
const CACHE_LIMIT = 50;
const sqlCache = new Map<
  string,
  { sql: string; explanation: string } | { error: string }
>();
const summaryCache = new Map<string, string>();

function normalize(q: string): string {
  return q.toLowerCase().trim().replace(/\s+/g, " ");
}

function setCache<V>(map: Map<string, V>, key: string, value: V) {
  if (map.size >= CACHE_LIMIT) {
    map.delete(map.keys().next().value!);
  }
  map.set(key, value);
}

/* ── Robust JSON parser for Gemini responses ───────────────────────────── */
function safeParseJson(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    if (start === -1) throw new Error("No JSON object found in LLM response");

    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < raw.length; i++) {
      const ch = raw[i];
      if (esc) { esc = false; continue; }
      if (ch === "\\" && inStr) { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return JSON.parse(raw.slice(start, i + 1));
      }
    }
    throw new Error("Unbalanced JSON in LLM response");
  }
}

function isRateLimitError(err: any): boolean {
  return (
    err?.status === 429 ||
    err?.message?.includes("429") ||
    err?.message?.includes("Too Many Requests") ||
    err?.message?.includes("quota")
  );
}

/* ── Retry wrapper: 2 attempts, toggles model on 429, 60 s gap ─────────── */
async function callWithRetry<T>(
  fn: (modelName: string) => Promise<T>
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn(getActiveModel());
    } catch (err: any) {
      if (isRateLimitError(err) && attempt < MAX_ATTEMPTS) {
        const nextModel = toggleModel();
        console.warn(
          `[llm] Rate-limited on attempt ${attempt}, switching to ${nextModel}, retrying in ${RETRY_DELAY_MS / 1000}s…`
        );
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Retry limit reached");
}

/* ── Compact system instructions ────────────────────────────────────────── *
 * ~40 % fewer tokens than the verbose version while keeping every column,  *
 * FK, and join path the model needs.                                       *
 * ────────────────────────────────────────────────────────────────────────── */

const SQL_SYSTEM_INSTRUCTION = `SQL generator for SAP O2C PostgreSQL DB. Convert questions to SELECT queries.

SCHEMA (PK=primary key, →=foreign key, R=REAL, B=BOOLEAN, T=TEXT):

sales_orders(sales_order PK T, sales_order_type, sales_organization, distribution_channel, sold_to_party→customers.customer_id, creation_date, total_net_amount R INR, overall_delivery_status, transaction_currency, requested_delivery_date, customer_payment_terms)

sales_order_items(sales_order FK, sales_order_item, material→products.product, requested_quantity R, net_amount R, production_plant→plants.plant, storage_location) PK(sales_order,sales_order_item)

deliveries(delivery_document PK T, shipping_point, creation_date, overall_goods_movement_status, overall_picking_status)

delivery_items(delivery_document FK, delivery_document_item, actual_delivery_quantity R, plant→plants.plant, reference_sd_document→sales_orders.sales_order, reference_sd_document_item, storage_location) PK(delivery_document,delivery_document_item)

billing_documents(billing_document PK T, billing_document_type, creation_date, billing_document_date, billing_document_is_cancelled B, total_net_amount R INR, transaction_currency, company_code, fiscal_year, accounting_document→journal_entries.accounting_document, sold_to_party→customers.customer_id)

billing_document_items(billing_document FK, billing_document_item, material→products.product, billing_quantity R, net_amount R, reference_sd_document→deliveries.delivery_document, reference_sd_document_item) PK(billing_document,billing_document_item)

journal_entries(company_code, fiscal_year, accounting_document, gl_account, reference_document→billing_documents.billing_document, customer→customers.customer_id, amount_in_transaction_currency R, posting_date, accounting_document_type, accounting_document_item, clearing_accounting_document, clearing_date, financial_account_type) PK(company_code,fiscal_year,accounting_document,accounting_document_item)

payments(company_code, fiscal_year, accounting_document, accounting_document_item, clearing_date, clearing_accounting_document, amount_in_transaction_currency R, customer→customers.customer_id, posting_date, gl_account) PK(company_code,fiscal_year,accounting_document,accounting_document_item)

customers(customer_id PK T, business_partner_full_name, business_partner_name, business_partner_is_blocked B)

customer_addresses(business_partner PK T =customer_id, city_name, country, region, street_name, postal_code)

products(product PK T, product_type, gross_weight R, weight_unit, net_weight R, product_group, base_unit, division)

product_descriptions(product FK, language, product_description) PK(product,language) Use language='EN'.

plants(plant PK T, plant_name, sales_organization, plant_category)

O2C JOIN CHAIN: sales_orders→sales_order_items(sales_order)→delivery_items(reference_sd_document=sales_order)→deliveries(delivery_document)→billing_document_items(reference_sd_document=delivery_document)→billing_documents(billing_document)→journal_entries(reference_document=billing_document)→payments(clearing_accounting_document=accounting_document)

PAYMENT STATUS: "pending/unpaid/open" = journal_entries.clearing_date IS NULL AND journal_entries.clearing_accounting_document IS NULL (receivable not cleared). "paid/cleared" = clearing_date IS NOT NULL. Use LEFT JOIN from journal_entries to payments to detect missing payments.

RULES: SELECT only, LIMIT 50, use aliases, LEFT JOIN product_descriptions for names, LEFT JOIN+NULL for broken flows, amounts in INR. NEVER include semicolons in SQL.

JSON: {"sql":"SELECT ...","explanation":"..."} or {"error":"SAP O2C queries only."}`;

const SUMMARY_SYSTEM_INSTRUCTION = `Data analyst. Given question, SQL, and results, answer in plain text (<200 words). Cite numbers, use ₹ for currency, mention entity IDs. No markdown. If empty say "No results found."`;

const TRACE_EXTRACT_INSTRUCTION = `Extract the SAP O2C entity type and ID from the user's question.

Entity types (use these exact strings): sales_order, delivery, billing_document, journal_entry, payment

Rules:
- The ID is typically a numeric value (6+ digits)
- "order"/"sales order"/"SO" → sales_order
- "delivery"/"DLV"/"shipment" → delivery
- "billing"/"invoice"/"BDoc" → billing_document
- "journal entry"/"JE"/"accounting document" → journal_entry
- "payment"/"PAY"/"clearing" → payment
- Default to sales_order if the type is ambiguous

JSON: {"entityType":"sales_order","entityId":"740506"}`;

/* ── extractTraceEntity (cached) ────────────────────────────────────────── */

const traceExtractCache = new Map<
  string,
  { entityType: string; entityId: string }
>();

export async function extractTraceEntity(
  question: string,
): Promise<{ entityType: string; entityId: string } | null> {
  const key = normalize(`trace:${question}`);
  const cached = traceExtractCache.get(key);
  if (cached) return cached;

  try {
    const result = await callWithRetry((modelName) => {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: TRACE_EXTRACT_INSTRUCTION,
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
        },
      });
      return model.generateContent(question);
    });
    const parsed = safeParseJson(result.response.text());

    if (!parsed.entityType || !parsed.entityId) return null;

    const value = {
      entityType: String(parsed.entityType),
      entityId: String(parsed.entityId),
    };
    setCache(traceExtractCache, key, value);
    return value;
  } catch (err) {
    console.error("[llm] extractTraceEntity failed:", err);
    return null;
  }
}

/* ── generateSQL (cached) ───────────────────────────────────────────────── */

export async function generateSQL(
  userQuestion: string
): Promise<{ sql: string; explanation: string } | { error: string }> {
  const key = normalize(userQuestion);
  const cached = sqlCache.get(key);
  if (cached) return cached;

  const result = await callWithRetry((modelName) => {
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: SQL_SYSTEM_INSTRUCTION,
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    });
    return model.generateContent(userQuestion);
  });
  const parsed = safeParseJson(result.response.text());

  const value: { sql: string; explanation: string } | { error: string } =
    parsed.error
      ? { error: parsed.error }      
      : { sql: parsed.sql?.replace(/[;\s]+$/, ""), explanation: parsed.explanation };

  setCache(sqlCache, key, value);
  return value;
}

/* ── summarizeResults (cached, with local fallback) ─────────────────────── */

function localSummary(
  results: any[],
  explanation: string
): string {
  if (results.length === 0) return "No results found for this query.";

  const n = results.length;
  const cols = Object.keys(results[0]);
  const lines: string[] = [explanation, ""];

  for (const row of results.slice(0, 10)) {
    const parts = cols.map((c) => {
      const v = row[c];
      if (v == null) return null;
      const label = c.replace(/_/g, " ");
      if (typeof v === "number" && /amount|net|total/i.test(c)) {
        return `${label}: ₹${v.toLocaleString("en-IN")}`;
      }
      return `${label}: ${v}`;
    }).filter(Boolean);
    lines.push(parts.join(" | "));
  }

  if (n > 10) lines.push(`\n…and ${n - 10} more rows.`);
  return lines.join("\n");
}

export async function summarizeResults(
  question: string,
  sql: string,
  results: any[],
  explanation: string
): Promise<string> {
  const cacheKey = normalize(`${question}::${sql}::${results.length}`);
  const cached = summaryCache.get(cacheKey);
  if (cached) return cached;

  try {
    const prompt = `Question: ${question}\nSQL: ${sql}\nResults: ${JSON.stringify(results.slice(0, 20))}\nExplanation: ${explanation}`;

    const result = await callWithRetry((modelName) => {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: SUMMARY_SYSTEM_INSTRUCTION,
        generationConfig: { temperature: 0.3 },
      });
      return model.generateContent(prompt);
    });

    const text = result.response.text();
    setCache(summaryCache, cacheKey, text);
    return text;
  } catch {
    const fallback = localSummary(results, explanation);
    setCache(summaryCache, cacheKey, fallback);
    return fallback;
  }
}

/* ── summarizeResultsStream (streaming variant) ──────────────────────────── */

export async function* summarizeResultsStream(
  question: string,
  sql: string,
  results: any[],
  explanation: string
): AsyncGenerator<string> {
  const cacheKey = normalize(`${question}::${sql}::${results.length}`);
  const cached = summaryCache.get(cacheKey);
  if (cached) {
    yield cached;
    return;
  }

  try {
    const prompt = `Question: ${question}\nSQL: ${sql}\nResults: ${JSON.stringify(results.slice(0, 20))}\nExplanation: ${explanation}`;

    const streamResult = await callWithRetry((modelName) => {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: SUMMARY_SYSTEM_INSTRUCTION,
        generationConfig: { temperature: 0.3 },
      });
      return model.generateContentStream(prompt);
    });

    let full = "";
    for await (const chunk of streamResult.stream) {
      const text = chunk.text();
      if (text) {
        full += text;
        yield text;
      }
    }

    if (full) setCache(summaryCache, cacheKey, full);
  } catch {
    const fallback = localSummary(results, explanation);
    setCache(summaryCache, cacheKey, fallback);
    yield fallback;
  }
}
