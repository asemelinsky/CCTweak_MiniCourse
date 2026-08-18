# CCTweak MiniCourse — «Пригоди Черепашки Мо»

Free 5-урочний мінікурс з блочного програмування для дітей 7-9 років. Lead-magnet до основних курсів школи Кодомандри (Minecraft 3D, Scratch 2D).

**Мета:** через 5 коротких (~20 хв) уроків познайомити дитину з базовою логікою програмування — послідовність, цикл, умова, комбінація. У наскрізному сюжеті: черепашка Мо впала у покинуту шахту, дитина її виводить кімнатами глибше і глибше.

## Стек

- **Blockly** (Google) — візуальне блочне програмування
- **JS-Interpreter** (Neil Fraser) — sandbox виконання коду з детекцією нескінченних циклів
- **SVG** — рендер side-view сцени (як 2D-Terraria)
- **Vanilla Minecraft textures** — [mcasset.cloud](https://mcasset.cloud/)
- **Lesson Engine** — власний JSON-driven beat sequencer (`src/lesson-engine.js`)
- **Piper TTS** (Ukrainian) — озвучка Мо, Фаза 3
- **Hedra / NanoGen** — Реальний-Олексій і Pixar-Олексій відео, Фаза 2

## Відношення до CCTweak_Puzzles

CCTweak_Puzzles — це **playground/тренажер**, вільний доступ до головоломок.
CCTweak_MiniCourse — це **продукт**, конкретний 5-урочний курс з наративом.

Обидва проекти використовують одну й ту саму базу (Blockly + JS-Interpreter + turtle simulator), але еволюціонують незалежно. Puzzles розвивається як інструмент, MiniCourse — як педагогічний продукт.

## Локальний запуск

```bash
python3 -m http.server 8080
# → http://localhost:8080
```

Ця команда стартує статичний файловий сервер. Ніякого build-кроку немає.

## Структура

```
src/
├── blocks.js          — Blockly-блоки (forward, back, up, down)
├── generator.js       — JS-код-генератор для блоків
├── simulator.js       — turtle state, execute, animate, level map
├── main.js            — bootstrap: init Blockly + start lesson
├── style.css          — стилі UI
├── style-lesson.css   — стилі engine (bubble, coach mark)
├── lesson-engine.js   — JSON beat sequencer
├── coach-mark.js      — spotlight + callout component
└── speech-bubble.js   — SVG bubble з аватаром

lessons/
└── l1.json            — Урок 1: Знайомство з Мо

public/
└── textures/          — Minecraft-текстури (grass, dirt, stone, ...)
```

## Прогрес по фазах

- ✅ **Фаза 1:** Engine + L1 з text bubbles + coach marks
- ⏳ **Фаза 2:** Відео-оверлеї (Hedra Real-Olexii + Pixar-Olexii)
- ⏳ **Фаза 3:** TTS-озвучка Мо (Piper Ukrainian)
- 📅 **Фаза 4:** Уроки L2-L5, progress persistence, parents summary + CTA

## Ліцензія

MIT


## 📐 Документація розробки

- [`docs/dev-logic.md`](docs/dev-logic.md) — архітектура логіки (beat sequencer, bubble/coach-mark/video/audio, simulator, JSON schema, extension points, педагогічні принципи, журнал рішень)
- [`docs/tts-spec.md`](docs/tts-spec.md) — операційна специфікація TTS (Piper endpoint, voice model, pitch shift, pipeline, reproducibility)