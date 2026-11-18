import { useEffect, useRef } from 'react';
import { get, onDisconnect, onValue, ref, remove, serverTimestamp, set } from 'firebase/database';
import { useLocation } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { realtime } from '../firebase';
import { HEARTBEAT_MS, IDLE_MS, PURGE_MS, areaOf, type PresenceConnection } from './presenceRules';

const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;
const TICK_MS = 15_000;

/**
 * One node per browser connection, removed when the connection drops (the server closes unjoined
 * quick tables after the last one goes). The node's `at` is refreshed every minute for as long as
 * the tab lives, and `active` says whether the person has touched it within `IDLE_MS`, so a tab
 * left open does not keep its owner on the roster (see `presenceRules.ts`). A disconnect handler
 * does not always run (a laptop asleep, a dev proxy holding the socket), so on connect the owner
 * also removes their own nodes whose heartbeat stopped long ago; a server sweep catches the rest.
 *
 * Mounted once for a signed-in member, whatever page the tab shows: the node lives as long as the tab and only its
 * `area` follows the page. Removing it on a page change (the lobby to a waiting room, a profile) left the member with
 * no node for a moment, and the server then withdrew their open seat.
 */
export function MemberPresence() {
  const auth = useAuth();
  return auth.status === 'member' ? <Presence uid={auth.user.uid} /> : null;
}

function Presence({ uid }: { uid: string }) {
  const location = useLocation();
  const area = areaOf(location.pathname);
  const areaNow = useRef(area);
  areaNow.current = area;
  const writeRef = useRef<() => void>(() => {});
  useEffect(() => writeRef.current(), [area]);
  useEffect(() => {
    const connectionId = crypto.randomUUID();
    const connection = ref(realtime, `presence/${uid}/${connectionId}`);
    const disconnect = onDisconnect(connection);
    let lastInput = Date.now();
    let lastBeat = Date.now();
    let active = true;
    let gone = false;
    // The whole node every time: a partial update of a node that is gone (its disconnect handler ran on a dropped
    // connection, or the server swept it after a long sleep) fails the database rules, and the tab would stay off the
    // roster, and lose its open seat, until reloaded. Never after the cleanup: a node set then would outlive the tab
    // (StrictMode mounts every effect twice in dev).
    const put = () => {
      if (!gone) void set(connection, { at: serverTimestamp(), area: areaNow.current, active }).catch(() => {});
    };
    writeRef.current = put;
    // Each time the database connection comes up, the first time and after every drop: the server removed the node when
    // the old connection went, so arm the handler for the new one and write the node again.
    const stopConnected = onValue(ref(realtime, '.info/connected'), (snapshot) => {
      if (snapshot.val() === true && !gone) void disconnect.remove().then(put).catch(() => {});
    });
    // The clock offset is local SDK state (`get` would ask the server, which does not serve .info), hence the one-time listener.
    const serverOffset = new Promise<number>((resolve) => onValue(ref(realtime, '.info/serverTimeOffset'), (snapshot) => resolve(Number(snapshot.val() ?? 0)), () => resolve(0), { onlyOnce: true }));
    void Promise.all([get(ref(realtime, `presence/${uid}`)), serverOffset]).then(([snapshot, offset]) => {
      const mine = (snapshot.val() ?? {}) as Record<string, PresenceConnection | null>;
      // By the server clock: a sibling tab that is alive reports in every minute, so only long-dead nodes go.
      const cutoff = Date.now() + offset - PURGE_MS;
      for (const [id, node] of Object.entries(mine)) {
        if (id !== connectionId && (typeof node?.at !== 'number' || node.at < cutoff)) void remove(ref(realtime, `presence/${uid}/${id}`)).catch(() => {});
      }
    }).catch((e: unknown) => console.warn('presence: could not clear old connections', e));

    const onInput = () => {
      lastInput = Date.now();
      if (!active) {
        active = true;
        lastBeat = lastInput;
        put();
      }
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') onInput(); };
    const tick = () => {
      const now = Date.now();
      if (active && now - lastInput >= IDLE_MS) {
        active = false;
        lastBeat = now;
        put();
      } else if (now - lastBeat >= HEARTBEAT_MS) {
        lastBeat = now;
        put();
      }
    };
    for (const type of INPUT_EVENTS) window.addEventListener(type, onInput, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    const timer = window.setInterval(tick, TICK_MS);
    return () => {
      gone = true;
      stopConnected();
      window.clearInterval(timer);
      for (const type of INPUT_EVENTS) window.removeEventListener(type, onInput);
      document.removeEventListener('visibilitychange', onVisibility);
      void disconnect.cancel().catch(() => {});
      void remove(connection).catch(() => {});
    };
  }, [uid]);
  return null;
}
