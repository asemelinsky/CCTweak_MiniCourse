// api/payment/_wayforpay.js — WayForPay CREATE_INVOICE / webhook helpers.
// Docs: https://wiki.wayforpay.com/en/view/852102 (Create Invoice)
//       https://wiki.wayforpay.com/en/view/852136 (Callback / Service URL)
//
// Auth: MD5(HMAC-MD5) signature per-request. Field lists are order-sensitive.

const crypto = require('crypto');

const NAME = 'wayforpay';
const NOCODB_PROVIDER_VALUE = 'wayforpay';

const WFP_API = 'https://api.wayforpay.com/api';

function creds() {
  const account = process.env.WAYFORPAY_MERCHANT_ACCOUNT;
  const secret = process.env.WAYFORPAY_SECRET_KEY;
  const password = process.env.WAYFORPAY_MERCHANT_PASSWORD;
  if (!account) throw new Error('WAYFORPAY_MERCHANT_ACCOUNT env is not set');
  if (!secret) throw new Error('WAYFORPAY_SECRET_KEY env is not set');
  return { account, secret, password };
}

function hmacMd5(secret, message) {
  return crypto.createHmac('md5', secret).update(message, 'utf8').digest('hex');
}

// merchantSignature for CREATE_INVOICE:
//   merchantAccount;merchantDomainName;orderReference;orderDate;amount;currency;
//   productName[0];...;productName[N];productCount[0];...;productPrice[0];...
// (semicolon-joined, HMAC-MD5 with merchantSecretKey)
function signCreateInvoice({ merchantAccount, merchantDomainName, orderReference, orderDate,
                             amount, currency, productName, productCount, productPrice, secret }) {
  const parts = [
    merchantAccount,
    merchantDomainName,
    orderReference,
    String(orderDate),
    String(amount),
    currency,
    ...productName.map(String),
    ...productCount.map(String),
    ...productPrice.map(String),
  ];
  return hmacMd5(secret, parts.join(';'));
}

// Signature that WayForPay uses in webhook payloads (transactionStatus callback):
//   merchantAccount;orderReference;amount;currency;authCode;cardPan;transactionStatus;reasonCode
// (semicolon-joined, HMAC-MD5 with merchantSecretKey)
function signCallback({ merchantAccount, orderReference, amount, currency, authCode,
                        cardPan, transactionStatus, reasonCode, secret }) {
  const parts = [
    merchantAccount,
    orderReference,
    String(amount),
    currency,
    authCode || '',
    cardPan || '',
    transactionStatus || '',
    String(reasonCode ?? ''),
  ];
  return hmacMd5(secret, parts.join(';'));
}

// Signature for the ACK response WE send back to WayForPay so they stop retrying:
//   orderReference;status;time
function signAck({ orderReference, status, time, secret }) {
  return hmacMd5(secret, [orderReference, status, String(time)].join(';'));
}

// createInvoice → { invoice_id, pageUrl, provider, reference, raw }
async function createInvoice({ amount_uah, reference, destination, webhook_url, redirect_url }) {
  if (!amount_uah || amount_uah <= 0) throw new Error('amount_uah must be > 0');
  if (!reference) throw new Error('reference required');
  const { account, secret } = creds();

  const merchantDomainName = process.env.WAYFORPAY_MERCHANT_DOMAIN
    || (process.env.PUBLIC_APP_URL || 'https://cctweak-minicourse.vercel.app').replace(/^https?:\/\//, '');
  const orderDate = Math.floor(Date.now() / 1000);
  const productName = [destination || 'CCTweak MiniCourse'];
  const productCount = [1];
  const productPrice = [Number(amount_uah)];

  const merchantSignature = signCreateInvoice({
    merchantAccount: account,
    merchantDomainName,
    orderReference: reference,
    orderDate,
    amount: Number(amount_uah),
    currency: 'UAH',
    productName, productCount, productPrice,
    secret,
  });

  const body = {
    transactionType: 'CREATE_INVOICE',
    merchantAccount: account,
    merchantAuthType: 'SimpleSignature',
    merchantDomainName,
    apiVersion: 1,
    orderReference: reference,
    orderDate,
    amount: Number(amount_uah),
    currency: 'UAH',
    productName,
    productPrice,
    productCount,
    merchantSignature,
  };
  if (webhook_url) body.serviceUrl = webhook_url;
  if (redirect_url) body.returnUrl = redirect_url;

  const res = await fetch(WFP_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let raw;
  try { raw = text ? JSON.parse(text) : null; } catch { raw = text; }
  if (!res.ok) {
    const err = new Error(`WayForPay ${res.status}: ${typeof raw === 'string' ? raw : JSON.stringify(raw)}`);
    err.status = res.status; err.body = raw;
    throw err;
  }
  if (raw && raw.reasonCode && +raw.reasonCode !== 1100 && +raw.reasonCode !== 4100) {
    // 1100 = Ok (invoice created); 4100 = "Order already exists" (idempotent hit)
    const err = new Error(`WayForPay reasonCode=${raw.reasonCode}: ${raw.reason}`);
    err.body = raw;
    throw err;
  }

  return {
    invoice_id: raw.invoiceUrl || null, // WFP не повертає окремий id; використовуємо invoiceUrl як унікальний
    pageUrl: raw.invoiceUrl,
    provider: NAME,
    reference,
    raw,
  };
}

// Verify webhook body signature.
async function verifyWebhook(payload) {
  const { secret } = creds();
  const expected = signCallback({
    merchantAccount: payload.merchantAccount,
    orderReference: payload.orderReference,
    amount: payload.amount,
    currency: payload.currency,
    authCode: payload.authCode,
    cardPan: payload.cardPan,
    transactionStatus: payload.transactionStatus,
    reasonCode: payload.reasonCode,
    secret,
  });
  const ok = expected === payload.merchantSignature;
  return { verified: ok, reason: ok ? 'ok' : `expected ${expected}, got ${payload.merchantSignature}` };
}

// Build the JSON response we return to WayForPay so they stop retrying the webhook.
function buildAck({ orderReference, status = 'accept' }) {
  const { secret } = creds();
  const time = Math.floor(Date.now() / 1000);
  return {
    orderReference,
    status,
    time,
    signature: signAck({ orderReference, status, time, secret }),
  };
}

// Normalize webhook payload → shared shape.
// WayForPay statuses: Approved / Declined / Expired / Refunded / InProcessing / Pending / WaitingAuthComplete
function normalizeWebhook(payload) {
  return {
    reference: payload?.orderReference || null,
    transaction_id: payload?.orderReference || null, // WFP не має invoiceId, orderReference — унікальний
    amount_uah: typeof payload?.amount === 'number' ? payload.amount : Number(payload?.amount) || null,
    status: payload?.transactionStatus || null,
    isSuccess: payload?.transactionStatus === 'Approved',
    raw: payload,
  };
}

module.exports = {
  NAME,
  NOCODB_PROVIDER_VALUE,
  createInvoice,
  verifyWebhook,
  normalizeWebhook,
  buildAck,
  // exposed for unit tests
  _signCreateInvoice: signCreateInvoice,
  _signCallback: signCallback,
  _signAck: signAck,
};
