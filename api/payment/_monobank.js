// api/payment/_monobank.js — Monobank Acquiring API wrapper.
// Files starting with `_` are treated as private by Vercel and not routed.
//
// Docs: https://api.monobank.ua/docs/acquiring.html
// Auth: X-Token: <MONOBANK_MERCHANT_TOKEN>

const crypto = require('crypto');

const NAME = 'monobank';
const NOCODB_PROVIDER_VALUE = 'monobank_link'; // NocoDB SingleSelect option

const MONO_API = 'https://api.monobank.ua/api';

function token() {
  const t = process.env.MONOBANK_MERCHANT_TOKEN;
  if (!t) throw new Error('MONOBANK_MERCHANT_TOKEN env is not set');
  return t;
}

async function monoRequest(path, opts = {}) {
  const res = await fetch(`${MONO_API}${path}`, {
    ...opts,
    headers: {
      'X-Token': token(),
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const err = new Error(`Monobank ${res.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

// createInvoice → { invoice_id, pageUrl, provider, reference, raw }
//   amount_uah: number (гривні; конвертуємо у копійки)
//   reference: unique order id (e.g. cctweak-<telegram_id>-<uuid>)
//   destination: human-readable "Курс CCTweak Мо для ..."
//   redirect_url / webhook_url — задаються сервером
async function createInvoice({ amount_uah, reference, destination, webhook_url, redirect_url }) {
  if (!amount_uah || amount_uah <= 0) throw new Error('amount_uah must be > 0');
  if (!reference) throw new Error('reference required');

  const body = {
    amount: Math.round(amount_uah * 100), // копійки
    ccy: 980, // UAH
    merchantPaymInfo: {
      reference,
      destination: destination || 'CCTweak MiniCourse',
    },
    validity: 3600,
  };
  if (webhook_url) body.webHookUrl = webhook_url;
  if (redirect_url) body.redirectUrl = redirect_url;

  const raw = await monoRequest('/merchant/invoice/create', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return {
    invoice_id: raw.invoiceId,
    pageUrl: raw.pageUrl,
    provider: NAME,
    reference,
    raw,
  };
}

async function checkStatus(invoice_id) {
  if (!invoice_id) throw new Error('invoice_id required');
  return monoRequest(`/merchant/invoice/status?invoiceId=${encodeURIComponent(invoice_id)}`, {
    method: 'GET',
  });
}

// Monobank webhook signature verification.
// Monobank signs the raw body with ECDSA (SHA-256) using its private key.
// The webhook request carries `x-sign` = base64 signature. Public key is fetched
// from https://api.monobank.ua/api/merchant/pubkey (returns { key: "<PEM>" }).
//
// For Sprint 1 we accept any webhook that references a known telegram_id and
// verify the payment via /merchant/invoice/status (server-to-server) before
// mutating state — that is the authoritative source and doesn't require the
// public-key rotation dance. Signature check kept optional for future hardening.
async function verifyWebhook({ rawBody, signatureB64 }) {
  if (!signatureB64) return { verified: false, reason: 'no signature header' };
  try {
    const pubRes = await fetch(`${MONO_API}/merchant/pubkey`, {
      headers: { 'X-Token': token() },
    });
    if (!pubRes.ok) return { verified: false, reason: `pubkey http ${pubRes.status}` };
    const { key } = await pubRes.json();
    if (!key) return { verified: false, reason: 'no pubkey in response' };
    const pemPub = Buffer.from(key, 'base64').toString('utf8');
    const verifier = crypto.createVerify('SHA256');
    verifier.update(rawBody);
    verifier.end();
    const ok = verifier.verify(pemPub, Buffer.from(signatureB64, 'base64'));
    return { verified: !!ok, reason: ok ? 'ok' : 'signature mismatch' };
  } catch (e) {
    return { verified: false, reason: String(e.message || e) };
  }
}

// Normalize webhook payload → shared shape for markLearnerPaid.
// Monobank statuses: created / processing / hold / success / failure / reversed / expired
function normalizeWebhook(payload) {
  return {
    reference: payload?.reference || null,
    transaction_id: payload?.invoiceId || null,
    amount_uah: typeof payload?.amount === 'number' ? payload.amount / 100 : null,
    status: payload?.status || null,
    isSuccess: payload?.status === 'success',
    raw: payload,
  };
}

module.exports = {
  NAME,
  NOCODB_PROVIDER_VALUE,
  createInvoice,
  checkStatus,
  verifyWebhook,
  normalizeWebhook,
};
