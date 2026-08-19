// api/_lib.js — shared helpers for the CCTweak MiniCourse backend (v2 schema).
//
// v2 schema (multi-course):
//   courses      — catalog of courses (cctweak, minecraft, ...)
//   learners     — one row per human (unique by telegram_id)
//   enrollments  — access + progress per (learner × course)
//   payments     — one row per transaction (N per enrollment allowed)
//
// Public URLs still use `?u=<uuid>` where uuid = enrollments.uuid — the
// migration script preserved v1 cctweak_learners.uuid so existing links
// keep working.
//
// Files starting with `_` are treated as private by Vercel and not routed.

const NOCODB_URL = process.env.NOCODB_URL || 'https://crm.bajka.pp.ua';
const NOCODB_TOKEN = process.env.NOCODB_TOKEN;
const NOCODB_BASIC_AUTH = process.env.NOCODB_BASIC_AUTH;

const TABLE_COURSES     = process.env.NOCODB_TABLE_COURSES_ID;
const TABLE_LEARNERS    = process.env.NOCODB_TABLE_LEARNERS_ID;
const TABLE_ENROLLMENTS = process.env.NOCODB_TABLE_ENROLLMENTS_ID;
const TABLE_PAYMENTS    = process.env.NOCODB_TABLE_PAYMENTS_ID;

// -------- HTTP / CORS --------

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function handleOptions(req, res) {
  if (req.method === 'OPTIONS') { setCors(res); res.status(204).end(); return true; }
  return false;
}

function ok(res, data, status = 200) {
  setCors(res);
  res.status(status).json({ ok: true, data });
}

function fail(res, status, message, extra) {
  setCors(res);
  const body = { ok: false, error: message };
  if (extra) body.details = extra;
  res.status(status).json(body);
}

// -------- Low-level NocoDB client --------

async function nocodb(tableId, path, opts = {}) {
  if (!NOCODB_TOKEN) throw new Error('NOCODB_TOKEN env is not set');
  const url = `${NOCODB_URL}${path.replace('{table}', tableId)}`;
  const headers = {
    'xc-token': NOCODB_TOKEN,
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  };
  if (NOCODB_BASIC_AUTH) {
    headers.Authorization = 'Basic ' + Buffer.from(NOCODB_BASIC_AUTH).toString('base64');
  }
  const res = await fetch(url, { ...opts, headers });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const err = new Error(`NocoDB ${res.status} on ${path}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    err.status = res.status; err.body = body;
    throw err;
  }
  return body;
}

async function fetchRecords(tableId, where, opts = {}) {
  const q = new URLSearchParams();
  if (where) q.set('where', where);
  q.set('limit', String(opts.limit || 100));
  if (opts.offset) q.set('offset', String(opts.offset));
  if (opts.fields) q.set('fields', opts.fields);
  return nocodb(tableId, `/api/v2/tables/${tableId}/records?${q.toString()}`, { method: 'GET' });
}

async function insertRecord(tableId, row) {
  return nocodb(tableId, `/api/v2/tables/${tableId}/records`, {
    method: 'POST', body: JSON.stringify(row),
  });
}

async function updateRecord(tableId, id, patch) {
  return nocodb(tableId, `/api/v2/tables/${tableId}/records`, {
    method: 'PATCH', body: JSON.stringify({ Id: id, ...patch }),
  });
}

function escapeFilterValue(v) {
  // NocoDB v2 where-DSL is `(field,op,val)`. Bare parens/commas break parsing.
  return String(v).replace(/[)(,]/g, '');
}

// -------- Entity helpers --------

// courses
async function getCourseBySlug(slug) {
  const d = await fetchRecords(TABLE_COURSES, `(slug,eq,${escapeFilterValue(slug)})`, { limit: 1 });
  return (d.list && d.list[0]) || null;
}
async function getCourseById(id) {
  const d = await fetchRecords(TABLE_COURSES, `(Id,eq,${+id})`, { limit: 1 });
  return (d.list && d.list[0]) || null;
}

// learners
async function getLearnerById(id) {
  const d = await fetchRecords(TABLE_LEARNERS, `(Id,eq,${+id})`, { limit: 1 });
  return (d.list && d.list[0]) || null;
}
async function getLearnerByTelegramId(telegramId) {
  const d = await fetchRecords(TABLE_LEARNERS, `(telegram_id,eq,${+telegramId})`, { limit: 1 });
  return (d.list && d.list[0]) || null;
}

// enrollments
async function getEnrollmentByUuid(uuid) {
  const d = await fetchRecords(TABLE_ENROLLMENTS, `(uuid,eq,${escapeFilterValue(uuid)})`, { limit: 1 });
  return (d.list && d.list[0]) || null;
}
async function getEnrollmentByLearnerAndCourse(learnerId, courseId) {
  const d = await fetchRecords(TABLE_ENROLLMENTS,
    `(learner_id,eq,${+learnerId})~and(course_id,eq,${+courseId})`, { limit: 1 });
  return (d.list && d.list[0]) || null;
}
async function listEnrollmentsByLearner(learnerId) {
  const d = await fetchRecords(TABLE_ENROLLMENTS, `(learner_id,eq,${+learnerId})`, { limit: 100 });
  return d.list || [];
}
async function updateEnrollment(id, patch) { return updateRecord(TABLE_ENROLLMENTS, id, patch); }
async function insertEnrollment(row)       { return insertRecord(TABLE_ENROLLMENTS, row); }

// payments
async function getPaymentByInvoiceId(invoiceId) {
  const d = await fetchRecords(TABLE_PAYMENTS, `(invoice_id,eq,${escapeFilterValue(invoiceId)})`, { limit: 1 });
  return (d.list && d.list[0]) || null;
}
async function insertPayment(row) { return insertRecord(TABLE_PAYMENTS, row); }
async function updatePayment(id, patch) { return updateRecord(TABLE_PAYMENTS, id, patch); }

async function insertLearner(row) { return insertRecord(TABLE_LEARNERS, row); }
async function updateLearner(id, patch) { return updateRecord(TABLE_LEARNERS, id, patch); }

// -------- Payment flow: idempotent mark-paid across 3 tables --------

// Flow:
//   1) upsert learner by telegram_id
//   2) get course by slug (default 'cctweak')
//   3) if invoice_id already exists in payments — no-op idempotent return
//   4) insert payment (status='success', purpose='initial')
//   5) upsert enrollment by (learner_id, course_id) — set full_paid + unlock all lessons
//   6) back-fill payment.enrollment_id
//   7) return { learner, enrollment, payment, created:{learner,enrollment,payment} }
async function recordSuccessfulPayment({
  telegram_id,
  telegram_first_name = null,
  telegram_username = null,
  child_name = null,
  child_age = null,
  course_slug = 'cctweak',
  provider,
  invoice_id,
  order_reference,
  amount_uah,
  webhook_payload = null,
  provider_fee_uah = null,
}) {
  if (!telegram_id || !Number.isFinite(+telegram_id)) throw new Error('telegram_id required');
  if (!invoice_id) throw new Error('invoice_id required');
  if (!provider) throw new Error('provider required');
  if (!Number.isFinite(+amount_uah)) throw new Error('amount_uah required (number)');

  const now = nowIso();
  const created = { learner: false, payment: false, enrollment: false };

  // Idempotency: bail early if this invoice already recorded successfully.
  const existingPayment = await getPaymentByInvoiceId(invoice_id);
  if (existingPayment && existingPayment.status === 'success') {
    const learner = existingPayment.learner_id ? await getLearnerById(existingPayment.learner_id) : null;
    const enrollment = existingPayment.enrollment_id ? await getEnrollmentByLearnerAndCourse(
      existingPayment.learner_id, existingPayment.course_id
    ) : null;
    return { learner, enrollment, payment: existingPayment, created, alreadyRecorded: true };
  }

  // 1) Upsert learner
  let learner = await getLearnerByTelegramId(telegram_id);
  if (!learner) {
    const learnerRow = {
      uuid: generateUuid(),
      telegram_id: +telegram_id,
      telegram_username,
      telegram_first_name: telegram_first_name || `TG:${telegram_id}`,
      child_name,
      child_age: child_age === null ? null : (+child_age || null),
      created_at: now,
    };
    const ins = await insertLearner(learnerRow);
    learner = { ...learnerRow, Id: ins.Id };
    created.learner = true;
  }

  // 2) Resolve course
  const course = await getCourseBySlug(course_slug);
  if (!course) throw new Error(`course '${course_slug}' not found in catalog`);

  // 3) Insert or update payment
  let payment;
  if (existingPayment) {
    // Same invoice but non-success status → update to success.
    const patch = {
      status: 'success',
      paid_at: now,
      updated_at: now,
      amount_uah: +amount_uah,
      webhook_payload: webhook_payload ? JSON.stringify(webhook_payload) : null,
      provider_fee_uah,
    };
    await updatePayment(existingPayment.Id, patch);
    payment = { ...existingPayment, ...patch };
  } else {
    const paymentRow = {
      uuid: generateUuid(),
      learner_id: learner.Id,
      enrollment_id: null, // back-filled after enrollment
      course_id: course.Id,
      provider,
      invoice_id,
      order_reference: order_reference || invoice_id,
      amount_uah: +amount_uah,
      currency: 'UAH',
      status: 'success',
      payment_purpose: 'initial',
      paid_at: now,
      created_at: now,
      updated_at: now,
      webhook_payload: webhook_payload ? JSON.stringify(webhook_payload) : null,
      provider_fee_uah,
    };
    const ins = await insertPayment(paymentRow);
    payment = { ...paymentRow, Id: ins.Id };
    created.payment = true;
  }

  // 4) Upsert enrollment
  let enrollment = await getEnrollmentByLearnerAndCourse(learner.Id, course.Id);
  if (!enrollment) {
    const lessonSlugs = Array.from({ length: course.lessons_count || 7 }, (_, i) => `l${i + 1}`);
    const enrollmentRow = {
      uuid: generateUuid(),
      learner_id: learner.Id,
      course_id: course.Id,
      access_level: 'full_paid',
      unlocked_lessons: JSON.stringify(lessonSlugs),
      unlocked_at: now,
      total_paid_uah: +amount_uah,
      current_lesson: 'l2',
      current_beat_index: 0,
      completed_lessons: JSON.stringify(['l1']),
      attempts_per_lesson: '{}',
      time_spent_min: '{}',
      last_activity_at: now,
      upsell_clicked: false,
    };
    const ins = await insertEnrollment(enrollmentRow);
    enrollment = { ...enrollmentRow, Id: ins.Id };
    created.enrollment = true;
  } else {
    // Already enrolled (e.g. previous free_trial) — upgrade to full_paid + add to total_paid.
    const lessonSlugs = Array.from({ length: course.lessons_count || 7 }, (_, i) => `l${i + 1}`);
    const patch = {
      access_level: 'full_paid',
      unlocked_lessons: JSON.stringify(lessonSlugs),
      total_paid_uah: (+enrollment.total_paid_uah || 0) + (+amount_uah),
      last_activity_at: now,
    };
    await updateEnrollment(enrollment.Id, patch);
    enrollment = { ...enrollment, ...patch };
  }

  // 5) Back-fill payment.enrollment_id
  if (payment.enrollment_id !== enrollment.Id) {
    await updatePayment(payment.Id, { enrollment_id: enrollment.Id });
    payment.enrollment_id = enrollment.Id;
  }

  return { learner, enrollment, payment, created, alreadyRecorded: false };
}

// -------- Utilities --------

function generateUuid() {
  const crypto = require('crypto');
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const pickGroup = () => {
    const bytes = crypto.randomBytes(4);
    let out = '';
    for (let i = 0; i < 4; i++) out += chars[bytes[i] % chars.length];
    return out;
  };
  return `${pickGroup()}-${pickGroup()}-${pickGroup()}`;
}

function parseJson(x, fallback) {
  if (x === null || x === undefined || x === '') return fallback;
  if (typeof x === 'object') return x;
  try { return JSON.parse(x); } catch { return fallback; }
}

function nowIso() { return new Date().toISOString(); }

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw); } catch { return {}; }
}

function requireBearer(req, res, envKey) {
  const expected = process.env[envKey];
  if (!expected) return true;
  const header = req.headers.authorization || req.headers.Authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m || m[1] !== expected) {
    if (envKey === 'CRON_SECRET' && req.headers['x-vercel-cron']) return true;
    fail(res, 401, 'unauthorized');
    return false;
  }
  return true;
}

// -------- Web-app response serializer --------

// Merge learner + enrollment (+ course context) into the v1-compatible shape
// the frontend already consumes: { uuid, child_name, current_lesson, ... }.
function serializeEnrollment({ enrollment, learner, course }) {
  if (!enrollment) return null;
  const completed = parseJson(enrollment.completed_lessons, []);
  const unlocked = parseJson(enrollment.unlocked_lessons, []);
  const current = enrollment.current_lesson || 'l1';
  // Union: unlocked ∪ completed ∪ current (skip 'done' sentinel)
  const merged = Array.from(new Set([
    ...unlocked,
    ...completed,
    ...(current === 'done' ? [] : [current]),
  ]));
  return {
    uuid: enrollment.uuid,
    child_name: learner?.child_name || null,
    child_age: learner?.child_age || null,
    telegram_first_name: learner?.telegram_first_name || null,
    current_lesson: current,
    current_beat_index: enrollment.current_beat_index || 0,
    completed_lessons: completed,
    unlocked_lessons: merged,
    finished_course_at: enrollment.finished_at || null,
    upsell_clicked: !!enrollment.upsell_clicked,
    // v2 extras (optional for future frontend):
    access_level: enrollment.access_level || null,
    course_slug: course?.slug || null,
    total_paid_uah: enrollment.total_paid_uah || 0,
  };
}

module.exports = {
  // HTTP
  setCors, handleOptions, ok, fail,
  // low-level DB
  nocodb, fetchRecords, insertRecord, updateRecord,
  // entity accessors
  getCourseBySlug, getCourseById,
  getLearnerById, getLearnerByTelegramId, insertLearner, updateLearner,
  getEnrollmentByUuid, getEnrollmentByLearnerAndCourse, listEnrollmentsByLearner,
  insertEnrollment, updateEnrollment,
  getPaymentByInvoiceId, insertPayment, updatePayment,
  // payment flow
  recordSuccessfulPayment,
  // response shape
  serializeEnrollment,
  // utils
  generateUuid, parseJson, nowIso, readBody, requireBearer,
  escapeFilterValue,
  // table id constants (for cron JOIN queries)
  TABLE_COURSES, TABLE_LEARNERS, TABLE_ENROLLMENTS, TABLE_PAYMENTS,
};
