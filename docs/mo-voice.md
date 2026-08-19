# Голос Черепашки Мо — canonical spec

**Дата фіксації:** 2026-08-19
**Стан:** ✅ активний. Всі 56 voice mp3 у [`public/audio/l{1..7}/`](../public/audio/) згенеровані через ElevenLabs за цим документом.
**Superseded:** [`tts-spec.md`](tts-spec.md) — Piper stack (архівний, для reference).

---

## TL;DR

- **Provider:** ElevenLabs (paid Starter — $5/міс)
- **Voice:** `lkMXdLVaZ3W8mreYvUGj` (library voice, approved 2026-08-19)
- **Model:** `eleven_multilingual_v2`
- **Speed:** `1.1` (не default 1.0 — Олексій опробував і підтвердив)
- **Batch skript:** [`scripts/regen-tts-elevenlabs.js`](../scripts/regen-tts-elevenlabs.js)
- **Секрети:** `.secrets/tts.env` (chmod 600, у `.gitignore`)

## Одна команда — регенерувати всі 56

```bash
cd /root/projects/CCTweak_MiniCourse
set -a && source .secrets/tts.env && set +a
node scripts/regen-tts-elevenlabs.js
```

За замовчуванням `--skip-existing`, тобто пропускає файли що вже є. Для повної перегенерації: `--force`.

## Vercel env vars (не додано — batch запускаємо локально)

Наразі API-key живе тільки локально у `.secrets/tts.env`. Якщо колись треба runtime TTS з Vercel functions (динамічна генерація для нових фраз без redeploy), додати у Vercel prod: `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID_MO`, `ELEVENLABS_MODEL`.

---

## ElevenLabs API — параметри

| Param | Value | Чому |
|---|---|---|
| Endpoint | `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}` | v1 API stable |
| Auth header | `xi-api-key: sk_...` | Ключ форматом `sk_...` (не 64-hex ID — це API key ID, не сам ключ) |
| `voice_id` | `lkMXdLVaZ3W8mreYvUGj` | Library voice — approved Olexii після A/B з Alice/premade voices |
| `model_id` | `eleven_multilingual_v2` | v2 multilingual — stable, найкраща uk-UA підтримка. `eleven_v3` alpha ще не готовий. |
| `voice_settings.stability` | `0.5` | Баланс між моно-тонним (1.0) і слабко-варіативним (0.0) |
| `voice_settings.similarity_boost` | `0.75` | Голос ближче до тренувального сет'у creator'a — точніші наголоси |
| `voice_settings.style` | `0.35` | Трохи виразності («тепло» для дитини), але не overact |
| `voice_settings.use_speaker_boost` | `true` | Розлочує повний dynamic range voice |
| `voice_settings.speed` | **`1.1`** | Default 1.0 звучав повільно — Olexii підтвердив 1.1 як «правильний темп для Мо» |
| Accept header | `audio/mpeg` | Отримуємо mp3 blob (не WAV — вже стиснутий) |

## Character budget

- Наш загальний regen: **6 724 chars** (56 фраз, avg ~120 chars)
- Starter tier: **30 000 chars/міс**
- Використано: **22%** — залишається запас на ~200 нових/оновлених фраз/міс

## Concurrency

**Starter tier max = 3 concurrent requests.** Batch script default = **2 concurrent** (leaves headroom для retries). Якщо upgrade до Creator/Pro — можна `--concurrency=10`.

429 error `concurrent_limit_exceeded` = перевищено ліміт. Fix: зменшити concurrency.

---

## Файли — mapping

Convention: `public/audio/<lesson>/<beat_id>.mp3`, де `<beat_id>` — це `beat.id` у [`lessons/<lesson>.json`](../lessons/).

Повний реєстр 56 фраз: [`tts-phrases.json`](tts-phrases.json) (machine-readable) + [`tts-phrases.md`](tts-phrases.md) (human-review).

Стан по уроках (після 2026-08-19 regen):

| Lesson | Файлів | Total size |
|---|---|---|
| l1 | 7  | 796 KB |
| l2 | 5  | 592 KB |
| l3 | 10 | 1.7 MB |
| l4 | 10 | 1.5 MB |
| l5 | 7  | 1.3 MB |
| l6 | 11 | 1.6 MB |
| l7 | 6  | 1.1 MB |
| **Total** | **56** | **8.6 MB** |

`sfx/` не змінюємо — там 5 звукових ефектів (click/failure/step/success/test-beep), не voice.

---

## Батько-архів Piper (2026-08-19)

Попередня версія (65 файлів Piper `uk_UA-lada-x_low` з rubberband pitch 1.155) — у [`public/audio/_archive-piper-2026-08-19/`](../public/audio/_archive-piper-2026-08-19/).

**НЕ у Git** (додано у `.gitignore` — `public/audio/_archive-*/`). Тримається на диску як safety backup **1-3 тижні**, потім можна видалити.

Rollback (якщо треба):
```bash
cd public/audio
rm l{1..7}/*.mp3
for L in l1 l2 l3 l4 l5 l6 l7; do cp _archive-piper-2026-08-19/$L/*.mp3 $L/; done
```

---

## Batch script — features

`scripts/regen-tts-elevenlabs.js`:

- **Idempotent:** `--skip-existing` (default) пропускає файли що є. Або `--force` для full regen.
- **Filter:** `--only l3` (весь урок) або `--only l3/celebration` (один файл).
- **Concurrency:** `--concurrency=N` (default 2). Максимум 3 на Starter tier.
- **Dry-run:** `--dry-run` — покаже що робив би, без API calls.
- **Retry:** відсутній (failed показуються в summary — треба re-run для retry). Достатньо для 429 handling — просто зменшити concurrency + re-run.

Приклади:
```bash
# Full regen  
node scripts/regen-tts-elevenlabs.js --force

# Тільки урок 3  
node scripts/regen-tts-elevenlabs.js --only l3 --force

# Один файл  
node scripts/regen-tts-elevenlabs.js --only l3/celebration --force

# Preview  
node scripts/regen-tts-elevenlabs.js --dry-run
```

---

## Workflow — коли треба нову фразу або виправити стару

1. **Edit lesson JSON** — заміни/додай `beat.text` у `lessons/l{N}.json`
2. **Rebuild phrases mapping:**
   ```bash
   # Regenerate docs/tts-phrases.{json,md} з нових lessons/*.json
   # (не автоматизований yet — треба ручний rerun extraction; TODO if частий case)
   ```
3. **Regen тільки той файл:**
   ```bash
   node scripts/regen-tts-elevenlabs.js --only l4/new-beat-id --force
   ```
4. **Прослухати:** `open public/audio/l4/new-beat-id.mp3`
5. **Commit + push** — Vercel auto-deploy → live за 1-2 хв

## Workflow — коли треба змінити voice_settings (напр. speed для якогось конкретного beat'у)

Наразі batch script використовує single `VOICE_SETTINGS` const. Якщо треба per-file overrides — треба розширити `tts-phrases.json` полем `voice_settings_override` і script підхоплюватиме. Не implemented — не було потреби.

---

## Про Claude Connectors ElevenLabs (2026-08-19 assessment)

Питання від Olexii: чи є сенс переходити на Claude Connectors ElevenLabs (`https://claude.ai/directory/elevenlabs`) замість прямого API?

**Відповідь: ні** — connector не годиться для нашого use-case, ось чому:

- **Connector — це MCP tool для Claude Desktop / Claude.ai чатів.** Він дозволяє Claude генерувати voice у розмові, коли user щось питає в чаті.
- **Наш use-case:** batch генерація 56 static mp3 файлів → deploy на Vercel → children завантажують → грає у web app. Це server-side generation, а не interactive.
- **Vercel API functions не мають доступу до MCP connectors** — це runtime protocol для Claude, не для third-party apps.
- **Ціна:** ElevenLabs все одно рахує кошти за характери (їхня послуга); Claude connector лише bridge. Якщо ключ підключено як OAuth до твого ElevenLabs акаунту — рахується з твого $5/міс Starter. Якщо бundled через Anthropic (Max/Pro) — субсидія від них, але тільки для Claude чатів, не для нашого prod.

**Коли connector був би корисний:** швидкі ad-hoc експерименти з voice settings прямо у Claude.ai чаті («звучить як звучало б з speed=1.2?» → одразу mp3 у чаті), без потреби curl → SendUserFile flow.

Якщо хочеш — можу активувати connector у твоєму Claude.ai (не через tmux), і будеш через нього швидко тестувати нові фрази перед додаванням у lessons. Скажи «активуй connector» і зроблю через свій Claude.ai flow (не через batch API).

**Для production regen залишаємось з API + `scripts/regen-tts-elevenlabs.js`.**

---

## 🔗 Related

- 📝 Фрази-джерело: [`tts-phrases.json`](tts-phrases.json) + [`tts-phrases.md`](tts-phrases.md) (human review + editing form)
- 🧪 Інші TTS системи розглянуті: [`tts-systems-inventory.md`](tts-systems-inventory.md)
- 📼 Piper (previous stack): [`tts-spec.md`](tts-spec.md) (superseded, kept для reference)
- 🎛️ Live phase0 TTS admin (9 provider'ів A/B): https://phase0-five.vercel.app/app/admin.html
- 📄 ElevenLabs API docs: https://elevenlabs.io/docs/api-reference/text-to-speech
- 🎨 Voice Library: https://elevenlabs.io/app/voice-library
