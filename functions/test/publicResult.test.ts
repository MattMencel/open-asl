import { describe, expect, it } from 'vitest';
import { publicResultOf } from '../src/lib/publicResult';

/** The row a finished match adds to the players' public battle history (`publicResults`). */
describe('publicResultOf', () => {
  const seats = { am: { uid: 'u1', displayName: 'Able' }, ge: { uid: 'u2', displayName: 'Baker' } };
  const match = { scenarioId: 'sk-s1', scenarioTitle: 'S1', playerIds: ['u1', 'u2'], seats, mode: 'online' as const };
  const result = { winner: 'am', reason: 'victory conditions', winnerUid: 'u1', loserUid: 'u2' };

  it('lists a public friendly between players, marked friendly, as well as a ranked game', () => {
    const friendly = publicResultOf('m1', { ...match, competition: 'friendly' }, 'starter-kit', true, result, 0);
    expect(friendly).toMatchObject({ matchId: 'm1', competition: 'friendly', playerIds: ['u1', 'u2'], players: { am: { uid: 'u1', nickname: 'Able' } } });
    expect(publicResultOf('m2', { ...match, competition: 'ranked' }, 'starter-kit', true, { ...result, eloDelta: 12 }, 0)).toMatchObject({ competition: 'ranked', result: { eloDelta: 12 } });
  });

  it('lists a public game against the computer as a friendly, and no private game', () => {
    const computer = { ...match, mode: 'computer' as const, competition: 'friendly' as const, seats: { ...seats, ge: { uid: 'computer', displayName: 'Bot' } } };
    expect(publicResultOf('m3', computer, 'starter-kit', true, result, 0)?.competition).toBe('friendly');
    expect(publicResultOf('m4', { ...match, competition: 'friendly' }, 'starter-kit', false, result, 0)).toBeNull();
  });
});
