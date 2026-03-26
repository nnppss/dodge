import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

/* ── Keyword lists for fast Layer-1 classification ─────────────────────── */

const ALLOW_KEYWORDS = [
  "order", "delivery", "deliveries", "billing", "invoice", "payment",
  "journal", "customer", "product", "plant", "sales", "shipped", "ship",
  "cancelled", "cancel", "amount", "total", "material", "flow", "trace",
  "document", "status", "quantity", "billed", "unbilled", "revenue",
  "value", "transaction", "currency", "inr", "account", "clearing",
  "incomplete", "broken", "missing", "highest", "lowest", "most", "least",
  "top", "bottom", "average", "count", "sum", "how many", "which",
  "compare", "between", "list", "show", "find", "o2c", "order to cash",
  "sap",
];

const REJECT_KEYWORDS = [
  "recipe", "cook", "poem", "story", "write me", "code", "python",
  "javascript", "weather", "capital of", "president", "translate",
  "summarize this article", "explain quantum", "tell me a joke", "who won",
  "movie", "song", "lyrics",
];

/* ── Forbidden SQL tokens ──────────────────────────────────────────────── */

const FORBIDDEN_SQL_TOKENS = [
  "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "TRUNCATE",
  "GRANT", "REVOKE", "EXEC", "EXECUTE", "INTO",
];

/* ── isOnTopic ─────────────────────────────────────────────────────────── */

export async function isOnTopic(message: string): Promise<boolean> {
  const lower = message.toLowerCase();

  // Layer 1a: fast allow
  if (ALLOW_KEYWORDS.some((kw) => lower.includes(kw))) return true;

  // Layer 1b: fast reject
  if (REJECT_KEYWORDS.some((kw) => lower.includes(kw))) return false;

  // Layer 2: LLM classification for ambiguous messages
  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash-lite",
      systemInstruction:
        "You classify whether questions are about a business Order-to-Cash dataset " +
        "(sales orders, deliveries, billing, invoices, payments, journal entries, customers, " +
        "products, plants). Reply ONLY with YES or NO.",
      generationConfig: { temperature: 0, maxOutputTokens: 10 },
    });

    const result = await model.generateContent(message);
    const answer = result.response.text().trim().toUpperCase();
    return answer.startsWith("YES");
  } catch (err) {
    console.error("[guardrails] LLM topic check failed:", err);
    return true; // fail-open so legitimate queries aren't blocked
  }
}

/* ── getRejectMessage ──────────────────────────────────────────────────── */

export function getRejectMessage(): string {
  return (
    "This system is designed to answer questions related to the SAP Order-to-Cash " +
    "dataset only. You can ask about sales orders, deliveries, billing documents, " +
    "payments, customers, and products."
  );
}

/* ── validateSQL ───────────────────────────────────────────────────────── */

export function validateSQL(sql: string): { valid: boolean; reason?: string } {
  const trimmed = sql.trim();
  const upper = trimmed.toUpperCase();

  if (!upper.startsWith("SELECT")) {
    return { valid: false, reason: "Query must start with SELECT." };
  }

  for (const token of FORBIDDEN_SQL_TOKENS) {
    const pattern = new RegExp(`\\b${token}\\b`, "i");
    if (pattern.test(trimmed)) {
      return { valid: false, reason: `Forbidden keyword detected: ${token}.` };
    }
  }

  if (trimmed.includes("--")) {
    return { valid: false, reason: "SQL line comments (--) are not allowed." };
  }

  if (trimmed.includes("/*")) {
    return { valid: false, reason: "SQL block comments (/*) are not allowed." };
  }

  if (trimmed.includes(";")) {
    return { valid: false, reason: "Semicolons are not allowed." };
  }

  if (trimmed.length >= 2000) {
    return { valid: false, reason: "Query exceeds 2000-character limit." };
  }

  return { valid: true };
}
