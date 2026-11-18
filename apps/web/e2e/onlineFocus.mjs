#!/usr/bin/env node
// Browser check of an online table between turns (two headless Chromium profiles, alice and carol, in one online
// lma-9 match):
//   - the hex a player selects is ringed on the opponent's board (and nothing is shared during setup);
//   - the opponent's actions reach the other board as they are made: the arrival times are printed;
//   - when the match ends (a concession here), the other board keeps its own view: no "Match unavailable".
// Needs `pnpm dev` up and `pnpm seed alice@example.com carol@example.com`, like ping.mjs.
// Options: SHOTS=<dir> saves screenshots, WEB=<url> for another dev server.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const WEB = process.env.WEB ?? 'http://localhost:5173';
const SHOTS = process.env.SHOTS ?? null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (m) => { throw new Error(m); };
const expect = (c, m) => { if (!c) fail(m); };
const bin = ['chromium', 'chromium-browser', 'google-chrome'].find((c) => spawnSync('which', [c]).status === 0) ?? fail('no chromium');
const devices = [];
process.on('exit', () => { for (const d of devices) { try { d.proc.kill(); } catch {} try { rmSync(d.profile, { recursive: true, force: true }); } catch {} } });

async function launch(name, port, email) {
  const profile = mkdtempSync(join(tmpdir(), `asl-focus-${name}-`));
  const proc = spawn(bin, ['--headless=new', '--mute-audio', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1600,1000', '--no-first-run', '--no-sandbox', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
  const d = { name, proc, profile, errors: [], email };
  devices.push(d);
  let targets = null;
  for (let i = 0; i < 60 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(250); } }
  if (!targets) fail(`${name}: no devtools`);
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => {
    const x = JSON.parse(m.data);
    if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); return; }
    if (x.method === 'Runtime.exceptionThrown') d.errors.push(`exception: ${x.params.exceptionDetails.exception?.description ?? x.params.exceptionDetails.text}`);
    if (x.method === 'Runtime.consoleAPICalled' && x.params.type === 'error') d.errors.push(`console.error: ${x.params.args.map((a) => a.description ?? a.value).join(' ')}`);
  };
  d.send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  d.evaluate = async (js) => {
    const r = await d.send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(`${name}: eval failed: ${r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text}\n${js.slice(0, 200)}`);
    return r.result?.result?.value;
  };
  let n = 0;
  d.shot = async (label) => { if (!SHOTS) return; const r = await d.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(SHOTS, `${name}-${String(++n).padStart(2, '0')}-${label}.png`), Buffer.from(r.result.data, 'base64')); };
  d.waitFor = async (js, what, ms = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await d.evaluate(`!!(${js})`)) return; await sleep(120); }
    await d.shot('timeout');
    fail(`${name}: timed out waiting for ${what}`);
  };
  d.hexClient = async (hex) => JSON.parse(await d.evaluate(`JSON.stringify(window.aslBoard.hexToClient(${JSON.stringify(hex)}))`)) ?? fail(`no hex ${hex}`);
  d.ctrlClickHex = async (hex, dx = 0, dy = 0) => {
    const c = await d.hexClient(hex);
    c.x += dx; c.y += dy;
    await d.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y, modifiers: 2 });
    await d.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1, modifiers: 2 });
    await d.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1, modifiers: 2 });
  };
  d.pings = async () => (await d.evaluate(`window.aslBoard.stats().fx.ping ?? 0`)) ?? 0;
  await d.send('Page.enable'); await d.send('Runtime.enable');
  await d.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  d.token = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password', returnSecureToken: true }) }).then((r) => r.json());
  if (!d.token?.idToken) fail(`${name}: cannot sign in as ${email}`);
  await d.send('Page.navigate', { url: `${WEB}/login` });
  await d.waitFor(`document.querySelector('input[type=email]') || location.pathname.startsWith('/app')`, 'login page');
  if (await d.evaluate(`!!document.querySelector('input[type=email]')`)) {
    await d.evaluate(`document.querySelector('input[type=email]').focus()`);
    await d.send('Input.insertText', { text: email });
    await d.evaluate(`document.querySelector('input[type=password]').focus()`);
    await d.send('Input.insertText', { text: 'password' });
    for (let i = 0; i < 4; i++) {
      await d.evaluate(`document.querySelector('form button.primary')?.click()`);
      await sleep(2500);
      if (await d.evaluate(`location.pathname.startsWith('/app')`)) break;
    }
    await d.waitFor(`location.pathname.startsWith('/app')`, 'lobby');
  }
  // The member claim is granted on first sign-in through the app: take a token minted after it.
  await sleep(500);
  d.token = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password', returnSecureToken: true }) }).then((r) => r.json());
  d.api = async (fn, data) => (await fetch(`http://127.0.0.1:5001/demo-asl-web/us-central1/${fn}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${d.token.idToken}` }, body: JSON.stringify({ data }) })).json();
  d.open = async (matchId) => {
    await d.send('Page.navigate', { url: `${WEB}/app/match/${matchId}` });
    await d.waitFor(`window.aslGame && window.aslBoard && document.querySelector('canvas') && window.aslBoard.stats().builds >= 1`, 'the match');
    await sleep(800);
    // Click the phase wheel away so it does not cover the hex.
    await d.evaluate(`document.querySelector('.pw-overlay')?.click()`);
    await sleep(400);
  };
  return d;
}

const alice = await launch('alice', 9335, 'alice@example.com');
const carol = await launch('carol', 9336, 'carol@example.com');
d0: {
  const r = await fetch('http://127.0.0.1:8080/v1/projects/demo-asl-web/databases/(default)/documents/matches?pageSize=300', { headers: { authorization: 'Bearer owner' } }).then((x) => x.json());
  for (const docu of r.documents ?? []) {
    const f = docu.fields ?? {};
    if (f.mode?.stringValue !== 'online' || !['active', 'open'].includes(f.status?.stringValue)) continue;
    const mid = docu.name.split('/').pop();
    const ids = (f.playerIds?.arrayValue?.values ?? []).map((v) => v.stringValue);
    for (const d of [alice, carol]) if (ids.includes(d.token.localId)) { await d.api('leaveMatch', { matchId: mid }); break; }
  }
}
const created = await alice.api('createMatch', { mode: 'online', scenarioId: 'lma-9', balance: [], side: 'br', openSeat: true, pace: 'live' });
const matchId = created?.result?.matchId ?? fail(`createMatch: ${JSON.stringify(created)}`);
const joined = await carol.api('joinOpenMatch', { matchId });
expect(!joined.error, `joinOpenMatch: ${JSON.stringify(joined)}`);
console.log(`online match ${matchId}`);
await alice.open(matchId);
await carol.open(matchId);
const both = [alice, carol];
/** The board whose decision it is, once the position has settled. */
const mover = async () => {
  for (let i = 0; i < 100; i++) {
    for (const d of both) if (await d.evaluate(`!!window.aslGame.owner && !window.aslGame.resolving`)) return d;
    await sleep(150);
  }
  fail('nobody to move');
};
const actFirst = async (d, pick) => {
  const a = await d.evaluate(`(() => { const a = window.aslGame.legal.find(${pick}); if (!a) return null; const { side, decisionId, ...rest } = a; return JSON.stringify(rest); })()`);
  if (!a) return null;
  const err = await d.evaluate(`window.aslGame.act(${a})`);
  if (err) fail(`${d.name}: ${err}`);
  await sleep(400);
  return JSON.parse(a);
};

// --- setup: a hex clicked while placing is not shared.
const clickHex = async (d, hex) => {
  const c = await d.hexClient(hex);
  await d.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: c.x, y: c.y });
  await d.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
  await d.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 });
  await sleep(300);
};
{
  const setter = await mover();
  const hex = JSON.parse(await setter.evaluate(`JSON.stringify([...window.aslGame.env.statics.map.hexes()][40].id)`));
  await clickHex(setter, hex);
  await sleep(1500);
  const seen = await (setter === alice ? carol : alice).evaluate('window.aslGame.theirFocus');
  expect(seen === null, `a hex selected during setup was shared: ${seen}`);
  console.log(`setup: ${setter.name} clicked ${hex}; not shared`);
}
const rightHex = async (d, hex) => { const c = await d.hexClient(hex); await d.evaluate(`document.querySelector('.board canvas, canvas').dispatchEvent(new MouseEvent('contextmenu', { clientX: ${c.x}, clientY: ${c.y}, bubbles: true, cancelable: true, button: 2 }))`); await sleep(350); };
const wheel = (d, label) => d.evaluate(`(() => { const items = [...document.querySelectorAll('.aw-item')].map((b) => ({ b, t: b.querySelector('.aw-label')?.textContent.trim() ?? '' })); const hit = items.find((i) => i.t === ${JSON.stringify(label)}) ?? items.find((i) => i.t.startsWith(${JSON.stringify(label)})); if (!hit) return 'missing (' + items.map((i) => i.t).join(' | ') + ')'; if (hit.b.disabled) return 'disabled'; hit.b.click(); return 'ok'; })()`);
const emptyHex = (d) => d.evaluate(`(() => { const G = window.aslGame; const busy = new Set(Object.values(G.shown.pieces).map((p) => p.loc.hex).filter(Boolean)); for (const h of G.env.statics.map.hexes()) if (!busy.has(h.id)) return h.id; return null; })()`);
for (let i = 0; i < 6; i++) {
  await sleep(1200);
  const d = await mover();
  if (!(await d.evaluate(`['setup','offboardSetup'].includes(window.aslGame.decision?.kind)`))) break;
  const id = await d.evaluate('window.aslGame.decision.id');
  const h = await emptyHex(d);
  await rightHex(d, h);
  expect((await wheel(d, 'Auto-place the rest')) === 'ok', 'auto-place');
  await sleep(1500);
  await rightHex(d, h);
  const confirm = await wheel(d, 'Confirm');
  expect(confirm === 'ok', `confirm: ${confirm}`);
  await d.waitFor(`window.aslGame.decision?.id !== ${JSON.stringify(id)}`, 'setup confirmed');
}
console.log('setup done; phase', await alice.evaluate('window.aslGame.phase'));

// --- focus: the mover clicks a hex; the other board rings it.
const m = await mover();
const other = m === alice ? carol : alice;
const hexes = JSON.parse(await m.evaluate(`JSON.stringify([...window.aslGame.env.statics.map.hexes()].map((h) => h.id))`));
// An empty hex: nothing of the mover's to hide there.
const free = JSON.parse(await m.evaluate(`JSON.stringify(${JSON.stringify(hexes)}.find((h) => !Object.values(window.aslGame.state.pieces).some((p) => p.loc.kind === 'hex' && p.loc.hex === h)))`));
await clickHex(m, free);
await m.waitFor(`window.aslGame.selectedHex === ${JSON.stringify(free)}`, 'the click to select the hex', 5000);
const t0 = Date.now();
await other.waitFor(`window.aslGame.theirFocus === ${JSON.stringify(free)}`, `${m.name}'s selection on ${other.name}'s board`, 8000);
console.log(`focus: ${m.name} selected ${free}; ${other.name} saw it after ${Date.now() - t0} ms`);
await other.evaluate(`document.querySelector('.pw-overlay')?.click()`);
await sleep(600);
await other.shot('their-focus');

// --- timing: the mover acts every 3 s; the other board records when each position arrives.
await other.evaluate(`(() => { window.__arr = []; let last = window.aslGame.state.seq; setInterval(() => { const s = window.aslGame.state.seq; if (s !== last) { last = s; window.__arr.push(Math.round(performance.now())); } }, 20); })()`);
const sent = [];
for (let i = 0; i < 6; i++) {
  const d = await mover();
  const t = await d.evaluate('Math.round(performance.now())');
  const a = await actFirst(d, `(a) => a.type === 'fire' || a.type === 'endPhase'`);
  sent.push(`${d.name}:${a?.type}`);
  await sleep(3000);
}
const arr = JSON.parse(await other.evaluate('JSON.stringify(window.__arr)'));
console.log('actions:', sent.join(' '));
console.log('arrivals on', other.name, '(ms apart):', arr.map((t, i) => (i ? t - arr[i - 1] : 0)).join(' '));

// --- the end: alice concedes; carol's board stays (no "Match unavailable").
console.log('leave:', JSON.stringify(await alice.api('leaveMatch', { matchId })));
await sleep(3000);
const gate = await carol.evaluate(`document.querySelector('.gate h1')?.textContent ?? null`);
await carol.shot('after-concession');
expect(gate !== 'Match unavailable', `carol's board after the concession: ${gate}`);
console.log('after the concession carol sees:', gate ?? 'the board');
for (const d of devices) if (d.errors.length) { console.log(`${d.name} page errors:`, d.errors.slice(0, 5)); process.exitCode = 1; }
console.log('done');
process.exit();
