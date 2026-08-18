# 📐 DEV-LOGIC — CCTweak MiniCourse

> **Живий документ архітектури.** Опис ЛОГІКИ, не коду. Читати перед тим, як міняти engine.
> Оновлюється при кожному значущому фіксі поведінки.

**Проект:** https://github.com/asemelinsky/CCTweak_MiniCourse
**Live:** https://cctweak-minicourse.vercel.app/
**Стартовий читач:** будь-який dev або LLM-агент, який працює над кодом уперше.

---

## Загальна архітектура (3 шари)

```
┌─────────────────────────────────────────────────────────────┐
│  Шар 1: Blockly workspace (UI для складання коду)            │
│  — стандартний Blockly з нашими 4 turtle-блоками             │
│  — main.js ініціалізує; toolbox у index.html                 │
└─────────────────────────────────────────────────────────────┘
                              ↓ (Blockly → JS-код через generator.js)
┌─────────────────────────────────────────────────────────────┐
│  Шар 2: Simulator (sandbox виконання + анімація)             │
│  — JS-Interpreter (Neil Fraser) — покроково для timeout      │
│  — Log-and-replay: збираємо actions → анімуємо після         │
│  — 4 outcomes: SUCCESS / FAILURE / CRASH / TIMEOUT           │
│  — simulator.js                                               │
└─────────────────────────────────────────────────────────────┘
                              ↓ (custom events → engine)
┌─────────────────────────────────────────────────────────────┐
│  Шар 3: Lesson Engine (JSON-driven beat sequencer)           │
│  — читає lessons/lN.json → виконує beats послідовно          │
│  — 4 типи beats: speech-bubble, coach-mark, task, video      │
│  — координує UI-компоненти (bubble, coach-mark, video, audio)│
│  — lesson-engine.js                                           │
└─────────────────────────────────────────────────────────────┘
```

**Ключове рішення:** уроки описуються у JSON, не імперативно. Це дозволяє додавати нові уроки без зміни JS-коду.

---

## §1. Beat sequencer (lesson-engine.js)

### Що таке beat

Beat — це один крок уроку. Може бути bubble Мо, coach mark на UI, task, або video. Уроки — списки beats.

### Життєвий цикл beat'а

```
runCurrentBeat()
  ├─ Очищає listeners попереднього beat'а
  ├─ Дивиться на type → викликає відповідний show() (SpeechBubble.show, CoachMark.show, etc)
  ├─ Реєструє advance-listener (на що чекати щоб перейти далі)
  └─ Повертає керування — асинхронно чекаємо event
              ↓
       advance-event fires (напр. click-next, block-added, run-clicked)
              ↓
       advance()
         ├─ Викликає hide() поточного компонента
         ├─ Очищає listeners
         └─ currentBeatIdx++
              ↓
       runCurrentBeat() (наступний beat)
```

### Типи advance

| Тип | Що чекає |
|---|---|
| `click-next` | Клік на кнопку «Далі» у bubble або callout |
| `block-added` | Дитина перетягнула блок з палітри у workspace |
| `run-clicked` | Дитина натиснула ▶ Запустити |
| `task-solved` | Simulator dispatch'нув `lesson-task-solved` (SUCCESS) |

### Listeners cleanup

Кожен advance-listener додається у список `listeners`. Перед новим beat — `clearListeners()` видаляє всі: DOM listeners через `removeEventListener`, Blockly listeners через `workspace.removeChangeListener`.

**Правило:** одна дія = один advance. Не можна щоб бабка «click-next» лишалась активною коли ми вже на task-етапі.

---

## §2. Speech Bubble (speech-bubble.js)

### Що це

SVG bubble у нижній частині сцени з аватаром (🐢 або 👨‍🏫) і текстом. Може мати кнопку «Далі», може не мати. Може відтворювати voice-over, може не відтворювати.

### Позиціонування

**Фіксоване** — `position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%)`. **НЕ** рухається за черепашкою.

**Чому:** черепашка мандрує сценою під час анімації. Bubble що стрибає за нею = візуальний хаос. Стабільна позиція + анімація аватара (wiggle/jump/shake) + хвостик вниз — достатньо для звʼязку «Мо каже».

### Анімації аватара

- `wiggle` — легке погойдування, для звичайного bubble
- `jump` — підскакування, для радісних моментів
- `shake` — тряска, для помилок

### Voice-over — ключова логіка

**Автоматичний URL:** якщо у beat є `id` і `lesson_id` → шукає файл `public/audio/{lesson_id}/{beat_id}.mp3`.

**Явний URL:** якщо у beat є `voice_url` → грає його.

**Без ID → без voice:** якщо beat не має `id`, voice не грає (це dynamic hint-bubbles).

**AudioPlayer керує:**
- Якщо toggle 🔈 (mute) — ігнорує play
- Якщо файл 404 — тихо, не крешить
- Якщо browser autoplay-blocked — грає після першого user gesture

### Dismiss (коли зникає)

Bubble зникає при виклику `SpeechBubble.hide()`. Викликається:
- З `advance()` у engine — коли beat переходить у наступний
- З `failListener` у setupTask — коли дитина клікнула ▶ (нова спроба) або редагує blocks

**НЕ зникає по таймеру.** Раніше був `setTimeout(hide, 4000)` — прибрано (див. §7).

---

## §3. Failure/Crash Hint bubbles — окрема логіка

Це особливий випадок speech-bubble, який показується коли дитина запустила код і він не пройшов.

### Правила показу

1. **Триггер:** `lesson-task-failed` event з simulator (`{ detail: { result: 'FAILURE' | 'CRASH' | 'TIMEOUT' } }`)
2. **Текст:** з `beat.hint_on_failure` / `beat.hint_on_crash` (з JSON уроку). TIMEOUT має дефолтний текст.
3. **Voice:** з `public/audio/{lesson_id}/hint-failure.mp3` / `hint-crash.mp3` — автоматично через ID `hint-failure` / `hint-crash`.
4. **Дисміс:** НЕ по таймеру. Зникає коли:
   - Дитина клікнула ▶ Запустити (нова спроба)
   - Дитина внесла зміну у workspace (BLOCK_MOVE / BLOCK_CHANGE / BLOCK_CREATE у Blockly)

### Anti-repeat

Якщо той самий hint показувався **менш ніж 60 сек тому** — bubble показуємо (мовчазний), voice не переграємо.

**Чому:** дитина 3 рази поспіль отримує «не дійшла» — набридливо слухати ту саму фразу 3 рази. Але візуально показати треба (щоб дитина знала що спробувала і що знову невдало).

**Реалізація:** `lastHintText` + `lastHintTime` у lesson-engine.js. При новому task — reset.

### Педагогічний зв'язок

Ця логіка матеріалізує **головний посил positioning-документу §5**: помилка = не сором, а частина процесу. Мо реагує **звуком співчуття**, дитина її чує, повторно намагається без стресу.

---

## §4. Coach Mark (coach-mark.js)

### Що це

Dark overlay покриває весь екран **окрім** одного UI-елемента (кутик підсвічений через SVG-mask). Плюс callout з текстом і опційно кнопкою.

### Позиціонування callout

Через `target: '.blocklyToolboxDiv'` (CSS selector) + `position: 'right' | 'left' | 'top' | 'bottom'`.

Якщо target не знайдено — graceful fallback: callout по центру екрану без spotlight (`showCalloutOnly`).

### Технічне рішення (SVG mask)

Overlay — SVG що покриває viewport. Всередині: `<mask>` з двома `<rect>`:
- Білий = «видиме» (тобто затемнене)
- Чорний = «дірка» (розташована над target)

Це дає rounded-corner дірку у dark backdrop, без CSS-хаків.

### Автооновлення при resize

При зміні розміру вікна — `resizeHandler` перераховує позицію дірки і callout, щоб залишались над правильним елементом.

### Advance

Стандартний — `click-next` (кнопка у callout), або `block-added` / `run-clicked` (з engine слухає окремо).

---

## §5. Video Overlay (video-overlay.js) — Phase 2

### Що це

Модальний overlay з mp4 у круглій рамці. Використовується для «bookend» відео — реального Олексія-вчителя з Hedra.

### Життєвий цикл

- Показ → autoplay video
- Якщо autoplay заблокований (Safari) → велика центральна Play-кнопка
- Через `dismissible_after_ms` (default 3000) → з'являється кнопка «Далі»
- Клік на «Далі» → dispatch `lesson-next-click` → engine advance

### Стилі

- Backdrop `rgba(0, 0, 0, 0.85)` — темнить сцену
- Container `border-radius: 50%` — коло
- Video `object-fit: cover` — обріз краї щоб вписалось у коло
- Green border 6px — брендинг

**Гнучкість формату:** приймає mp4 будь-якого розширення (720×720 квадрат ідеально, вертикальне 720×1280 обріжеться).

---

## §6. Audio Player (audio-player.js)

### Global toggle

- Стан: `localStorage['lesson_audio_enabled']` (default `true`)
- UI: кнопка 🔊 / 🔈 у header, ліворуч від «Скинути»
- Клік на toggle грає `test-beep` для підтвердження + unlock autoplay

### SFX (Sound Effects)

- Preload при init — 5 файлів (step, success, failure, click, test-beep) з `public/audio/sfx/`
- Volume: step 0.7, інші 0.9
- Graceful degradation: якщо файлу нема — `console.warn`, продовжуємо без нього
- Reset `currentTime` перед кожним play — для швидких повторів (крок під час анімації)

### Voice-over

- Динамічне створення `new Audio(url)` при кожному виклику
- Volume 0.85
- Тільки один активний voice одночасно — `stopVoice()` перед новим play
- При autoplay-block → `console.log`, не крешимо

### Логіка звук/тиша

| Дія | З toggle 🔊 | З toggle 🔈 |
|---|---|---|
| Крок черепашки під час анімації | грає `step` | тиша |
| Успіх (task-solved) | грає `success` | тиша |
| Невдача (crash/failure) | грає `failure` | тиша |
| Bubble Мо з ID | грає voice mp3 | тиша |
| Bubble Мо без ID (dynamic) | без voice | без voice (те саме) |
| Клік на toggle | грає `test-beep` (unlock + confirm) | зупиняє поточний voice |

---

## §7. Simulator (simulator.js)

### Ключові конcтaнти

- `TILE_SIZE = 40` — px на клітинку
- `COLS = 12, ROWS = 9` — розмір мапи
- SVG scene `480 × 360`

### Level format

`LEVEL_1` — масив рядків, де кожен символ = тип клітинки:
- `.` = AIR (повітря)
- `G` = GRASS
- `D` = DIRT
- `S` = STONE
- `C` = COBBLESTONE
- `B` = BEDROCK
- `◆` = DIAMOND (фініш)
- `►` = START (позиція черепашки)

### Turtle API (виконується у JS-Interpreter)

- `turtleForward(id)` — крок вправо (у 2D face zafiкsований)
- `turtleBack(id)` — крок вліво
- `turtleUp(id)` — крок вгору
- `turtleDown(id)` — крок вниз

Другий аргумент `id` — блоку у Blockly, для підсвітки під час анімації.

### Виконання коду (log-and-replay)

1. `executeUserCode()` викликається з ▶
2. `attemptCount++` — інкремент лічильника (для outro-модалки §10.1 positioning)
3. `interpreter.step()` у циклі, поки не завершиться або `ticks-- === 0` (10000 → TIMEOUT)
4. Actions пишуться у `log`
5. Визначається `lastResult`: SUCCESS / FAILURE / CRASH / TIMEOUT
6. `scheduleAnimation()` → анімація за log-ом

### Dispatch events для engine

- Після `showFinalResult()`:
  - SUCCESS → `document.dispatchEvent(new CustomEvent('lesson-task-solved', { detail: { result } }))`
  - інше → `lesson-task-failed`
- У lesson mode (`window._lessonMode`) → стандартний модал не показуємо (engine керує)

### Attempt counter

- `attemptCount` — глобальний лічильник спроб у поточній сесії
- Експортується у `window._puzzles.attemptCount`
- Lesson-engine читає у `final-modal` для заміни `{ATTEMPTS}` і `{ATTEMPTS_WORD}` у тексті

---

## §8. Lesson JSON schema

```json
{
  "id": "l1",
  "title": "Знайомство з Мо",
  "beats": [
    {
      "id": "intro-1",                   // ID для voice-URL та debug
      "type": "speech-bubble",           // тип beat'а
      "character": "mo",                 // "mo" | "olexii"
      "text": "Привіт! Я Мо...",         // текст bubble
      "animation": "wiggle",             // wiggle | jump | shake
      "advance": {                       // на що чекати
        "type": "click-next",
        "label": "Далі"                  // текст кнопки
      }
    },
    {
      "id": "tour-toolbox",
      "type": "coach-mark",
      "target": ".blocklyToolboxDiv",    // CSS selector елемента для підсвітки
      "position": "right",               // right | left | top | bottom
      "text": "Тут блоки-команди",
      "advance": { "type": "click-next", "label": "Далі" }
    },
    {
      "id": "task-main",
      "type": "task",
      "hint_on_failure": "Не дійшла...", // текст bubble при FAILURE
      "hint_on_crash": "Врізалась...",   // текст bubble при CRASH
      "advance": { "type": "task-solved" }
    },
    {
      "id": "final",
      "type": "final-modal",             // окремий тип, без advance
      "title": "Урок 1 пройдено!",
      "message": "Ти зробив {ATTEMPTS} {ATTEMPTS_WORD}...",
      "cta_label": "Дякую!"
    }
  ]
}
```

### Плейсхолдери у тексті

- `{ATTEMPTS}` — кількість спроб з simulator (тільки у final-modal)
- `{ATTEMPTS_WORD}` — правильне відмінювання: 1 → «спробу», 2-4 → «спроби», інше → «спроб»

---

## §9. Audio Files convention

```
public/audio/
├── sfx/
│   ├── step.mp3         # ~100ms, крок черепашки
│   ├── success.mp3      # ~600ms, 3-нотний акорд
│   ├── failure.mp3      # ~500ms, 2-нотний спадаючий
│   ├── click.mp3        # UI-клік (нею поки не використовуємо, зарезервовано)
│   └── test-beep.mp3    # ~100ms, підтвердження toggle
└── l1/
    ├── intro-1.mp3         # відповідає beat.id="intro-1"
    ├── intro-2.mp3         # beat.id="intro-2"
    ├── praise-first.mp3    # beat.id="praise-first"
    ├── celebration.mp3     # beat.id="celebration"
    ├── hint-failure.mp3    # для failure hint у task beat
    └── hint-crash.mp3      # для crash hint
```

**Правило:** назва файлу = `beat.id`. Автоматичне зіставлення у `SpeechBubble.show()`.

**Голос:** Piper Ukrainian `uk_UA-lada-x_low`, pitch +250 cents (через `rubberband=pitch=1.155`).
Кодек: mp3 96 kbps mono.

---

## §10. Extension points

### Додати нову lesson (l2, l3...)

1. Створити `lessons/lN.json` за схемою §8
2. Згенерувати voice-файли у `public/audio/lN/` (див. `scripts/generate-tts.sh`)
3. У `main.js` замінити `LessonEngine.load('lessons/l1.json')` на потрібний або зробити level-selector

**Ніяких змін JS-коду.**

### Додати новий тип beat

1. У `lesson-engine.js`, у `runCurrentBeat()` switch — додати case
2. Створити відповідний component (за прикладом speech-bubble.js / coach-mark.js)
3. Задокументувати у цьому файлі (§X)

### Додати нову SFX

1. Файл у `public/audio/sfx/`
2. Додати entry у `SFX` object у audio-player.js
3. Викликати `AudioPlayer.play('name')` де треба

### Додати новий Blockly-блок

1. Визначення у `src/blocks.js`
2. JS-generator у `src/generator.js` → `Blockly.JavaScript.forBlock['blockname']`
3. Додати у `<xml id="toolbox">` у `index.html`
4. Реалізувати turtle-функцію у `src/simulator.js` (та зареєструвати у `initInterpreter`)

### Додати новий тип verification

Зараз використовуємо тільки goal achievement. Для нових типів (MAX_BLOCKS, efficiency, etc):

- Розширити `showFinalResult()` — прораховувати нові метрики
- Розширити `lesson-task-failed` event detail — додати metrics
- В engine — новий `advance.type` (напр. `task-solved-with-max-blocks`)
- В JSON beat.task — параметри перевірки (`max_blocks: 5`, тощо)

---

## §11. Наскрізні педагогічні принципи (з positioning-документу)

Ці принципи задокументовано ЯК коду і в JSON-текстах:

### Помилка = частина процесу

- Мо реагує на CRASH/FAILURE співчуттям, а не осудом (текст hint'ів)
- Bubble не зникає по таймеру — можна прочитати не поспішаючи
- Anti-repeat voice — не набридаємо тим самим повідомленням
- Attempt counter у outro — показує N як позитив: «ти зробив 5 спроб — це саме як фахівець»

### Дитина йде за руку, не тестується

- Coach marks направляють куди дивитись і що робити
- Toolbox спочатку без шкоди — тільки 4 блоки
- Fail — не game over, миттєвий retry без штрафу

### Live feedback

- Кожен крок черепашки супроводжується звуком (step)
- Блок у workspace підсвічується під час виконання (Blockly.highlightBlock)
- 4 outcomes з візуальними іконками (💎, 💥, ⏱️, 🤷)

---

## §12. Що зафіксовано у Vercel і що ні

**У git:** усе (крім бінарних відео поки що).
**У Vercel deploy:** усе з main branch.
**НЕ у git:** `.env`, `node_modules/` (нема), `.vercel/` (deployment metadata).

**Auto-deploy:** git push на `main` → Vercel робить production deploy за ~30 сек.
**Preview:** push на будь-який інший branch → Vercel робить preview URL. Не використовуємо поки що.

---

## §13. Журнал значущих архітектурних рішень

| Дата | Що | Чому |
|---|---|---|
| 2026-08-17 | Beat sequencer з JSON (не hardcoded scripts) | Швидкість створення нових уроків, без dev-роботи |
| 2026-08-17 | Speech-bubble у фіксованій позиції знизу | Стабільність UX під час анімації черепашки |
| 2026-08-17 | Coach mark через SVG-mask, не CSS-shadow | Rounded corners, точна форма |
| 2026-08-17 | Custom events для simulator ↔ engine | Loose coupling; simulator не знає про уроки |
| 2026-08-17 | `window._lessonMode` прапорець | Fallback до standalone-режиму (для розробки) |
| 2026-08-18 | AudioPlayer як окремий модуль з global toggle | Аудіо-стан = один global, а не per-bubble |
| 2026-08-18 | Attempt counter у simulator, expose через window | Мінімум coupling з engine; engine читає, не змінює |
| 2026-08-18 | Hint bubbles БЕЗ auto-hide | Читання не поспішаючи. Для 7-9-річок 4 сек мало. |
| 2026-08-18 | Anti-repeat voice на 60 сек | Уникнути «повторного голосу» при кількох невдалих спробах |
| 2026-08-18 | Dev-logic doc створений | Явна документація логіки, не лише в коді |

---

## Куди дивитись при проблемах

| Симптом | Дивись у |
|---|---|
| Bubble не з'являється | speech-bubble.js `show()` — консоль на error; переконайся що DOM-body існує |
| Voice не грає | `console.log` `[Audio]` — блокує autoplay? файл 404? toggle mute? |
| Coach mark промахує | Blockly перерендерився → змінилась структура. Логі: `console.warn('[CoachMark] Не знайдено target: ...')` |
| Task не advance | Simulator dispatch'ив task-solved? Перевір `document.addEventListener('lesson-task-solved', ...)` через chrome devtools Events |
| SFX не грають | Файли у public/audio/sfx/? Preload успішний? Audio toggle ON? |
| Всі уроки грають однаково | main.js завжди `_lessonMode = true` — для standalone треба закоментувати. Level selector — не в MVP. |

---

## Що НЕ описано (поки що)

- Мобільна адаптація (не MVP)
- Progress persistence (Backlog)
- Multi-agent (майбутнє, див. tasks-catalog §6)
- Screen-switching (roadmap §11.2 у tasks-catalog)
- Tools + Mobs система (roadmap §11.2 №7)

Коли реалізуємо — додаємо секцію сюди.
