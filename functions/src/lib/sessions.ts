/**
 * What becomes of a scheduled session once its table has closed (30 minutes after the start), as
 * `recordScheduledNoShows` sees it: `played` when both players came to the table, or the match has moves
 * (either player may make the first one, and only the first visitor is recorded as present); else `no-show`.
 * A played session leaves both players' schedules; the match itself stays in their games until it ends.
 */
export function closedSession(listing: { presentUids?: string[] }, match: { actionCount: number } | undefined): 'played' | 'no-show' {
  return (listing.presentUids?.length ?? 0) >= 2 || (match?.actionCount ?? 0) > 0 ? 'played' : 'no-show';
}
