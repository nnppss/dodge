import { NextRequest } from "next/server";
import { generateSQL, summarizeResultsStream, extractTraceEntity } from "@/lib/llm";
import { executeSafeSQL } from "@/lib/sql-executor";
import { isOnTopic, getRejectMessage, validateSQL } from "@/lib/guardrails";

/* ── Trace-query detection ─────────────────────────────────────────────── */

const TRACE_KEYWORDS =
  /\b(trace|flow|full\s+flow|end\s+to\s+end|e2e|chain|o2c|order.to.cash)\b/i;
const LONG_ID = /\b\d{6,}\b/;

function isTraceQuery(msg: string): boolean {
  return TRACE_KEYWORDS.test(msg) && LONG_ID.test(msg);
}

/* ── Handler ───────────────────────────────────────────────────────────── */

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  function encode(data: Record<string, unknown>): Uint8Array {
    return encoder.encode(JSON.stringify(data) + "\n");
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const body = await request.json();
        const message: string | undefined = body.message;

        if (!message || typeof message !== "string" || message.trim().length === 0) {
          controller.enqueue(encode({ type: "answer", answer: "Please provide a valid question." }));
          controller.enqueue(encode({ type: "done" }));
          controller.close();
          return;
        }

        if (!(await isOnTopic(message))) {
          controller.enqueue(encode({ type: "answer", answer: getRejectMessage() }));
          controller.enqueue(encode({ type: "done" }));
          controller.close();
          return;
        }

        /* ── Trace path ──────────────────────────────────────────────── */

        if (isTraceQuery(message)) {
          const extracted = await extractTraceEntity(message);

          if (extracted) {
            try {
              const origin = new URL(request.url).origin;
              const traceRes = await fetch(`${origin}/api/trace`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(extracted),
              });

              if (traceRes.ok) {
                const traceData = await traceRes.json();
                const foundCount = (traceData.flow ?? []).filter(
                  (s: { status: string }) => s.status === "found",
                ).length;
                const typePretty = extracted.entityType.replace(/_/g, " ");
                const issueNote =
                  traceData.issues?.length > 0
                    ? ` Found ${traceData.issues.length} issue(s).`
                    : "";

                controller.enqueue(encode({
                  type: "trace",
                  answer: `Traced the full Order-to-Cash flow for ${typePretty} ${extracted.entityId}. The flow is ${traceData.isComplete ? "complete" : "incomplete"} — ${foundCount} of 5 steps have entities.${issueNote}`,
                  trace: {
                    ...traceData,
                    entityType: extracted.entityType,
                    entityId: extracted.entityId,
                  },
                }));
                controller.enqueue(encode({ type: "done" }));
                controller.close();
                return;
              }

              controller.enqueue(encode({
                type: "answer",
                answer: "Unable to trace the flow for this entity. The trace service returned an error.",
              }));
              controller.enqueue(encode({ type: "done" }));
              controller.close();
              return;
            } catch {
              controller.enqueue(encode({
                type: "answer",
                answer: "Unable to trace the flow for this entity. Please try again.",
              }));
              controller.enqueue(encode({ type: "done" }));
              controller.close();
              return;
            }
          }
        }

        /* ── Normal SQL path ─────────────────────────────────────────── */

        const sqlResult = await generateSQL(message);

        if ("error" in sqlResult) {
          controller.enqueue(encode({ type: "answer", answer: sqlResult.error }));
          controller.enqueue(encode({ type: "done" }));
          controller.close();
          return;
        }

        const { sql, explanation } = sqlResult;

        const validation = validateSQL(sql);
        if (!validation.valid) {
          controller.enqueue(encode({
            type: "answer",
            answer: `Generated query was rejected: ${validation.reason}`,
            sql,
          }));
          controller.enqueue(encode({ type: "done" }));
          controller.close();
          return;
        }

        const { rows, error: execError } = await executeSafeSQL(sql);

        if (execError) {
          controller.enqueue(encode({
            type: "answer",
            answer: "I generated a query but it failed to execute. Please try rephrasing your question.",
            sql,
          }));
          controller.enqueue(encode({ type: "done" }));
          controller.close();
          return;
        }

        controller.enqueue(encode({
          type: "meta",
          sql,
          results: rows.slice(0, 20),
          explanation,
        }));

        for await (const chunk of summarizeResultsStream(message, sql, rows, explanation)) {
          controller.enqueue(encode({ type: "text", chunk }));
        }

        controller.enqueue(encode({ type: "done" }));
        controller.close();
      } catch (err: any) {
        console.error("[chat] Error:", err);

        const msg = err?.message ?? String(err);
        const isRateLimit =
          err?.status === 429 ||
          msg.includes("429") ||
          msg.includes("Too Many Requests") ||
          msg.includes("quota");

        const answer = isRateLimit
          ? "The AI service is temporarily rate-limited. Please wait a moment and try again."
          : "Something went wrong. Please try again.";

        try {
          controller.enqueue(encode({ type: "answer", answer }));
          controller.enqueue(encode({ type: "done" }));
          controller.close();
        } catch {
          /* stream already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
