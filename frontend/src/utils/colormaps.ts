/**
 * 科学的可視化用カラーマップ（Viridis / RdBu）。
 * - 速度比 |V|/V_inf: Viridis（知覚的均一性・色覚多様性対応）
 * - 圧力係数 Cp: RdBu 発散型（Cp=0 を白、負圧 Cp<0 を青、正圧 Cp>0 を赤）
 */

export type RGB = [number, number, number];

const VIRIDIS_STOPS: readonly RGB[] = [
  [68, 1, 84],
  [72, 40, 120],
  [62, 74, 137],
  [49, 104, 142],
  [38, 130, 142],
  [31, 158, 137],
  [53, 183, 121],
  [109, 205, 89],
  [180, 222, 44],
  [253, 231, 37],
];

// 青（負圧: 0.0）→ 白（Cp=0: 0.5）→ 赤（正圧: 1.0）
const RDBU_STOPS: readonly RGB[] = [
  [5, 48, 97],
  [33, 102, 172],
  [67, 147, 195],
  [146, 197, 222],
  [247, 247, 247],
  [244, 165, 130],
  [214, 96, 77],
  [178, 24, 43],
  [103, 0, 31],
];

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function interpolateStops(t: number, stops: readonly RGB[]): RGB {
  const clamped = clamp01(t);
  const scaled = clamped * (stops.length - 1);
  const idx = Math.min(stops.length - 2, Math.floor(scaled));
  const frac = scaled - idx;
  const c0 = stops[idx];
  const c1 = stops[idx + 1];
  return [
    Math.round(c0[0] + (c1[0] - c0[0]) * frac),
    Math.round(c0[1] + (c1[1] - c0[1]) * frac),
    Math.round(c0[2] + (c1[2] - c0[2]) * frac),
  ];
}

/** Viridis カラーマップ（t in [0, 1]）。 */
export function sampleViridis(t: number): RGB {
  return interpolateStops(t, VIRIDIS_STOPS);
}

/** RdBu 発散カラーマップ（t=0: 青/負圧, t=0.5: 白/0, t=1: 赤/正圧）。 */
export function sampleRdBu(t: number): RGB {
  return interpolateStops(t, RDBU_STOPS);
}

/** 速度比 |V|/V_inf を Viridis RGB に変換する。 */
export function mapSpeedRatioToRgb(speedRatio: number, minVal = 0.0, maxVal = 1.8): RGB {
  const denom = Math.max(1e-6, maxVal - minVal);
  const t = (speedRatio - minVal) / denom;
  return sampleViridis(t);
}

/** 圧力係数 Cp を RdBu RGB に変換する（Cp=0 が必ず白になる区分線形マッピング）。 */
export function mapCpToRgb(cp: number, minCp = -2.0, maxCp = 1.0): RGB {
  let t: number;
  if (cp <= 0) {
    const negSpan = Math.max(1e-6, -minCp);
    t = 0.5 * (1 + cp / negSpan);
  } else {
    const posSpan = Math.max(1e-6, maxCp);
    t = 0.5 + 0.5 * (cp / posSpan);
  }
  return sampleRdBu(t);
}

/** カラーバー表示用の CSS linear-gradient 文字列を生成する。 */
export function buildCssGradient(kind: 'speed' | 'cp'): string {
  const stops = kind === 'speed' ? VIRIDIS_STOPS : RDBU_STOPS;
  const parts = stops.map((rgb, i) => {
    const pct = Math.round((i / (stops.length - 1)) * 100);
    return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]}) ${pct}%`;
  });
  return `linear-gradient(to right, ${parts.join(', ')})`;
}
