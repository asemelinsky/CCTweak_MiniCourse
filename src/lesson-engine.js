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
 * Використання:
 *   LessonEngine.load('lessons/l1.json').then(engine => engine.start());
 */

'use strict';

const LessonEngine = (function() {

  let currentLesson = null;
  let currentBeatIdx = 0;
  let listeners = [];  // активні event listeners для поточного beat

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

  function advance() {
    // Прибрати UI поточного beat
    const beat = currentLesson.beats[currentBeatIdx];
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
  };
})();

// Expose globally
window.LessonEngine = LessonEngine;
