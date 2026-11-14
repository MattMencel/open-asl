import { describe, expect, it } from 'vitest';
import { UNKNOWN_DEF_ID, concealmentModule, redactState, sk2CoreModules, sk3CoreModules } from '@asl/rules';
import { RU_VS_GE, makeEngine } from '../../../packages/rules/test/fixtures';
import { personnelStack } from '../src/board/stacking';

describe('board stacking', () => {
  it('draws a concealed stack’s "?" under the Known units of its side in the hex, which stay in view (SK4 8.3)', () => {
    const { engine, state } = makeEngine({
      scenario: { ...RU_VS_GE, ssr: [{ module: 'concealment', params: {}, text: 'Concealment' }] },
      extra: [...sk2CoreModules, ...sk3CoreModules, concealmentModule],
      terrain: { yK5: { terrain: 'building-stone', buildingId: 'b' } },
      pieces: [
        { id: 'a', def: 'ru.447', side: 'ru', hex: 'yK5', tags: { concealed: true } },
        { id: 'c', def: 'ru.447', side: 'ru', hex: 'yK5' },
        { id: 'g', def: 'ge.467', side: 'ge', hex: 'yK8' },
      ],
    });
    const seen = redactState(engine, state, 'ge');
    const people = Object.values(seen.pieces).filter((p) => p.loc.kind === 'hex' && p.loc.hex === 'yK5');
    const order = personnelStack(engine.env(seen), people);
    expect(order.map((p) => (p.defId === UNKNOWN_DEF_ID ? '?' : p.id))).toEqual(['?', 'c']);
  });
});
