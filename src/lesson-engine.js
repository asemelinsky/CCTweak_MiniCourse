/**
 * Lesson Engine — послідовний виконувач «beats» уроку.
 *
 * Читає JSON-конфіг (див. lessons/lN.json), виконує beat за beat'ом,
 * чекає на вказану подію (`advance.type`), переходить далі.
 *
 * Підтримувані типи beat (Фаза 1):
 *  - speech-bubble  → малює SVG bubble біля черепашки з текстом
 *  - coach-mark     → dark overlay + spotlight на target-елементі + callout
 *  - task           → передає керування у Blockly workspace, чекає task-solved
 *  - task-with-constraints → task + block constraints layer (LB-011, L7):
 *                            beat.constraints[] — масив правил {block_type, max_count,
 *                            scope, on_exceed:{route_to_beat, escalation_beats[]}}.
 *                            При exceed: dragon анімація → dispose блока → route до beat.
 *                            Потребує window.ConstraintEngine + опційно window.DragonOverlay.
 *  - final-modal    → показує modal після проходження уроку
 *
 * Підтримувані advance-типи:
 *  - click-next          → чекає натискання «Далі» / label кнопки з beat.advance.label
 *  - block-added         → чекає що у workspace з'явиться блок типу block_type
 *  - block-count-reached → чекає N+ блоків типу X (frustration hook, L3)
 *  - run-clicked         → чекає що натиснуто ▶ Запустити (БЕЗ валідації результату)
 *  - task-solved         → чекає що lastResult === SUCCESS у simulator
 *  - sim-forward-progress → advance якщо end position симуляції ДАЛІ ніж у попередньому
 *                           запуску (LB-003 fix — для L5 debug-flow і майбутніх
 *                           debug-задач з catalog §11.6). Metric: manhattan distance
 *                           від startPos. Перший ever run у beat → зберігаємо як реф,
 *                           не advance'ним; другий run далі — advance.
 *  - sim-progress-past-x → advance якщо endX >= beat.advance.threshold (варіант з
 *                           явним target'ом для випадків «дитина має дійти хоча б
 *                           до col N щоб я вважав це прогресом»).
 *
 * Beat-level optional fields (LB-011, Adaptive Narrative Engine):
 *  - skip_if: {workspace_contains|workspace_contains_any|beat_visited}
 *      → якщо умова true (AND semantics при multiple keys) — beat пропускається
 *        одразу після track visitedBeats, без setup UI.
 *  - after_advance_route_to: '<beat_id>'
 *      → замість «наступного beat у sequence» після advance() — jump до конкретного
 *        beat.id. Використовується для reactive beats (dragon-ate-*) щоб повернути
 *        учня назад у task-main після click-next.
 *
 * Public navigation API (LB-015):
 *  - jumpToVisitedBeat(direction)  — direction ∈ {-1, +1}. Стрибок на попередній
 *    (⏮) або наступний (⏭) navigable beat (speech-bubble / coach-mark).
 *    Forward gated на maxVisitedBeatIdx (не skip у майбутнє). Voice того beat
 *    програється автоматично. No-op якщо цільового beat немає.
 *  - getNavigationState() → {canGoBack, canGoForward} — для рендеру disabled
 *    стану ⏮/⏭ кнопок у UI.
 *
 * Використання:
 *   LessonEngine.load('lessons/l1.json').then(engine => engine.start());
 */

'use strict';

const LessonEngine = (function() {

  let currentLesson = null;
  let currentBeatIdx = 0;
  let listeners = [];  // активні event listeners для поточного beat

  // LB-011: track показаних beat'ів (для `skip_if.beat_visited` predicate + cycle guard).
  // Скидається у start(lesson). Додається у runCurrentBeat() до skip_if check —
  // тому beat_visited: 'this-beat-id' у поточному beat завжди true (self-visit
  // одразу гартує проти повторних заходів через route_to_beat).
  let visitedBeats = new Set();

  // LB-015: max idx beat що learner уже досягнув (не тільки visited by id, а
  // sequence position). Використовується для «⏭ наступний» — button активний
  // тільки якщо currentBeatIdx < maxVisitedBeatIdx (тобто learner повернувся
  // назад і може піти вперед до вже баченого; skip у майбутнє заборонено).
  // Скидається у start(lesson). Оновлюється у runCurrentBeat() через
  // Math.max(current, currentBeatIdx) — навіть при jumpToVisitedBeat(-1)
  // не зменшується.
  let maxVisitedBeatIdx = -1;

  // LB-015: типи beat, до яких можна навігувати back/forward. Task'и і
  // final-modal мають власну advance-механіку, яку не можна переривати
  // ретрактом — тому вони skip'аються при пошуку navigable target.
  const NAVIGABLE_BEAT_TYPES = new Set(['speech-bubble', 'coach-mark']);

  // LB-003: state для sim-forward-progress advance type.
  // Тримає manhattan distance від startPos для попереднього завершеного
  // запуску симуляції (у поточному beat). null = ще не було референсу.
  // Скидається при вхід у кожен beat що використовує sim-forward-progress
  // (див. setupAdvanceListener).
  let lastRunProgressDist = null;

  //////////////////////////////////////////////////////////////////////
  // Публічне API
  //////////////////////////////////////////////////////////////////////

  async function load(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Не вдалося завантажити урок: ${url}`);
    const lesson = await res.json();
    return {
      start: () => start(lesson),
      lesson,
    };
  }

  function start(lesson) {
    console.log(`[LessonEngine] Старт уроку: ${lesson.id} — «${lesson.title}»`);
    currentLesson = lesson;
    currentBeatIdx = 0;
    lastRunProgressDist = null;  // LB-003: скидаємо cross-beat progress state
    visitedBeats.clear();        // LB-011: скидаємо історію відвіданих beat'ів
    maxVisitedBeatIdx = -1;      // LB-015: скидаємо max visited для nav-forward gating

    // Preload workspace якщо lesson має initial_workspace_xml (для L5 debug —
    // learn бачить broken code на старті і мусить його виправити).
    // Формат: standard Blockly XML string з блоками для injection.
    if (lesson.initial_workspace_xml && window.workspace && window.Blockly) {
      try {
        const dom = Blockly.utils.xml.textToDom(lesson.initial_workspace_xml);
        window.workspace.clear();
        Blockly.Xml.domToWorkspace(dom, window.workspace);
        console.log(`[LessonEngine] Preloaded initial workspace для ${lesson.id}`);
      } catch (err) {
        console.error(`[LessonEngine] Failed to preload workspace:`, err);
      }
    }

    runCurrentBeat();
  }

  //////////////////////////////////////////////////////////////////////
  // Beat runner
  //////////////////////////////////////////////////////////////////////

  function runCurrentBeat() {
    // Очистити listeners попереднього beat
    clearListeners();

    if (currentBeatIdx >= currentLesson.beats.length) {
      console.log('[LessonEngine] Урок закінчено');
      return;
    }

    const beat = currentLesson.beats[currentBeatIdx];
    console.log(`[LessonEngine] Beat ${currentBeatIdx + 1}/${currentLesson.beats.length}: ${beat.id} (${beat.type})`);

    // LB-011: track visited ПЕРЕД skip_if check — щоб beat_visited: '<self>' спрацював
    // як cycle guard (якщо цей же beat був route_to цілю, наступний захід буде skip).
    visitedBeats.add(beat.id);

    // LB-015: розширюємо max-visited для navigation-forward gating (тільки росте,
    // ніколи не зменшується — навіть на jumpToVisitedBeat(-1) тримаємо historic max).
    maxVisitedBeatIdx = Math.max(maxVisitedBeatIdx, currentBeatIdx);

    // LB-011: skip_if — якщо умова true, пропускаємо beat.
    if (beat.skip_if && evaluateSkipCondition(beat.skip_if, window.workspace)) {
      console.log(`[LessonEngine] skip beat ${beat.id} — skip_if matched`);
      advance();
      return;
    }

    // Виконати beat
    switch (beat.type) {
      case 'speech-bubble':
        SpeechBubble.show({ ...beat, lesson_id: currentLesson.id });
        break;
      case 'coach-mark':
        CoachMark.show({ ...beat, lesson_id: currentLesson.id });
        break;
      case 'video-overlay':
        VideoOverlay.show(beat);
        break;
      case 'task':
        setupTask(beat);
        break;
      case 'task-with-constraints':
        setupTaskWithConstraints(beat);
        break;
      case 'final-modal':
        showFinalModal(beat);
        break;
      default:
        console.warn(`[LessonEngine] Невідомий тип beat: ${beat.type} — пропускаю`);
        advance();
        return;
    }

    // Встановити advance-listener
    setupAdvanceListener(beat);
  }

  //////////////////////////////////////////////////////////////////////
  // LB-011: skip_if predicate evaluator
  //////////////////////////////////////////////////////////////////////

  /**
   * Evaluate skip_if condition. Returns true → beat should be skipped.
   * Supported predicates (AND semantics — усі keys мають бути true):
   *   - workspace_contains: '<block_type>'      → true якщо workspace has any of that type
   *   - workspace_contains_any: ['<t1>', '<t2>'] → true якщо workspace has any of these
   *   - beat_visited: '<beat_id>'                → true якщо beat уже було показано
   */
  function evaluateSkipCondition(cond, workspace) {
    if (!cond) return false;

    const keys = Object.keys(cond);
    if (keys.length === 0) return false;

    for (const key of keys) {
      const val = cond[key];
      let match = false;

      if (key === 'workspace_contains') {
        if (!workspace) return false;
        const blocks = workspace.getAllBlocks(false);
        match = blocks.some(b => b.type === val);
      } else if (key === 'workspace_contains_any') {
        if (!workspace) return false;
        if (!Array.isArray(val)) {
          console.warn(`[LessonEngine] skip_if.workspace_contains_any must be array`);
          return false;
        }
        const blocks = workspace.getAllBlocks(false);
        const typeSet = new Set(val);
        match = blocks.some(b => typeSet.has(b.type));
      } else if (key === 'beat_visited') {
        match = visitedBeats.has(val);
      } else {
        console.warn(`[LessonEngine] Unknown skip_if predicate: ${key}`);
        return false;
      }

      if (!match) return false;  // AND — один false → cond false
    }
    return true;
  }

  //////////////////////////////////////////////////////////////////////
  // LB-011: routeToBeat — jump до beat by id (не sequence)
  //////////////////////////////////////////////////////////////////////

  /**
   * Jump до beat з заданим id. Очищає поточні listeners + UI, ставить index,
   * запускає runCurrentBeat. Якщо beat не знайдено — warn і stay put.
   */
  function routeToBeat(beatId) {
    if (!currentLesson) {
      console.warn(`[LessonEngine] routeToBeat(${beatId}): no lesson loaded`);
      return;
    }
    const idx = currentLesson.beats.findIndex(b => b.id === beatId);
    if (idx < 0) {
      console.warn(`[LessonEngine] routeToBeat: beat '${beatId}' not found — staying`);
      return;
    }
    console.log(`[LessonEngine] routeToBeat: '${beatId}' (idx ${idx})`);

    // Cleanup поточного beat (UI + listeners) — analog до першої частини advance()
    const currentBeat = currentLesson.beats[currentBeatIdx];
    if (currentBeat) {
      if (currentBeat.type === 'speech-bubble') SpeechBubble.hide();
      if (currentBeat.type === 'coach-mark') CoachMark.hide();
      if (currentBeat.type === 'video-overlay') VideoOverlay.hide();
    }
    clearListeners();

    currentBeatIdx = idx;
    runCurrentBeat();
  }

  //////////////////////////////////////////////////////////////////////
  // LB-015: bidirectional beat-navigation (⏮ / ⏭)
  //////////////////////////////////////////////////////////////////////

  /**
   * Знайти idx першого navigable beat у заданому напрямку від currentBeatIdx,
   * з урахуванням gating maxVisitedBeatIdx для forward.
   *
   * @param {-1|+1} direction — -1 = попередній, +1 = наступний
   * @returns {number} idx target beat або -1 якщо немає доступного.
   *
   * Правила:
   *  - direction -1: шукаємо максимальний idx < currentBeatIdx серед
   *    NAVIGABLE_BEAT_TYPES. Ніякого maxVisited-gating — все, що позаду,
   *    точно вже баченe.
   *  - direction +1: шукаємо мінімальний idx > currentBeatIdx AND
   *    idx <= maxVisitedBeatIdx серед NAVIGABLE_BEAT_TYPES.
   *    Skip у майбутнє (unseen) заборонено.
   */
  function findNavigableBeatIdx(direction) {
    if (!currentLesson || !Array.isArray(currentLesson.beats)) return -1;
    const beats = currentLesson.beats;

    if (direction < 0) {
      for (let i = currentBeatIdx - 1; i >= 0; i--) {
        if (NAVIGABLE_BEAT_TYPES.has(beats[i]?.type)) return i;
      }
      return -1;
    } else {
      const upperBound = Math.min(beats.length - 1, maxVisitedBeatIdx);
      for (let i = currentBeatIdx + 1; i <= upperBound; i++) {
        if (NAVIGABLE_BEAT_TYPES.has(beats[i]?.type)) return i;
      }
      return -1;
    }
  }

  /**
   * Стрибок на попередній (⏮) або наступний (⏭) navigable beat.
   * Використовується UI кнопками у speech-bubble і coach-mark.
   *
   * Якщо цільового beat нема — no-op (silent), UI має рендерити disabled.
   * Voice того beat програється автоматично (через runCurrentBeat → show()).
   *
   * @param {-1|+1} direction
   */
  function jumpToVisitedBeat(direction) {
    if (direction !== -1 && direction !== 1) {
      console.warn(`[LessonEngine] jumpToVisitedBeat: direction must be -1 or +1, got ${direction}`);
      return;
    }
    const targetIdx = findNavigableBeatIdx(direction);
    if (targetIdx < 0) {
      console.log(`[LessonEngine] jumpToVisitedBeat(${direction}): no target — no-op`);
      return;
    }
    console.log(`[LessonEngine] jumpToVisitedBeat(${direction}): ${currentBeatIdx} → ${targetIdx}`);

    // Cleanup поточного UI (той самий pattern, що routeToBeat)
    const currentBeat = currentLesson.beats[currentBeatIdx];
    if (currentBeat) {
      if (currentBeat.type === 'speech-bubble') SpeechBubble.hide();
      if (currentBeat.type === 'coach-mark') CoachMark.hide();
      if (currentBeat.type === 'video-overlay') VideoOverlay.hide();
    }
    clearListeners();

    currentBeatIdx = targetIdx;
    runCurrentBeat();
  }

  /**
   * Стан навігації для UI. UI читає при render щоб виставити disabled на
   * ⏮/⏭ кнопках. Дешевий — просто перевірка наявності navigable target.
   *
   * @returns {{canGoBack: boolean, canGoForward: boolean}}
   */
  function getNavigationState() {
    return {
      canGoBack:    findNavigableBeatIdx(-1) >= 0,
      canGoForward: findNavigableBeatIdx(+1) >= 0,
    };
  }

  function advance() {
    // Прибрати UI поточного beat
    const beat = currentLesson.beats[currentBeatIdx];

    // LB-011: якщо beat має after_advance_route_to — не інкрементимо currentBeatIdx,
    // а jump'аємо через routeToBeat. Використовується для reactive beats
    // (dragon-ate-*) щоб повернути учня назад до task-main після click-next.
    // routeToBeat сам зробить UI cleanup — не робимо тут щоб не dublicate.
    if (beat && beat.after_advance_route_to) {
      routeToBeat(beat.after_advance_route_to);
      return;
    }

    if (beat) {
      if (beat.type === 'speech-bubble') SpeechBubble.hide();
      if (beat.type === 'coach-mark') CoachMark.hide();
      if (beat.type === 'video-overlay') VideoOverlay.hide();
    }
    clearListeners();
    currentBeatIdx++;
    runCurrentBeat();
  }

  //////////////////////////////////////////////////////////////////////
  // Advance listeners
  //////////////////////////////////////////////////////////////////////

  function setupAdvanceListener(beat) {
    const adv = beat.advance;
    if (!adv) return;  // final-modal сам собі рулить

    switch (adv.type) {
      case 'click-next':
        // Кнопка «Далі» додається у speech-bubble або coach-mark UI
        // Тут просто підписуємось на кастомну подію 'lesson-next-click'
        addListener(document, 'lesson-next-click', () => advance());
        break;

      case 'block-added':
        listenForBlockAdded(adv.block_type);
        break;

      case 'block-count-reached':
        // Frustration hook: чекаємо доки user не поставить N+ блоків типу X.
        // Використовуємо для L3 «Мо стомилась» — коли дитина поставила 5+
        // однакових forward блоків, Мо перебиває з demo repeat.
        // Приклад: { type: 'block-count-reached', block_type: 'turtle_forward', count: 5 }
        listenForBlockCount(adv.block_type, adv.count || 5);
        break;

      case 'run-clicked':
        addListener(document, 'lesson-run-clicked', () => advance());
        break;

      case 'task-solved':
        addListener(document, 'lesson-task-solved', () => advance());
        break;

      case 'sim-forward-progress':
        // LB-003: advance ТІЛЬКИ якщо end position симуляції має більший manhattan
        // distance від startPos, ніж останній run який був у lesson.
        // Skipping same-position или regressed runs (без цього — на клік ▶ без
        // жодних змін advance спрацював би, що і є bug LB-003).
        //
        // State cross-beat: `lastRunProgressDist` не скидається при вхід у beat.
        // Якщо null (перший sim-forward-progress ever у lesson) → перший run встановлює
        // референс, не advance. Reset відбувається тільки у start(lesson).
        //
        // Cross-beat flow (L5): beat 4 (run-clicked) → sim завершилась, beat 5 вже
        // active з нашим listener'ом → отримує event, встановлює референс.
        // User виправляє bug → run → dist > ref → advance + update ref.
        // beat 6 setup → user run → dist > ref → advance + update ref. І так далі.
        const onProgress = (event) => {
          const { endX, endY } = event.detail || {};
          const start = window.startPos;
          if (start == null || endX == null || endY == null) {
            console.warn('[LessonEngine] sim-forward-progress: no startPos or end coords, fallback advance');
            advance();
            return;
          }
          const dist = Math.abs(endX - start.x) + Math.abs(endY - start.y);
          if (lastRunProgressDist === null) {
            // Перший run — це референс. Дитина ще нічого не виправила, просто побачила initial state.
            console.log(`[LessonEngine] sim-forward-progress: reference set at dist=${dist}, waiting for progress`);
            lastRunProgressDist = dist;
            return;
          }
          if (dist > lastRunProgressDist) {
            console.log(`[LessonEngine] sim-forward-progress: progress! ${lastRunProgressDist} → ${dist}, advance`);
            lastRunProgressDist = dist;  // оновити реф для наступного beat
            advance();
          } else {
            console.log(`[LessonEngine] sim-forward-progress: no progress (${dist} <= ${lastRunProgressDist}), waiting`);
          }
        };
        addListener(document, 'lesson-task-solved', onProgress);
        addListener(document, 'lesson-task-failed', onProgress);
        break;

      case 'sim-progress-past-x':
        // Варіант з явним target'ом. Advance якщо end position endX >= threshold.
        // Простіший ніж forward-progress коли треба конкретний checkpoint.
        const threshold = adv.threshold;
        if (typeof threshold !== 'number') {
          console.warn('[LessonEngine] sim-progress-past-x: missing numeric threshold, fallback advance');
          addListener(document, 'lesson-task-solved', () => advance());
          addListener(document, 'lesson-task-failed', () => advance());
          break;
        }
        const onPastX = (event) => {
          const { endX } = event.detail || {};
          if (typeof endX === 'number' && endX >= threshold) {
            console.log(`[LessonEngine] sim-progress-past-x: endX=${endX} >= ${threshold}, advance`);
            advance();
          } else {
            console.log(`[LessonEngine] sim-progress-past-x: endX=${endX} < ${threshold}, waiting`);
          }
        };
        addListener(document, 'lesson-task-solved', onPastX);
        addListener(document, 'lesson-task-failed', onPastX);
        break;

      default:
        console.warn(`[LessonEngine] Невідомий тип advance: ${adv.type}`);
    }
  }

  function listenForBlockAdded(blockType) {
    if (!window.workspace) return;
    const listener = (event) => {
      if (event.type === Blockly.Events.BLOCK_CREATE) {
        const ids = event.ids || [event.blockId];
        for (const id of ids) {
          const block = window.workspace.getBlockById(id);
          if (block && block.type === blockType) {
            window.workspace.removeChangeListener(listener);
            advance();
            return;
          }
        }
      }
    };
    window.workspace.addChangeListener(listener);
    listeners.push({ type: 'blockly', listener });
  }

  /**
   * Frustration-hook listener: чекає доки у workspace не з'явиться N+ блоків
   * певного типу. Рахує ВСІ existing блоки після кожного BLOCK_CREATE event,
   * не тільки нові. Це важливо на випадок якщо beat активується посеред
   * існуючого workspace (learn ставить блоки, engine ловить threshold пізніше).
   */
  function listenForBlockCount(blockType, count) {
    if (!window.workspace) return;
    const check = () => {
      const all = window.workspace.getAllBlocks(false);
      const matching = all.filter(b => b.type === blockType).length;
      if (matching >= count) {
        window.workspace.removeChangeListener(listener);
        advance();
        return true;
      }
      return false;
    };
    const listener = (event) => {
      if (event.type === Blockly.Events.BLOCK_CREATE) {
        check();
      }
    };
    // Одразу перевіряємо (може threshold уже досягнутий)
    if (check()) return;
    window.workspace.addChangeListener(listener);
    listeners.push({ type: 'blockly', listener });
  }

  function addListener(target, event, handler) {
    target.addEventListener(event, handler);
    listeners.push({ type: 'dom', target, event, handler });
  }

  function clearListeners() {
    for (const l of listeners) {
      if (l.type === 'dom') {
        l.target.removeEventListener(l.event, l.handler);
      } else if (l.type === 'blockly' && window.workspace) {
        window.workspace.removeChangeListener(l.listener);
      } else if (l.type === 'teardown' && typeof l.fn === 'function') {
        // LB-011: task-with-constraints — виклик teardown fn від ConstraintEngine
        try { l.fn(); } catch (err) {
          console.warn('[LessonEngine] teardown error:', err);
        }
      }
    }
    listeners = [];
  }

  //////////////////////////////////////////////////////////////////////
  // Task-runner integration
  //////////////////////////////////////////////////////////////////////

  // Стан для anti-repeat: останній показаний hint (щоб не переграти голос якщо той самий)
  let lastHintText = null;
  let lastHintTime = 0;

  function setupTask(beat) {
    // Якщо задача вимагає скинути workspace — очищаємо
    if (beat.reset_workspace && window.workspace) {
      window.workspace.clear();
    }

    // Скидаємо anti-repeat memory при новій task
    lastHintText = null;
    lastHintTime = 0;

    // Слухач невдач
    // Логіка (див. docs/dev-logic.md §3):
    //   1) Показуємо bubble з hint-текстом
    //   2) Голос грає з auto-URL (public/audio/{lesson_id}/hint-{result}.mp3)
    //   3) Якщо той самий текст щойно програвався (< 60 сек) — bubble так, голос ні
    //   4) Bubble НЕ зникає по таймеру. Зникає коли:
    //      - дитина клікнула ▶ (нова спроба)
    //      - дитина торкнулась Blockly workspace (почала редагувати)
    const failListener = (e) => {
      const { result } = e.detail;
      let hint = null;
      let hintId = null;
      if (result === 'CRASH')    { hint = beat.hint_on_crash;    hintId = 'hint-crash'; }
      else if (result === 'FAILURE') { hint = beat.hint_on_failure; hintId = 'hint-failure'; }
      else if (result === 'TIMEOUT') { hint = 'Ой, програма надто довго виконується. Може, зациклилась?'; hintId = 'hint-timeout'; }

      if (!hint) return;

      const now = Date.now();
      const isRepeat = (hint === lastHintText) && (now - lastHintTime < 60000);
      lastHintText = hint;
      lastHintTime = now;

      // Показуємо bubble з можливістю голосу тільки якщо це не repeat
      SpeechBubble.show({
        id: isRepeat ? null : hintId,           // без id → не шукає voice-URL
        lesson_id: currentLesson.id,
        character: 'mo',
        text: hint,
        animation: 'shake',
      });
      // Bubble НЕ auto-hide. Скасовується сам при новому ▶ або редагуванні.
    };
    addListener(document, 'lesson-task-failed', failListener);

    // Прибираємо hint bubble при новій спробі (▶) або редагуванні
    const clearOnRun = () => SpeechBubble.hide();
    addListener(document, 'lesson-run-clicked', clearOnRun);

    if (window.workspace) {
      const clearOnEdit = (event) => {
        if (event.type === Blockly.Events.BLOCK_MOVE ||
            event.type === Blockly.Events.BLOCK_CHANGE ||
            event.type === Blockly.Events.BLOCK_CREATE) {
          SpeechBubble.hide();
        }
      };
      window.workspace.addChangeListener(clearOnEdit);
      listeners.push({ type: 'blockly', listener: clearOnEdit });
    }

    // Опційна інструкція
    if (beat.instruction) {
      SpeechBubble.show({
        character: 'mo',
        text: beat.instruction,
        animation: 'wiggle',
      });
    }
  }

  //////////////////////////////////////////////////////////////////////
  // LB-011: task-with-constraints — task + block constraint layer
  //////////////////////////////////////////////////////////////////////

  /**
   * Standard task setup + attach ConstraintEngine listener для beat.constraints[].
   * При exceed: dragon animation → dispose блока → routeToBeat до відповідного
   * escalation-beat (hitCount визначає який).
   *
   * Escalation semantics (per constraint):
   *   hit 1 → constraint.on_exceed.route_to_beat
   *   hit 2 → constraint.on_exceed.escalation_beats[0]
   *   hit 3 → constraint.on_exceed.escalation_beats[1]
   *   ...
   *   hit N+ (out of range) → last escalation_beats item (stays на last hint)
   */
  function setupTaskWithConstraints(beat) {
    // Спочатку normal task setup — hint bubbles, run/edit listeners, etc.
    setupTask(beat);

    // Attach constraints layer тільки якщо ConstraintEngine доступний і є constraints
    if (!beat.constraints || !Array.isArray(beat.constraints) || beat.constraints.length === 0) {
      return;
    }
    if (!window.ConstraintEngine || typeof window.ConstraintEngine.setupConstraints !== 'function') {
      console.warn('[LessonEngine] task-with-constraints: window.ConstraintEngine not available — constraints ignored');
      return;
    }
    if (!window.workspace) {
      console.warn('[LessonEngine] task-with-constraints: window.workspace not available — constraints ignored');
      return;
    }

    const handleConstraintExceeded = (constraint, blockId, hitCount) => {
      console.log(`[LessonEngine] constraint hit: ${constraint.block_type} count=${hitCount}`);

      // Визначити route beat id за hitCount
      let routeBeatId = null;
      const onExceed = constraint.on_exceed || {};
      if (hitCount === 1) {
        routeBeatId = onExceed.route_to_beat;
      } else {
        const escIdx = hitCount - 2;
        const esc = onExceed.escalation_beats;
        if (Array.isArray(esc) && esc.length > 0) {
          routeBeatId = esc[Math.min(escIdx, esc.length - 1)];  // fallback до last
        } else {
          routeBeatId = onExceed.route_to_beat;  // немає escalation → залишаємось на first
        }
      }

      if (!routeBeatId) {
        console.warn(`[LessonEngine] constraint exceeded but no route_to_beat defined`);
        return;
      }

      // Отримати DOM element блоку для dragon animation target
      const block = window.workspace.getBlockById(blockId);
      const blockEl = block && typeof block.getSvgRoot === 'function' ? block.getSvgRoot() : null;

      const disposeAndRoute = () => {
        if (block) {
          // CRITICAL: notify ConstraintEngine BEFORE dispose. Інакше BLOCK_DELETE
          // event від dispose() декрементить escalation counter → 2-й hit покаже
          // dragon-ate-down-1 знову замість -2. Track A's contract (2026-08-19).
          if (window.ConstraintEngine && typeof window.ConstraintEngine.notifyManagedDispose === 'function') {
            try { window.ConstraintEngine.notifyManagedDispose(blockId); } catch (err) {
              console.warn('[LessonEngine] notifyManagedDispose error:', err);
            }
          }
          try { block.dispose(); } catch (err) {
            console.warn('[LessonEngine] block.dispose error:', err);
          }
        }
        routeToBeat(routeBeatId);
      };

      // Dragon animation якщо overlay доступний, інакше — миттєве dispose+route
      if (window.DragonOverlay && typeof window.DragonOverlay.swoopAndCrunch === 'function' && blockEl) {
        try {
          window.DragonOverlay.swoopAndCrunch(blockEl, disposeAndRoute);
        } catch (err) {
          console.warn('[LessonEngine] DragonOverlay error, fallback to direct dispose:', err);
          disposeAndRoute();
        }
      } else {
        disposeAndRoute();
      }
    };

    // Setup constraints — очікуємо teardown function повернути
    try {
      const teardown = window.ConstraintEngine.setupConstraints(beat, window.workspace, {
        onExceed: handleConstraintExceeded,
      });
      if (typeof teardown === 'function') {
        listeners.push({ type: 'teardown', fn: teardown });
      }
    } catch (err) {
      console.error('[LessonEngine] ConstraintEngine.setupConstraints failed:', err);
    }
  }

  //////////////////////////////////////////////////////////////////////
  // Final modal
  //////////////////////////////////////////////////////////////////////

  function showFinalModal(beat) {
    const overlay = document.getElementById('modal-overlay');
    const title   = document.getElementById('modal-title');
    const message = document.getElementById('modal-message');
    const icon    = document.getElementById('modal-icon');
    const close   = document.getElementById('modal-close');

    icon.textContent = '🎉';
    icon.style.fontSize = '4em';
    title.textContent = beat.title;

    // Заміна плейсхолдерів у повідомленні
    const attempts = (window._puzzles && window._puzzles.attemptCount) || 1;
    const attemptsWord = attempts === 1 ? 'спробу' :
                         (attempts >= 2 && attempts <= 4) ? 'спроби' : 'спроб';
    message.textContent = (beat.message || '')
      .replace('{ATTEMPTS}', attempts)
      .replace('{ATTEMPTS_WORD}', attemptsWord);

    close.textContent = beat.cta_label || 'OK';

    // Позначаємо завершення уроку у ProgressTracker (для free-tier L1 resume)
    if (window.ProgressTracker) {
      window.ProgressTracker.markLessonCompleted(currentLesson.id);
    }

    // Secondary CTA — з'являється якщо beat.secondary_cta_label є (для L1 "Ще подумати")
    // Динамічно додаємо/видаляємо щоб не міняти HTML статично.
    let secondaryBtn = document.getElementById('modal-close-secondary');
    if (beat.secondary_cta_label) {
      if (!secondaryBtn) {
        secondaryBtn = document.createElement('button');
        secondaryBtn.id = 'modal-close-secondary';
        secondaryBtn.className = 'btn btn-secondary';
        secondaryBtn.style.marginLeft = '12px';
        close.parentNode.insertBefore(secondaryBtn, close.nextSibling);
      }
      secondaryBtn.textContent = beat.secondary_cta_label;
      secondaryBtn.style.display = 'inline-block';
    } else if (secondaryBtn) {
      secondaryBtn.style.display = 'none';
    }

    overlay.style.display = 'flex';

    const closeModal = () => {
      overlay.style.display = 'none';
      close.removeEventListener('click', primaryHandler);
      if (secondaryBtn) secondaryBtn.removeEventListener('click', closeModal);
    };

    // Primary CTA — якщо beat.cta_url є, редіректить (для L1 → Telegram bot deep-link)
    // Інакше просто закриває модалку.
    const primaryHandler = () => {
      if (beat.cta_url) {
        // Позначаємо намір оплати перед редіректом (для аналітики)
        if (window.ProgressTracker) {
          window.ProgressTracker.markPaymentIntent(currentLesson.id);
        }
        window.location.href = beat.cta_url;
      } else {
        closeModal();
      }
    };

    close.addEventListener('click', primaryHandler);
    if (secondaryBtn) {
      secondaryBtn.addEventListener('click', closeModal);
    }
  }

  //////////////////////////////////////////////////////////////////////
  // Debug / API для консолі
  //////////////////////////////////////////////////////////////////////

  return {
    load,
    start,
    // debug helpers, доступні як window.LessonEngine.skipBeat() etc.
    skipBeat: () => advance(),
    getCurrentBeat: () => currentLesson?.beats[currentBeatIdx],
    getState: () => ({
      lesson: currentLesson?.id,
      beat: currentBeatIdx,
      total: currentLesson?.beats.length,
    }),
    // LB-015: bidirectional navigation API (використовується UI бабблів)
    jumpToVisitedBeat,
    getNavigationState,
  };
})();

// Expose globally
window.LessonEngine = LessonEngine;
