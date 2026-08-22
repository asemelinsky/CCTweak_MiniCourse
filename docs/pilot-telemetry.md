# CCTweak MiniCourse — Pilot Telemetry Reference

Каталог усіх events, що збираються у NocoDB під час пілотних сесій.

**Введено:** 2026-08-22 (commits `546fb6a`, `ef1c82d`, `7e2291a`).
**Where:** NocoDB `Pilot Events` таблиця, id `ms7z4a29wb5ht9s`, base `p3mj22s4c2ktjqk`.
**Filter:** запис створюється тільки коли URL містить `?u=<uuid>` — без uuid engine нічого не шле.

## Архітектура

```
[Browser]
   ├─ AudioPlayer     → dispatch document event 'audio-*'
   ├─ VideoOverlay    → dispatch document event 'video-*'
   ├─ main.js global  → dispatch document event 'pilot-*'
   │                     (errors, idle, visibility)
   └─ LessonEngine
        ├─ own emits (lesson_started, beat_shown, task_result, lesson_completed)
        └─ one-time listener на всі вищеперелічені events →
           додає currentLesson.id + currentBeat.id → pilotTrack()
                       │
                       ▼
              POST /api/pilot/event  (Vercel)
                       │
                       ▼
              NocoDB pilot_events row
```

`pilotTrack()` — fire-and-forget POST з `keepalive: true`, не блокує UI, помилка → console.warn.

## Каталог events

| event_type | Джерело | Коли | Meta fields |
|---|---|---|---|
| **`lesson_started`** | engine `start()` | 1 раз на сесію | `title`, `total_beats`, `href`, `ua`, `network` (effective_type, downlink_mbps, rtt_ms, save_data), `viewport` |
| **`beat_shown`** | engine `runCurrentBeat()` | Кожен beat | `idx`, `total`, `type` (speech-bubble / coach-mark / task / video-overlay / final-modal) |
| **`lesson_completed`** | engine, при final-modal beat | 1 раз якщо дійшов до кінця | `total_beats` |
| **`task_result`** | engine, `lesson-task-solved` / `lesson-task-failed` listeners | Кожна спроба ▶ у task-beat | `result` (SUCCESS / FAILURE / CRASH / TIMEOUT), `attempts` (per-task counter), `end_x`, `end_y`, `crash_type`, `bounces_count` |
| **`audio_request`** | AudioPlayer.playVoice() | Коли engine кличе play | `url` |
| **`audio_start`** | HTMLAudioElement 'playing' event | Реально почав грати | `url`, `ms_since_request` (латентність = завантаження + буфер) |
| **`audio_stall`** | HTMLAudioElement 'stalled' | Buffering під час грання | `url`, `ms_since_request` |
| **`audio_end`** | HTMLAudioElement 'ended' | Природньо доіграв | `url`, `duration_ms` |
| **`audio_error`** | HTMLAudioElement 'error' | 404 / decode fail | `url`, `code`, `message` |
| **`audio_blocked`** | audio.play().catch() | Chrome autoplay policy | `url`, `error` |
| **`audio_unlocked`** | user gesture unlock | При першому кліку після audio_blocked | `ms_waiting` (скільки learner тримав тишу) |
| **`video_request`** ... `video_blocked`** | VideoOverlay | Analog audio-* для mp4 (Реальний-Олексій) | url, ms_since_request / duration_ms / error |
| **`js_error`** | window.onerror | JS помилка на будь-якому скрипті | `message`, `source`, `lineno`, `colno`, `stack` |
| **`js_promise_rejection`** | window.onunhandledrejection | Async promise без catch | `reason` |
| **`idle_start`** | main.js global timer | 5+ сек без input | (пусто) |
| **`idle_end`** | main.js global timer | Перший input після idle | `duration_ms` (тривалість пасивності) |
| **`visibility_hidden`** | document.visibilitychange | Tab switch / minimize | (пусто) |
| **`visibility_visible`** | document.visibilitychange | Повернення | `away_ms` |

## Швидкі приклади queries (curl)

Всі події одного uuid:
```bash
curl -s -u admin:$BASIC -H "xc-token: $TOKEN" \
  "https://crm.bajka.pp.ua/api/v2/tables/ms7z4a29wb5ht9s/records?where=(learner_uuid,eq,pilot-XXX)&limit=1000&sort=Id"
```

Всі JS помилки:
```bash
"...records?where=(event_type,eq,js_error)&limit=100&sort=-Id"
```

Найдовші idle періоди:
```bash
# NocoDB v2 не має ORDER BY meta.duration_ms — треба pull і sort у python
curl -s ... "...where=(event_type,eq,idle_end)&limit=1000" | python3 -c "
import sys, json
d = json.load(sys.stdin)
rows = [(r['learner_uuid'], r['beat_id'], json.loads(r['meta'])['duration_ms'])
        for r in d['list']]
for r in sorted(rows, key=lambda x: -x[2])[:20]: print(r)"
```

Autoplay silence кейси (Ліза-like):
```bash
"...records?where=(event_type,eq,audio_unlocked)&limit=100"
# .ms_waiting > 30000 = дитина 30+ сек чула тишу
```

Мережевий когорт split:
```bash
"...records?where=(event_type,eq,lesson_started)&limit=1000"
# grep у meta для network.effective_type: 2g / 3g / 4g
```

## Похідні метрики (не збираються, обчислюються з raw)

- **Latency завантаження mp3** = `audio_start.ms_since_request`
- **Sync delay** = `audio_start.CreatedAt - beat_shown.CreatedAt` для того ж beat
- **Час на beat активний** = дельта до наступного `beat_shown` МІНУС сума `idle_end.duration_ms` між ними
- **Frustration score per task** = кількість `task_result` з result≠SUCCESS
- **Session engagement** = 100% - (сума `visibility_hidden` періодів + сума idle) / total duration

## Anti-patterns / gotchas

- **Emoji `🐢` у text не грає через TTS** — clean_for_tts() прибирає, TTS engine ігнорує. Не покладатись на emoji як інформативний сигнал у голосі.
- **`beat_shown` фіксує МОМЕНТ показу**, не тривалість. Тривалість = дельта між двома `beat_shown`. Якщо між ними був idle або visibility_hidden — це підрахувати окремо.
- **`audio_start.ms_since_request` — включає буферизацію**, не тільки network. Може бути 1500ms при поганому інтернеті чи 100ms при кешованому файлі.
- **`navigator.connection` — тільки у Chrome/Edge/Opera**. У Safari/Firefox `network` буде null. Не робити висновки для Safari-cohort.
- **`ms_waiting` у autoplay_unlocked** — це затримка user gesture, не завантаження mp3. Якщо >30000 — можна припускати «дитина не знала що клацати».

## Related

- Endpoint: `api/pilot/event.js`
- Engine emit: `src/lesson-engine.js` (pilotInit + pilotTrack + one-time listeners у start())
- Media emit: `src/audio-player.js`, `src/video-overlay.js`
- Global emit: `src/main.js` (setupGlobalPilotSignals)
- NocoDB CRM: https://crm.bajka.pp.ua/dashboard/#/base/p3mj22s4c2ktjqk
- Memory: `[[cctweak-vps-deploy]]`, `[[no-tts-regen-until-pilot]]`

## Session commits chronology

- `546fb6a` — базовий endpoint + 4 базові events (lesson_started, beat_shown, task_result, lesson_completed)
- `ef1c82d` — media lifecycle (audio-*, video-*) + network info у lesson_started
- `7e2291a` — global signals (js_error, idle_*, visibility_*)
