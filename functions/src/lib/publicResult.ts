import type { MatchDoc, MatchResult, PublicMatchResultDoc, RulesetId, Seat } from '@asl/platform';

/**
 * The row a finished match adds to its players' public battle history, or null for a private match. Every public game
 * is listed, ranked or friendly (a game against the computer is a friendly); a friendly carries no Elo.
 */
export function publicResultOf<T>(
  matchId: string,
  match: Pick<MatchDoc, 'scenarioId' | 'scenarioTitle' | 'playerIds' | 'seats' | 'competition' | 'mode'>,
  rulesetId: RulesetId,
  isPublic: boolean,
  result: MatchResult,
  completedAt: T,
): (Omit<PublicMatchResultDoc, 'completedAt'> & { completedAt: T }) | null {
  if (!isPublic) return null;
  const ranked = match.mode === 'online' && (match.competition ?? 'ranked') === 'ranked';
  return {
    matchId,
    rulesetId,
    scenarioId: match.scenarioId,
    scenarioTitle: match.scenarioTitle,
    playerIds: match.playerIds,
    players: Object.fromEntries(Object.entries(match.seats).filter((x): x is [string, Seat] => x[1] !== null).map(([side, s]) => [side, { uid: s.uid, nickname: s.displayName }])),
    competition: ranked ? 'ranked' : 'friendly',
    visibility: 'public',
    result,
    official: true,
    completedAt,
  };
}
