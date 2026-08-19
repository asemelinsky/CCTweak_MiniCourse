> ⚠️ **SUPERSEDED 2026-08-19** — цей документ описує **Piper**-стек, який замінено на **ElevenLabs**.
>
> Актуальна spec: [`mo-voice.md`](mo-voice.md).
>
> Piper mp3 файли архівовані у `public/audio/_archive-piper-2026-08-19/` (не в Git).
>
> Цей документ збережений для reference (rollback recipe, historical context).

---

# TTS Voice-Over Specification — CCTweak_MiniCourse Lesson 1

**Stack:** Piper TTS (self-hosted) → ffmpeg (pitch shift + encoding) → mp3
**Дата фіксації:** 2026-08-18
**Файли:** `public/audio/l1/{intro-1,intro-2,praise-first,celebration,hint-failure,hint-crash}.mp3` (6 файлів)

---

## Piper HTTP endpoint

| Параметр | Значення |
|---|---|
| Host | `vps-host` (46.225.227.42, Hetzner) |
| Bind | `127.0.0.1:5001` (localhost only, не exposed назовні) |
| Container | `piper-tts` (Docker, `piper-service-piper-tts` image) |
| Compose | `/root/projects/piper-service/docker-compose.yml` |
| Auth | Bearer token у header `Authorization: Bearer $PIPER_API_TOKEN` |
| Env | `/root/projects/piper-service/.env` → `PIPER_API_TOKEN` |
| Uptime | ~3 місяці stable, healthy |
| Health | `curl http://127.0.0.1:5001/health` |
| Endpoint | `POST /synthesize` |
| Body | `{"text": "...", "voice": "uk_UA-lada-x_low"}` |
| Return | `audio/wav` (raw WAV) |

---

## Voice model

| Параметр | Значення |
|---|---|
| Voice | `uk_UA-lada-x_low` |
| Language | Українська (uk_UA) |
| Quality | `x_low` (compact model — швидко, файли малі) |
| Num speakers | 1 |
| Native sample rate | **16000 Hz** |
| Format | WAV mono 16-bit PCM |
| Available alternatives | `uk_UA-ukrainian_tts-medium` (mykyta speaker, вищої якості але важче) |

**Файл моделі:** `/root/projects/piper-service/voices/uk_UA-lada-x_low.onnx` + `.onnx.json`

---

## Text preprocessing (обов'язково)

**Canonical `clean_for_tts()` функція** — застосувати ДО кожного запиту у Piper:

```python
import re

def clean_for_tts(text: str) -> str:
    # 1. Multi-char sequences → крапка (Piper читає '...' як «три-крапки»)
    text = text.replace('...', '.').replace('…', '.')
    # 2. Emoji + Mahjong tiles (U+1F000-U+1FAFF)
    text = re.sub(r'[\U0001F000-\U0001FAFF]', '', text)
    # 3. Broad symbols U+2190-U+27BF — Arrows, Math, Misc Tech,
    #    Enclosed Alphanum, Box Drawing, Block Elements, Geometric Shapes,
    #    Misc Symbols, Dingbats. Включає: ▶ ◀ ▲ ▼ ← → ↑ ↓ ⚠ ⚡ ✓ ✗ ⓘ ★
    text = re.sub(r'[←-➿]', '', text)
    # 4. Курсивні лапки — українські «» + curly EN “ ” ‘ ’ „ ‟
    text = re.sub(r'[«»“”‘’„‟]', '', text)
    # 5. Markdown emphasis — прибрати обгортку, залишити text
    text = re.sub(r'\*\*([^*]+)\*\*', r'\1', text)
    text = re.sub(r'\*([^*]+)\*', r'\1', text)
    # 6. Whitespace normalize
    text = re.sub(r'\s+', ' ', text).strip()
    return text
```

**Що ЗАЛИШАЄМО** (Piper корректно читає):
- Тире `—` (робить паузу)
- Дужки `()` `[]` — читаються як пауза
- Цифри — читаються словами
- Знаки пунктуації (`.` `,` `!` `?` `:` `;`) — інтонація/пауза

**Rationale** (чому broad ranges):
- Не варто робити whitelist специфічних символів для кожного beat'у
- Range U+2190-U+27BF blackistит все підозріле одним regex'ом
- У наших текстах символи з цих діапазонів не мають lexical смислу — тільки UI-метафора («натисни ▶», «увага ⚠»)
- Якщо колись треба буде використати наприклад математичне ≠ у тексті — доведеться уточнювати regex, але це corner case

---

## Pitch shift + encoding

**Спосіб:** ffmpeg з `librubberband` filter.

```bash
ffmpeg -y -loglevel error -i input.wav \
  -af "rubberband=pitch=1.155" \
  -codec:a libmp3lame -b:a 96k \
  output.mp3
```

**Параметри:**
| Параметр | Значення | Чому |
|---|---|---|
| Pitch ratio | `1.155` (=+250 cents) | «Дитячий» тембр Мо |
| Filter | `rubberband=pitch=X` | Phase-vocoder, найкраща якість без speed distortion |
| Speed | **1x (не змінено)** | Олексій підтвердив цей темп як прийнятний (2026-08-18) |
| Encoder | `libmp3lame` | Стандарт для web-audio |
| Bitrate | `96k` | Compromise: voice-only OK, файли компактні |
| Sample rate | 16000 Hz | Успадковано від Piper (не upsample'ити — sensor нікчемний) |
| Channels | mono (1) | Voice-only |

**НЕ використовувати** `asetrate + atempo` для pitch shift — це створює speed inconsistency між файлами через різну довжину TTS output.

**НЕ вживати** `-af "asetrate=22050*1.155,aresample=22050,atempo=1/1.155"` — deprecated нашою специфікацією (пробували раніше, результат нестабільний).

---

## Приклади готових файлів

Всі — mp3, mono, 16000 Hz, 96 kbps CBR:

| Файл | Duration | Size | Text |
|---|---|---|---|
| `intro-1.mp3` | 4.18s | 51 KB | «Привіт! Мене звати Мо. Я впала у покинуту шахту...» |
| `intro-2.mp3` | ~9s | 106 KB | «Не можу вибратись сама! Але ти можеш мене вивести...» |
| `praise-first.mp3` | ~12s | 148 KB | «Ідеально! Це мій перший крок. Тепер додай ще декілька блоків...» |
| `celebration.mp3` | ~8s | 95 KB | «УРА! Я знайшла алмаз! Дякую тобі!...» |
| `hint-failure.mp3` | ~5s | 67 KB | «Здається, я не дійшла до алмаза. Додай ще блоків...» |
| `hint-crash.mp3` | 4.5s | 54 KB | «Ой, я врізалась у стіну! Перевір послідовність...» |

**Total Lesson 1:** ~520 KB / ~42 секунди voice content.

---

## Full generation pipeline (bash script)

```bash
#!/bin/bash
set -euo pipefail
TOKEN="$PIPER_API_TOKEN"
OUT="./audio-out"
mkdir -p "$OUT"

# beat_id | текст (emoji вже прибрані)
declare -A BEATS=(
  ["hint-failure"]="Здається, я не дійшла до алмаза. Додай ще блоків..."
  ["hint-crash"]="Ой, я врізалась у стіну! Перевір послідовність..."
)

for id in "${!BEATS[@]}"; do
  text="${BEATS[$id]}"
  # 1. Синтез
  curl -sS -X POST "http://127.0.0.1:5001/synthesize" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c "import json,sys; print(json.dumps({'text':sys.argv[1],'voice':'uk_UA-lada-x_low'}))" "$text")" \
    -o "$OUT/${id}.wav"

  # 2. Sanity (RIFF header)
  head -c 4 "$OUT/${id}.wav" | grep -q RIFF || { echo "FAIL: not WAV"; exit 1; }

  # 3. Pitch shift + mp3 encode
  ffmpeg -y -loglevel error -i "$OUT/${id}.wav" \
    -af "rubberband=pitch=1.155" \
    -codec:a libmp3lame -b:a 96k \
    "$OUT/${id}.mp3"

  rm "$OUT/${id}.wav"
  echo "  → ${id}.mp3 $(wc -c < "$OUT/${id}.mp3")b"
done
```

---

## Deployment

**Location:** `/root/projects/CCTweak_MiniCourse/public/audio/l1/`
**Serve URL:** `https://cctweak-minicourse.vercel.app/public/audio/l1/{id}.mp3`
**Deploy:** `git push` → Vercel auto-deploy (webhook)
**Cache:** static, immutable — Vercel default

**Verify після push:**
```bash
until curl -sI "https://cctweak-minicourse.vercel.app/public/audio/l1/hint-failure.mp3" | head -1 | grep -q '200'; do sleep 3; done
```

---

## Dependencies

**На VPS host (для generation):**
- Docker + `piper-tts` контейнер (running, healthy)
- `ffmpeg` з `--enable-librubberband` (default в Ubuntu 24.04 ffmpeg build)
- `curl`, `python3`

**Немає в devbox контейнері:**
- Docker недоступний → всі TTS-generation команди виконувати через `ssh vps-host`
- Файли scp'ити на VPS: `scp vps-host:/tmp/tts_out/*.mp3 ./public/audio/l1/`

---

## Reproducibility

Всі 6 файлів згенеровані з identical params:
- Voice: `uk_UA-lada-x_low`
- Pitch: `rubberband=pitch=1.155`
- Encoding: `libmp3lame -b:a 96k`
- Sample rate: 16000 (native)
- Speed: 1x

Тому регенерація дає bit-identical (або майже) результат — deterministic.

---

## Що НЕ у цій специфікації

- Voice-cloning (custom Mo voice) — off-scope
- Multi-voice (різні персонажі) — off-scope
- Musical background — off-scope
- Emotion tags (SSML `<prosody>`) — Piper не підтримує SSML
- WebAudio dynamic pitch — client-side, не наша частина
- 6E network requirements — irrelevant
