/**
 * Constraint Engine — block-level правила для beat'ів типу `task-with-constraints`.
 *
 * Ідея (spec §1.1 «Block Constraints», POC для L7 «Ender Dragon frustration»):
 * beat декларує масив правил «максимум N блоків типу X у scope», engine слухає
 * BLOCK_CREATE у Blockly workspace, і коли поріг перевищений — викликає callback.
 * Callback (owner: lesson-engine) вирішує, що робити: animate дракона, dispose
 * зайвого блоку, route до наступного reaction-beat, тощо. Constraint engine
 * САМ нічого у workspace не змінює — тільки повідомляє про порушення.
 *
 * Escalation:
 * Для кожної (beat, constraint) пари ведеться лічильник — скільки разів це
 * правило вже спрацювало. hitCount передається callback'у 1-indexed:
 *   1 → перше порушення (спокійна реакція)
 *   2 → друге (пряміша підказка)
 *   3+ → hard help (застигає на останньому escalation_beat)
 * Стан персистить між викликами setupConstraints для того самого beat.id, тому
 * коли учень вертається у task після reaction-beat'у, наступне порушення дає
 * інкрементний hint. Reset — тільки через resetState() або нову лесон-сесію.
 *
 * JSON schema (see spec §1.1):
 *   {
 *     "block_type": "turtle_down",
 *     "max_count": 1,
 *     "scope": "top-level" | "any",
 *     "on_exceed": { ...free-form, передається callback'у як-є... }
 *   }
 *
 * Використання:
 *   const teardown = ConstraintEngine.setupConstraints(beat, workspace, {
 *     onExceed(constraint, newestBlockId, hitCount) {
 *       // animate dragon, dispose block via ConstraintEngine.notifyManagedDispose(id),
 *       // route to constraint.on_exceed.route_to_beat або escalation_beats[hitCount-2]
 *     }
 *   });
 *   // при виході з beat:
 *   teardown();
 */

'use strict';

const ConstraintEngine = (function() {

  // Escalation counters per (beat.id, block_type, scope) key.
  // Персистить через teardown/setup для того самого beat — це дозволяє
  // прогресію hint'ів між reaction-beat'ами.
  const escalationCounters = Object.create(null);

  // Ids блоків, чиї BLOCK_DELETE-події треба ігнорувати (щоб engine-driven
  // dispose у callback'у не декрементував counter одразу після onExceed).
  // Callback має викликати notifyManagedDispose(id) перед block.dispose().
  const suppressedDeleteIds = new Set();

  //////////////////////////////////////////////////////////////////////
  // Публічне API
  //////////////////////////////////////////////////////////////////////

  /**
   * Атачить BLOCK_CREATE/BLOCK_DELETE слухачі на workspace для перевірки
   * constraint'ів beat'у. Повертає teardown-функцію, що відписує все.
   *
   * @param {Object} beat — beat об'єкт з опційним beat.constraints[]
   * @param {Blockly.Workspace} workspace — активний Blockly workspace
   * @param {{onExceed: function(constraint, newestBlockId, hitCount)}} callbacks
   *        onExceed отримує:
   *          - constraint — той самий об'єкт з beat.constraints[i]
   *          - newestBlockId — id щойно доданого блоку, що спричинив violation
   *            (може бути null у edge-case якщо блок уже зник; callback має
   *            це перевірити перед dispose)
   *          - hitCount — 1-indexed номер порушення для цього constraint
   *            у поточному beat (використовується для escalation_beats routing)
   * @returns {function(): void} teardown — виклик відписує listeners
   */
  function setupConstraints(beat, workspace, callbacks) {
    // Edge case: beat без constraints — no-op teardown.
    // Це нормальний випадок для beat'ів, які проходять через
    // setupConstraints шлях, але constraints опціональні.
    if (!beat || !beat.constraints || !beat.constraints.length) {
      return function noopTeardown() {};
    }
    if (!workspace || !window.Blockly) {
      console.warn('[ConstraintEngine] No workspace or Blockly — skipping setup');
      return function noopTeardown() {};
    }
    if (!callbacks || typeof callbacks.onExceed !== 'function') {
      console.warn('[ConstraintEngine] callbacks.onExceed missing — skipping setup');
      return function noopTeardown() {};
    }

    const beatId = beat.id || '__anon__';
    const constraints = beat.constraints;

    // Debounce state. Blockly часто-густо емітить кілька подій підряд
    // (одна user-action → BLOCK_CREATE + BLOCK_MOVE + BLOCK_CHANGE у батчі).
    // Debounce ~50ms гарантує, що ми перевіримо workspace ОДИН раз після
    // того, як батч осів, а не N разів на кожен sub-event.
    let debounceTimer = null;
    const pendingCreatedIds = [];  // збирається між тіками debounce

    const listener = function(event) {
      if (!event || !event.type) return;

      if (event.type === Blockly.Events.BLOCK_CREATE) {
        // event.ids — стандартний Blockly-масив; fallback на event.blockId
        // для сумісності зі старими Blockly-подіями та тестами.
        const ids = event.ids || (event.blockId ? [event.blockId] : []);
        for (const id of ids) pendingCreatedIds.push(id);
        scheduleCheck();
      } else if (event.type === Blockly.Events.BLOCK_DELETE) {
        // Delete може прилетіти двома шляхами:
        //   1) callback сам dispose'ить excess-блок (engine-driven)
        //   2) учень вручну прибрав блок (Ctrl+Z / drag to trash)
        // Ми хочемо декрементувати counter ТІЛЬКИ у випадку 2, інакше
        // прогресія escalation зламається (наступне порушення покаже
        // той самий reaction-beat замість escalated).
        const deletedIds = event.ids || (event.blockId ? [event.blockId] : []);
        let anyUserDelete = false;
        for (const id of deletedIds) {
          if (suppressedDeleteIds.has(id)) {
            suppressedDeleteIds.delete(id);
          } else {
            anyUserDelete = true;
          }
        }
        if (anyUserDelete) {
          // Дебаунсимо і delete-check теж — під час undo Blockly часто
          // видаляє кілька блоків одразу.
          scheduleDeleteCheck();
        }
      }
    };

    function scheduleCheck() {
      if (debounceTimer) return;
      debounceTimer = setTimeout(function() {
        debounceTimer = null;
        const idsSnapshot = pendingCreatedIds.slice();
        pendingCreatedIds.length = 0;
        try {
          runCreateCheck(idsSnapshot);
        } catch (err) {
          console.error('[ConstraintEngine] check failed:', err);
        }
      }, 50);
    }

    // Окремий debounce для delete-check, щоб не міксувати з create-check.
    let deleteDebounceTimer = null;
    function scheduleDeleteCheck() {
      if (deleteDebounceTimer) return;
      deleteDebounceTimer = setTimeout(function() {
        deleteDebounceTimer = null;
        try {
          runDeleteCheck();
        } catch (err) {
          console.error('[ConstraintEngine] delete-check failed:', err);
        }
      }, 50);
    }

    function runCreateCheck(recentIds) {
      for (const constraint of constraints) {
        const count = countMatching(constraint, workspace);
        if (count > constraint.max_count) {
          const key = counterKey(beatId, constraint);
          escalationCounters[key] = (escalationCounters[key] || 0) + 1;
          const hitCount = escalationCounters[key];
          const newestId = pickNewest(recentIds, constraint, workspace);
          // Note: fire event ПІСЛЯ інкременту, щоб callback побачив свіжий count.
          // Callback може синхронно викликати notifyManagedDispose(newestId) →
          // block.dispose() → наступна BLOCK_DELETE прилетить у suppressed set.
          try {
            callbacks.onExceed(constraint, newestId, hitCount);
          } catch (err) {
            console.error('[ConstraintEngine] onExceed threw:', err);
          }
          // Не break'аємо — теоретично можливо, що учень одним drag'ом
          // порушив кілька constraint'ів (rare, але треба показати обидва).
        }
      }
    }

    function runDeleteCheck() {
      // На кожен user-driven delete: якщо count певного constraint'у знову
      // <= max_count, ДЕКРЕМЕНТУЄМО counter на 1 (не до нуля — щоб прогресія
      // не «забула» попередні порушення, якщо учень грається).
      // Це реалізує spec-вимогу «allows recovery after user manually removes
      // excess» — учень може відкотити помилку, і наступний create триг'герне
      // fresh escalation level.
      for (const constraint of constraints) {
        const key = counterKey(beatId, constraint);
        if (!escalationCounters[key]) continue;
        const count = countMatching(constraint, workspace);
        if (count <= constraint.max_count) {
          escalationCounters[key] = Math.max(0, escalationCounters[key] - 1);
        }
      }
    }

    workspace.addChangeListener(listener);

    return function teardown() {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (deleteDebounceTimer) {
        clearTimeout(deleteDebounceTimer);
        deleteDebounceTimer = null;
      }
      pendingCreatedIds.length = 0;
      workspace.removeChangeListener(listener);
    };
  }

  /**
   * Скидає ВСІ escalation counters. Використовується коли починається новий
   * lesson або коли task-with-constraints beat остаточно завершився success'ом
   * (щоб при наступному візиті прогресія була fresh).
   */
  function resetState() {
    for (const key in escalationCounters) delete escalationCounters[key];
    suppressedDeleteIds.clear();
  }

  /**
   * Повідомляє engine, що наступний BLOCK_DELETE для цього id — engine-driven
   * (callback dispose'ить excess-блок), тому НЕ треба декрементувати counter.
   * Callback має викликати цю функцію ПЕРЕД block.dispose():
   *
   *   ConstraintEngine.notifyManagedDispose(newestBlockId);
   *   workspace.getBlockById(newestBlockId).dispose();
   */
  function notifyManagedDispose(blockId) {
    if (blockId) suppressedDeleteIds.add(blockId);
  }

  //////////////////////////////////////////////////////////////////////
  // Helpers
  //////////////////////////////////////////////////////////////////////

  function counterKey(beatId, constraint) {
    // Включаємо beatId у ключ, щоб різні beat'и з однаковим block_type
    // не заважали один одному (напр. L7 і майбутній L8 обидва обмежують
    // turtle_down — прогрес у L7 не має підняти escalation level у L8).
    return beatId + '::' + constraint.block_type + '::' + (constraint.scope || 'any');
  }

  function countMatching(constraint, workspace) {
    const all = workspace.getAllBlocks(false);
    let n = 0;
    for (const b of all) {
      if (b.type !== constraint.block_type) continue;
      if (constraint.scope === 'top-level' && !isTopLevel(b)) continue;
      n++;
    }
    return n;
  }

  /**
   * Top-level = блок не всередині statement/value slot іншого блоку.
   * Blockly.Block.getSurroundParent() → повертає ЛИШЕ enclosing-parent
   * (той що містить нас всередині свого input), не previousStatement-сусіда
   * у тому ж стеку. Тому:
   *   - `turtle_down` на порожньому canvas'і → getSurroundParent() null → top-level ✓
   *   - `turtle_down` як частина стеку (previousStatement chain) → getSurroundParent() null → top-level ✓
   *   - `turtle_down` всередині `loop_while_not_diamond`.DO → getSurroundParent() === loop → NOT top-level ✓
   *   - `turtle_down` всередині `condition_if_else`.THEN → getSurroundParent() === if_else → NOT top-level ✓
   *
   * Це саме та семантика, яку хоче spec: constraint has max_count=1 top-level
   * означає «не можна ставити 2 однакових на canvas НАРАЗІ у голому стеку»,
   * а поставити один усередині циклу + один на canvas — ОК (два разні scope).
   */
  function isTopLevel(block) {
    if (!block || typeof block.getSurroundParent !== 'function') return true;
    return block.getSurroundParent() == null;
  }

  /**
   * Вибирає з recentIds найновіший блок, що САМЕ порушує constraint
   * (тип збігається, scope збігається). Якщо recentIds порожній або жоден
   * не підходить — fallback: беремо останній matching блок з workspace
   * (це трапляється якщо BLOCK_CREATE прийшов не з user-action, а з XML load
   * чи undo-redo).
   */
  function pickNewest(recentIds, constraint, workspace) {
    // Iterate у зворотньому порядку — найпізніші id першими.
    for (let i = recentIds.length - 1; i >= 0; i--) {
      const id = recentIds[i];
      const b = workspace.getBlockById(id);
      if (!b) continue;                              // блок уже зник
      if (b.type !== constraint.block_type) continue;
      if (constraint.scope === 'top-level' && !isTopLevel(b)) continue;
      return id;
    }
    // Fallback: беремо будь-який matching блок з workspace.
    const all = workspace.getAllBlocks(false);
    let last = null;
    for (const b of all) {
      if (b.type !== constraint.block_type) continue;
      if (constraint.scope === 'top-level' && !isTopLevel(b)) continue;
      last = b;
    }
    return last ? last.id : null;
  }

  //////////////////////////////////////////////////////////////////////
  // Return
  //////////////////////////////////////////////////////////////////////

  return {
    setupConstraints: setupConstraints,
    resetState: resetState,
    notifyManagedDispose: notifyManagedDispose,
    // Debug helpers — не для production використання.
    _debug: {
      getCounters: function() { return Object.assign({}, escalationCounters); },
      getSuppressed: function() { return Array.from(suppressedDeleteIds); },
    },
  };
})();

// Expose globally (same pattern as LessonEngine, SpeechBubble, CoachMark).
window.ConstraintEngine = ConstraintEngine;
