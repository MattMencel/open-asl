import { describe, expect, it } from 'vitest';
import { RU_VS_GE, makeEngine } from './fixtures';

/*
 * The APh advance enters an ADJACENT Location the unit could enter in the MPh (SK1 3.7; ASLRB A4.7): one hex at any
 * MF cost, but never terrain that may not be entered at all, such as a hex an SSR floods.
 */
const game = () =>
  makeEngine({
    scenario: { ...RU_VS_GE, firstSide: 'ru' },
    terrain: { yO5: { terrain: 'flooded' } },
    startPhase: 'APh',
    pieces: [
      { id: 'q', def: 'ru.447', side: 'ru', hex: 'yO4' },
      { id: 'l', def: 'ru.L81', side: 'ru', hex: 'yO4' },
    ],
  });

describe('advance into terrain no unit may enter', () => {
  it('refuses the advance into a flooded hex and does not offer it', () => {
    const { engine, state } = game();
    const d = engine.currentDecision(state)!;
    expect(engine.validate(state, { type: 'advance', units: ['q', 'l'], to: 'yO5', side: 'ru', decisionId: d.id } as never)).toBe('q cannot enter that hex');
    const advances = engine.legalActions(state, 'ru').filter((a) => a.type === 'advance');
    expect(advances.some((a) => a['to'] === 'yO5')).toBe(false);
    // The open hexes round it are still offered.
    expect(advances.some((a) => a['to'] === 'yO3')).toBe(true);
  });
});
