/**
 * S70's Connection Location (SSR 2: "a pseudo, off-map hex ... remove any units in the Connection Location from the map
 * and secretly record them"). It is on no board, so its owner sees what is in it here and acts on it from here; the
 * other side never sees this box (nor, in its view of the game, the units).
 */
export function ConnectionBox(props: {
  units: { id: string; label: string }[];
  selected: boolean;
  onSelect: () => void;
  /** `disabled`: offered but refused now; `hint` then says why, shown under the buttons. */
  actions: { label: string; run: () => void; hint?: string; disabled?: boolean }[];
}) {
  const refused = props.actions.filter((a) => a.disabled && a.hint);
  return (
    <section className={`panel small connection-box${props.selected ? ' selected' : ''}`}>
      <h3>
        Connection Location <span className="muted">(secret)</span>
      </h3>
      {props.units.length ? (
        <ul>
          {props.units.map((u) => (
            <li key={u.id}>{u.label}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">Empty. Units enter it from a Cave as their sole action in the MPh, RtPh or APh.</p>
      )}
      <div className="row">
        {props.units.length > 0 && (
          <button onClick={props.onSelect} title="Show these units in the stack card, to tick the ones that act">
            Select
          </button>
        )}
        {props.actions.map((a) => (
          <button key={a.label} onClick={a.run} title={a.hint} disabled={a.disabled}>
            {a.label}
          </button>
        ))}
      </div>
      {refused.map((a) => (
        <p key={a.label} className="muted small">
          {a.label}: {a.hint}
        </p>
      ))}
    </section>
  );
}
