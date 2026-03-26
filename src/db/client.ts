import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql as rawSql } from "drizzle-orm";
import * as schema from "./schema";

const connection = neon(process.env.DATABASE_URL!);

export const db = drizzle(connection, { schema });

export async function executeRawSQL(query: string): Promise<Record<string, unknown>[]> {
  const result = await db.execute(rawSql.raw(query));
  return result.rows as Record<string, unknown>[];
}
