#!/usr/bin/env node
// scripts/regen-tts-elevenlabs.js
// Regenerate all voice files for Черепашка Мо через ElevenLabs.
//
// Reads:  docs/tts-phrases.json   (56 entries: lesson/beat_id/audio/text_tts)
// Writes: public/audio/<lesson>/<beat_id>.mp3
//
// Idempotent: skips a file if it already exists AND `--skip-existing` (default),
// or overwrites all if `--force`. --dry-run prints what would happen without API calls.
//
// Env (from .secrets/tts.env):
//   ELEVENLABS_API_KEY=sk_...
//   ELEVENLABS_VOICE_ID_MO=<voice_id>
//   ELEVENLABS_MODEL=eleven_multilingual_v2
//
// Run:
//   set -a; source .secrets/tts.env; set +a
//   node scripts/regen-tts-elevenlabs.js               # skip existing
//   node scripts/regen-tts-elevenlabs.js --force       # regen all 56
//   node scripts/regen-tts-elevenlabs.js --dry-run
//   node scripts/regen-tts-elevenlabs.js --only l3     # only lesson l3
//   node scripts/regen-tts-elevenlabs.js --only l3/celebration  # single file

const fs = require('fs');
const path = require('path');

const BASE = path.resolve(__dirname, '..');
const PHRASES = path.join(BASE, 'docs', 'tts-phrases.json');
const AUDIO_ROOT = path.join(BASE, 'public', 'audio');

const API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID_MO;
const MODEL = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';

// -------- voice_settings — approved 2026-08-19 --------
const VOICE_SETTINGS = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0.35,
  use_speaker_boost: true,
  speed: 1.1,          // ← Olexii approved (default 1.0 was too slow for Мо)
};

// Args
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY_RUN = args.includes('--dry-run');
const CONCURRENCY = parseInt(args.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '5');
const ONLY = (() => {
  const i = args.indexOf('--only');
  return i >= 0 ? args[i + 1] : null;
})();

function matchOnly(phrase) {
  if (!ONLY) return true;
  if (ONLY.includes('/')) return `${phrase.lesson}/${phrase.beat_id}` === ONLY;
  return phrase.lesson === ONLY;
}

// -------- ElevenLabs call --------

async function synthesize(text, outPath) {
  const t0 = Date.now();
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: 'POST',
    headers: {
      'xi-api-key': API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: MODEL,
      voice_settings: VOICE_SETTINGS,
    }),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok) {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { msg = buf.toString(); }
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(msg)}`);
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  return { ms: Date.now() - t0, bytes: buf.length };
}

// -------- Concurrency-limited task runner --------

async function runLimited(items, limit, worker) {
  const results = new Array(items.length);
  let i = 0;
  async function next() {
    const idx = i++;
    if (idx >= items.length) return;
    try { results[idx] = await worker(items[idx], idx); }
    catch (e) { results[idx] = { error: e.message }; }
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
  return results;
}

// -------- Main --------

async function main() {
  if (!API_KEY) { console.error('ELEVENLABS_API_KEY env not set'); process.exit(1); }
  if (!VOICE_ID) { console.error('ELEVENLABS_VOICE_ID_MO env not set'); process.exit(1); }

  const phrases = JSON.parse(fs.readFileSync(PHRASES, 'utf8')).filter(matchOnly);
  console.log(`== ElevenLabs regen ==`);
  console.log(`  voice: ${VOICE_ID}`);
  console.log(`  model: ${MODEL}`);
  console.log(`  voice_settings: ${JSON.stringify(VOICE_SETTINGS)}`);
  console.log(`  phrases: ${phrases.length} (filter: ${ONLY || 'none'})`);
  console.log(`  mode: ${DRY_RUN ? 'DRY RUN' : FORCE ? 'FORCE overwrite' : 'skip existing'}`);
  console.log(`  concurrency: ${CONCURRENCY}`);
  console.log('');

  let skipped = 0, done = 0, failed = 0, totalChars = 0, totalBytes = 0, totalMs = 0;

  await runLimited(phrases, CONCURRENCY, async (p, idx) => {
    const rel = `${p.lesson}/${p.beat_id}.mp3`;
    const outPath = path.join(AUDIO_ROOT, rel);
    const exists = fs.existsSync(outPath);
    const label = `[${String(idx + 1).padStart(2, ' ')}/${phrases.length}] ${rel}`;

    if (exists && !FORCE) { console.log(`  ⏭  ${label}  (exists, skip)`); skipped++; return; }
    if (DRY_RUN) { console.log(`  🔬 ${label}  (dry, ${p.text_tts.length} chars)`); return; }

    try {
      const { ms, bytes } = await synthesize(p.text_tts, outPath);
      console.log(`  ✅ ${label}  ${p.text_tts.length}c  ${ms}ms  ${(bytes/1024).toFixed(0)}KB`);
      done++;
      totalChars += p.text_tts.length;
      totalBytes += bytes;
      totalMs += ms;
    } catch (e) {
      console.error(`  ❌ ${label}  ${e.message}`);
      failed++;
    }
  });

  console.log('');
  console.log('== Summary ==');
  console.log(`  ✅ regenerated: ${done}`);
  console.log(`  ⏭  skipped: ${skipped}`);
  console.log(`  ❌ failed: ${failed}`);
  console.log(`  chars used: ${totalChars.toLocaleString()}`);
  console.log(`  bytes written: ${(totalBytes / 1024).toFixed(0)} KB (${(totalBytes/1024/1024).toFixed(2)} MB)`);
  console.log(`  API time (sum, not wall-clock): ${(totalMs / 1000).toFixed(1)}s`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
