import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(__dirname, '..', 'data', 'sap-o2c-data');
const OUT_DIR = path.resolve(__dirname, '..', 'data', 'cleaned');

const SKIP_FOLDERS = new Set([
  'billing_document_cancellations',
  'product_storage_locations',
]);

const FOLDER_TO_OUTPUT: Record<string, string> = {
  sales_order_headers: 'sales_orders',
  outbound_delivery_headers: 'deliveries',
  outbound_delivery_items: 'delivery_items',
  billing_document_headers: 'billing_documents',
  billing_document_items: 'billing_document_items',
  journal_entry_items_accounts_receivable: 'journal_entries',
  payments_accounts_receivable: 'payments',
  business_partners: 'customers',
  business_partner_addresses: 'customer_addresses',
};

// ── Key conversion ──────────────────────────────────────────────────────────

function camelToSnake(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

// ── Value transformations ───────────────────────────────────────────────────

const ID_KEYWORDS = [
  'order',
  'document',
  'party',
  'partner',
  'customer',
  'product',
  'plant',
  'account',
  'material',
  'reference',
  'item',
];

const NUMERIC_KEYWORDS = [
  'amount',
  'quantity',
  'weight',
  'net_amount',
  'gross_weight',
];

function isIdField(snakeKey: string): boolean {
  return ID_KEYWORDS.some((kw) => snakeKey.includes(kw));
}

function isNumericField(snakeKey: string): boolean {
  return NUMERIC_KEYWORDS.some((kw) => snakeKey.includes(kw));
}

function isTimeObject(val: unknown): val is { hours: number; minutes: number; seconds: number } {
  if (typeof val !== 'object' || val === null) return false;
  const obj = val as Record<string, unknown>;
  return (
    typeof obj.hours === 'number' &&
    typeof obj.minutes === 'number' &&
    typeof obj.seconds === 'number'
  );
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function transformRecord(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw)) {
    const snakeKey = camelToSnake(key);

    if (isTimeObject(value)) {
      out[snakeKey] = `${pad2(value.hours)}:${pad2(value.minutes)}:${pad2(value.seconds)}`;
      continue;
    }

    if (value === '') {
      out[snakeKey] = null;
      continue;
    }

    if (typeof value === 'string' && !isIdField(snakeKey) && isNumericField(snakeKey)) {
      const num = parseFloat(value);
      out[snakeKey] = isNaN(num) ? value : num;
      continue;
    }

    out[snakeKey] = value;
  }

  return out;
}

// ── File I/O helpers ────────────────────────────────────────────────────────

function readJsonlFolder(folderPath: string): Record<string, unknown>[] {
  const files = fs.readdirSync(folderPath).filter((f) => f.endsWith('.jsonl'));
  const records: Record<string, unknown>[] = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(folderPath, file), 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      records.push(JSON.parse(trimmed));
    }
  }

  return records;
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const folders = fs
    .readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !SKIP_FOLDERS.has(d.name))
    .map((d) => d.name);

  const summary: { entity: string; records: number; fields: string }[] = [];

  for (const folder of folders) {
    const outputName = FOLDER_TO_OUTPUT[folder] ?? folder;
    const folderPath = path.join(DATA_DIR, folder);

    const rawRecords = readJsonlFolder(folderPath);
    const cleaned = rawRecords.map(transformRecord);

    const outFile = path.join(OUT_DIR, `${outputName}.json`);
    fs.writeFileSync(outFile, JSON.stringify(cleaned, null, 2), 'utf-8');

    const exampleFields = cleaned.length > 0 ? Object.keys(cleaned[0]).slice(0, 5).join(', ') : '—';
    summary.push({ entity: outputName, records: cleaned.length, fields: exampleFields });
  }

  // Print summary table
  const entityWidth = Math.max('Entity'.length, ...summary.map((s) => s.entity.length));
  const recordsWidth = Math.max('Records'.length, ...summary.map((s) => String(s.records).length));

  const header = `${'Entity'.padEnd(entityWidth)}  ${'Records'.padStart(recordsWidth)}  Example Fields`;
  const divider = '-'.repeat(header.length + 20);

  console.log('\n' + divider);
  console.log(header);
  console.log(divider);

  for (const row of summary) {
    console.log(
      `${row.entity.padEnd(entityWidth)}  ${String(row.records).padStart(recordsWidth)}  ${row.fields}`
    );
  }

  console.log(divider);
  console.log(`\nTotal entities: ${summary.length}`);
  console.log(`Output directory: ${OUT_DIR}\n`);
}

main();
