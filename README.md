# Graph-Based Data Modeling and Query System

A context graph system with an LLM-powered query interface built on SAP Order-to-Cash data. Visualize interconnected business entities as a graph and query them using natural language — the system generates SQL, executes it, and returns data-backed answers.

**Live Demo:** `https://dodge-liart.vercel.app`

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 14 (App Router) | Full-stack in one deployable unit — frontend, API, and DB access |
| Database | PostgreSQL (Neon) | LLMs generate reliable SQL; serverless free tier; relational integrity |
| Graph Viz | React Flow | Built-in zoom/pan/custom nodes for interactive graph exploration |
| LLM | Gemini 2.0 Flash | Native JSON output mode, fast, strong SQL generation |
| Styling | Tailwind + shadcn/ui | Clean, professional UI with minimal code |
| Deployment | Vercel | Zero-config for Next.js, instant demo URLs |

---

## Architecture

```
User Question
  → Guardrails (keyword check + LLM classifier)
    → Gemini Pass 1: generate SQL (temperature: 0, JSON mode)
      → SQL Validator (SELECT-only, no injection)
        → Execute on PostgreSQL
          → Gemini Pass 2: summarize results into natural language
            → Answer with cited numbers + viewable SQL
```

**Why two LLM passes?** A single pass would either hallucinate data or need the entire dataset in context. The two-pass pattern guarantees every answer is grounded in actual query results — the LLM never invents numbers.

---

## Database Choice: PostgreSQL over Neo4j

We model graph relationships inside PostgreSQL using a dedicated `graph_edges` table rather than using a native graph database. Three reasons:

1. **SQL generation reliability.** LLMs produce correct SQL ~95% of the time. Cypher accuracy is significantly lower — more retries, worse UX.

2. **Best of both paradigms.** Entity tables give us relational integrity (composite PKs, typed columns, aggregations). The `graph_edges` table gives us graph traversal for the visualization. One database serves both needs.

3. **Operational simplicity.** One data store, one connection string, one hosting provider. No sync between two databases.

The `graph_edges` table stores ~2000+ explicit relationships across 15 edge types:

```sql
-- This IS a graph query
SELECT * FROM graph_edges
WHERE source_type = 'sales_order' AND source_id = '740506';
```

Edge types include: `SOLD_TO`, `HAS_ITEM`, `FULFILLS_ORDER`, `BILLS_DELIVERY`, `GENERATES_JOURNAL_ENTRY`, `CLEARED_BY`, and 9 others — covering the full O2C chain from order to payment.

---

## Guardrails

Three layers, each catching what the previous one misses:

### Layer 1 — Keyword Filter (instant, no API call)

Fast allow/block lists. Handles ~80% of inputs at zero cost.

- **Allow:** order, delivery, billing, payment, customer, product, trace, flow, amount, revenue...
- **Block:** recipe, poem, weather, capital of, write me, code, movie, lyrics...

### Layer 2 — LLM Classifier (for ambiguous inputs)

Single-token Gemini call: "Is this about Order-to-Cash data? YES/NO." Adds ~200ms only when keyword check is inconclusive.

### Layer 3 — SQL Validation (before execution)

Structural regex checks on every generated query:

- Must be `SELECT` only
- No `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `CREATE`
- No semicolons, comments, or `SELECT INTO`
- Max 2000 characters, 10-second execution timeout

**Rejection message** (consistent across all layers):
> "This system is designed to answer questions related to the SAP Order-to-Cash dataset only."

| Input | Layer | Result |
|---|---|---|
| "What is the capital of France?" | 1 | Rejected |
| "Tell me about machine learning" | 2 | Rejected |
| `DROP TABLE sales_orders;` | 3 | Rejected |
| "Find orders delivered but not billed" | 1 | Allowed |

---

## Data Model

The O2C flow is a chain: **Sales Order → Delivery → Billing → Journal Entry → Payment**

13 entity tables, ~1200 core records. Edges are derived from foreign key relationships during ingestion — not stored in the source data.

Raw data preprocessing: camelCase → snake_case, string numbers → real types, empty strings → null, nested time objects → flat strings, dropped 2 redundant/irrelevant tables.

---

## Project Structure

```
src/
├── app/
│   ├── page.tsx                 # Split layout: graph (65%) + chat (35%)
│   └── api/
│       ├── graph/route.ts       # Graph data (clusters, expand, neighbors)
│       ├── chat/route.ts        # NL → SQL → Execute → Summarize
│       ├── trace/route.ts       # O2C flow tracing + broken flow detection
│       └── node/[id]/route.ts   # Entity metadata + connections
├── components/
│   ├── GraphCanvas.tsx          # React Flow interactive graph
│   ├── ChatPanel.tsx            # Chat with SQL transparency
│   ├── NodeDetail.tsx           # Entity detail panel
│   └── TraceFlow.tsx            # Visual O2C pipeline
├── db/
│   ├── schema.ts                # Drizzle ORM definitions
│   └── client.ts                # Neon connection + raw SQL executor
└── lib/
    ├── llm.ts                   # Gemini (generateSQL + summarizeResults)
    ├── guardrails.ts            # Topic check + SQL validation
    └── sql-executor.ts          # Safe execution wrapper
```

---

## Quick Start

```bash
npm install
cp .env.example .env.local       # Add DATABASE_URL + GEMINI_API_KEY
npx drizzle-kit push             # Create tables
npx tsx scripts/preprocess.ts    # Clean raw data
npx tsx scripts/ingest.ts        # Load data + build edges
npm run dev                      # http://localhost:3000
```
