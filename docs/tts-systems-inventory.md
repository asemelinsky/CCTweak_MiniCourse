# TTS Systems Inventory — Preparation для regen Мо

**Створено:** 2026-08-19  |  **Мета:** обрати TTS engine для регенерації всіх 56 фраз черепашки Мо з правильними наголосами.

**Чому треба regen:** Поточні `.mp3` у [`../public/audio/l{1..7}/`](../public/audio/) створено через **Piper TTS `uk_UA-lada-x_low`** — багато неправильних наголосів. Для дітей 7–9р це поганий мовний зразок (уроки виступають вчительським еталоном).

**Джерело:** інформація з проекту `phase0` (Скретчик), який 3 місяці досліджував і тестував TTS engines для української на дітей 6–9р.

---

## 🎙️ Live тест-сторінка (**використовуй її!**)

**URL:** https://phase0-five.vercel.app/app/admin.html

**Що вміє:**
- Вибираєш будь-який з 9 провайдерів у списку (radio)
- Вставляєш будь-яку текстову фразу
- Тиснеш ▶ → одразу генерується + грає
- Показує `X-TTS-Provider` header (реально який відпрацював, з fallback-hint'ом якщо chain перескочив)
- Замір latency у ms
- **НЕ міняє prod env** — це single-request override через `provider` у body

**Як користуватись для нашого use-case:**
1. Візьми **5-10 «найпроблемніших» фраз** з [`tts-phrases.md`](tts-phrases.md) (з характерними складними словами: `алмаз`, `черепашка`, `порядок`, імена)
2. Прогнати кожну через **3-4 candidate providers** на admin.html
3. Прослухати → занотувати перемогшу
4. Тоді генеруємо всі 56 через API з обраним провайдером

**Live-API (для batch regen):**
```bash
curl -X POST https://phase0-five.vercel.app/api/tts \
  -H "Content-Type: application/json" \
  -d '{"text":"фраза українською","provider":"cartesia"}' \
  -o out.mp3
```

**Поточний prod chain** (не змінюємо для тесту):
```bash
$ curl -s https://phase0-five.vercel.app/api/tts-status
{"providers":["piper","elevenlabs","google_translate"]}
```

---

## 📋 Inventory — 9 інтегрованих провайдерів

| Provider ID | Label | Ціна/1M симв | Латентність | uk-UA якість | Стан |
|---|---|---|---|---|---|
| `cartesia`         | ⚡ Cartesia Sonic 3            | $15–20      | **40ms**    | ⭐⭐⭐⭐⭐ (uk доданий) | 🥇 recommended prod |
| `elevenlabs`       | 🎙️ ElevenLabs                 | $130–220    | ~300ms      | ⭐⭐⭐⭐⭐ найкраща     | ⚠️ дорого але для one-time OK |
| `chirp_charon`     | ☁️ Google Chirp 3 HD (Charon ♂) | $16       | ~300ms      | ⭐⭐⭐⭐               | 🧪 в тестуванні |
| `gemini_charon`    | ✨ Gemini 2.5 (Charon ♂)      | ~$0.35–$80  | ~1.5s       | ⭐⭐⭐⭐⭐              | 🧪 преміум |
| `google_cloud`     | ☁️ Google WaveNet             | $4–16       | ~200ms      | ⭐⭐⭐ трохи робот   | ✅ у prod phase0 |
| `azure_neural`     | 🔵 Azure Neural (Polina/Ostap) | $16–22    | ~150ms      | ⭐⭐⭐⭐ native uk    | 🧪 не тестувався |
| `piper`            | 🆓 Piper (self-host)           | **$0**      | ~50–100ms   | ⭐⭐⭐ трохи робот   | ⚠️ **наш поточний** — треба замінити |
| `coqui_xtts`       | 🎭 Coqui XTTS                  | **$0**      | ~?          | ❌ **uk не підтримується** | dormant |
| `google_translate` | ☁️ Google Translate            | **$0**      | ~200ms      | 🤖 fallback         | ✅ вільний fallback |

**Джерело:** [`phase0/app/admin.html:225-234`](/root/projects/aiscratch/claude/phase0/app/admin.html) + [`vault/business/tts-economics.md`](/root/projects/aiscratch/claude/phase0/vault/business/tts-economics.md)

---

## 💰 Cost для нашого use-case — одноразова регенерація

**Загалом символів:** 56 фраз × ~200 симв/фраза ≈ **~11 000 симв = 0.011M**

| Provider | Cost для повного regen | Коментар |
|---|---|---|
| Piper           | **$0**    | Але це те, з чим ми зараз |
| Google Translate | **$0**   | Роботизований звук, не для дітей |
| Cartesia        | ~$0.17    | 40ms, uk-UA, дитячий-friendly voices |
| Chirp 3 HD      | ~$0.18    | Google HD, uk-UA native |
| Google WaveNet  | ~$0.18    | Вже у phase0-prod, stable |
| Azure Neural    | ~$0.18    | Native uk voices Polina/Ostap — не тестувався ще |
| Gemini 2.5      | ~$0.88 (max) | Преміум якість |
| ElevenLabs      | ~$2.42    | ⭐⭐⭐⭐⭐ але дорого при масштабі; для one-time OK |

**Висновок:** для one-time regen цінник не блокатор ніде — обираємо тільки по якості наголосів для дітей.

---

## 🎯 Рекомендація workflow

### Крок 1: A/B тест кандидатів на 5 фразах (30 хв)

Кандидати top-3:
1. **Cartesia Sonic 3** — репутація best kid-friendly, uk доданий
2. **Chirp 3 HD (Charon ♂)** — Google HD, natively uk-UA
3. **ElevenLabs** — якість reference (навіть якщо не для prod — щоб порівняти)

Тестові фрази (з характерними складними наголосами):
- «Привіт! Мене звати Мо. Я впала у покинуту шахту.» — «покинуту», «шахту»
- «УРА! Я знайшла алмаз! Дякую тобі!» — «алмаз», «дякую»
- «Ідеально! Це мій перший крок. Тепер додай ще декілька блоків.» — «декілька», «блоків»
- «Ой, я вдарилась об стінку! Спробуй ще раз.» — «вдарилась», «стінку»
- «Тепер настав час найважчого завдання. Готовий?» — «найважчого», «завдання»

Прогнати кожну через 3 provider'и через admin.html → занотувати переможця.

### Крок 2: Обрати + regen 56 файлів через API

Batch-скрипт (я напишу коли скажеш, orientation: `scripts/regen-tts.sh`):

```bash
#!/bin/bash
# Reads tts-phrases.json → POSTs each phrase.text_tts to /api/tts with chosen provider
# → saves as public/audio/<lesson>/<beat_id>.mp3
PROVIDER="${PROVIDER:-cartesia}"
BASE="https://phase0-five.vercel.app/api/tts"
jq -c '.[]' docs/tts-phrases.json | while read -r item; do
  audio=$(echo "$item" | jq -r '.audio')
  text=$(echo "$item" | jq -r '.text_tts')
  out="public/audio/$audio"
  curl -s -X POST "$BASE" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg t "$text" --arg p "$PROVIDER" '{text:$t,provider:$p}')" \
    -o "$out"
  echo "  ✓ $audio"
done
```

### Крок 3: Якщо якийсь окремий файл — треба вручну виправити текст

Використати SSML / preprocessing tricks з [`tts-phrases.md`](tts-phrases.md):
- Google/Azure/OpenAI: `<phoneme alphabet="ipa" ph="...">слово</phoneme>`
- Piper +eSpeak: `+а` перед голосною наголошеного складу
- Або просто переформулювати фразу так, щоб TTS сам поставив правильний наголос

---

## 📞 Питання для тебе перед стартом

1. **Хто буде слухати A/B тест 5 фраз?** — ти особисто (з іншої сесії), чи хочеш щоб я запустив test у 3-х providers і сам оцінив? *(Sensitive для дитячого TTS — краще людське вухо)*
2. **Бюджет:** якщо переможе ElevenLabs ($2.42 за regen) — ОК? Чи обмеження $1?
3. **Наголоси у [tts-phrases.md](tts-phrases.md)** — впишеш сам після прослухування поточних `.mp3`, чи я підготую bulk-diff (згенерую всі 56 через 2 нові providers + поточні → створю html-порівняння для тебе)?
4. **API credentials** — ключі провайдерів уже налаштовані у phase0-five.vercel.app як env vars. Ми **не** використовуємо власні ключі — просто дьоргаємо його `/api/tts`. Це OK з погляду billing (спільний акаунт для тестів)? Чи хочеш окремі ключі для CCTweak_MiniCourse на самому cctweak-minicourse.vercel.app?

---

## 🔗 Related

- 📝 Фрази для регенерації: [`tts-phrases.md`](tts-phrases.md) + [`tts-phrases.json`](tts-phrases.json)
- 🎙️ Поточна TTS специфікація Piper: [`tts-spec.md`](tts-spec.md) (стане SUPERSEDED після regen)
- 📊 Оригінальний comparison report (phase0): `/root/projects/aiscratch/claude/tts-tester/docs/tts-comparison-report.md`
- 💰 TTS economics (phase0): `/root/projects/aiscratch/claude/phase0/vault/business/tts-economics.md`
- 🎛️ TTS switch skill (phase0): `/root/projects/aiscratch/claude/phase0/.claude/skills/tts-switch/skill.md`
- 🌐 Live admin page: https://phase0-five.vercel.app/app/admin.html
- 🌐 Live API: `POST https://phase0-five.vercel.app/api/tts` (body: `{text, provider}`)
- 🌐 Live status: https://phase0-five.vercel.app/api/tts-status
- 🌐 Live health probe: https://phase0-five.vercel.app/api/tts/health
