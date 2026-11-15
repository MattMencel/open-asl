import { WIND_NAME, weatherLabel, type AslWindForce, type Sky, type Weather } from '@asl/rules';

/** The full ASL wind and EC as the chip shows them (ASLRB B25.5, B25.63–B25.651). */
export interface AslWindView {
  force: AslWindForce;
  /** The hexside the wind blows toward (ASLRB B.8 numbering as `sideToward` gives it), once a wind has blown. */
  dir?: number;
  gusts: boolean;
  gustDir?: number;
  ec: { name: string; drm: number } | null;
}

interface Props {
  weather: Weather;
  /** Where the wind blows to, in screen degrees clockwise from up (see `windScreenAngle`). */
  windAngle: number;
  aslWind?: AslWindView | null;
}

/** The Spreading Fire DRM ring round a Blaze for the wind blowing toward hexside `dir` (B25.64): downwind +2, beside it +1, beside upwind 0, upwind -1. */
function windRing(dir: number): string {
  const off = (k: number) => Math.min(((k - dir) % 6 + 6) % 6, ((dir - k) % 6 + 6) % 6);
  const names = ['SE', 'S', 'SW', 'NW', 'N', 'NE'];
  return [0, 1, 2, 3, 4, 5].map((k) => `${names[k]} ${[2, 1, 0, -1][off(k)]! >= 0 ? '+' : ''}${[2, 1, 0, -1][off(k)]}`).join(' · ');
}

/** The sky and ground part of the weather label (the Starter Kit's compass wind is replaced by the full ASL wind). */
const SKY_NAME_OF = (w: Weather) => weatherLabel(w).split(' · ').slice(0, w.ground !== 'normal' ? 2 : 1).join(' · ');

/** Small line icons, one per sky condition, drawn in the HUD's brass. */
function SkyIcon({ sky }: { sky: Sky }) {
  const cloud = <path d="M7 15.5h8.5a3 3 0 0 0 .4-6 4.5 4.5 0 0 0-8.6-1.2A3.6 3.6 0 0 0 7 15.5z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />;
  switch (sky) {
    case 'clear':
      return (
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <circle cx="10" cy="10" r="3.6" fill="currentColor" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <line key={a} x1="10" y1="2.2" x2="10" y2="4.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" transform={`rotate(${a} 10 10)`} />
          ))}
        </svg>
      );
    case 'overcast':
      return (
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          {cloud}
        </svg>
      );
    case 'rain':
      return (
        <svg viewBox="0 0 20 22" width="18" height="20" aria-hidden="true">
          <g transform="translate(0 -2)">{cloud}</g>
          {[6.5, 10, 13.5].map((x) => (
            <line key={x} x1={x} y1="16" x2={x - 1.2} y2="20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          ))}
        </svg>
      );
    case 'fallingSnow':
      return (
        <svg viewBox="0 0 20 22" width="18" height="20" aria-hidden="true">
          <g transform="translate(0 -2)">{cloud}</g>
          {[6, 10, 14].map((x, i) => (
            <circle key={x} cx={x} cy={i === 1 ? 20 : 17.5} r="1.1" fill="currentColor" />
          ))}
        </svg>
      );
    case 'fog':
    case 'mist':
      return (
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          {[5, 8.5, 12, 15.5].map((y, i) => (
            <line key={y} x1={i % 2 ? 5 : 3} y1={y} x2={i % 2 ? 17 : 15} y2={y} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity={sky === 'mist' ? 0.7 : 1} />
          ))}
        </svg>
      );
  }
}

/** The weather in play: the sky's icon, the ground when it matters, and an arrow the wind blows along. */
export function WeatherChip({ weather, windAngle, aslWind }: Props) {
  const dir = aslWind ? (aslWind.force !== 'none' ? aslWind.dir : aslWind.gustDir) : undefined;
  // Full ASL: the wind blows toward a hexside of the hex grid (B25.64), with Gusts for the Player Turn (B25.651) and the EC (B25.5).
  const aslLabel = aslWind
    ? [
        `${WIND_NAME[aslWind.force]}${dir !== undefined ? ` toward the ${['south-east', 'south', 'south-west', 'north-west', 'north', 'north-east'][dir]} hexside` : ''}`,
        ...(aslWind.gusts ? ['Gusts this Player Turn: every Blaze spreads downwind, one of them two hexes (ASLRB B25.651)'] : []),
        ...(aslWind.ec ? [`EC ${aslWind.ec.name} (${aslWind.ec.drm >= 0 ? '+' : ''}${aslWind.ec.drm} to Kindling and Spreading Fire DRs, not into a building)`] : []),
        ...(aslWind.force === 'breeze' && dir !== undefined ? [`Spreading Fire DRM by hexside: ${windRing(dir)}`] : []),
        ...(aslWind.force === 'heavy' ? ['Heavy Winds: no Smoke; a Blaze spreads outright into its three downwind hexes and never upwind (B25.63)'] : []),
      ].join('\n')
    : null;
  const label = aslLabel ? `${SKY_NAME_OF(weather)} · ${aslLabel}` : weatherLabel(weather);
  const calm = aslWind ? aslWind.force === 'none' && !aslWind.gusts : weather.wind.force === 'calm';
  const force = aslWind ? (aslWind.gusts ? 'gusts' : aslWind.force === 'none' ? 'calm' : aslWind.force) : weather.wind.force;
  return (
    <div className={`weather-chip sky-${weather.sky}`} title={`Weather: ${label}`} aria-label={`Weather: ${label}`}>
      <span className="lbl muted small">WX</span>
      <span className="sky">
        <SkyIcon sky={weather.sky} />
      </span>
      {weather.ground !== 'normal' && <span className={`ground ground-${weather.ground}`}>{weather.ground}</span>}
      {aslWind && aslWind.force !== 'none' && <span className="ground wind-word">{aslWind.force === 'breeze' ? 'Breeze' : 'Heavy'}</span>}
      {aslWind?.gusts && <span className="ground gusts">Gusts</span>}
      {aslWind?.ec && <span className="ground ec" title={`Environmental Conditions: ${aslWind.ec.name}`}>EC {aslWind.ec.drm >= 0 ? '+' : ''}{aslWind.ec.drm}</span>}
      <span className={`wind ${calm ? 'calm' : `force-${force}`}`} style={{ transform: `rotate(${windAngle}deg)` }}>
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
          {calm ? (
            <circle cx="10" cy="10" r="2.2" fill="currentColor" opacity="0.5" />
          ) : (
            <>
              <line x1="10" y1="17" x2="10" y2="5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <polyline points="5.5,9.5 10,4 14.5,9.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </>
          )}
        </svg>
      </span>
    </div>
  );
}
