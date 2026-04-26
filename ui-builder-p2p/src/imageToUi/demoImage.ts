import { MOBILE_CANVAS_WIDTH_PX, SAFE_AREA_TOP_PX } from './constants';

/**
 * Synthetic “luxury hero” bitmap for offline slicing demos (no binary assets in repo).
 * 390×520 SVG rasterized by the browser in `sliceImageToUbPlan`.
 */
export const DEMO_IMAGE_DATA_URL =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${MOBILE_CANVAS_WIDTH_PX}" height="520" viewBox="0 0 ${MOBILE_CANVAS_WIDTH_PX} 520">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="55%" stop-color="#1e3a8a"/>
      <stop offset="100%" stop-color="#3f5be6"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <rect x="0" y="0" width="${MOBILE_CANVAS_WIDTH_PX}" height="${SAFE_AREA_TOP_PX}" fill="#020617" opacity="0.35"/>
  <text x="24" y="${SAFE_AREA_TOP_PX + 28}" fill="#f8fafc" font-family="system-ui,sans-serif" font-size="11" font-weight="800" letter-spacing="0.18em">SOUTHSTACK</text>
  <text x="24" y="${SAFE_AREA_TOP_PX + 86}" fill="#e2e8f0" font-family="system-ui,sans-serif" font-size="26" font-weight="800">Div-first canvas</text>
  <text x="24" y="${SAFE_AREA_TOP_PX + 118}" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="13">Section → Column → Row → Element</text>
  <rect x="24" y="${SAFE_AREA_TOP_PX + 148}" width="342" height="120" rx="20" fill="rgba(248,250,252,0.12)" stroke="rgba(248,250,252,0.25)"/>
  <rect x="44" y="${SAFE_AREA_TOP_PX + 300}" width="120" height="44" rx="32" fill="#f8fafc"/>
  <text x="104" y="${SAFE_AREA_TOP_PX + 328}" text-anchor="middle" fill="#1e3a8a" font-family="system-ui,sans-serif" font-size="13" font-weight="800">Ship</text>
</svg>`);
