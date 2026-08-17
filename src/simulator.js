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
  DIAMOND: 6,      // diamond_ore (finish marker)
  START: 7,        // start marker (візуально air, але помічає стартову позицію)
};

const TEXTURE_URL = {
  [TILE.GRASS]:       'public/textures/grass_block_side.png',
  [TILE.DIRT]:        'public/textures/dirt.png',
  [TILE.STONE]:       'public/textures/stone.png',
  [TILE.COBBLESTONE]: 'public/textures/cobblestone.png',
  [TILE.BEDROCK]:     'public/textures/bedrock.png',
  [TILE.DIAMOND]:     'public/textures/diamond_ore.png',
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
      svg('image', {
        x: x * TILE_SIZE,
        y: y * TILE_SIZE,
        width: TILE_SIZE,
        height: TILE_SIZE,
        href: url,
        'image-rendering': 'pixelated',
      }, scene);
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
 */
function tryMove(dx, dy, id, actionName) {
  const nx = turtleX + dx;
  const ny = turtleY + dy;

  // Bounds check
  if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) {
    log.push(['crash_' + actionName, id]);
    throw false;
  }

  // Wall check (все що не AIR і не DIAMOND — стіна)
  const t = map[ny][nx];
  if (t !== TILE.AIR && t !== TILE.DIAMOND) {
    log.push(['crash_' + actionName, id]);
    throw false;
  }

  // Успішний крок
  turtleX = nx;
  turtleY = ny;
  log.push([actionName, id]);
}

function turtleForward(id) { tryMove(+1, 0, id, 'forward'); }
function turtleBack(id)    { tryMove(-1, 0, id, 'back');    }
function turtleUp(id)      { tryMove(0, -1, id, 'up');      }
function turtleDown(id)    { tryMove(0, +1, id, 'down');    }

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
  // highlightBlock — noop у sandbox (використовується Blockly generator при
  // Blockly.JavaScript.STATEMENT_PREFIX; ми не встановлюємо префікс, тому
  // ця функція не викликається, але резервую на майбутнє).
  wrap('highlightBlock', function(id) { /* handled by animate() */ });
}

function executeUserCode() {
  cancelAnimation();
  reset();

  const code = Blockly.JavaScript.workspaceToCode(workspace);
  log = [];

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
    if (e === Infinity)   lastResult = Result.TIMEOUT;
    else if (e === false) lastResult = Result.CRASH;
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

  if (lastResult === Result.SUCCESS) {
    document.dispatchEvent(new CustomEvent('lesson-task-solved', {
      detail: { result: resultName }
    }));
  } else {
    document.dispatchEvent(new CustomEvent('lesson-task-failed', {
      detail: { result: resultName }
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
  const parsed = parseLevel(LEVEL_1);
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
