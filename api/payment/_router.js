// api/payment/_router.js — pick active payment provider by ACTIVE_PAYMENT_PROVIDER env.
//
// Sprint 1 spec: bajka.pp.ua/notes/methodist/courses/cctweak-minicourse/specs/payment-providers/
//
// Env values: `monobank` (default) | `wayforpay`.

const monobank = require('./_monobank');
const wayforpay = require('./_wayforpay');

const PROVIDERS = {
  monobank,
  wayforpay,
};

const DEFAULT_PROVIDER = 'monobank';

function getActiveProviderName() {
  const raw = (process.env.ACTIVE_PAYMENT_PROVIDER || DEFAULT_PROVIDER).toLowerCase().trim();
  if (!PROVIDERS[raw]) {
    throw new Error(`ACTIVE_PAYMENT_PROVIDER='${raw}' is invalid (valid: ${Object.keys(PROVIDERS).join(', ')})`);
  }
  return raw;
}

function getProvider(name) {
  const p = PROVIDERS[name];
  if (!p) throw new Error(`unknown payment provider '${name}'`);
  return p;
}

function getActiveProvider() {
  return getProvider(getActiveProviderName());
}

module.exports = {
  PROVIDERS,
  DEFAULT_PROVIDER,
  getActiveProviderName,
  getActiveProvider,
  getProvider,
};
