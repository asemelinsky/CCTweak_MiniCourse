/**
 * Simulator — level map, drawMap, turtle state, API, execute, animate.
 * Архітектура запозичена з Blockly Games Maze (main.js), адаптована під:
 *   - side-view (не top-down)
 *   - 4 абсолютні напрямки (не face-based)
 *   - Minecraft-текстури замість pegman-tiles
 */

'use strict';

//////////////////////////////////////////////////////////////////////
// Константи
//////////////////////////////////////////////////////////////////////

const TILE_SIZE = 40;        // px, розмір однієї клітинки у SVG
const COLS = 12;             // ширина world у клітинках
const ROWS = 9;              // висота world

// Expose константи та state на window для e2e-тестів
if (typeof window !== 'undefined') {
  window._puzzles = { TILE_SIZE, COLS, ROWS };
}
const SCENE_W = TILE_SIZE * COLS;   // 480px
const SCENE_H = TILE_SIZE * ROWS;   // 360px

const TILE = {
  AIR: 0,          // повітря (небо або в тунелі)
  GRASS: 1,        // grass_block_side
  DIRT: 2,         // dirt
  STONE: 3,        // stone
  COBBLESTONE: 4,  // cobblestone
  BEDROCK: 5,      // bedrock (край world, для декору)
  DIAMOND: 6,      // diamond gem (finish marker) — animated via .tile-diamond CSS
  START: 7,        // start marker (візуально air, але помічає стартову позицію)
};

const TEXTURE_URL = {
  [TILE.GRASS]:       'public/textures/grass_block_side.png',
  [TILE.DIRT]:        'public/textures/dirt.png',
  [TILE.STONE]:       'public/textures/stone.png',
  [TILE.COBBLESTONE]: 'public/textures/cobblestone.png',
  [TILE.BEDROCK]:     'public/textures/bedrock.png',
  [TILE.DIAMOND]:     'public/textures/diamond.svg',   // LB-004: gem, не ore. Animated via CSS (class="tile-diamond")
};

// Level 1 map — 12 колонок × 9 рядків.
// Layout: sky зверху, поверхня-grass, підземелля-dirt+stone.
// Тунель: (2,2) стартова позиція → forward → down×2 → forward×4 → down → diamond (7,7).
// Всього 8 кроків.
//
// Legend: . = AIR (небо/тунель), G = grass, D = dirt, S = stone,
//         C = cobblestone, B = bedrock, ◆ = diamond, ► = START
//
//        col: 0 1 2 3 4 5 6 7 8 9 10 11
const LEVEL_1 = [
  '............',  // 0 — sky
  '............',  // 1 — sky
  '..►.........',  // 2 — turtle starts here (on grass surface at col 2)
  'GGG.GGGGGGGG',  // 3 — surface (тунель entrance at col 3)
  'DDD.DDDDDDDD',  // 4 — dirt (тунель col 3 продовжується вниз)
  'DDD......DDD',  // 5 — dirt (тунель повертає праворуч col 3→8)
  'SSSSSSS◆SSSS',  // 6 — stone + DIAMOND at col 7
  'SSSSSSSSSSSS',  // 7 — stone
  'BBBBBBBBBBBB',  // 8 — bedrock floor
];

// Level 2 map — S-shape тунель, 3 повороти, 8 блоків оптимальне рішення.
// Ідея: дитина мусить планувати шлях (не просто «спам вперед»).
// Path: down×2 (col 2) → forward (col 3) → down×2 → forward×2 → down = DIAMOND (5,7).
// Дизайн: див. /root/projects/methodist/tasks/2026-08-17-puzzles-lesson-engine/l2-design.md
const LEVEL_2 = [
  '............',  // 0 — sky
  '............',  // 1 — sky
  '..►.........',  // 2 — turtle starts at (2, 2)
  'GG.GGGGGGGGG',  // 3 — surface + tunnel entry col 2
  'DD..DDDDDDDD',  // 4 — dirt: тунель col 2, поворот у col 3
  'DDD.DDDDDDDD',  // 5 — тунель col 3 (вертикально вниз)
  'DDD...DDDDDD',  // 6 — поворот, тунель col 3-5 (горизонталь)
  'SSSSS◆SSSSSS',  // 7 — stone + DIAMOND at (5, 7)
  'BBBBBBBBBBBB',  // 8 — bedrock
];

// Level 3 map — довгий тунель для введення `repeat N`.
// Ідея: наївне рішення = 12 блоків (3 вниз + 7 вперед + 2 вниз).
// Оптимальне з repeat = 3 блоки (repeat 3 [вниз] + repeat 7 [вперед] + repeat 2 [вниз]).
// Frustration hook: після 5+ однакових forward блоків Мо перебиває з demo.
// Дизайн: див. courses/cctweak-minicourse/teaching-patterns.md § "Patтерн 1"
const LEVEL_3 = [
  '............',  // 0 — sky
  '............',  // 1 — sky
  '..►.........',  // 2 — turtle starts at (2, 2)
  'GG.GGGGGGGGG',  // 3 — surface + tunnel entry col 2
  'DD.DDDDDDDDD',  // 4 — vertical tunnel col 2 (down)
  'DD........DD',  // 5 — LONG horizontal tunnel col 2-9 (frustration!)
  'DDDDDDDDD.DD',  // 6 — turn down at col 9
  'SSSSSSSSS◆SS',  // 7 — DIAMOND at (9, 7)
  'BBBBBBBBBBBB',  // 8 — bedrock
];

// Level 4 — «Мо у темряві». 6 варіантів «зачарованого» тунеля.
// Ender Dragon зачарував — кожен Reset карта міняється (random no-repeat).
// Всі варіанти: старт Мо (2,2), стіна праворуч одразу, шлях через down+forward
// у різних пропорціях. Sensor+if/інакше solution — universal для всіх 6.
// Post-pilot decisions: methodist/tasks/.../decisions.md §16.

const LEVEL_4_A = [
  '............',  // 0
  '............',  // 1
  '..►GGGGGGGGG',  // 2 — turtle + стіна
  'GG.GGGGGGGGG',  // 3 — down col 2
  'DD.DDDDDDDDD',  // 4 — down col 2
  'DD....DDDDDD',  // 5 — right col 2-5
  'SSSSS◆SSSSSS',  // 6 — DIAMOND (5, 6)
  'BBBBBBBBBBBB',  // 7
  'BBBBBBBBBBBB',  // 8
];

const LEVEL_4_B = [
  '............',
  '............',
  '..►GGGGGGGGG',
  'GG.GGGGGGGGG',
  'DD..DDDDDDDD',  // right col 3 (1 крок горизонтально)
  'DDD.DDDDDDDD',  // down col 3 (тільки один поворот!)
  'DDD.DDDDDDDD',
  'SSS◆SSSSSSSS',  // DIAMOND (3, 7)
  'BBBBBBBBBBBB',
  // LB-002 fix (2026-08-19): раніше прохід був col 4 (rows 5-7) з diamond (4,7),
  // але canonical algorithm застрявав у (3,4) → (3,5) crash. Зсунуто прохід
  // на col 3, diamond теж на col 3. Тепер canonical проходить: down до (2,4),
  // forward до (3,4), down до (3,7)=diamond. Verify: methodist scratchpad/l4-sim.py
];

const LEVEL_4_C = [
  '............',
  '............',
  '..►GGGGGGGGG',
  'GG.GGGGGGGGG',
  'DD.DDDDDDDDD',
  'DD......DDDD',  // довший horizontal col 2-7
  'SSSSSSS◆SSSS',  // DIAMOND (7, 6)
  'BBBBBBBBBBBB',
  'BBBBBBBBBBBB',
];

const LEVEL_4_D = [
  '............',
  '............',
  '..►GGGGGGGGG',
  'GG.GGGGGGGGG',
  'DD.DDDDDDDDD',
  'DD.DDDDDDDDD',  // ще одне down col 2 (глибший тунель)
  'DD...DDDDDDD',  // right col 2-4
  'SSSS◆SSSSSSS',  // DIAMOND (4, 7)
  'BBBBBBBBBBBB',
];

const LEVEL_4_E = [
  '............',
  '............',
  '..►GGGGGGGGG',
  'GG.GGGGGGGGG',
  'DD.DDDDDDDDD',
  'DD.DDDDDDDDD',
  'DD.DDDDDDDDD',  // глибокий тунель — тільки down
  'DD◆DDDDDDDDD',  // DIAMOND одразу під тунелем (2, 7)
  'BBBBBBBBBBBB',
];

const LEVEL_4_F = [
  '............',
  '............',
  '..►GGGGGGGGG',
  'GG.GGGGGGGGG',
  'DD...DDDDDDD',  // right col 2-4 (ранній поворот)
  'DDDD.DDDDDDD',  // down col 4
  'DDDD.DDDDDDD',
  'SSSS◆SSSSSSS',  // DIAMOND (4, 7)
  'BBBBBBBBBBBB',
];

const LEVEL_4_VARIANTS = [LEVEL_4_A, LEVEL_4_B, LEVEL_4_C, LEVEL_4_D, LEVEL_4_E, LEVEL_4_F];

// Стан для L4 random-no-repeat: індекс поточного варіанта.
// При кожному reset() у L4 — вибираємо новий випадковий, ≠ поточному.
let l4CurrentVariantIndex = 0;

/**
 * Обчислює наступний L4 варіант — випадково з набору, але НЕ той самий що
 * поточний (щоб learn ніколи не побачив той самий тунель двічі підряд).
 * Дає ілюзію магії «Ender Dragon зачарував» — кожен Reset = сюрприз.
 */
function pickNextL4Variant() {
  const total = LEVEL_4_VARIANTS.length;
  if (total <= 1) return 0;
  let nextIdx;
  do {
    nextIdx = Math.floor(Math.random() * total);
  } while (nextIdx === l4CurrentVariantIndex);
  l4CurrentVariantIndex = nextIdx;
  return nextIdx;
}

// Level 5 map — «Мо-детектив». Debug workflow урок.
// Карта та сама структура що L2 (S-shape), але фокус не на планування а
// на дебаг готового broken коду (см. l5.json initial_workspace_xml).
// Оптимальне рішення: down×2 + forward×2 + down×2 + forward + down = 8 блоків.
// Broken код у workspace має 3 послідовні bugs (see design).
const LEVEL_5 = [
  '............',  // 0
  '............',  // 1
  '..►.........',  // 2
  'GG.GGGGGGGGG',  // 3
  'DD..DDDDDDDD',  // 4
  'DDD.DDDDDDDD',  // 5
  'DDD...DDDDDD',  // 6
  'SSSSS◆SSSSSS',  // 7 — DIAMOND (5, 7)
  'BBBBBBBBBBBB',  // 8
];

// Level 6 — «Мо у безодні». While урок з невідомою глибиною тунеля.
// Wither зробив шахти безкінечно глибокими — кожен Reset нова глибина
// (random no-repeat, 5 варіантів). Прямий вертикальний тунель від (2,2).
// Оптимальне: loop_while_not_diamond { вниз } = 1 блок вкладеного.
// Post-pilot design.

const LEVEL_6_D3 = [
  '............', '............', '..►.........',
  'GG.GGGGGGGGG', 'DD.DDDDDDDDD', 'DD◆DDDDDDDDD',
  'BBBBBBBBBBBB', 'BBBBBBBBBBBB', 'BBBBBBBBBBBB',
];
const LEVEL_6_D4 = [
  '............', '............', '..►.........',
  'GG.GGGGGGGGG', 'DD.DDDDDDDDD', 'DD.DDDDDDDDD',
  'DD◆DDDDDDDDD', 'BBBBBBBBBBBB', 'BBBBBBBBBBBB',
];
const LEVEL_6_D5 = [
  '............', '............', '..►.........',
  'GG.GGGGGGGGG', 'DD.DDDDDDDDD', 'DD.DDDDDDDDD',
  'DD.DDDDDDDDD', 'DD◆DDDDDDDDD', 'BBBBBBBBBBBB',
];
const LEVEL_6_D6 = [
  '............', '............', '..►.........',
  'GG.GGGGGGGGG', 'DD.DDDDDDDDD', 'DD.DDDDDDDDD',
  'DD.DDDDDDDDD', 'DD.DDDDDDDDD', 'DD◆DDDDDDDDD',
];
const LEVEL_6_D2 = [
  '............', '............', '..►.........',
  'GG.GGGGGGGGG', 'DD◆DDDDDDDDD', 'BBBBBBBBBBBB',
  'BBBBBBBBBBBB', 'BBBBBBBBBBBB', 'BBBBBBBBBBBB',
];

const LEVEL_6_VARIANTS = [LEVEL_6_D2, LEVEL_6_D3, LEVEL_6_D4, LEVEL_6_D5, LEVEL_6_D6];
let l6CurrentVariantIndex = 0;

function pickNextL6Variant() {
  const total = LEVEL_6_VARIANTS.length;
  if (total <= 1) return 0;
  let nextIdx;
  do {
    nextIdx = Math.floor(Math.random() * total);
  } while (nextIdx === l6CurrentVariantIndex);
  l6CurrentVariantIndex = nextIdx;
  return nextIdx;
}

// Level 7 map — «Фінальна битва». Composite: while + якщо/то/інакше + repeat.
// Ender Dragon повернувся з ultimate challenge. Складна печера з поворотами.
// Оптимальне рішення: loop_while_not_diamond { if wall_ahead [ down ] else [ forward ] }
// = 2 блоки (while + if_else всередині), універсально працює.
// Ще складніше ніж L4/L6 бо has multiple horizontal + vertical segments.
const LEVEL_7 = [
  '............',  // 0
  '............',  // 1
  '..►GGGGGGGGG',  // 2 — turtle + стіна одразу (як L4)
  'GG.GGGGGGGGG',  // 3 — down col 2
  'DD..DDDDDDDD',  // 4 — right col 2-3
  'DDD.DDDDDDDD',  // 5 — down col 3
  'DDD.....DDDD',  // 6 — right col 3-7 (довгий)
  'DDDDDDD.DDDD',  // 7 — down col 7
  'SSSSSSS◆SSSS',  // 8 — DIAMOND (7, 8)
];

// Map registry — lookup by lesson id
const LEVEL_MAPS = {
  'l1': LEVEL_1,
  'l2': LEVEL_2,
  'l3': LEVEL_3,
  // 'l4' — dynamic, див. getLevelMap()
  'l5': LEVEL_5,
  // 'l6' — dynamic
  'l7': LEVEL_7,
};

/**
 * Повертає ASCII карту для конкретного lesson id.
 * Використовується у initLevel(); default = 'l1'.
 * Читає window.currentLessonId (виставляється у main.js з URL param).
 *
 * L4 special case: карта міняється при кожному Reset (Ender Dragon narrative).
 * Викликач має явно передати {pickNew: true} щоб отримати новий варіант.
 * Без цього — той самий варіант (для повторного Run без Reset).
 */
function getLevelMap(lessonId, opts = {}) {
  if (lessonId === 'l4') {
    if (opts.pickNew) {
      pickNextL4Variant();
    }
    return LEVEL_4_VARIANTS[l4CurrentVariantIndex];
  }
  if (lessonId === 'l6') {
    if (opts.pickNew) {
      pickNextL6Variant();
    }
    return LEVEL_6_VARIANTS[l6CurrentVariantIndex];
  }
  return LEVEL_MAPS[lessonId] || LEVEL_1;
}

//////////////////////////////////////////////////////////////////////
// Level state
//////////////////////////////////////////////////////////////////////

// Все state exposed на window щоб e2e-тести могли інспектувати
let map;              // 2D array [row][col] → TILE value
let startPos;         // {x, y} у клітинках
let finishPos;        // {x, y}
let turtleX;          // поточна позиція turtle
let turtleY;
let log;              // array of [action, block_id] tuples (для animate)
const pidList = [];   // pending setTimeout IDs (для reset)

//////////////////////////////////////////////////////////////////////
// Per-lesson behavior config (LB-016 — bounce + no-early-exit для L6)
//////////////////////////////////////////////////////////////////////
//
// Дефолти забезпечують backward-compat для L1-L5, L7:
//   - crash при стіні (як зараз)
//   - early-exit коли turtle крокує на діамант (LB-002 fix для L4)
//
// Урок-специфічні flags (з lesson JSON) через Simulator.setLessonConfig():
//   - wall_behavior: 'bounce_vertical' — вертикальні ходи відбиваються від стіни
//     (horizontal ходи → все одно crash). Причина: L6 «Мо у безодні» вчить
//     цикл `while not diamond`. Якщо learn пише `repeat N [вниз]` з N > глибина,
//     наївний crash дає false-fail. Bounce дає narrative feedback («вдарилась,
//     відскочила») і чіткий signal «спробуй менше кроків».
//
//   - success_condition: 'end_at_diamond' — SUCCESS ТІЛЬКИ якщо end position
//     збігається з діамантом. Прибирає early-exit при проходженні через діамант.
//     Причина: `repeat 3 [вниз]` на глибині 2 інакше дає false success бо turtle
//     торкнулась діаманта транзитно. З `end_at_diamond` після діаманта може
//     bounce/crash — і кінцеве положення ≠ діамант → FAILURE (як має бути).
let wallBehavior = 'crash';                    // 'crash' | 'bounce_vertical'
let successCondition = 'diamond_reached';      // 'diamond_reached' | 'end_at_diamond'
let firstBounceInSession = true;               // reset у reset(); use у dispatch

// LB-018 (2026-08-20) — adaptive hint engine інпути:
//   lastCrashType — 'horizontal' | 'vertical' | null; виставляється у tryMove
//     перед throw false. Читається у showFinalResult → додається у dispatch detail.
//   bouncesCount — лічильник bounce у ПОТОЧНОМУ run (reset у reset()).
//     Тільки для L6 wall_behavior='bounce_vertical'; для інших уроків завжди 0.
let lastCrashType = null;
let bouncesCount = 0;

/**
 * Публічне API для lesson-engine — виставити per-lesson поведінку.
 * Викликається з lesson-engine.start(lesson) перед першим Run.
 * Безпечно передати null / undefined / порожній об'єкт — вертається у дефолти.
 */
function setLessonConfig(cfg) {
  cfg = cfg || {};
  wallBehavior = (cfg.wall_behavior === 'bounce_vertical') ? 'bounce_vertical' : 'crash';
  successCondition = (cfg.success_condition === 'end_at_diamond') ? 'end_at_diamond' : 'diamond_reached';
  firstBounceInSession = true;
}

if (typeof window !== 'undefined') {
  window.Simulator = window.Simulator || {};
  window.Simulator.setLessonConfig = setLessonConfig;
}

function _exposeState() {
  if (typeof window === 'undefined') return;
  window.map = map;
  window.startPos = startPos;
  window.finishPos = finishPos;
  window.turtleX = turtleX;
  window.turtleY = turtleY;
  window.log = log;
  window.lastResult = lastResult;
}

// Outcome enum (як у Blockly Games)
const Result = {
  UNSET:   0,
  SUCCESS: 1,
  FAILURE: -1,
  TIMEOUT: 2,
  CRASH:   -2,
};

let lastResult = Result.UNSET;

//////////////////////////////////////////////////////////////////////
// Level parsing
//////////////////////////////////////////////////////////////////////

function parseLevel(rows) {
  const m = [];
  let start = null, finish = null;
  for (let y = 0; y < rows.length; y++) {
    const row = [];
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      let t;
      switch (ch) {
        case '.': t = TILE.AIR; break;
        case 'G': t = TILE.GRASS; break;
        case 'D': t = TILE.DIRT; break;
        case 'S': t = TILE.STONE; break;
        case 'C': t = TILE.COBBLESTONE; break;
        case 'B': t = TILE.BEDROCK; break;
        case '◆': t = TILE.DIAMOND; finish = {x, y}; break;
        case '►': t = TILE.AIR; start = {x, y}; break;
        default:  t = TILE.AIR;
      }
      row.push(t);
    }
    m.push(row);
  }
  return { map: m, start, finish };
}

//////////////////////////////////////////////////////////////////////
// SVG rendering
//////////////////////////////////////////////////////////////////////

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

function svg(tag, attrs, parent) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) {
    if (k === 'href') {
      el.setAttributeNS(XLINK_NS, 'xlink:href', attrs[k]);
    } else {
      el.setAttribute(k, attrs[k]);
    }
  }
  if (parent) parent.appendChild(el);
  return el;
}

function drawMap() {
  const scene = document.getElementById('scene');
  scene.setAttribute('viewBox', `0 0 ${SCENE_W} ${SCENE_H}`);
  scene.innerHTML = '';

  // Знаходимо surfaceRow — найвищий рядок з grass. Все нижче = підземелля.
  let surfaceRow = ROWS;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (map[y][x] === TILE.GRASS) { surfaceRow = y; break; }
    }
    if (surfaceRow < ROWS) break;
  }

  // Sky gradient background — тільки над surface
  const defs = svg('defs', {}, scene);
  const skyGrad = svg('linearGradient', {
    id: 'sky-gradient', x1: '0', y1: '0', x2: '0', y2: '1'
  }, defs);
  svg('stop', { offset: '0%', 'stop-color': '#87CEEB' }, skyGrad);
  svg('stop', { offset: '100%', 'stop-color': '#B0E0E6' }, skyGrad);

  // Underground gradient — темний, легкий brown-tint (як у Minecraft cave)
  const undGrad = svg('linearGradient', {
    id: 'underground-gradient', x1: '0', y1: '0', x2: '0', y2: '1'
  }, defs);
  svg('stop', { offset: '0%', 'stop-color': '#1e1712' }, undGrad);
  svg('stop', { offset: '100%', 'stop-color': '#0f0a08' }, undGrad);

  // Sky rect (від верху до surface)
  svg('rect', {
    x: 0, y: 0, width: SCENE_W, height: surfaceRow * TILE_SIZE,
    fill: 'url(#sky-gradient)'
  }, scene);

  // Underground rect (від surface до низу) — тунель показує саме цей темний фон
  svg('rect', {
    x: 0, y: surfaceRow * TILE_SIZE,
    width: SCENE_W, height: SCENE_H - surfaceRow * TILE_SIZE,
    fill: 'url(#underground-gradient)'
  }, scene);

  // Tiles (yspвrhx кладемо на background)
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const t = map[y][x];
      if (t === TILE.AIR) continue;
      const url = TEXTURE_URL[t];
      if (!url) continue;
      const attrs = {
        x: x * TILE_SIZE,
        y: y * TILE_SIZE,
        width: TILE_SIZE,
        height: TILE_SIZE,
        href: url,
        'image-rendering': 'pixelated',
      };
      // LB-004: diamond отримує клас для CSS анімації (bob + subtle pulse)
      if (t === TILE.DIAMOND) attrs.class = 'tile-diamond';
      svg('image', attrs, scene);
    }
  }

  // Turtle (SVG в стилі ComputerCraft)
  drawTurtle(scene);
}

function drawTurtle(scene) {
  // Group для turtle — легко transformувати
  const g = svg('g', { id: 'turtle', transform: `translate(0,0)` }, scene);

  // Розміри turtle — трохи менше клітинки щоб було візуальне padding
  const S = TILE_SIZE;         // scale reference (40)
  const bodyPad = 3;
  const bodyW = S - bodyPad * 2;   // 34
  const bodyH = S - bodyPad * 2;

  // Корпус (сірий кубик, як ComputerCraft-turtle)
  svg('rect', {
    x: bodyPad, y: bodyPad,
    width: bodyW, height: bodyH,
    rx: 2,
    fill: '#5a5a5a',           // основний сірий
    stroke: '#2b2b2b',
    'stroke-width': 1,
  }, g);

  // Верхня «панель» (світліша)
  svg('rect', {
    x: bodyPad + 2, y: bodyPad + 2,
    width: bodyW - 4, height: 4,
    fill: '#7a7a7a',
  }, g);

  // Екран (темний прямокутник)
  const screenW = bodyW - 10;
  const screenH = bodyH - 14;
  svg('rect', {
    x: bodyPad + 5, y: bodyPad + 9,
    width: screenW, height: screenH,
    rx: 1,
    fill: '#0a1a0a',            // майже чорний з зеленим тоном
    stroke: '#000',
    'stroke-width': 0.5,
  }, g);

  // LED-точка на екрані (зелена, мерехтить)
  const led = svg('circle', {
    cx: bodyPad + 5 + screenW / 2,
    cy: bodyPad + 9 + screenH / 2,
    r: 2,
    fill: '#3fbf3f',
    id: 'turtle-led',
  }, g);
  // Анімація мерехтіння (SMIL — працює у всіх сучасних браузерах)
  svg('animate', {
    attributeName: 'opacity',
    values: '1;0.3;1',
    dur: '1.5s',
    repeatCount: 'indefinite',
  }, led);

  // Дві «ніжки» знизу (треки для гусениць)
  svg('rect', {
    x: bodyPad + 2, y: bodyPad + bodyH - 4,
    width: 6, height: 3,
    fill: '#2b2b2b',
  }, g);
  svg('rect', {
    x: bodyPad + bodyW - 8, y: bodyPad + bodyH - 4,
    width: 6, height: 3,
    fill: '#2b2b2b',
  }, g);

  // Стрілочка вправо на панелі (показує face-direction)
  svg('polygon', {
    points: `${bodyPad + bodyW - 6},${bodyPad + 4} ${bodyPad + bodyW - 3},${bodyPad + 5.5} ${bodyPad + bodyW - 6},${bodyPad + 7}`,
    fill: '#e0e0e0',
  }, g);
}

function displayTurtle(x, y) {
  const g = document.getElementById('turtle');
  if (!g) return;
  g.setAttribute('transform', `translate(${x * TILE_SIZE}, ${y * TILE_SIZE})`);
}

//////////////////////////////////////////////////////////////////////
// Turtle API (called by generated code)
//////////////////////////////////////////////////////////////////////

/**
 * Загальна функція руху. dx/dy — крок у клітинках.
 * @throws {false} якщо клітинка стіна або поза межами
 *
 * LB-016 (2026-08-20) — per-lesson bounce mechanic:
 *   Якщо wallBehavior === 'bounce_vertical' і рух вертикальний і попереду стіна
 *   (але НЕ OOB) — turtle відскакує назад на 1 клітинку у зворотному напрямку.
 *   Якщо позаду теж стіна (затиснута) — залишається на місці, ходу немає.
 *   Horizontal ходи в bounce-режимі → ті ж самі crash як завжди.
 *
 * LB-016 — no-early-exit:
 *   Якщо successCondition === 'end_at_diamond' — крок на діамант НЕ кидає
 *   'diamond_reached'; виконання йде далі до природного завершення програми.
 *   Використовується для L6 щоб уникнути false-success при `repeat N`
 *   що транзитно потрапляє на діамант.
 */
function tryMove(dx, dy, id, actionName) {
  const nx = turtleX + dx;
  const ny = turtleY + dy;
  const isVertical = (dx === 0);

  // Bounds check — навіть у bounce-режимі OOB — це crash (карта скінченна).
  if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) {
    log.push(['crash_' + actionName, id]);
    lastCrashType = isVertical ? 'vertical' : 'horizontal';   // LB-018
    throw false;
  }

  // Wall check (все що не AIR і не DIAMOND — стіна)
  const t = map[ny][nx];
  const isWall = (t !== TILE.AIR && t !== TILE.DIAMOND);

  if (isWall) {
    if (isVertical && wallBehavior === 'bounce_vertical') {
      // BOUNCE — інвертуємо напрямок і робимо крок назад
      const bx = turtleX - dx;
      const by = turtleY - dy;
      let bIsWall;
      if (by < 0 || by >= ROWS || bx < 0 || bx >= COLS) {
        bIsWall = true;
      } else {
        const bt = map[by][bx];
        bIsWall = (bt !== TILE.AIR && bt !== TILE.DIAMOND);
      }
      if (bIsWall) {
        // Затиснута (стіна і попереду, і позаду) — no move, no bounce log
        return;
      }
      // Виконуємо reversed move
      turtleX = bx;
      turtleY = by;
      log.push(['bounce_' + actionName, id]);
      bouncesCount++;   // LB-018 — per-run лічильник; читається у dispatch detail

      // Dispatch bounce event для lesson-engine (Track B слухає, показує bubble
      // при першому bounce у сесії уроку). event.detail.isFirst — прапорець.
      if (typeof document !== 'undefined' && typeof CustomEvent !== 'undefined') {
        const wasFirst = firstBounceInSession;
        firstBounceInSession = false;
        document.dispatchEvent(new CustomEvent('lesson-bounce', {
          detail: {
            positionX: bx,
            positionY: by,
            actionName: actionName,
            isFirst: wasFirst,
          }
        }));
      }
      return;
    }
    // Horizontal wall або wallBehavior === 'crash' → existing crash logic
    log.push(['crash_' + actionName, id]);
    lastCrashType = isVertical ? 'vertical' : 'horizontal';   // LB-018
    throw false;
  }

  // Успішний крок
  turtleX = nx;
  turtleY = ny;
  log.push([actionName, id]);

  // Diamond reached — early exit з SUCCESS. Причина: learn може мати «зайві»
  // блоки після досягнення алмаза (наприклад `repeat 8` де success на 7-й
  // iteration — типовий випадок для L4). Без early-exit наступні команди
  // виконуються, Мо крокує далі, врізається у bedrock → CRASH переписує SUCCESS.
  // Post-pilot fix Olexii L4 2026-08-18.
  //
  // LB-016: для уроків з successCondition === 'end_at_diamond' (L6) — гейт
  // early-exit ВИМКНЕНО, щоб транзитне торкання діаманта не давало SUCCESS.
  if (t === TILE.DIAMOND && successCondition === 'diamond_reached') {
    throw 'diamond_reached';
  }
}

function turtleForward(id) { tryMove(+1, 0, id, 'forward'); }
function turtleBack(id)    { tryMove(-1, 0, id, 'back');    }
function turtleUp(id)      { tryMove(0, -1, id, 'up');      }
function turtleDown(id)    { tryMove(0, +1, id, 'down');    }

/**
 * L6 helper — «на алмазі?». Використовується у loop_while_not_diamond
 * (учень не бачить це як окремий блок, воно вбудовано у while конструкцію).
 * Повертає true якщо поточна клітинка Мо це diamond tile.
 */
function sensorOnDiamond() {
  if (turtleY < 0 || turtleY >= ROWS || turtleX < 0 || turtleX >= COLS) return false;
  return map[turtleY][turtleX] === TILE.DIAMOND;
}

/**
 * L4 sensor — «стіна попереду?». Повертає boolean.
 * Читає карту у напрямку forward (turtleX+1, turtleY).
 * Правило: не air і не diamond = стіна. Кордон карти теж рахується як стіна.
 * Логуємо у log щоб animation міг показати momentum (якщо треба HUD у V2).
 */
function sensorWallAhead(id) {
  const nx = turtleX + 1;
  const ny = turtleY;
  let isWall;
  if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) {
    isWall = true;   // за кордоном карти теж «стіна»
  } else {
    const t = map[ny][nx];
    isWall = (t !== TILE.AIR && t !== TILE.DIAMOND);
  }
  log.push(['sensor_check', id, isWall]);
  return isWall;
}

//////////////////////////////////////////////////////////////////////
// Execute — sandbox через JS-Interpreter
//////////////////////////////////////////////////////////////////////

function initInterpreter(interp, globalObj) {
  const wrap = (name, fn) => {
    interp.setProperty(globalObj, name,
      interp.createNativeFunction(fn, false));
  };
  wrap('turtleForward', turtleForward);
  wrap('turtleBack',    turtleBack);
  wrap('turtleUp',      turtleUp);
  wrap('turtleDown',    turtleDown);
  // L4 sensor — value function, returns boolean.
  // JS-Interpreter автоматично конвертує JS bool ↔ pseudo-bool.
  wrap('sensorWallAhead', sensorWallAhead);
  // L6 sensor — вбудований у loop_while_not_diamond (учень не бачить).
  wrap('sensorOnDiamond', sensorOnDiamond);
  // highlightBlock — noop у sandbox (використовується Blockly generator при
  // Blockly.JavaScript.STATEMENT_PREFIX; ми не встановлюємо префікс, тому
  // ця функція не викликається, але резервую на майбутнє).
  wrap('highlightBlock', function(id) { /* handled by animate() */ });
}

function executeUserCode() {
  cancelAnimation();
  reset();

  attemptCount++;
  window._puzzles = window._puzzles || {};
  window._puzzles.attemptCount = attemptCount;

  const code = Blockly.JavaScript.workspaceToCode(workspace);
  log = [];

  // LB-018 — reset per-run adaptive hint інпутів перед новим виконанням.
  lastCrashType = null;
  bouncesCount = 0;

  const interp = new Interpreter(code, initInterpreter);
  lastResult = Result.UNSET;

  try {
    let ticks = 10000;
    while (interp.step()) {
      if (ticks-- === 0) throw Infinity;
    }
    // Програма нормально завершилась
    lastResult = atFinish() ? Result.SUCCESS : Result.FAILURE;
  } catch (e) {
    if (e === 'diamond_reached') lastResult = Result.SUCCESS;   // early exit
    else if (e === Infinity)     lastResult = Result.TIMEOUT;
    else if (e === false)        lastResult = Result.CRASH;
    else {
      lastResult = Result.CRASH;
      console.error('Interpreter error:', e);
    }
  }

  // Log зібрано, стартуємо анімацію
  _exposeState();
  scheduleAnimation();
}

function atFinish() {
  return turtleX === finishPos.x && turtleY === finishPos.y;
}

//////////////////////////////////////////////////////////////////////
// Animation replay
//////////////////////////////////////////////////////////////////////

const STEP_SPEED_OK   = 250;   // ms/крок при SUCCESS
const STEP_SPEED_SLOW = 400;   // ms/крок при інших
let stepSpeed;
let animIndex;

// Лічильник спроб дитини у поточному сесії (для outro-модалки, positioning §10.1)
let attemptCount = 0;

function cancelAnimation() {
  while (pidList.length) clearTimeout(pidList.shift());
}

function scheduleAnimation() {
  // reset visual state → потім анімуємо log
  turtleX = startPos.x;
  turtleY = startPos.y;
  displayTurtle(turtleX, turtleY);
  workspace.highlightBlock(null);

  stepSpeed = (lastResult === Result.SUCCESS) ? STEP_SPEED_OK : STEP_SPEED_SLOW;
  animIndex = 0;
  pidList.push(setTimeout(animateStep, 100));
}

function animateStep() {
  if (window.AudioPlayer) AudioPlayer.play('step');
  if (animIndex >= log.length) {
    // Кінець анімації → показати підсумок
    _exposeState();
    showFinalResult();
    return;
  }

  const [action, blockId] = log[animIndex++];
  if (blockId) workspace.highlightBlock(blockId);

  let dx = 0, dy = 0;
  let isCrash = false;
  switch (action) {
    case 'forward':       dx = +1; break;
    case 'back':          dx = -1; break;
    case 'up':            dy = -1; break;
    case 'down':          dy = +1; break;
    case 'crash_forward': dx = +1; isCrash = true; break;
    case 'crash_back':    dx = -1; isCrash = true; break;
    case 'crash_up':      dy = -1; isCrash = true; break;
    case 'crash_down':    dy = +1; isCrash = true; break;
    // LB-016: bounce — turtle кроконула у зворотному напрямку до наміру.
    // Показуємо як нормальний move, але зі стрілкою руху проти команди.
    case 'bounce_forward': dx = -1; break;
    case 'bounce_back':    dx = +1; break;
    case 'bounce_up':      dy = +1; break;
    case 'bounce_down':    dy = -1; break;
    default:
      // невідома команда — пропускаємо
      pidList.push(setTimeout(animateStep, stepSpeed));
      return;
  }

  if (isCrash) {
    // Показати «спробував ступити у стіну» — turtle трясеться на місці
    const g = document.getElementById('turtle');
    if (g) {
      g.setAttribute('transform',
        `translate(${turtleX * TILE_SIZE + dx * 3}, ${turtleY * TILE_SIZE + dy * 3})`);
      pidList.push(setTimeout(() => {
        g.setAttribute('transform',
          `translate(${turtleX * TILE_SIZE}, ${turtleY * TILE_SIZE})`);
      }, stepSpeed / 2));
    }
    pidList.push(setTimeout(animateStep, stepSpeed));
    return;
  }

  // Нормальний крок — плавна анімація через 4 subframes
  const startX = turtleX, startY = turtleY;
  const endX = turtleX + dx, endY = turtleY + dy;
  turtleX = endX; turtleY = endY;

  for (let i = 1; i <= 4; i++) {
    const frac = i / 4;
    pidList.push(setTimeout(() => {
      displayTurtle(startX + dx * frac, startY + dy * frac);
    }, (stepSpeed / 4) * i));
  }
  pidList.push(setTimeout(animateStep, stepSpeed));
}

function showFinalResult() {
  workspace.highlightBlock(null);

  // Аудіо-фідбек за результатом
  if (window.AudioPlayer) {
    if (lastResult === Result.SUCCESS) AudioPlayer.play('success');
    else AudioPlayer.play('failure');
  }

  // Dispatch подій для LessonEngine (harmless якщо engine не активний)
  const resultName = {
    [Result.SUCCESS]: 'SUCCESS',
    [Result.FAILURE]: 'FAILURE',
    [Result.CRASH]:   'CRASH',
    [Result.TIMEOUT]: 'TIMEOUT',
  }[lastResult] || 'UNKNOWN';

  // endX/endY — позиція turtle де вона зупинилась (crash location для FAILURE/CRASH,
  // diamond для SUCCESS). Потрібно для `sim-forward-progress` у lesson-engine.
  //
  // LB-018 — додатково передаємо crash_type ('horizontal'|'vertical'|null) та
  // bounces_count (кількість bounce у цьому run) для adaptive hint engine.
  if (lastResult === Result.SUCCESS) {
    document.dispatchEvent(new CustomEvent('lesson-task-solved', {
      detail: {
        result: resultName,
        endX: turtleX,
        endY: turtleY,
        crash_type: lastCrashType,
        bounces_count: bouncesCount,
      }
    }));
  } else {
    document.dispatchEvent(new CustomEvent('lesson-task-failed', {
      detail: {
        result: resultName,
        endX: turtleX,
        endY: turtleY,
        crash_type: lastCrashType,
        bounces_count: bouncesCount,
      }
    }));
  }

  // У lesson-режимі — не показуємо стандартний модал, engine керує UI
  if (window._lessonMode) {
    return;
  }

  const status = document.getElementById('status-text');
  const overlay = document.getElementById('modal-overlay');
  const icon = document.getElementById('modal-icon');
  const title = document.getElementById('modal-title');
  const message = document.getElementById('modal-message');

  let iconText, titleText, msgText, cls;
  switch (lastResult) {
    case Result.SUCCESS:
      iconText = '💎'; titleText = 'Вітаємо!'; cls = 'modal-success';
      msgText = 'Черепашка дійшла до алмаза. Молодець!';
      break;
    case Result.FAILURE:
      iconText = '🤷'; titleText = 'Не дійшла'; cls = 'modal-failure';
      msgText = 'Програма закінчилась, а черепашка ще не на алмазі. Спробуй додати ще кроків.';
      break;
    case Result.CRASH:
      iconText = '💥'; titleText = 'Врізалась!'; cls = 'modal-failure';
      msgText = 'Черепашка спробувала пройти крізь блок. Перевір напрямки руху.';
      break;
    case Result.TIMEOUT:
      iconText = '⏱️'; titleText = 'Занадто довго'; cls = 'modal-failure';
      msgText = 'Програма надто складна або зациклилась. Спробуй простіше.';
      break;
    default:
      iconText = '?'; titleText = 'Дивно'; cls = 'modal-failure';
      msgText = 'Щось пішло не так.';
  }
  status.textContent = titleText + ' — ' + msgText;
  icon.textContent = iconText;
  title.textContent = titleText;
  message.textContent = msgText;
  overlay.className = cls;
  overlay.style.display = 'flex';
}

//////////////////////////////////////////////////////////////////////
// Reset
//////////////////////////////////////////////////////////////////////

function reset() {
  cancelAnimation();

  // L4/L6 special: карта міняється при кожному Reset (random no-repeat).
  // L4 — Ender Dragon narrative, L6 — Wither. Обидва змушують sensor-based
  // solution замість hard-coded direct path.
  const lessonId = (typeof window !== 'undefined' && window.currentLessonId) || 'l1';
  if (lessonId === 'l4' || lessonId === 'l6') {
    const newMap = getLevelMap(lessonId, { pickNew: true });
    const parsed = parseLevel(newMap);
    map = parsed.map;
    startPos = parsed.start;
    finishPos = parsed.finish;
    _exposeState();
    drawMap();
  }

  turtleX = startPos.x;
  turtleY = startPos.y;
  displayTurtle(turtleX, turtleY);
  log = [];
  lastResult = Result.UNSET;
  const status = document.getElementById('status-text');
  if (status) status.textContent = 'Збери програму і натисни «Запустити»';
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.style.display = 'none';
  if (typeof workspace !== 'undefined' && workspace) {
    workspace.highlightBlock(null);
  }
}

//////////////////////////////////////////////////////////////////////
// Init
//////////////////////////////////////////////////////////////////////

function initLevel() {
  // Читаємо lesson id що виставив main.js з URL param (?lesson=2)
  // Default: 'l1' — щоб старі закладки без param працювали як раніше.
  const lessonId = (typeof window !== 'undefined' && window.currentLessonId) || 'l1';
  const parsed = parseLevel(getLevelMap(lessonId));
  map = parsed.map;
  startPos = parsed.start;
  finishPos = parsed.finish;
  turtleX = startPos.x;
  turtleY = startPos.y;
  log = [];

  drawMap();
  displayTurtle(turtleX, turtleY);
  _exposeState();
}
