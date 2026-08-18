/**
 * Custom Blockly-блоки для черепашки в 2D-side-view.
 * API узгоджено з реальним ComputerCraft turtle (мінус copaння+turnLeft/Right).
 *
 * У 2D-side-view face-direction турtl'а зафіксований вправо, тому:
 *   turtle.forward() = крок вправо (у face)
 *   turtle.back()    = крок вліво  (протилежно face, не змінює face)
 *   turtle.up()      = крок вгору  (абсолютно)
 *   turtle.down()    = крок вниз   (абсолютно)
 */

'use strict';

Blockly.defineBlocksWithJsonArray([
  {
    "type": "turtle_forward",
    "message0": "➡️ вперед",
    "previousStatement": null,
    "nextStatement": null,
    "colour": 120,
    "tooltip": "Крок уперед (у 2D — крок вправо)",
    "helpUrl": ""
  },
  {
    "type": "turtle_back",
    "message0": "⬅️ назад",
    "previousStatement": null,
    "nextStatement": null,
    "colour": 120,
    "tooltip": "Крок назад (у 2D — крок вліво)",
    "helpUrl": ""
  },
  {
    "type": "turtle_up",
    "message0": "⬆️ вгору",
    "previousStatement": null,
    "nextStatement": null,
    "colour": 120,
    "tooltip": "Крок угору",
    "helpUrl": ""
  },
  {
    "type": "turtle_down",
    "message0": "⬇️ вниз",
    "previousStatement": null,
    "nextStatement": null,
    "colour": 120,
    "tooltip": "Крок униз",
    "helpUrl": ""
  },
  {
    // L4 sensor. Value block (output: Boolean) — вставляється у boolean-slot
    // блоку `controls_if` як умова. Педагогічний meaning: «питання що
    // повертає ТАК/НІ». Дизайн: методист/tasks/.../l4-design.md
    "type": "sensor_wall_ahead",
    "message0": "🔍 стіна попереду?",
    "output": "Boolean",
    "colour": 180,
    "tooltip": "Повертає ТАК якщо клітинка попереду — стіна. Інакше НІ.",
    "helpUrl": ""
  },
  {
    // L4 atomic «якщо/то/інакше» — заміна для controls_if що потребує
    // шестерні для else. Тут всі три слоти видно одразу.
    // Причина: 7-9р дитина не може працювати з mutator UI. Плюс українська
    // без англіцизмів «if/else» — дотримання voice ↔ visual sync.
    // Post-pilot decision: docs/decisions.md §17 (Olexii's feedback L4).
    "type": "condition_if_else",
    "message0": "якщо %1 то",
    "args0": [
      {
        "type": "input_value",
        "name": "COND",
        "check": "Boolean"
      }
    ],
    "message1": "%1",
    "args1": [
      {
        "type": "input_statement",
        "name": "THEN"
      }
    ],
    "message2": "інакше",
    "message3": "%1",
    "args3": [
      {
        "type": "input_statement",
        "name": "ELSE"
      }
    ],
    "previousStatement": null,
    "nextStatement": null,
    "colour": 210,
    "tooltip": "Якщо умова ТАК — виконати перше. Якщо НІ — виконати друге.",
    "helpUrl": ""
  },
  {
    // L6 atomic «поки не на алмазі — робити». Спрощений while без mutator,
    // без окремого sensor (semantics вбудована). Аналог condition_if_else
    // для L4. Дизайн: teaching-patterns § "Патерн 4: while" — фіксована
    // конструкція для 7-9р, general while залишаємо на просунутий курс.
    "type": "loop_while_not_diamond",
    "message0": "поки я ще не на алмазі, роби:",
    "message1": "%1",
    "args1": [
      {
        "type": "input_statement",
        "name": "DO"
      }
    ],
    "previousStatement": null,
    "nextStatement": null,
    "colour": 290,
    "tooltip": "Повторює команди всередині, доки Мо не досягне алмаза. Універсально — працює для будь-якої довжини шляху.",
    "helpUrl": ""
  }
]);
