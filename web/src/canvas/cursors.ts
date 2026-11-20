// Crisp custom SVG cursors for precision vector feedback (+, -, ○, hollow arrow, rotate).

function svgCursor(svg: string, hotX = 2, hotY = 2): string {
  const encoded = encodeURIComponent(svg.trim());
  return `url("data:image/svg+xml,${encoded}") ${hotX} ${hotY}, crosshair`;
}

export const CURSORS = {
  select: "default",
  directSelect: svgCursor(
    `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
      <path d="M3 2 L3 15 L7 11.5 L10.5 17 L12.5 15.8 L9 10.2 L14 10.2 Z" fill="#FFFFFF" stroke="#111111" stroke-width="1.3" stroke-linejoin="round"/>
    </svg>`,
    3,
    2,
  ),
  pen: svgCursor(
    `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
      <path d="M2 2 L14 7 L10 10 L7 14 Z" fill="#FFFFFF" stroke="#111111" stroke-width="1.3" stroke-linejoin="round"/>
      <circle cx="8" cy="8" r="1.2" fill="#111111"/>
    </svg>`,
    2,
    2,
  ),
  penAdd: svgCursor(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
      <path d="M2 2 L14 7 L10 10 L7 14 Z" fill="#FFFFFF" stroke="#111111" stroke-width="1.3" stroke-linejoin="round"/>
      <path d="M17 13 V21 M13 17 H21" stroke="#0D99FF" stroke-width="2" stroke-linecap="round"/>
    </svg>`,
    2,
    2,
  ),
  penRemove: svgCursor(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
      <path d="M2 2 L14 7 L10 10 L7 14 Z" fill="#FFFFFF" stroke="#111111" stroke-width="1.3" stroke-linejoin="round"/>
      <path d="M13 17 H21" stroke="#EF4444" stroke-width="2" stroke-linecap="round"/>
    </svg>`,
    2,
    2,
  ),
  penClose: svgCursor(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
      <path d="M2 2 L14 7 L10 10 L7 14 Z" fill="#FFFFFF" stroke="#111111" stroke-width="1.3" stroke-linejoin="round"/>
      <circle cx="17" cy="17" r="3.5" fill="none" stroke="#0D99FF" stroke-width="1.8"/>
    </svg>`,
    2,
    2,
  ),
  rotate: svgCursor(
    `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
      <path d="M6 12 A6 6 0 0 1 15 6" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round"/>
      <path d="M6 12 A6 6 0 0 1 15 6" fill="none" stroke="#111111" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M13 3.5 L16.5 6 L13.5 8.8" fill="none" stroke="#111111" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
    11,
    11,
  ),
  knife: svgCursor(
    `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
      <path d="M3 19 L14 4 L18 7 L9 19 Z" fill="#FFFFFF" stroke="#111111" stroke-width="1.3" stroke-linejoin="round"/>
    </svg>`,
    3,
    19,
  ),
  eyedropper: svgCursor(
    `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
      <path d="M3 19 L6 13 L13 6 L16 9 L9 16 Z" fill="#FFFFFF" stroke="#111111" stroke-width="1.3" stroke-linejoin="round"/>
      <path d="M12 5 L17 10" stroke="#0D99FF" stroke-width="2" stroke-linecap="round"/>
    </svg>`,
    3,
    19,
  ),
  crosshair: "crosshair",
  grab: "grab",
  grabbing: "grabbing",
} as const;
