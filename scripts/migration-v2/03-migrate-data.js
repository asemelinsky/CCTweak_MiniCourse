#!/usr/bin/env node
// scripts/migration-v2/03-migrate-data.js
// Migrates cctweak_learners v1 → learners + enrollments + payments v2.
//
// Idempotent:
//   - Learners deduped by telegram_id
//   - Enrollments deduped by (learner_id, course_id)
//   - Payments deduped by invoice_id (using migrated-<oldId> sentinel)
//
// Preserves cctweak_learners.uuid → enrollments.uuid so existing URLs work.
//
// Run:
//   set -a; source /tmp/vercel-env.sh; set +a
//   node scripts/migration-v2/03-migrate-data.js
//   node scripts/migration-v2/03-migrate-data.js --dry-run

const fs = require('fs');
const path = require('path');

const ids = JSON.parse(fs.readFileSync(path.join(__dirname, '.table-ids.json'), 'utf8'));
const OLD_TABLE = process.env.NOCODB_TABLE_ID; // cctweak_learners
const NOCODB_URL = process.env.NOCODB_URL;
const NOCODB_TOKEN = process.env.NOCODB_TOKEN;
const NOCODB_BASIC_AUTH = process.env.NOCODB_BASIC_AUTH;
const DRY_RUN = process.argv.includes('--dry-run');

async function api(method, p, body) {
  const headers = { 'xc-token': NOCODB_TOKEN, 'Content-Type': 'application/json' };
  if (NOCODB_BASIC_AUTH) headers.Authorization = 'Basic ' + Buffer.from(NOCODB_BASIC_AUTH).toString('base64');
  const res = await fetch(`${NOCODB_URL}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let d; try { d = text ? JSON.parse(text) : null; } catch { d = text; }
  if (!res.ok) { console.error(`${method} ${p} → ${res.status}`, JSON.stringify(d)); throw new Error('API'); }
  return d;
}

async function fetchAll(tableId, where = '') {
  const results = [];
  let offset = 0;
  for (;;) {
    const q = new URLSearchParams();
    q.set('limit', '100');
    q.set('offset', String(offset));
    if (where) q.set('where', where);
    const d = await api('GET', `/api/v2/tables/${tableId}/records?${q}`);
    const list = d.list || [];
    results.push(...list);
    const info = d.pageInfo || {};
    if (info.isLastPage || list.length === 0) break;
    offset += list.length;
    if (offset > 100000) throw new Error('runaway');
  }
  return results;
}

async function getCourseIdBySlug(slug) {
  const d = await api('GET', `/api/v2/tables/${ids.courses}/records?where=(slug,eq,${slug})&limit=1`);
  const r = d.list && d.list[0];
  if (!r) throw new Error(`course '${slug}' not found — run 02-seed-courses.js first`);
  return r.Id;
}

async function findLearnerByTelegramId(telegramId) {
  const d = await api('GET', `/api/v2/tables/${ids.learners}/records?where=(telegram_id,eq,${telegramId})&limit=1`);
  return (d.list && d.list[0]) || null;
}

async function findEnrollmentByUuid(uuid) {
  const safe = String(uuid).replace(/[)(,]/g, '');
  const d = await api('GET', `/api/v2/tables/${ids.enrollments}/records?where=(uuid,eq,${safe})&limit=1`);
  return (d.list && d.list[0]) || null;
}

async function findPaymentByInvoiceId(invoiceId) {
  const safe = String(invoiceId).replace(/[)(,]/g, '');
  const d = await api('GET', `/api/v2/tables/${ids.payments}/records?where=(invoice_id,eq,${safe})&limit=1`);
  return (d.list && d.list[0]) || null;
}

function coalesceJson(v, fallback) {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

// Map v1 payment_provider → v2 provider enum
function providerV1ToV2(v1) {
  if (!v1) return 'manual';
  if (v1 === 'monobank_link' || v1 === 'monobank') return 'monobank';
  if (v1 === 'wayforpay') return 'wayforpay';
  if (v1 === 'telegram_payments') return 'manual'; // Telegram Payments migrated as manual
  return 'manual';
}

function genUuid() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const grp = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${grp()}-${grp()}-${grp()}`;
}

async function main() {
  if (!OLD_TABLE) throw new Error('NOCODB_TABLE_ID env not set (should be cctweak_learners id)');
  console.log(`== Migrating cctweak_learners → v2 ${DRY_RUN ? '(DRY RUN)' : '(LIVE)'}==`);
  console.log(`  old table: ${OLD_TABLE}`);
  console.log(`  new: learners=${ids.learners}, enrollments=${ids.enrollments}, payments=${ids.payments}`);

  const cctweakCourseId = await getCourseIdBySlug('cctweak');
  console.log(`  course cctweak: Id=${cctweakCourseId}`);

  const oldRows = await fetchAll(OLD_TABLE);
  console.log(`\n📥 Loaded ${oldRows.length} rows from cctweak_learners\n`);

  const stats = { learners_created: 0, learners_reused: 0, payments_created: 0, payments_skipped: 0, enrollments_created: 0, enrollments_skipped: 0 };

  for (const old of oldRows) {
    const label = `[${old.Id}] ${old.telegram_first_name || 'Unknown'}/${old.child_name || '?'} tg=${old.telegram_id}`;
    console.log(`▶ ${label}`);

    // ---- Learner upsert ----
    let learner = await findLearnerByTelegramId(old.telegram_id);
    if (learner) {
      console.log(`    ↳ learner already exists Id=${learner.Id} uuid=${learner.uuid}`);
      stats.learners_reused++;
    } else {
      const learnerRow = {
        uuid: genUuid(),
        telegram_id: old.telegram_id,
        telegram_username: old.telegram_username,
        telegram_first_name: old.telegram_first_name,
        child_name: old.child_name,
        child_age: old.child_age,
        notes: old.notes,
        unsubscribed_at: old.unsubscribed_at,
        created_at: old.created_at || old.CreatedAt,
      };
      if (!DRY_RUN) {
        const created = await api('POST', `/api/v2/tables/${ids.learners}/records`, learnerRow);
        learner = { ...learnerRow, Id: created.Id };
      } else {
        learner = { ...learnerRow, Id: '(dry)' };
      }
      console.log(`    ↳ learner created Id=${learner.Id} uuid=${learner.uuid}`);
      stats.learners_created++;
    }

    // ---- Payment (only if paid_at was set) ----
    let paymentId = null;
    if (old.paid_at) {
      const migratedInvoiceId = `migrated-${old.Id}`;
      const existingPayment = await findPaymentByInvoiceId(migratedInvoiceId);
      if (existingPayment) {
        console.log(`    ↳ payment already exists Id=${existingPayment.Id}`);
        paymentId = existingPayment.Id;
        stats.payments_skipped++;
      } else {
        const paymentRow = {
          uuid: genUuid(),
          learner_id: learner.Id,
          enrollment_id: null, // filled after enrollment created
          course_id: cctweakCourseId,
          provider: providerV1ToV2(old.payment_provider),
          invoice_id: migratedInvoiceId,
          order_reference: migratedInvoiceId,
          amount_uah: old.payment_amount_uah,
          currency: 'UAH',
          status: 'success',
          payment_purpose: 'initial',
          installment_number: null,
          installments_total: null,
          paid_at: old.paid_at,
          created_at: old.paid_at,
          updated_at: old.paid_at,
          webhook_payload: null,
          provider_fee_uah: null,
          notes: 'Migrated from cctweak_learners v1 schema',
        };
        if (!DRY_RUN) {
          const created = await api('POST', `/api/v2/tables/${ids.payments}/records`, paymentRow);
          paymentId = created.Id;
        } else {
          paymentId = '(dry)';
        }
        console.log(`    ↳ payment created Id=${paymentId} provider=${paymentRow.provider} amount=${paymentRow.amount_uah}`);
        stats.payments_created++;
      }
    } else {
      console.log(`    ↳ no payment (paid_at is null — free_trial enrollment)`);
    }

    // ---- Enrollment ----
    const enrollmentUuid = old.uuid; // preserve for URL compat
    let enrollment = await findEnrollmentByUuid(enrollmentUuid);
    if (enrollment) {
      console.log(`    ↳ enrollment already exists Id=${enrollment.Id} uuid=${enrollment.uuid}`);
      stats.enrollments_skipped++;
    } else {
      const paid = !!old.paid_at;
      const accessLevel = paid ? 'full_paid' : 'free_trial';
      const unlockedLessons = paid ? ['l1','l2','l3','l4','l5','l6','l7'] : ['l1'];
      const enrollmentRow = {
        uuid: enrollmentUuid,
        learner_id: learner.Id,
        course_id: cctweakCourseId,
        access_level: accessLevel,
        unlocked_lessons: JSON.stringify(unlockedLessons),
        unlocked_at: old.paid_at || old.created_at || old.CreatedAt,
        total_paid_uah: paid ? (old.payment_amount_uah || 0) : 0,
        current_lesson: old.current_lesson || 'l1',
        current_beat_index: old.current_beat_index || 0,
        completed_lessons: coalesceJson(old.completed_lessons, paid ? '["l1"]' : '[]'),
        attempts_per_lesson: coalesceJson(old.attempts_per_lesson, '{}'),
        time_spent_min: coalesceJson(old.time_spent_min, '{}'),
        last_activity_at: old.last_activity_at || old.created_at || old.CreatedAt,
        daily_reminder_sent_at: old.daily_reminder_sent_at,
        reactivation_sent_at: old.reactivation_sent_at,
        finished_at: old.finished_course_at,
        upsell_clicked: !!old.upsell_clicked,
        notes: old.notes,
      };
      if (!DRY_RUN) {
        const created = await api('POST', `/api/v2/tables/${ids.enrollments}/records`, enrollmentRow);
        enrollment = { ...enrollmentRow, Id: created.Id };
        // Back-fill payment.enrollment_id
        if (paymentId && paymentId !== '(dry)') {
          await api('PATCH', `/api/v2/tables/${ids.payments}/records`,
            { Id: paymentId, enrollment_id: enrollment.Id });
          console.log(`    ↳ payment ${paymentId}.enrollment_id ← ${enrollment.Id}`);
        }
      } else {
        enrollment = { ...enrollmentRow, Id: '(dry)' };
      }
      console.log(`    ↳ enrollment created Id=${enrollment.Id} uuid=${enrollment.uuid} access=${accessLevel} current=${enrollmentRow.current_lesson}`);
      stats.enrollments_created++;
    }
  }

  console.log(`\n📊 Migration summary:`);
  console.log(`  learners:    ${stats.learners_created} created, ${stats.learners_reused} reused`);
  console.log(`  payments:    ${stats.payments_created} created, ${stats.payments_skipped} skipped`);
  console.log(`  enrollments: ${stats.enrollments_created} created, ${stats.enrollments_skipped} skipped`);
  if (DRY_RUN) console.log(`\n⚠️  DRY RUN — nothing was actually written. Rerun without --dry-run.`);
}

main().catch(e => { console.error(e); process.exit(1); });
