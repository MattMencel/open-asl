import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import type { Decision } from '@asl/engine';
import { deadlineFor } from '../src/lib/clock';

const turn = { id: 'd1', kind: 'phase', owner: 'ge', deadlineClass: 'turn' } as unknown as Decision;
const MIN = 60_000;

/** A scheduled session's table opens 15 minutes early, but no clock runs before the scheduled start. */
describe('deadlineFor', () => {
  const now = Date.UTC(2026, 10, 16, 20, 0);
  it('counts from now without a scheduled start', () => {
    expect((deadlineFor({ pace: 'live' }, turn, 0, now).at as Timestamp).toMillis()).toBe(now + 10 * MIN);
  });
  it('counts from the scheduled start while it is still to come', () => {
    const start = Timestamp.fromMillis(now + 15 * MIN);
    expect((deadlineFor({ pace: 'live', clockFrom: start }, turn, 0, now).at as Timestamp).toMillis()).toBe(now + 25 * MIN);
  });
  it('counts from now once the start has passed', () => {
    const start = Timestamp.fromMillis(now - 5 * MIN);
    expect((deadlineFor({ pace: 'live', clockFrom: start }, turn, 3, now).at as Timestamp).toMillis()).toBe(now + 10 * MIN);
  });
});
