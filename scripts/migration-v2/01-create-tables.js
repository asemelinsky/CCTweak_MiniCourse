#!/usr/bin/env node
// scripts/migration-v2/01-create-tables.js
// Creates 4 new NocoDB tables for v2 multi-course schema.
// Idempotent: skips tables that already exist.
//
// Run:
//   source /tmp/vercel-env.sh
//   node scripts/migration-v2/01-create-tables.js
//
// Writes table IDs to scripts/migration-v2/.table-ids.json for downstream scripts.

const fs = require('fs');
const path = require('path');

const NOCODB_URL = process.env.NOCODB_URL;
const NOCODB_TOKEN = process.env.NOCODB_TOKEN;
const NOCODB_BASIC_AUTH = process.env.NOCODB_BASIC_AUTH;
const BASE_ID = process.env.NOCODB_BASE_ID;

if (!NOCODB_URL || !NOCODB_TOKEN || !BASE_ID) {
  console.error('Missing env: NOCODB_URL / NOCODB_TOKEN / NOCODB_BASE_ID');
  process.exit(1);
}

async function api(method, path, body) {
  const headers = {
    'xc-token': NOCODB_TOKEN,
    'Content-Type': 'application/json',
  };
  if (NOCODB_BASIC_AUTH) {
    headers.Authorization = 'Basic ' + Buffer.from(NOCODB_BASIC_AUTH).toString('base64');
  }
  const res = await fetch(`${NOCODB_URL}${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    console.error(`${method} ${path} → ${res.status}`);
    console.error(JSON.stringify(data, null, 2));
    throw new Error(`API ${res.status}`);
  }
  return data;
}

async function listTables() {
  const d = await api('GET', `/api/v2/meta/bases/${BASE_ID}/tables`);
  return d.list || [];
}

async function findTable(title) {
  const tables = await listTables();
  return tables.find(t => t.title === title) || null;
}

async function createTable(spec) {
  const existing = await findTable(spec.title);
  if (existing) {
    console.log(`  ⏭  ${spec.title} already exists → ${existing.id}`);
    return existing.id;
  }
  const d = await api('POST', `/api/v2/meta/bases/${BASE_ID}/tables`, spec);
  console.log(`  ✅ ${spec.title} created → ${d.id}`);
  return d.id;
}

// -------- Column type helpers --------

const T = (title, opts = {}) => ({ column_name: title, title, uidt: 'SingleLineText', ...opts });
const L = (title, opts = {}) => ({ column_name: title, title, uidt: 'LongText', ...opts });
const N = (title, opts = {}) => ({ column_name: title, title, uidt: 'Number', ...opts });
const D = (title, opts = {}) => ({ column_name: title, title, uidt: 'DateTime', ...opts });
const B = (title, opts = {}) => ({ column_name: title, title, uidt: 'Checkbox', ...opts });
const SS = (title, options, opts = {}) => ({
  column_name: title, title, uidt: 'SingleSelect',
  colOptions: { options: options.map((o, i) => ({ title: o, order: i + 1 })) },
  dtxp: options.map(o => `'${o}'`).join(','),
  ...opts,
});

// -------- Schema definitions (mirror nocodb-schema-v2-multi-course.md) --------

const courses = {
  table_name: 'courses',
  title: 'courses',
  columns: [
    T('uuid'),
    T('slug'),
    T('title'),
    L('description'),
    N('price_full_uah'),
    N('lessons_count'),
    SS('payment_plan', ['single', 'installments', 'subscription']),
    L('installments_config'),
    SS('unlock_strategy', ['full_on_payment', 'progressive']),
    B('active'),
    D('created_at'),
    L('notes'),
  ],
};

const learners = {
  table_name: 'learners',
  title: 'learners',
  columns: [
    T('uuid'),
    N('telegram_id'),
    T('telegram_username'),
    T('telegram_first_name'),
    T('child_name'),
    N('child_age'),
    L('notes'),
    D('unsubscribed_at'),
    D('created_at'),
  ],
};

const enrollments = {
  table_name: 'enrollments',
  title: 'enrollments',
  columns: [
    T('uuid'),
    N('learner_id'),
    N('course_id'),
    SS('access_level', ['free_trial', 'partial_paid', 'full_paid', 'revoked']),
    L('unlocked_lessons'),
    D('unlocked_at'),
    N('total_paid_uah'),
    T('current_lesson'),
    N('current_beat_index'),
    L('completed_lessons'),
    L('attempts_per_lesson'),
    L('time_spent_min'),
    D('last_activity_at'),
    D('daily_reminder_sent_at'),
    D('reactivation_sent_at'),
    D('finished_at'),
    B('upsell_clicked'),
    L('notes'),
  ],
};

const payments = {
  table_name: 'payments',
  title: 'payments',
  columns: [
    T('uuid'),
    N('learner_id'),
    N('enrollment_id'),
    N('course_id'),
    SS('provider', ['monobank', 'wayforpay', 'manual', 'refund']),
    T('invoice_id'),
    T('order_reference'),
    N('amount_uah'),
    T('currency'),
    SS('status', ['created', 'processing', 'success', 'failure', 'expired', 'reversed', 'refunded']),
    SS('payment_purpose', ['initial', 'installment', 'bonus', 'refund']),
    N('installment_number'),
    N('installments_total'),
    D('paid_at'),
    D('created_at'),
    D('updated_at'),
    L('webhook_payload'),
    N('provider_fee_uah'),
    L('notes'),
  ],
};

async function main() {
  console.log('== Creating v2 multi-course tables ==');
  console.log(`base_id: ${BASE_ID}`);

  const ids = {};
  ids.courses = await createTable(courses);
  ids.learners = await createTable(learners);
  ids.enrollments = await createTable(enrollments);
  ids.payments = await createTable(payments);

  const outPath = path.join(__dirname, '.table-ids.json');
  fs.writeFileSync(outPath, JSON.stringify(ids, null, 2));
  console.log(`\n📝 Table IDs written → ${outPath}`);
  console.log(JSON.stringify(ids, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
