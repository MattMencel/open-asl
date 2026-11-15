import { useEffect, useRef } from 'react';
import { buildMap } from '@asl/content';
import { GEO, hexPixel, objectiveAreas, type ScenarioDef } from '@asl/rules';
import { drawPlacementArt, playableBounds, type CropPlacement } from '../board/crop';
import { boardImage } from '../game/assets';

/** Side colours as the stylesheet has them (canvas cannot read CSS variables). */
const SIDE_COLOR: Record<string, string> = { ge: '#86acd0', ru: '#d0a24e', am: '#9cbb4e', br: '#d9c38a', al: '#8fb36a', it: '#aab4ba' };
const OBJECTIVE = '#e8322b';
const BRASS = '#c9a24a';

type Placement = CropPlacement;

/** The hex outline the board view draws (flat-sided, as printed). */
function hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  const rx = GEO.px.hexWidth * (2 / 3);
  const ry = GEO.px.hexHeight / 2;
  const pts = [cx - rx, cy, cx - rx / 2, cy - ry, cx + rx / 2, cy - ry, cx + rx, cy, cx + rx / 2, cy + ry, cx - rx / 2, cy + ry];
  ctx.beginPath();
  ctx.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
  ctx.closePath();
}

/** The corners of the hex outline `hexPath` draws, in order. */
function hexCorners(cx: number, cy: number): [number, number][] {
  const rx = GEO.px.hexWidth * (2 / 3);
  const ry = GEO.px.hexHeight / 2;
  return [
    [cx - rx, cy],
    [cx - rx / 2, cy - ry],
    [cx + rx / 2, cy - ry],
    [cx + rx, cy],
    [cx + rx / 2, cy + ry],
    [cx - rx / 2, cy + ry],
  ];
}

/**
 * The border of an area of hexes: the hex sides that belong to only one of its hexes. A wash alone
 * can vanish on art of the same colour (a green area on a green board reads as reaching one hexrow
 * further than it does), so every area also gets its outline.
 */
function areaBorder(centres: { x: number; y: number }[]): [number, number, number, number][] {
  const sides = new Map<string, { seg: [number, number, number, number]; n: number }>();
  for (const c of centres) {
    const pts = hexCorners(c.x, c.y);
    for (let i = 0; i < 6; i++) {
      const [ax, ay] = pts[i]!;
      const [bx, by] = pts[(i + 1) % 6]!;
      const key = `${Math.round((ax + bx) / 2)},${Math.round((ay + by) / 2)}`;
      const s = sides.get(key);
      if (s) s.n++;
      else sides.set(key, { seg: [ax, ay, bx, by], n: 1 });
    }
  }
  return [...sides.values()].filter((s) => s.n === 1).map((s) => s.seg);
}

const load = (url: string) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });

/**
 * A small picture of the scenario's map as it will be played: the boards' playable parts,
 * turned so the card's north is up, with each side's setup area washed in its colour, its
 * entry edges outlined, and the victory objectives in red.
 */
export function MapPreview({ scenario: sc, width = 440, height = 420, onSize }: { scenario: ScenarioDef; width?: number; height?: number; onSize?(width: number, height: number): void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    const placements: Placement[] = sc.boards.map((b) => {
      const [x, y] = b.position.split(',').map(Number) as [number, number];
      return { board: b.board, x, y, ...(b.columns ? { columns: b.columns } : {}), ...(b.rows ? { rows: b.rows } : {}), ...(b.rotation ? { rotation: b.rotation } : {}) };
    });
    const map = buildMap(placements, { los: 'grid', ...(sc.compass ? { compass: sc.compass } : {}) });
    // Map pixel bounds of the playable parts.
    const { x0, x1, y0, y1 } = playableBounds(placements);
    const mapW = x1 - x0;
    const mapH = y1 - y0;
    const rot = { N: 0, E: 270, S: 180, W: 90 }[sc.compass?.N ?? 'N'];
    const swap = rot === 90 || rot === 270;
    const outW = swap ? mapH : mapW;
    const outH = swap ? mapW : mapH;
    // Fit the box either way round: a portrait map is limited by the height.
    const scale = Math.min(width / outW, height / outH);
    const el = canvas.current!;
    el.width = Math.round(outW * scale);
    el.height = Math.round(outH * scale);
    onSize?.(el.width, el.height);
    const ctx = el.getContext('2d')!;

    (async () => {
      const images = await Promise.all(placements.map((p) => (boardImage(p.board) ? load(boardImage(p.board)!) : Promise.resolve(null))));
      if (!live) return;
      ctx.save();
      ctx.scale(scale, scale);
      // Turn the whole map so the card's north is up, then shift its playable bounds to 0,0.
      ctx.translate(outW / 2, outH / 2);
      ctx.rotate((rot * Math.PI) / 180);
      ctx.translate(-mapW / 2 - x0, -mapH / 2 - y0);
      ctx.fillStyle = '#1a1f1a';
      ctx.fillRect(x0, y0, mapW, mapH);
      placements.forEach((p, i) => {
        const img = images[i];
        if (!img) return;
        drawPlacementArt(ctx, img, p);
      });
      const at = (id: string) => {
        const h = map.hex(id);
        return h ? hexPixel(h.cube) : null;
      };
      // Setup areas: a wash in the side's colour; entry edges: the edge hexes outlined.
      for (const f of sc.forces) {
        const color = SIDE_COLOR[f.side] ?? '#ffffff';
        // Scattered forces have no setup area until their rendezvous hexes are picked.
        if (f.setup.kind === 'scatter') continue;
        if (f.setup.kind === 'enter') {
          const hexes = f.setup.hexes?.length ? f.setup.hexes : map.edge(f.setup.edge);
          ctx.strokeStyle = color;
          ctx.lineWidth = 6;
          ctx.globalAlpha = 0.9;
          for (const id of hexes) {
            const c = at(id);
            if (!c) continue;
            hexPath(ctx, c.x, c.y);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
          continue;
        }
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.38;
        const centres: { x: number; y: number }[] = [];
        for (const id of f.setup.hexes) {
          const c = at(id);
          if (!c) continue;
          centres.push(c);
          hexPath(ctx, c.x, c.y);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        // The area's edge: a dark line under a line in the side's colour, clear on any art.
        const border = areaBorder(centres);
        for (const [w, stroke] of [
          [12, 'rgba(0,0,0,0.55)'],
          [6, color],
        ] as const) {
          ctx.lineWidth = w;
          ctx.strokeStyle = stroke;
          ctx.lineCap = 'round';
          ctx.beginPath();
          for (const [ax, ay, bx, by] of border) {
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
          }
          ctx.stroke();
        }
      }
      // Objectives.
      for (const area of objectiveAreas(sc, map)) {
        for (const id of area.hexes) {
          const c = at(id);
          if (!c) continue;
          hexPath(ctx, c.x, c.y);
          ctx.fillStyle = OBJECTIVE;
          ctx.globalAlpha = 0.35;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.strokeStyle = OBJECTIVE;
          ctx.lineWidth = 4;
          ctx.stroke();
        }
      }
      ctx.restore();
      // North arrow, top right, in screen space.
      ctx.save();
      ctx.translate(el.width - 18, 20);
      ctx.fillStyle = BRASS;
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.lineTo(6, 8);
      ctx.lineTo(0, 4);
      ctx.lineTo(-6, 8);
      ctx.closePath();
      ctx.fill();
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('N', 0, 20);
      ctx.restore();
    })();
    return () => {
      live = false;
    };
  }, [sc, width, height, onSize]);
  return <canvas ref={canvas} className="map-preview" aria-label="Map preview" />;
}
