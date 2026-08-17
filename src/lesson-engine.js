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
 *  - click-next     → чекає натискання «Далі» / label кнопки з beat.advance.label
 *  - block-added    → чекає що у workspace з'явиться блок типу block_type
 *  - run-clicked    → чекає що натиснуто ▶ Запустити
 *  - task-solved    → чекає що lastResult === SUCCESS у simulator
 *
 * Використання:
 *   LessonEngine.load('lessons/l1.json').then(engine => engine.start());
 */

'use strict';

const LessonEngine = (function() {

  let currentLesson = null;
  let currentBeatIdx = 0;
  let listeners = [];  // активні event listeners для поточного beat

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
        SpeechBubble.show(beat);
        break;
      case 'coach-mark':
        CoachMark.show(beat);
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

      case 'run-clicked':
        addListener(document, 'lesson-run-clicked', () => advance());
        break;

      case 'task-solved':
        addListener(document, 'lesson-task-solved', () => advance());
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

  function setupTask(beat) {
    // Якщо задача вимагає скинути workspace — очищаємо
    if (beat.reset_workspace && window.workspace) {
      window.workspace.clear();
    }
    // Задача = дитина сама складає код і натискає ▶
    // Simulator сам виконає код, поставить lastResult, і викличе подію 'lesson-task-solved'
    // якщо success. Або 'lesson-task-failed' інакше — тоді показуємо hint.

    // Слухач невдач
    const failListener = (e) => {
      const { result } = e.detail;
      let hint = null;
      if (result === 'CRASH') hint = beat.hint_on_crash;
      else if (result === 'FAILURE') hint = beat.hint_on_failure;
      else if (result === 'TIMEOUT') hint = 'Ой, програма надто довго виконується. Може, зациклилась?';

      if (hint) {
        SpeechBubble.show({
          character: 'mo',
          text: hint,
          animation: 'shake',
        });
        // Через 4 сек прибрати
        setTimeout(() => SpeechBubble.hide(), 4000);
      }
    };
    addListener(document, 'lesson-task-failed', failListener);

    // Опційна інструкція
    if (beat.instruction) {
      SpeechBubble.show({
        character: 'mo',
        text: beat.instruction,
        animation: 'wiggle',
      });
      // Не приховуємо — залишається як нагадування
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
    message.textContent = beat.message;
    close.textContent = beat.cta_label || 'OK';

    overlay.style.display = 'flex';

    const handler = () => {
      overlay.style.display = 'none';
      close.removeEventListener('click', handler);
      // Урок закінчено, engine нічого більше не робить
    };
    close.addEventListener('click', handler);
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
