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
    "message0": "рухатись уперед",
    "previousStatement": null,
    "nextStatement": null,
    "colour": 120,
    "tooltip": "Крок уперед (у 2D — крок вправо)",
    "helpUrl": ""
  },
  {
    "type": "turtle_back",
    "message0": "рухатись назад",
    "previousStatement": null,
    "nextStatement": null,
    "colour": 120,
    "tooltip": "Крок назад (у 2D — крок вліво)",
    "helpUrl": ""
  },
  {
    "type": "turtle_up",
    "message0": "рухатись угору",
    "previousStatement": null,
    "nextStatement": null,
    "colour": 120,
    "tooltip": "Крок угору",
    "helpUrl": ""
  },
  {
    "type": "turtle_down",
    "message0": "рухатись униз",
    "previousStatement": null,
    "nextStatement": null,
    "colour": 120,
    "tooltip": "Крок униз",
    "helpUrl": ""
  }
]);
