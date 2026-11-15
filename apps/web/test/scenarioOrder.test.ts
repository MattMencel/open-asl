import { describe, expect, it } from 'vitest';
import { byScenarioNumber } from '../src/lobby-v2/scenarioOrder';

describe('scenario atlas order', () => {
  it('lists scenarios by number, numerically within a series: S2 before S10, the S cards before LMA, LMA2 before LMA10', () => {
    const numbers = ['LMA10', 'S10', 'Demo 2', 'S2', 'T1', 'LMA2', 'S1', 'S36', 'Demo 1', 'S9'];
    const list = numbers.map((number, i) => ({ number, name: `Scenario ${String.fromCharCode(90 - i)}` }));
    expect(list.sort(byScenarioNumber).map((s) => s.number)).toEqual(['S1', 'S2', 'S9', 'S10', 'S36', 'LMA2', 'LMA10', 'Demo 1', 'Demo 2', 'T1']);
  });
});
