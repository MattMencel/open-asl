import { describe, expect, it } from 'vitest';
import { closedSession } from '../src/lib/sessions';

/** A scheduled session whose table has closed: played (off the schedule) or a no-show. */
describe('closedSession', () => {
  it('is played when both players came to the table, or the match has moves', () => {
    expect(closedSession({ presentUids: ['u1', 'u2'] }, { actionCount: 0 })).toBe('played');
    expect(closedSession({ presentUids: ['u1', 'u2'] }, { actionCount: 412 })).toBe('played');
    expect(closedSession({ presentUids: ['u1'] }, { actionCount: 3 })).toBe('played');
  });
  it('is a no-show when one player or nobody came and nothing was played', () => {
    expect(closedSession({ presentUids: ['u1'] }, { actionCount: 0 })).toBe('no-show');
    expect(closedSession({ presentUids: [] }, undefined)).toBe('no-show');
    expect(closedSession({}, undefined)).toBe('no-show');
  });
});
