#!/usr/bin/env node
// scripts/migration-v2/02-seed-courses.js
// Inserts the CCTweak course row into `courses`. Idempotent: skips if slug exists.

const fs = require('fs');
const path = require('path');

const ids = JSON.parse(fs.readFileSync(path.join(__dirname, '.table-ids.json'), 'utf8'));
const NOCODB_URL = process.env.NOCODB_URL;
const NOCODB_TOKEN = process.env.NOCODB_TOKEN;
const NOCODB_BASIC_AUTH = process.env.NOCODB_BASIC_AUTH;

async function api(method, p, body) {
  const headers = { 'xc-token': NOCODB_TOKEN, 'Content-Type': 'application/json' };
  if (NOCODB_BASIC_AUTH) headers.Authorization = 'Basic ' + Buffer.from(NOCODB_BASIC_AUTH).toString('base64');
  const res = await fetch(`${NOCODB_URL}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let d; try { d = text ? JSON.parse(text) : null; } catch { d = text; }
  if (!res.ok) { console.error(`${method} ${p} → ${res.status}`, d); throw new Error('API'); }
  return d;
}

async function findBySlug(slug) {
  const d = await api('GET', `/api/v2/tables/${ids.courses}/records?where=(slug,eq,${slug})&limit=1`);
  return (d.list && d.list[0]) || null;
}

async function main() {
  const existing = await findBySlug('cctweak');
  if (existing) {
    console.log(`  ⏭  cctweak course already exists → Id=${existing.Id}`);
    return existing.Id;
  }
  const now = new Date().toISOString();
  const row = {
    uuid: 'course-cctweak',
    slug: 'cctweak',
    title: 'CCTweak MiniCourse — Пригоди Мо',
    description: 'Мінікурс з 7 уроків для дітей 7-9 років. Візуальне програмування з черепашкою.',
    price_full_uah: 200,
    lessons_count: 7,
    payment_plan: 'single',
    installments_config: null,
    unlock_strategy: 'full_on_payment',
    active: true,
    created_at: now,
    notes: null,
  };
  const d = await api('POST', `/api/v2/tables/${ids.courses}/records`, row);
  console.log(`  ✅ cctweak course inserted → Id=${d.Id}`);
  return d.Id;
}

main().catch(e => { console.error(e); process.exit(1); });
