import { executeRawSQL } from "@/db/client";

const FORBIDDEN_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "CREATE",
  "TRUNCATE",
  "GRANT",
  "REVOKE",
  "EXEC",
  "EXECUTE",
  "--",
  "/*",
];

const FORBIDDEN_PATTERNS = [
  /\bSELECT\b[^)]*\bINTO\b/i,
];

const MAX_QUERY_LENGTH = 2000;
const TIMEOUT_MS = 10_000;

function sanitize(raw: string): string {
  let sql = raw.trim();

  // Strip markdown code fences Gemini occasionally wraps around SQL
  sql = sql.replace(/^```(?:sql)?\s*/i, "").replace(/\s*```$/i, "");

  // Strip trailing semicolons + whitespace (handles ";", ";;", "; \n" etc.)
  sql = sql.replace(/[;\s]+$/, "").trim();

  // If Gemini generated multiple statements, keep only the first SELECT
  if (sql.includes(";")) {
    const first = sql.slice(0, sql.indexOf(";")).trim();
    if (first.toUpperCase().startsWith("SELECT")) {
      sql = first;
    }
  }

  return sql.trim();
}

function validate(sql: string): string | null {
  if (!sql.toUpperCase().startsWith("SELECT")) {
    return "Query rejected: only SELECT statements are allowed";
  }

  // Reject mid-query semicolons (multi-statement injection)
  if (sql.includes(";")) {
    return "Query rejected: semicolons are not allowed";
  }

  if (sql.length > MAX_QUERY_LENGTH) {
    return `Query rejected: query exceeds ${MAX_QUERY_LENGTH} character limit`;
  }

  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (keyword === "--" || keyword === "/*") {
      if (sql.includes(keyword)) {
        return `Query rejected: forbidden token "${keyword}" detected`;
      }
    } else if (new RegExp(`\\b${keyword}\\b`, "i").test(sql)) {
      return `Query rejected: forbidden keyword "${keyword}" detected`;
    }
  }

  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(sql)) {
      return "Query rejected: SELECT INTO is not allowed";
    }
  }

  return null;
}

export async function executeSafeSQL(
  rawSql: string
): Promise<{ rows: any[]; error?: string }> {
  const sql = sanitize(rawSql);

  const rejection = validate(sql);
  if (rejection) {
    return { rows: [], error: rejection };
  }

  try {
    const result = await Promise.race([
      executeRawSQL(sql),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Query timed out after 10 seconds")), TIMEOUT_MS)
      ),
    ]);

    return { rows: result };
  } catch (err: any) {
    return { rows: [], error: `Query execution failed: ${err.message ?? err}` };
  }
}
