// Lazy-loaded 62+ Thread Brand Charts loader (`web/public/threads/charts.json`)

import type { ThreadColor } from "../state/document";

export interface ThreadBrandChart {
  id: string;
  name: string;
  threads: ThreadColor[];
}

let cachedCharts: ThreadBrandChart[] | null = null;

export async function loadAllThreadCharts(): Promise<ThreadBrandChart[]> {
  if (cachedCharts) return cachedCharts;
  try {
    const res = await fetch("/threads/charts.json");
    if (res.ok) {
      const json = (await res.json()) as { charts: ThreadBrandChart[] };
      cachedCharts = json.charts;
      return cachedCharts;
    }
  } catch {
    // fallback handled by caller
  }
  return [];
}

/** Fast perceptual RGB-weighted distance for matching across any of the 62+ lazy-loaded charts. */
export function matchHexInChart(hex: string, threads: ThreadColor[]): ThreadColor | null {
  if (threads.length === 0) return null;
  const parse = (h: string) => {
    const s = h.replace("#", "");
    return [parseInt(s.slice(0, 2), 16) || 0, parseInt(s.slice(2, 4), 16) || 0, parseInt(s.slice(4, 6), 16) || 0];
  };
  const [r1, g1, b1] = parse(hex);
  let best = threads[0];
  let bestD = Infinity;
  for (const t of threads) {
    const [r2, g2, b2] = parse(t.hex);
    const rMean = (r1 + r2) * 0.5;
    const dr = r1 - r2;
    const dg = g1 - g2;
    const db = b1 - b2;
    const d = (2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db;
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}
