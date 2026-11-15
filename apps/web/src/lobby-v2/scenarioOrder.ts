const COLLATOR = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
const nameKey = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toLocaleLowerCase();

/** The series a scenario number belongs to, in list order: the Starter Kit cards (S1…), then LMA, then the rest. */
const seriesRank = (n: string) => (/^S\d/i.test(n) ? 0 : /^LMA/i.test(n) ? 1 : 2);

/** Scenario number order: by series, then numerically within it ("S2" before "S10", the collator being numeric). */
export const byScenarioNumber = (a: { number: string; name: string }, b: { number: string; name: string }): number =>
  seriesRank(a.number) - seriesRank(b.number) || COLLATOR.compare(a.number, b.number) || COLLATOR.compare(nameKey(a.name), nameKey(b.name));
