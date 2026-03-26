"use client";

import { useCallback, useEffect, useRef, useState, Fragment } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SendHorizonal,
  ChevronDown,
  ChevronRight,
  Database,
  Sparkles,
  Trash2,
} from "lucide-react";
import TraceFlow from "@/components/TraceFlow";

interface TraceData {
  flow: { step: string; status: "found" | "missing" | "cancelled"; entities: { type: string; id: string; data: Record<string, unknown> }[] }[];
  isComplete: boolean;
  issues: string[];
  entityType: string;
  entityId: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  sql?: string;
  results?: any[];
  explanation?: string;
  trace?: TraceData;
}

type Phase = "idle" | "thinking" | "streaming";

interface ChatPanelProps {
  onHighlightNodes?: (nodeIds: string[]) => void;
}

const SUGGESTED_QUERIES = [
  "Which products have the most billing documents?",
  "Trace the full flow of sales order 740506",
  "Find orders that were delivered but not billed",
  "Top 5 customers by total order value",
];

const ENTITY_ID_PATTERN = /\b(\d{4,10})\b/g;

function extractEntityIds(text: string): string[] {
  const matches = text.match(ENTITY_ID_PATTERN);
  return matches ? [...new Set(matches)] : [];
}

function renderContentWithLinks(
  text: string,
  onClickId: (id: string) => void
) {
  const parts = text.split(ENTITY_ID_PATTERN);
  return parts.map((part, i) => {
    if (ENTITY_ID_PATTERN.test(part) && part.length >= 4) {
      ENTITY_ID_PATTERN.lastIndex = 0;
      return (
        <button
          key={i}
          onClick={() => onClickId(part)}
          className="font-mono text-primary underline underline-offset-2 decoration-primary/40 hover:decoration-primary cursor-pointer"
        >
          {part}
        </button>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function CollapsibleQuery({
  sql,
  results,
}: {
  sql: string;
  results?: any[];
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const PREVIEW_LIMIT = 5;
  const hasMore = results && results.length > PREVIEW_LIMIT;
  const visibleRows = expanded ? results : results?.slice(0, PREVIEW_LIMIT);

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? (
          <ChevronDown className="size-3" />
        ) : (
          <ChevronRight className="size-3" />
        )}
        <Database className="size-3" />
        View Query
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          <pre className="rounded-md bg-muted/80 p-2.5 text-[11px] leading-relaxed font-mono text-foreground/80 overflow-x-auto whitespace-pre-wrap break-words">
            {sql}
          </pre>

          {results && results.length > 0 && (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b bg-muted/60">
                    {Object.keys(results[0]).map((col) => (
                      <th
                        key={col}
                        className="px-2 py-1 text-left font-medium text-muted-foreground whitespace-nowrap"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows?.map((row, ri) => (
                    <tr key={ri} className="border-b last:border-0">
                      {Object.values(row).map((val, ci) => (
                        <td
                          key={ci}
                          className="px-2 py-1 whitespace-nowrap text-foreground/70"
                        >
                          {val == null ? "—" : String(val)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {hasMore && (
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="w-full px-2 py-1.5 text-[10px] font-medium text-primary hover:bg-muted/60 bg-muted/40 transition-colors cursor-pointer text-center"
                >
                  {expanded
                    ? "Show less"
                    : `+ ${results.length - PREVIEW_LIMIT} more rows`}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Typing indicator                                                          */
/* ═══════════════════════════════════════════════════════════════════════════ */

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-2.5 rounded-xl rounded-bl-sm bg-card ring-1 ring-foreground/[0.06] px-3.5 py-2.5 text-sm text-muted-foreground">
        <div className="flex items-center gap-1">
          <span className="typing-dot" />
          <span className="typing-dot animation-delay-150" />
          <span className="typing-dot animation-delay-300" />
        </div>
        <span className="text-xs">Thinking…</span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Stop button                                                               */
/* ═══════════════════════════════════════════════════════════════════════════ */

function StopButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="stop-button shrink-0"
      title="Stop generating"
    >
      <svg viewBox="0 0 24 24" className="size-7">
        <circle
          cx="12"
          cy="12"
          r="10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="stop-button-ring"
        />
        <rect
          x="9"
          y="9"
          width="6"
          height="6"
          rx="1"
          fill="currentColor"
        />
      </svg>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  NDJSON stream reader                                                      */
/* ═══════════════════════════════════════════════════════════════════════════ */

async function* readNDJSON(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<Record<string, any>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          yield JSON.parse(line);
        } catch {
          /* skip malformed lines */
        }
      }
    }

    if (buffer.trim()) {
      try { yield JSON.parse(buffer); } catch { /* skip */ }
    }
  } finally {
    reader.releaseLock();
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Main                                                                      */
/* ═══════════════════════════════════════════════════════════════════════════ */

export default function ChatPanel({ onHighlightNodes }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, phase]);

  const handleIdClick = useCallback(
    (id: string) => {
      onHighlightNodes?.([id]);
    },
    [onHighlightNodes]
  );

  const handleClearChat = useCallback(() => {
    setMessages([]);
    onHighlightNodes?.([]);
  }, [onHighlightNodes]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || phase !== "idle") return;

      setInputValue("");
      setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
      setPhase("thinking");

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed }),
          signal: controller.signal,
        });

        if (!res.body) throw new Error("No response body");

        let streamedContent = "";
        let meta: { sql?: string; results?: any[]; explanation?: string } = {};
        let messageAdded = false;

        for await (const event of readNDJSON(res.body, controller.signal)) {
          switch (event.type) {
            case "text": {
              streamedContent += event.chunk;
              if (!messageAdded) {
                messageAdded = true;
                setPhase("streaming");
                setMessages((prev) => [
                  ...prev,
                  { role: "assistant", content: streamedContent },
                ]);
              } else {
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    ...updated[updated.length - 1],
                    content: streamedContent,
                  };
                  return updated;
                });
              }
              break;
            }

            case "meta":
              meta = {
                sql: event.sql,
                results: event.results,
                explanation: event.explanation,
              };
              break;

            case "trace":
              setMessages((prev) => [
                ...prev,
                {
                  role: "assistant",
                  content: event.answer,
                  trace: event.trace,
                },
              ]);
              messageAdded = true;
              break;

            case "answer":
              setMessages((prev) => [
                ...prev,
                {
                  role: "assistant",
                  content: event.answer,
                  sql: event.sql ?? undefined,
                },
              ]);
              messageAdded = true;
              break;

            case "done":
              if (messageAdded && (meta.sql || meta.results)) {
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  updated[updated.length - 1] = {
                    ...last,
                    content: last.content || streamedContent || "No response received.",
                    sql: meta.sql,
                    results: meta.results,
                    explanation: meta.explanation,
                  };
                  return updated;
                });
              }
              break;
          }
        }

        if (!messageAdded) {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: "Sorry, I couldn\u2019t process that question. Please try again.",
            },
          ]);
        }

        const finalContent = streamedContent || "";
        if (finalContent) {
          const ids = extractEntityIds(finalContent);
          if (ids.length > 0) onHighlightNodes?.(ids);
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "Sorry, I couldn\u2019t process that question. Please try again.",
          },
        ]);
      } finally {
        abortRef.current = null;
        setPhase("idle");
        inputRef.current?.focus();
      }
    },
    [phase, onHighlightNodes]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      sendMessage(inputValue);
    },
    [inputValue, sendMessage]
  );

  const hasSentMessage = messages.length > 0;
  const isBusy = phase !== "idle";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <div>
            <h2 className="text-sm font-semibold text-foreground leading-tight">
              Chat with Graph
            </h2>
            <p className="text-[11px] text-muted-foreground">Order to Cash</p>
          </div>
        </div>
        {hasSentMessage && !isBusy && (
          <button
            onClick={handleClearChat}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-md px-2 py-1 hover:bg-muted"
          >
            <Trash2 className="size-3" />
            Clear
          </button>
        )}
      </div>

      {/* Message Area */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="flex flex-col gap-3 p-4">
          {!hasSentMessage && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">
                  Ask a question
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Query your SAP Order-to-Cash data in plain English
                </p>
              </div>

              <div className="grid grid-cols-1 gap-2 w-full max-w-sm">
                {SUGGESTED_QUERIES.map((q) => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    className="rounded-lg border bg-background px-3 py-2 text-left text-xs text-foreground/80 hover:bg-muted hover:text-foreground transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => {
            const isLastAssistant =
              phase === "streaming" &&
              msg.role === "assistant" &&
              i === messages.length - 1;

            return (
              <div
                key={i}
                className={
                  msg.role === "user"
                    ? "flex justify-end"
                    : "flex justify-start"
                }
              >
                <div
                  className={
                    msg.role === "user"
                      ? "max-w-[85%] rounded-xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground"
                      : `${msg.trace ? "max-w-full" : "max-w-[90%]"} rounded-xl rounded-bl-sm bg-card ring-1 ring-foreground/[0.06] px-3 py-2 text-sm text-card-foreground`
                  }
                >
                  {msg.role === "assistant" ? (
                    <>
                      <div className="whitespace-pre-wrap leading-relaxed">
                        {renderContentWithLinks(msg.content, handleIdClick)}
                        {isLastAssistant && (
                          <span className="streaming-cursor" />
                        )}
                      </div>
                      {msg.trace && (
                        <div className="mt-3">
                          <TraceFlow
                            flow={msg.trace.flow}
                            isComplete={msg.trace.isComplete}
                            issues={msg.trace.issues}
                            entityType={msg.trace.entityType}
                            entityId={msg.trace.entityId}
                          />
                        </div>
                      )}
                      {msg.sql && (
                        <CollapsibleQuery
                          sql={msg.sql}
                          results={msg.results}
                        />
                      )}
                    </>
                  ) : (
                    <span className="whitespace-pre-wrap">{msg.content}</span>
                  )}
                </div>
              </div>
            );
          })}

          {phase === "thinking" && <TypingIndicator />}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input Area */}
      <form
        onSubmit={handleSubmit}
        className="shrink-0 border-t px-3 py-2.5 flex items-center gap-2"
      >
        <Input
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Analyze anything"
          disabled={isBusy}
          className="flex-1 h-9"
        />
        {isBusy ? (
          <StopButton onClick={handleStop} />
        ) : (
          <Button
            type="submit"
            size="icon"
            disabled={!inputValue.trim()}
            className="shrink-0"
          >
            <SendHorizonal className="size-4" />
          </Button>
        )}
      </form>
    </div>
  );
}
