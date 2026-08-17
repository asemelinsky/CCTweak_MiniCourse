#!/bin/bash
# generate-tts.sh — генерує озвучку для всіх speech-bubble beats з lessons/*.json
# через Piper Ukrainian voice (phase0-серверу).
#
# Використання:
#   ./scripts/generate-tts.sh [lesson_id]
#
# Приклад:
#   ./scripts/generate-tts.sh l1
#   ./scripts/generate-tts.sh          # усі уроки
#
# Prerequisites (на VPS):
#   - Piper binary у PATH або /root/piper/piper
#   - Український голос: /root/piper/voices/uk_UA-lada-x_low.onnx (або аналог)
#     Голос перевірити: https://huggingface.co/rhasspy/piper-voices/tree/main/uk/uk_UA
#     Для «light female / near-childish» — спробувати `lada` або `ukrainian_tts_female`,
#     плюс post-process у sox з підвищенням pitch на +200 (для дитячого тембру).

set -euo pipefail

LESSON_ID="${1:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LESSONS_DIR="$ROOT/lessons"
AUDIO_DIR="$ROOT/public/audio"

# Piper paths — можуть відрізнятись на різних машинах
PIPER_BIN="${PIPER_BIN:-/root/piper/piper}"
PIPER_VOICE="${PIPER_VOICE:-/root/piper/voices/uk_UA-lada-x_low.onnx}"

# Post-process: pitch shift для «дитячого» тембру (опційно)
USE_SOX_PITCH_UP="${USE_SOX_PITCH_UP:-1}"
PITCH_CENTS="${PITCH_CENTS:-250}"  # +250 cents = ~2.5 півтона вище

# Перевірити prerequisites
if [ ! -x "$PIPER_BIN" ]; then
  echo "❌ Piper binary не знайдено: $PIPER_BIN"
  echo "   Встанови або переопредели PIPER_BIN='/шлях/до/piper'"
  exit 1
fi

if [ ! -f "$PIPER_VOICE" ]; then
  echo "❌ Piper voice не знайдено: $PIPER_VOICE"
  echo "   Скачати з https://huggingface.co/rhasspy/piper-voices"
  exit 1
fi

# Функція: згенерувати один mp3
# Args: text output_mp3
generate_one() {
  local text="$1"
  local out="$2"

  echo "  → $(basename "$out")"
  echo "    text: ${text:0:60}..."

  local wav_tmp; wav_tmp=$(mktemp --suffix=.wav)
  local wav_shifted; wav_shifted=$(mktemp --suffix=.wav)

  # Piper: text → wav
  echo "$text" | "$PIPER_BIN" --model "$PIPER_VOICE" --output_file "$wav_tmp" 2>/dev/null

  # Опційно: pitch up через sox
  if [ "$USE_SOX_PITCH_UP" = "1" ] && command -v sox &>/dev/null; then
    sox "$wav_tmp" "$wav_shifted" pitch "$PITCH_CENTS"
    mv "$wav_shifted" "$wav_tmp"
  fi

  # wav → mp3 (краще lame, або ffmpeg як fallback)
  mkdir -p "$(dirname "$out")"
  if command -v lame &>/dev/null; then
    lame --quiet -b 64 "$wav_tmp" "$out"
  elif command -v ffmpeg &>/dev/null; then
    ffmpeg -loglevel error -y -i "$wav_tmp" -codec:a libmp3lame -b:a 64k "$out"
  else
    # Fallback — просто скопіювати як wav (якщо ні lame ні ffmpeg)
    cp "$wav_tmp" "${out%.mp3}.wav"
    echo "  ⚠️  Немає ні lame ні ffmpeg — залишив як wav"
  fi

  rm -f "$wav_tmp"
}

# Обробити один урок JSON
process_lesson() {
  local lesson_file="$1"
  local lesson_id; lesson_id=$(basename "$lesson_file" .json)
  echo
  echo "=== $lesson_id ==="

  local out_dir="$AUDIO_DIR/$lesson_id"
  mkdir -p "$out_dir"

  # Витягуємо beats з speech-bubble, які мають text
  # Формат виходу: <beat_id>|<text>
  python3 <<PY | while IFS='|' read -r beat_id text; do
import json, sys
data = json.load(open("$lesson_file"))
for beat in data.get("beats", []):
    if beat.get("type") == "speech-bubble" and beat.get("text"):
        bid = beat.get("id", "unknown")
        txt = beat["text"].replace("\\n", " ").replace("|", ";")
        print(f"{bid}|{txt}")
PY
    out="$out_dir/${beat_id}.mp3"
    if [ -f "$out" ] && [ "${FORCE_REGEN:-0}" != "1" ]; then
      echo "  ⏭  $(basename "$out") — вже існує (FORCE_REGEN=1 щоб перегенерувати)"
      continue
    fi
    generate_one "$text" "$out"
  done
}

# Main
if [ -n "$LESSON_ID" ]; then
  process_lesson "$LESSONS_DIR/${LESSON_ID}.json"
else
  for f in "$LESSONS_DIR"/*.json; do
    process_lesson "$f"
  done
fi

echo
echo "✅ Готово. Файли у $AUDIO_DIR/"
echo
echo "Далі: закомітити нові .mp3 у git, push — Vercel зробить redeploy."
