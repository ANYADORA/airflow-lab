/**
 * 翼型幾何生成・カスタム DAT/CSV パーサ・3次スプライン再パネル化・空間幾何判定モジュール。
 *
 * Python 版 `backend/app/geometry/` (`naca4.py`, `paneling.py`, `airfoil_io.py`) および
 * `backend/app/models/airfoil.py` のアルゴリズムと定数を 1:1 で TypeScript へ移植している。
 */

import { ApiClientError } from '../services/apiClientError';
import type {
  AirfoilGeometryResult,
  AirfoilPresetItem,
  AirfoilSourceType,
  WarningItem,
} from '../types/api';

export const MIN_NUM_PANELS = 40;
export const MAX_NUM_PANELS = 300;
export const DEFAULT_NUM_PANELS = 160;

const MIN_RAW_POINTS = 12;
const DUPLICATE_POINT_TOL = 1e-9;
const NORMALIZATION_WARN_TOL = 1e-4;
const OPEN_TE_GAP_TOL = 1e-5;

export type PanelSide = 'lower' | 'upper';

export interface AirfoilMesh {
  x: Float64Array;
  y: Float64Array;
  xC: Float64Array;
  yC: Float64Array;
  dx: Float64Array;
  dy: Float64Array;
  s: Float64Array;
  phi: Float64Array;
  tx: Float64Array;
  ty: Float64Array;
  nx: Float64Array;
  ny: Float64Array;
  side: PanelSide[];
  teGap: number;
  maxThicknessRatio: number;
  maxCamberRatio: number;
  maxCamberPos: number;
  isSymmetric: boolean;
  isClosedTe: boolean;
  warnings: WarningItem[];
  name: string;
}

export interface StandardPresetSpec {
  id: string;
  name: string;
  naca_code: string;
  is_symmetric: boolean;
  max_thickness_ratio: number;
  max_camber_ratio: number;
  max_camber_pos: number;
  description: string;
}

export const STANDARD_AIRFOIL_PRESETS: readonly StandardPresetSpec[] = [
  {
    id: 'naca0012',
    name: 'NACA 0012',
    naca_code: '0012',
    is_symmetric: true,
    max_thickness_ratio: 0.12,
    max_camber_ratio: 0.0,
    max_camber_pos: 0.0,
    description:
      '代表的な対称翼型（厚さ12%）。迎角0°で揚力0となり、対称性の学習に最適。',
  },
  {
    id: 'naca2412',
    name: 'NACA 2412',
    naca_code: '2412',
    is_symmetric: false,
    max_thickness_ratio: 0.12,
    max_camber_ratio: 0.02,
    max_camber_pos: 0.4,
    description:
      '軽航空機で広く使われる標準キャンバー翼（最大反り2%、位置40%、厚さ12%）。',
  },
  {
    id: 'naca4412',
    name: 'NACA 4412',
    naca_code: '4412',
    is_symmetric: false,
    max_thickness_ratio: 0.12,
    max_camber_ratio: 0.04,
    max_camber_pos: 0.4,
    description:
      '中程度のキャンバーを持つ実用翼型（最大反り4%、位置40%、厚さ12%）。迎角0°でも明確な正揚力を発生。',
  },
  {
    id: 'naca6412',
    name: 'NACA 6412',
    naca_code: '6412',
    is_symmetric: false,
    max_thickness_ratio: 0.12,
    max_camber_ratio: 0.06,
    max_camber_pos: 0.4,
    description:
      '強いキャンバーを持つ高揚力翼型（最大反り6%、位置40%、厚さ12%）。キャンバー効果の比較に最適。',
  },
];

function cleanZero(val: number): number {
  return val === 0 ? 0 : val;
}

export function roundDecimals(val: number, decimals: number): number {
  const factor = 10 ** decimals;
  const rounded = Math.round(val * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

function geometryError(
  message: string,
  code = 'INVALID_AIRFOIL_GEOMETRY',
  details: Record<string, unknown> | null = null
): ApiClientError {
  return new ApiClientError(message, 422, code, details);
}

export function validateNumPanels(numPanels: number): number {
  if (!Number.isInteger(numPanels)) {
    throw geometryError('num_panels は整数で指定してください。', 'INVALID_NUM_PANELS', {
      num_panels: numPanels,
    });
  }
  if (numPanels < MIN_NUM_PANELS || numPanels > MAX_NUM_PANELS || numPanels % 2 !== 0) {
    throw geometryError(
      `num_panels は ${MIN_NUM_PANELS} 以上 ${MAX_NUM_PANELS} 以下の偶数で指定してください。`,
      'INVALID_NUM_PANELS',
      { num_panels: numPanels }
    );
  }
  return numPanels;
}

export function generateCosineXi(numPanels = DEFAULT_NUM_PANELS): Float64Array {
  validateNumPanels(numPanels);
  const nHalf = numPanels / 2;
  const xi = new Float64Array(nHalf + 1);
  for (let k = 0; k <= nHalf; k++) {
    const beta = (Math.PI * k) / nHalf;
    xi[k] = 0.5 * (1.0 - Math.cos(beta));
  }
  xi[0] = 0.0;
  xi[nHalf] = 1.0;
  return xi;
}

export function computeSignedArea(x: Float64Array, y: Float64Array): number {
  const n = x.length;
  if (n < 3) return 0.0;
  let area2 = 0.0;
  for (let i = 0; i < n - 1; i++) {
    area2 += x[i] * y[i + 1] - x[i + 1] * y[i];
  }
  if (x[0] !== x[n - 1] || y[0] !== y[n - 1]) {
    area2 += x[n - 1] * y[0] - x[0] * y[n - 1];
  }
  return 0.5 * area2;
}

export function buildAirfoilMesh(
  xIn: ArrayLike<number>,
  yIn: ArrayLike<number>,
  options: {
    name?: string;
    maxThicknessRatio?: number;
    maxCamberRatio?: number;
    maxCamberPos?: number;
    isSymmetric?: boolean;
    isClosedTe?: boolean;
    side?: PanelSide[];
    warnings?: WarningItem[];
    validateNonDegenerate?: boolean;
  } = {}
): AirfoilMesh {
  const {
    name = 'Airfoil',
    maxThicknessRatio = 0.0,
    maxCamberRatio = 0.0,
    maxCamberPos = 0.0,
    isSymmetric = false,
    isClosedTe = true,
    side,
    warnings = [],
    validateNonDegenerate = true,
  } = options;

  const nNodes = xIn.length;
  if (nNodes !== yIn.length) {
    throw geometryError('節点座標 x, y は同じ長さの配列である必要があります。');
  }
  if (nNodes < 3) {
    throw geometryError('パネルメッシュの構築には最低3個以上の節点が必要です。');
  }

  const x = new Float64Array(nNodes);
  const y = new Float64Array(nNodes);
  for (let i = 0; i < nNodes; i++) {
    const xv = xIn[i];
    const yv = yIn[i];
    if (validateNonDegenerate && (!Number.isFinite(xv) || !Number.isFinite(yv))) {
      throw geometryError('節点座標に NaN または Inf が含まれています。');
    }
    x[i] = cleanZero(xv);
    y[i] = cleanZero(yv);
  }

  const nPanels = nNodes - 1;
  const dx = new Float64Array(nPanels);
  const dy = new Float64Array(nPanels);
  const s = new Float64Array(nPanels);
  const phi = new Float64Array(nPanels);
  const tx = new Float64Array(nPanels);
  const ty = new Float64Array(nPanels);
  const nx = new Float64Array(nPanels);
  const ny = new Float64Array(nPanels);
  const xC = new Float64Array(nPanels);
  const yC = new Float64Array(nPanels);

  for (let i = 0; i < nPanels; i++) {
    const dxi = cleanZero(x[i + 1] - x[i]);
    const dyi = cleanZero(y[i + 1] - y[i]);
    const si = Math.hypot(dxi, dyi);
    if (validateNonDegenerate && si <= 1e-13) {
      throw geometryError('長さゼロ（重複節点）の退化パネルが含まれています。');
    }
    const phii = Math.atan2(dyi, dxi);
    const txi = Math.cos(phii);
    const tyi = Math.sin(phii);

    dx[i] = dxi;
    dy[i] = dyi;
    s[i] = si;
    phi[i] = phii;
    tx[i] = txi;
    ty[i] = tyi;
    nx[i] = -tyi;
    ny[i] = txi;
    xC[i] = cleanZero(0.5 * (x[i] + x[i + 1]));
    yC[i] = cleanZero(0.5 * (y[i] + y[i + 1]));
  }

  let panelSide: PanelSide[];
  if (side) {
    if (side.length !== nPanels) {
      throw geometryError('side リストの長さがパネル数と一致しません。');
    }
    panelSide = [...side];
  } else {
    const nHalf = Math.floor(nPanels / 2);
    panelSide = Array.from({ length: nPanels }, (_, idx) =>
      idx < nHalf ? 'lower' : 'upper'
    );
  }

  let teGap = Math.hypot(x[nNodes - 1] - x[0], y[nNodes - 1] - y[0]);
  if (isClosedTe && teGap < 1e-14) {
    teGap = 0.0;
  }

  if (validateNonDegenerate) {
    const signedArea = computeSignedArea(x, y);
    if (signedArea >= -1e-10) {
      throw geometryError(
        'パネル節点列が時計回り閉曲線をなしていないか、面積が退化しています。'
      );
    }
  }

  return {
    x,
    y,
    xC,
    yC,
    dx,
    dy,
    s,
    phi,
    tx,
    ty,
    nx,
    ny,
    side: panelSide,
    teGap,
    maxThicknessRatio,
    maxCamberRatio,
    maxCamberPos,
    isSymmetric,
    isClosedTe,
    warnings: [...warnings],
    name,
  };
}

export function meshToGeometryResult(mesh: AirfoilMesh): AirfoilGeometryResult {
  return {
    name: mesh.name,
    x: Array.from(mesh.x),
    y: Array.from(mesh.y),
    num_panels: mesh.s.length,
    max_thickness_ratio: mesh.maxThicknessRatio,
    max_camber_ratio: mesh.maxCamberRatio,
    max_camber_pos: mesh.maxCamberPos,
    is_symmetric: mesh.isSymmetric,
    is_closed_te: mesh.isClosedTe,
  };
}

export function parseNaca4Code(nacaCode: string): { m: number; p: number; t: number } {
  if (typeof nacaCode !== 'string' || !/^\d{4}$/.test(nacaCode)) {
    throw geometryError(
      `NACA 4桁コード '${nacaCode}' が不正です。4桁の半角数字で指定してください。`,
      'INVALID_AIRFOIL_GEOMETRY',
      { naca_code: nacaCode }
    );
  }

  const mDigit = Number(nacaCode[0]);
  const pDigit = Number(nacaCode[1]);
  const tDigits = Number(nacaCode.slice(2, 4));

  if (tDigits < 1 || tDigits > 40) {
    throw geometryError(
      `NACA コード '${nacaCode}' の翼厚比 XX=${String(tDigits).padStart(2, '0')} は許容範囲（01〜40%）外です。`,
      'INVALID_AIRFOIL_GEOMETRY',
      { naca_code: nacaCode, thickness_percent: tDigits }
    );
  }

  if (mDigit === 0 && pDigit !== 0) {
    throw geometryError(
      `対称翼（M=0）では最大キャンバー位置 P も 0 でなければなりません（入力: '${nacaCode}'）。`,
      'INVALID_AIRFOIL_GEOMETRY',
      { naca_code: nacaCode }
    );
  }

  if (mDigit !== 0 && (pDigit < 1 || pDigit > 9)) {
    throw geometryError(
      `キャンバー翼（M>0）では最大キャンバー位置 P は 1〜9 で指定してください（入力: '${nacaCode}'）。`,
      'INVALID_AIRFOIL_GEOMETRY',
      { naca_code: nacaCode }
    );
  }

  return {
    m: mDigit / 100.0,
    p: pDigit / 10.0,
    t: tDigits / 100.0,
  };
}

export function generateNaca4(
  nacaCode: string,
  numPanels = DEFAULT_NUM_PANELS,
  closedTe = true,
  name: string | null = null
): AirfoilMesh {
  const { m, p, t } = parseNaca4Code(nacaCode);
  validateNumPanels(numPanels);

  const xi = generateCosineXi(numPanels);
  const nHalf = numPanels / 2;
  const a4 = closedTe ? -0.1036 : -0.1015;

  const yt = new Float64Array(nHalf + 1);
  for (let k = 0; k <= nHalf; k++) {
    const xik = xi[k];
    if (xik === 0.0 || (closedTe && xik === 1.0)) {
      yt[k] = 0.0;
    } else {
      yt[k] =
        5.0 *
        t *
        (0.2969 * Math.sqrt(Math.max(xik, 0.0)) -
          0.126 * xik -
          0.3516 * xik * xik +
          0.2843 * xik * xik * xik +
          a4 * xik * xik * xik * xik);
    }
  }

  const xU = new Float64Array(nHalf + 1);
  const yU = new Float64Array(nHalf + 1);
  const xL = new Float64Array(nHalf + 1);
  const yL = new Float64Array(nHalf + 1);

  if (m === 0.0) {
    for (let k = 0; k <= nHalf; k++) {
      xU[k] = xi[k];
      yU[k] = yt[k];
      xL[k] = xi[k];
      yL[k] = -yt[k];
    }
  } else {
    for (let k = 0; k <= nHalf; k++) {
      const xik = xi[k];
      const yc =
        xik === 0.0 || xik === 1.0
          ? 0.0
          : xik < p
            ? (m / (p * p)) * (2.0 * p * xik - xik * xik)
            : (m / ((1.0 - p) * (1.0 - p))) * (1.0 - 2.0 * p + 2.0 * p * xik - xik * xik);
      const dycDxi =
        xik < p
          ? ((2.0 * m) / (p * p)) * (p - xik)
          : ((2.0 * m) / ((1.0 - p) * (1.0 - p))) * (p - xik);

      const theta = Math.atan(dycDxi);
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);

      xU[k] = xik - yt[k] * sinT;
      yU[k] = yc + yt[k] * cosT;
      xL[k] = xik + yt[k] * sinT;
      yL[k] = yc - yt[k] * cosT;
    }
    xU[0] = 0.0;
    yU[0] = 0.0;
    xL[0] = 0.0;
    yL[0] = 0.0;
    if (closedTe) {
      xU[nHalf] = 1.0;
      yU[nHalf] = 0.0;
      xL[nHalf] = 1.0;
      yL[nHalf] = 0.0;
    }
  }

  // 時計回り連結：下面後縁 (nHalf) -> 前縁 (0) -> 上面後縁 (nHalf)
  const xNodes = new Float64Array(numPanels + 1);
  const yNodes = new Float64Array(numPanels + 1);
  let pos = 0;
  for (let k = nHalf; k >= 1; k--) {
    xNodes[pos] = xL[k];
    yNodes[pos] = yL[k];
    pos++;
  }
  xNodes[pos] = 0.0;
  yNodes[pos] = 0.0;
  pos++;
  for (let k = 1; k <= nHalf; k++) {
    xNodes[pos] = xU[k];
    yNodes[pos] = yU[k];
    pos++;
  }

  const side: PanelSide[] = Array.from({ length: numPanels }, (_, idx) =>
    idx < nHalf ? 'lower' : 'upper'
  );
  const displayName = name && name.trim() ? name.trim() : `NACA ${nacaCode}`;

  return buildAirfoilMesh(xNodes, yNodes, {
    name: displayName,
    maxThicknessRatio: t,
    maxCamberRatio: m,
    maxCamberPos: m > 0.0 ? p : 0.0,
    isSymmetric: m === 0.0,
    isClosedTe: closedTe,
    side,
    warnings: [],
  });
}

export function buildPresetPreviewItems(): AirfoilPresetItem[] {
  return STANDARD_AIRFOIL_PRESETS.map((spec) => {
    const previewMesh = generateNaca4(spec.naca_code, 80, true);
    const px = Array.from(previewMesh.x, (v) => roundDecimals(v, 6));
    const py = Array.from(previewMesh.y, (v) => roundDecimals(v, 6));
    return {
      id: spec.id,
      name: spec.name,
      naca_code: spec.naca_code,
      is_symmetric: spec.is_symmetric,
      max_thickness_ratio: spec.max_thickness_ratio,
      max_camber_ratio: spec.max_camber_ratio,
      max_camber_pos: spec.max_camber_pos,
      description: spec.description,
      preview_coords: { x: px, y: py },
    };
  });
}

export function hasNonAdjacentSelfIntersection(
  polyX: ArrayLike<number>,
  polyY: ArrayLike<number>,
  treatEndpointsConnected = true
): boolean {
  const nSeg = polyX.length - 1;
  if (nSeg < 4) return false;

  const eps = 1e-12;
  for (let i = 0; i < nSeg - 2; i++) {
    const jEnd = i === 0 && treatEndpointsConnected ? nSeg - 1 : nSeg;
    if (i + 2 >= jEnd) continue;

    const ax = polyX[i];
    const ay = polyY[i];
    const bx = polyX[i + 1];
    const by = polyY[i + 1];
    const abx = bx - ax;
    const aby = by - ay;
    const minXi = Math.min(ax, bx);
    const maxXi = Math.max(ax, bx);
    const minYi = Math.min(ay, by);
    const maxYi = Math.max(ay, by);

    for (let j = i + 2; j < jEnd; j++) {
      const cx = polyX[j];
      const cy = polyY[j];
      const dxSeg = polyX[j + 1];
      const dySeg = polyY[j + 1];

      const minXj = Math.min(cx, dxSeg);
      const maxXj = Math.max(cx, dxSeg);
      const minYj = Math.min(cy, dySeg);
      const maxYj = Math.max(cy, dySeg);

      if (
        maxXi < minXj - eps ||
        maxXj < minXi - eps ||
        maxYi < minYj - eps ||
        maxYj < minYi - eps
      ) {
        continue;
      }

      const cdx = dxSeg - cx;
      const cdy = dySeg - cy;
      const d1 = abx * (cy - ay) - aby * (cx - ax);
      const d2 = abx * (dySeg - ay) - aby * (dxSeg - ax);
      const d3 = cdx * (ay - cy) - cdy * (ax - cx);
      const d4 = cdx * (by - cy) - cdy * (bx - cx);

      if (
        ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
        ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
      ) {
        return true;
      }

      if (
        Math.abs(d1) <= eps &&
        Math.abs(d2) <= eps &&
        Math.abs(d3) <= eps &&
        Math.abs(d4) <= eps
      ) {
        if (
          Math.max(minXi, minXj) <= Math.min(maxXi, maxXj) + eps &&
          Math.max(minYi, minYj) <= Math.min(maxYi, maxYj) + eps
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

export function pointInPolygonBatch(
  px: Float64Array,
  py: Float64Array,
  polyX: Float64Array,
  polyY: Float64Array
): Uint8Array {
  const nPts = px.length;
  const inside = new Uint8Array(nPts);
  const nPoly = polyX.length;
  if (nPoly < 3 || nPts === 0) return inside;

  const isClosed = polyX[0] === polyX[nPoly - 1] && polyY[0] === polyY[nPoly - 1];
  const nEdges = isClosed ? nPoly - 1 : nPoly;

  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (let i = 0; i < nPoly; i++) {
    if (polyX[i] < xMin) xMin = polyX[i];
    if (polyX[i] > xMax) xMax = polyX[i];
    if (polyY[i] < yMin) yMin = polyY[i];
    if (polyY[i] > yMax) yMax = polyY[i];
  }

  for (let p = 0; p < nPts; p++) {
    const qx = px[p];
    const qy = py[p];
    if (qx < xMin || qx > xMax || qy < yMin || qy > yMax) {
      continue;
    }

    let crossings = 0;
    for (let e = 0; e < nEdges; e++) {
      const i1 = e;
      const i2 = e + 1 < nPoly ? e + 1 : 0;
      const y1 = polyY[i1];
      const y2 = polyY[i2];
      if (y1 > qy !== y2 > qy) {
        const x1 = polyX[i1];
        const x2 = polyX[i2];
        const xInter = x1 + ((qy - y1) * (x2 - x1)) / (y2 - y1);
        if (qx < xInter) {
          crossings++;
        }
      }
    }
    inside[p] = (crossings & 1) === 1 ? 1 : 0;
  }

  return inside;
}

export function minDistanceToPanelsBatch(
  px: Float64Array,
  py: Float64Array,
  mesh: AirfoilMesh
): Float64Array {
  const nPts = px.length;
  const dmin = new Float64Array(nPts);
  const nPanels = mesh.s.length;
  for (let p = 0; p < nPts; p++) {
    const qx = px[p];
    const qy = py[p];
    let minSq = Infinity;
    for (let j = 0; j < nPanels; j++) {
      const x1 = mesh.x[j];
      const y1 = mesh.y[j];
      const dx = mesh.dx[j];
      const dy = mesh.dy[j];
      const sSq = Math.max(mesh.s[j] * mesh.s[j], 1e-30);
      let t = ((qx - x1) * dx + (qy - y1) * dy) / sSq;
      if (t < 0.0) t = 0.0;
      else if (t > 1.0) t = 1.0;
      const rx = qx - (x1 + t * dx);
      const ry = qy - (y1 + t * dy);
      const distSq = rx * rx + ry * ry;
      if (distSq < minSq) minSq = distSq;
    }
    dmin[p] = Math.sqrt(minSq);
  }
  return dmin;
}

// ---------------------------------------------------------------------------
// カスタム翼型（DAT / CSV）パーサ + 3次 not-a-knot スプライン + Brent 最適化
// ---------------------------------------------------------------------------

type Point2D = [number, number];

function parseCoordinateBlocks(rawText: string): {
  blocks: Point2D[][];
  detectedHeaderName: string | null;
} {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    throw geometryError('翼型座標データが空です。');
  }

  const lines = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let blocks: Point2D[][] = [];
  let currentBlock: Point2D[] = [];
  let detectedHeaderName: string | null = null;
  let seenAnyNumeric = false;

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNo = idx + 1;
    const stripped = lines[idx].trim();
    if (!stripped) {
      if (currentBlock.length > 0) {
        blocks.push(currentBlock);
        currentBlock = [];
      }
      continue;
    }

    const firstCh = stripped[0];
    if (firstCh === '#' || firstCh === ';' || firstCh === '!' || firstCh === '%') {
      continue;
    }

    const tokens = stripped.split(/[,\s]+/).filter(Boolean);
    if (tokens.length === 2) {
      const xVal = Number(tokens[0]);
      const yVal = Number(tokens[1]);
      if (tokens[0] !== '' && tokens[1] !== '' && !Number.isNaN(xVal) && !Number.isNaN(yVal)) {
        if (!Number.isFinite(xVal) || !Number.isFinite(yVal)) {
          throw geometryError(
            `${lineNo}行目に非有限値（NaN/Inf）が含まれています。`,
            'INVALID_AIRFOIL_GEOMETRY',
            { line: lineNo, content: stripped }
          );
        }
        currentBlock.push([xVal, yVal]);
        seenAnyNumeric = true;
        continue;
      }
    }

    if (!seenAnyNumeric) {
      const lowerLine = stripped.toLowerCase().replace(/\s+/g, '');
      if (
        lowerLine !== 'x,y' &&
        lowerLine !== 'x/c,y/c' &&
        lowerLine !== 'xc,yc' &&
        detectedHeaderName === null
      ) {
        detectedHeaderName = stripped;
      }
      continue;
    }

    throw geometryError(
      `${lineNo}行目の座標データを2列の数値として解釈できません: '${stripped}'`,
      'INVALID_AIRFOIL_GEOMETRY',
      { line: lineNo, content: stripped }
    );
  }

  if (currentBlock.length > 0) {
    blocks.push(currentBlock);
  }

  if (blocks.length === 0) {
    throw geometryError('有効な2次元座標データが含まれていません。');
  }

  const firstBlk = blocks[0];
  const totalPts = blocks.reduce((acc, b) => acc + b.length, 0);
  if (firstBlk.length >= 1 && totalPts >= MIN_RAW_POINTS + 1) {
    const [v1, v2] = firstBlk[0];
    const isIntPair =
      v1 >= 6.0 &&
      v2 >= 6.0 &&
      Math.abs(v1 - Math.round(v1)) < 1e-6 &&
      Math.abs(v2 - Math.round(v2)) < 1e-6;
    if (isIntPair) {
      const expectedRem = Math.round(v1) + Math.round(v2);
      const actualRem = totalPts - 1;
      const remCoords = [...firstBlk.slice(1), ...blocks.slice(1).flat()];
      let maxAbsRem = 0;
      for (const [px, py] of remCoords) {
        const m = Math.max(Math.abs(px), Math.abs(py));
        if (m > maxAbsRem) maxAbsRem = m;
      }
      if (Math.abs(actualRem - expectedRem) <= 2 && maxAbsRem <= 5.0) {
        if (firstBlk.length === 1) {
          blocks = blocks.slice(1);
        } else {
          blocks[0] = firstBlk.slice(1);
        }
      }
    }
  }

  const cleanBlocks = blocks.filter((b) => b.length > 0);
  const totalValid = cleanBlocks.reduce((acc, b) => acc + b.length, 0);
  if (totalValid < MIN_RAW_POINTS) {
    throw geometryError(
      `有効な座標点数が不足しています（入力: ${totalValid}点、最低 ${MIN_RAW_POINTS}点必要）。`,
      'INVALID_AIRFOIL_GEOMETRY',
      { num_points: totalValid, min_required: MIN_RAW_POINTS }
    );
  }

  return { blocks: cleanBlocks, detectedHeaderName };
}

function removeConsecutiveDuplicates(pts: Point2D[], tol = DUPLICATE_POINT_TOL): Point2D[] {
  if (pts.length <= 1) return pts.slice();
  const out: Point2D[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (d >= tol) {
      out.push(pts[i]);
    }
  }
  return out;
}

function convertToClockwiseContour(blocks: Point2D[][]): Point2D[] {
  const allPts = blocks.flat();
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const [px, py] of allPts) {
    if (px < xMin) xMin = px;
    if (px > xMax) xMax = px;
    if (py < yMin) yMin = py;
    if (py > yMax) yMax = py;
  }
  const span = Math.max(xMax - xMin, yMax - yMin);
  if (span <= 1e-9) {
    throw geometryError('翼型座標の空間広がりがゼロ（全点ほぼ同一）です。');
  }

  let candidatePair: [Point2D[], Point2D[]] | null = null;
  const isLednicerPair = (b1: Point2D[], b2: Point2D[]): boolean => {
    const startDist = Math.hypot(b1[0][0] - b2[0][0], b1[0][1] - b2[0][1]);
    const b1Last = b1[b1.length - 1];
    const b2Last = b2[b2.length - 1];
    const endDist = Math.hypot(b1Last[0] - b2Last[0], b1Last[1] - b2Last[1]);
    const v1x = b1Last[0] - b1[0][0];
    const v1y = b1Last[1] - b1[0][1];
    const v2x = b2Last[0] - b2[0][0];
    const v2y = b2Last[1] - b2[0][1];
    const dot = v1x * v2x + v1y * v2y;
    return startDist <= 0.12 * span && endDist <= 0.15 * span && dot > 0.25 * span * span;
  };

  if (blocks.length === 2 && blocks[0].length >= 6 && blocks[1].length >= 6) {
    if (isLednicerPair(blocks[0], blocks[1])) {
      candidatePair = [blocks[0], blocks[1]];
    }
  } else if (blocks.length === 1) {
    const single = blocks[0];
    const largeJumps: number[] = [];
    for (let i = 0; i < single.length - 1; i++) {
      const jump = Math.hypot(single[i + 1][0] - single[i][0], single[i + 1][1] - single[i][1]);
      if (jump > 0.45 * span) largeJumps.push(i);
    }
    if (largeJumps.length === 1) {
      const splitIdx = largeJumps[0] + 1;
      const b1 = single.slice(0, splitIdx);
      const b2 = single.slice(splitIdx);
      if (b1.length >= 6 && b2.length >= 6 && isLednicerPair(b1, b2)) {
        candidatePair = [b1, b2];
      }
    }
  }

  if (candidatePair !== null) {
    const [b1, b2] = candidatePair;
    const pLeX = 0.5 * (b1[0][0] + b2[0][0]);
    const pLeY = 0.5 * (b1[0][1] + b2[0][1]);
    const pTeX = 0.5 * (b1[b1.length - 1][0] + b2[b2.length - 1][0]);
    const pTeY = 0.5 * (b1[b1.length - 1][1] + b2[b2.length - 1][1]);
    const cx = pTeX - pLeX;
    const cy = pTeY - pLeY;
    const cLen = Math.hypot(cx, cy);
    if (cLen <= 1e-9) {
      throw geometryError('Lednicer 形式の前縁と後縁が一致しています。');
    }
    const nUpX = -cy / cLen;
    const nUpY = cx / cLen;
    const meanSide = (blk: Point2D[]): number => {
      let sum = 0;
      for (const [px, py] of blk) {
        sum += (px - pLeX) * nUpX + (py - pLeY) * nUpY;
      }
      return sum / blk.length;
    };
    const h1 = meanSide(b1);
    const h2 = meanSide(b2);
    if (Math.abs(h1 - h2) <= 1e-7 * span) {
      throw geometryError('Lednicer 形式の上面ブロックと下面ブロックが重なっています。');
    }
    const [upperBlk, lowerBlk] = h1 > h2 ? [b1, b2] : [b2, b1];
    const rawCw = [...lowerBlk.slice().reverse(), ...upperBlk.slice(1)];
    const cwPts = removeConsecutiveDuplicates(rawCw);
    if (cwPts.length < MIN_RAW_POINTS) {
      throw geometryError('重複点除去後の有効座標点数が12点未満です。');
    }
    const xs = cwPts.map((p) => p[0]);
    const ys = cwPts.map((p) => p[1]);
    if (hasNonAdjacentSelfIntersection(xs, ys, true)) {
      throw geometryError('翼型輪郭に自己交差が検出されました。');
    }
    return cwPts;
  }

  let pts = removeConsecutiveDuplicates(allPts);
  if (pts.length < MIN_RAW_POINTS) {
    throw geometryError('重複点除去後の有効座標点数が12点未満です。');
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  if (hasNonAdjacentSelfIntersection(xs, ys, true)) {
    throw geometryError('翼型輪郭に自己交差が検出されました。');
  }

  const signedArea = computeSignedArea(Float64Array.from(xs), Float64Array.from(ys));
  if (Math.abs(signedArea) <= 1e-8 * span * span) {
    throw geometryError('翼型輪郭の囲む面積がほぼゼロ（退化形状）です。');
  }
  if (signedArea > 0.0) {
    pts = pts.slice().reverse();
  }
  return pts;
}

function computeArcLength(pts: Point2D[]): Float64Array {
  const s = new Float64Array(pts.length);
  s[0] = 0.0;
  for (let i = 1; i < pts.length; i++) {
    s[i] = s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return s;
}

function solveTridiagonal(
  a: Float64Array,
  b: Float64Array,
  c: Float64Array,
  d: Float64Array
): Float64Array {
  const n = d.length;
  const cp = new Float64Array(n);
  const dp = new Float64Array(n);
  const x = new Float64Array(n);

  cp[0] = c[0] / b[0];
  dp[0] = d[0] / b[0];
  for (let i = 1; i < n; i++) {
    const denom = b[i] - a[i] * cp[i - 1];
    cp[i] = i < n - 1 ? c[i] / denom : 0.0;
    dp[i] = (d[i] - a[i] * dp[i - 1]) / denom;
  }
  x[n - 1] = dp[n - 1];
  for (let i = n - 2; i >= 0; i--) {
    x[i] = dp[i] - cp[i] * x[i + 1];
  }
  return x;
}

class CubicSpline1D {
  private readonly t: Float64Array;
  private readonly c0: Float64Array;
  private readonly c1: Float64Array;
  private readonly c2: Float64Array;
  private readonly c3: Float64Array;
  private readonly nSeg: number;

  constructor(t: Float64Array, y: Float64Array) {
    const n = t.length;
    this.t = t;
    this.nSeg = n - 1;
    this.c0 = new Float64Array(this.nSeg);
    this.c1 = new Float64Array(this.nSeg);
    this.c2 = new Float64Array(this.nSeg);
    this.c3 = new Float64Array(this.nSeg);

    const h = new Float64Array(this.nSeg);
    const delta = new Float64Array(this.nSeg);
    for (let i = 0; i < this.nSeg; i++) {
      h[i] = t[i + 1] - t[i];
      delta[i] = (y[i + 1] - y[i]) / h[i];
    }

    let k: Float64Array;
    if (n === 2) {
      k = Float64Array.from([delta[0], delta[0]]);
    } else if (n === 3) {
      const a2 = (delta[1] - delta[0]) / (h[0] + h[1]);
      k = Float64Array.from([
        delta[0] - a2 * h[0],
        delta[0] + a2 * h[0],
        delta[1] + a2 * h[1],
      ]);
    } else {
      const a = new Float64Array(n);
      const b = new Float64Array(n);
      const c = new Float64Array(n);
      const rhs = new Float64Array(n);

      const d0 = h[0] + h[1];
      b[0] = h[1] * d0;
      c[0] = d0 * d0;
      rhs[0] = h[1] * (3.0 * h[0] + 2.0 * h[1]) * delta[0] + h[0] * h[0] * delta[1];

      for (let i = 1; i <= n - 2; i++) {
        a[i] = h[i];
        b[i] = 2.0 * (h[i - 1] + h[i]);
        c[i] = h[i - 1];
        rhs[i] = 3.0 * (h[i] * delta[i - 1] + h[i - 1] * delta[i]);
      }

      const hp = h[n - 3];
      const hq = h[n - 2];
      const dend = hp + hq;
      a[n - 1] = dend * dend;
      b[n - 1] = hp * dend;
      rhs[n - 1] = hq * hq * delta[n - 3] + hp * (2.0 * hp + 3.0 * hq) * delta[n - 2];

      k = solveTridiagonal(a, b, c, rhs);
    }

    for (let i = 0; i < this.nSeg; i++) {
      this.c0[i] = y[i];
      this.c1[i] = k[i];
      this.c2[i] = (3.0 * delta[i] - 2.0 * k[i] - k[i + 1]) / h[i];
      this.c3[i] = (k[i] + k[i + 1] - 2.0 * delta[i]) / (h[i] * h[i]);
    }
  }

  private findSeg(tv: number): number {
    if (tv <= this.t[0]) return 0;
    if (tv >= this.t[this.nSeg]) return this.nSeg - 1;
    let lo = 0;
    let hi = this.nSeg - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (tv < this.t[mid]) hi = mid - 1;
      else if (tv >= this.t[mid + 1]) lo = mid + 1;
      else return mid;
    }
    return Math.min(Math.max(lo, 0), this.nSeg - 1);
  }

  eval(tv: number, deriv = 0): number {
    const i = this.findSeg(tv);
    const u = tv - this.t[i];
    if (deriv === 0) {
      return this.c0[i] + u * (this.c1[i] + u * (this.c2[i] + u * this.c3[i]));
    }
    if (deriv === 1) {
      return this.c1[i] + u * (2.0 * this.c2[i] + 3.0 * u * this.c3[i]);
    }
    return 2.0 * this.c2[i] + 6.0 * u * this.c3[i];
  }
}

class CubicSpline2D {
  private readonly sx: CubicSpline1D;
  private readonly sy: CubicSpline1D;

  constructor(s: Float64Array, pts: Point2D[]) {
    const xs = Float64Array.from(pts, (p) => p[0]);
    const ys = Float64Array.from(pts, (p) => p[1]);
    this.sx = new CubicSpline1D(s, xs);
    this.sy = new CubicSpline1D(s, ys);
  }

  eval(sv: number, deriv = 0): Point2D {
    return [this.sx.eval(sv, deriv), this.sy.eval(sv, deriv)];
  }
}

function minimizeScalarBounded(
  fn: (x: number) => number,
  a: number,
  b: number,
  xatol = 1e-13
): number {
  const phi = 0.5 * (3.0 - Math.sqrt(5.0));
  let x1 = a;
  let x2 = b;
  if (x1 > x2) [x1, x2] = [x2, x1];

  let x = x1 + phi * (x2 - x1);
  let w = x;
  let v = x;
  let fx = fn(x);
  let fw = fx;
  let fv = fx;
  let d = 0.0;
  let e = 0.0;

  for (let iter = 0; iter < 120; iter++) {
    const xm = 0.5 * (x1 + x2);
    const tol1 = Math.sqrt(Number.EPSILON) * Math.abs(x) + xatol / 3.0;
    const tol2 = 2.0 * tol1;
    if (Math.abs(x - xm) <= tol2 - 0.5 * (x2 - x1)) {
      return x;
    }

    let p = 0.0;
    let q = 0.0;
    let r = 0.0;
    let useGolden = Math.abs(e) <= tol1;

    if (!useGolden) {
      r = (x - w) * (fx - fv);
      q = (x - v) * (fx - fw);
      p = (x - v) * q - (x - w) * r;
      q = 2.0 * (q - r);
      if (q > 0.0) p = -p;
      q = Math.abs(q);
      const eTemp = e;
      e = d;
      if (
        Math.abs(p) < Math.abs(0.5 * q * eTemp) &&
        p > q * (x1 - x) &&
        p < q * (x2 - x)
      ) {
        d = p / q;
        const u = x + d;
        if (u - x1 < tol2 || x2 - u < tol2) {
          d = xm - x >= 0 ? tol1 : -tol1;
        }
      } else {
        useGolden = true;
      }
    }

    if (useGolden) {
      e = x >= xm ? x1 - x : x2 - x;
      d = phi * e;
    }

    const u = Math.abs(d) >= tol1 ? x + d : x + (d >= 0 ? tol1 : -tol1);
    const fu = fn(u);

    if (fu <= fx) {
      if (u >= x) x1 = x;
      else x2 = x;
      v = w;
      fv = fw;
      w = x;
      fw = fx;
      x = u;
      fx = fu;
    } else {
      if (u < x) x1 = u;
      else x2 = u;
      if (fu <= fw || w === x) {
        v = w;
        fv = fw;
        w = u;
        fw = fu;
      } else if (fu <= fv || v === x || v === w) {
        v = u;
        fv = fu;
      }
    }
  }
  return x;
}

function brentq(fn: (x: number) => number, aIn: number, bIn: number, xtol = 1e-13): number {
  let a = aIn;
  let b = bIn;
  let fa = fn(a);
  let fb = fn(b);
  if (Math.abs(fa) < 1e-15) return a;
  if (Math.abs(fb) < 1e-15) return b;
  if (fa * fb > 0.0) return 0.5 * (a + b);

  let c = a;
  let fc = fa;
  let d = b - a;
  let e = d;

  for (let iter = 0; iter < 100; iter++) {
    if (fb * fc > 0.0) {
      c = a;
      fc = fa;
      d = b - a;
      e = d;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b;
      b = c;
      c = a;
      fa = fb;
      fb = fc;
      fc = fa;
    }

    const tol1 = 2.0 * Number.EPSILON * Math.abs(b) + 0.5 * xtol;
    const xm = 0.5 * (c - b);
    if (Math.abs(xm) <= tol1 || fb === 0.0) {
      return b;
    }

    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let p: number;
      let q: number;
      if (a === c) {
        p = 2.0 * xm * s;
        q = 1.0 - s;
      } else {
        q = fa / fc;
        const r = fb / fc;
        p = s * (2.0 * xm * q * (q - r) - (b - a) * (r - 1.0));
        q = (q - 1.0) * (r - 1.0) * (s - 1.0);
      }
      if (p > 0.0) q = -q;
      p = Math.abs(p);
      const min1 = 3.0 * xm * q - Math.abs(tol1 * q);
      const min2 = Math.abs(e * q);
      if (2.0 * p < Math.min(min1, min2)) {
        e = d;
        d = p / q;
      } else {
        d = xm;
        e = d;
      }
    } else {
      d = xm;
      e = d;
    }
    a = b;
    fa = fb;
    b += Math.abs(d) > tol1 ? d : xm >= 0 ? tol1 : -tol1;
    fb = fn(b);
  }
  return b;
}

function interp1dSorted(x: number, xs: Float64Array, ys: Float64Array): number {
  const n = xs.length;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const dx = xs[hi] - xs[lo];
  if (dx <= 1e-18) return ys[lo];
  const t = (x - xs[lo]) / dx;
  return ys[lo] + t * (ys[hi] - ys[lo]);
}

function computeGradient1D(y: Float64Array, x: Float64Array): Float64Array {
  const n = y.length;
  const g = new Float64Array(n);
  if (n < 2) return g;
  g[0] = (y[1] - y[0]) / (x[1] - x[0]);
  g[n - 1] = (y[n - 1] - y[n - 2]) / (x[n - 1] - x[n - 2]);
  for (let i = 1; i < n - 1; i++) {
    const dx1 = x[i] - x[i - 1];
    const dx2 = x[i + 1] - x[i];
    const dy1 = (y[i] - y[i - 1]) / dx1;
    const dy2 = (y[i + 1] - y[i]) / dx2;
    g[i] = (dx2 * dy1 + dx1 * dy2) / (dx1 + dx2);
  }
  return g;
}

function locateLeadingEdgeOnSpline(
  cs: CubicSpline2D,
  sNodes: Float64Array,
  pts: Point2D[],
  pTe: Point2D
): { sLe: number; pLe: Point2D } {
  const sTotal = sNodes[sNodes.length - 1];
  let idxFar = 0;
  let maxDistSq = -1.0;
  for (let i = 0; i < pts.length; i++) {
    const dx = pts[i][0] - pTe[0];
    const dy = pts[i][1] - pTe[1];
    const dSq = dx * dx + dy * dy;
    if (dSq > maxDistSq) {
      maxDistSq = dSq;
      idxFar = i;
    }
  }
  const loIdx = Math.max(0, idxFar - 2);
  const hiIdx = Math.min(sNodes.length - 1, idxFar + 2);
  const sLeDist = minimizeScalarBounded(
    (sv) => {
      const [px, py] = cs.eval(sv, 0);
      const dx = px - pTe[0];
      const dy = py - pTe[1];
      return -(dx * dx + dy * dy);
    },
    sNodes[loIdx],
    sNodes[hiIdx],
    1e-13
  );

  const dsWin = 0.03 * sTotal;
  const sLo = Math.max(0.0, sLeDist - dsWin);
  const sHi = Math.min(sTotal, sLeDist + dsWin);

  const negCurvature = (sv: number): number => {
    const d1 = cs.eval(sv, 1);
    const d2 = cs.eval(sv, 2);
    const speedSq = d1[0] * d1[0] + d1[1] * d1[1];
    if (speedSq <= 1e-24) return 0.0;
    const cross = Math.abs(d1[0] * d2[1] - d1[1] * d2[0]);
    return -(cross / Math.pow(speedSq, 1.5));
  };

  const nGrid = 121;
  let bestIdx = 0;
  let bestVal = Infinity;
  const sGrid = new Float64Array(nGrid);
  for (let i = 0; i < nGrid; i++) {
    const sv = sLo + ((sHi - sLo) * i) / (nGrid - 1);
    sGrid[i] = sv;
    const kv = negCurvature(sv);
    if (kv < bestVal) {
      bestVal = kv;
      bestIdx = i;
    }
  }
  const bLo = sGrid[Math.max(0, bestIdx - 2)];
  const bHi = sGrid[Math.min(nGrid - 1, bestIdx + 2)];
  const sLe = minimizeScalarBounded(negCurvature, bLo, bHi, 1e-13);
  return { sLe, pLe: cs.eval(sLe, 0) };
}

export function parseCustomAirfoil(
  rawCoordinatesText: string,
  numPanels = DEFAULT_NUM_PANELS,
  closedTe = true,
  name: string | null = null
): AirfoilMesh {
  validateNumPanels(numPanels);
  const { blocks, detectedHeaderName } = parseCoordinateBlocks(rawCoordinatesText);
  const cwPts = convertToClockwiseContour(blocks);
  const warnings: WarningItem[] = [];

  const sRaw = computeArcLength(cwPts);
  const csRaw = new CubicSpline2D(sRaw, cwPts);
  const pTeRaw: Point2D = [
    0.5 * (cwPts[0][0] + cwPts[cwPts.length - 1][0]),
    0.5 * (cwPts[0][1] + cwPts[cwPts.length - 1][1]),
  ];
  const { pLe: pLeRaw } = locateLeadingEdgeOnSpline(csRaw, sRaw, cwPts, pTeRaw);

  const chordVecX = pTeRaw[0] - pLeRaw[0];
  const chordVecY = pTeRaw[1] - pLeRaw[1];
  const cRaw = Math.hypot(chordVecX, chordVecY);
  if (cRaw <= 1e-9) {
    throw geometryError('翼弦長がゼロまたは極小のため正規化できません。');
  }

  const psi0 = Math.atan2(chordVecY, chordVecX);
  const psi0Deg = (psi0 * 180.0) / Math.PI;
  const cosP = Math.cos(psi0);
  const sinP = Math.sin(psi0);

  let normPts: Point2D[] = cwPts.map(([px, py]) => {
    const rx = px - pLeRaw[0];
    const ry = py - pLeRaw[1];
    return [(rx * cosP + ry * sinP) / cRaw, (-rx * sinP + ry * cosP) / cRaw];
  });

  const leOffsetRatio = Math.hypot(pLeRaw[0], pLeRaw[1]) / cRaw;
  if (
    Math.abs(cRaw - 1.0) > NORMALIZATION_WARN_TOL ||
    Math.abs(psi0) > NORMALIZATION_WARN_TOL ||
    leOffsetRatio > 1e-3
  ) {
    const psiSign = psi0Deg >= 0 ? `+${psi0Deg.toFixed(4)}` : psi0Deg.toFixed(4);
    warnings.push({
      code: 'CUSTOM_AIRFOIL_NORMALIZED',
      severity: 'info',
      title: 'カスタム翼型の正規化補正を適用しました',
      message: `前縁を (0, 0)、後縁を (1, 0) へ正規化しました（元弦長 c_raw = ${Number(cRaw.toPrecision(6))}、回転補正角 psi_0 = ${psiSign} deg）。`,
    });
  }

  const sNorm = computeArcLength(normPts);
  const csNormPre = new CubicSpline2D(sNorm, normPts);
  const sLeNorm = minimizeScalarBounded(
    (sv) => {
      const [px, py] = csNormPre.eval(sv, 0);
      return px * px + py * py;
    },
    0.0,
    sNorm[sNorm.length - 1],
    1e-13
  );

  const dxTe = normPts[normPts.length - 1][0] - normPts[0][0];
  const dyTe = normPts[normPts.length - 1][1] - normPts[0][1];
  const teGapInitial = Math.hypot(dxTe, dyTe);

  if (closedTe) {
    if (Math.abs(dyTe) > OPEN_TE_GAP_TOL || teGapInitial > OPEN_TE_GAP_TOL) {
      const x0Lo = Math.max(normPts[0][0], 0.5);
      const x0Up = Math.max(normPts[normPts.length - 1][0], 0.5);
      for (let i = 0; i < normPts.length; i++) {
        if (sNorm[i] <= sLeNorm) {
          const w = Math.min(Math.max(normPts[i][0] / x0Lo, 0.0), 1.0);
          normPts[i][0] += 0.5 * dxTe * w;
          normPts[i][1] += 0.5 * dyTe * w;
        } else {
          const w = Math.min(Math.max(normPts[i][0] / x0Up, 0.0), 1.0);
          normPts[i][0] -= 0.5 * dxTe * w;
          normPts[i][1] -= 0.5 * dyTe * w;
        }
      }
      normPts[0] = [1.0, 0.0];
      normPts[normPts.length - 1] = [1.0, 0.0];
      warnings.push({
        code: 'OPEN_TE_CLOSED_AUTO',
        severity: 'info',
        title: '開後縁を線形ブレンドで自動閉合しました',
        message: `パネル法の数値安定性確保のため、後縁ギャップ（|Δy_TE| = ${Math.abs(dyTe).toFixed(5)}）を弦方向線形ブレンドにより (1, 0) へ滑らかに閉合しました。`,
      });
    } else {
      normPts[0] = [1.0, 0.0];
      normPts[normPts.length - 1] = [1.0, 0.0];
    }
  }

  normPts = removeConsecutiveDuplicates(normPts);
  const sFinal = computeArcLength(normPts);
  const csFinal = new CubicSpline2D(sFinal, normPts);
  const sTotal = sFinal[sFinal.length - 1];
  const sLe = minimizeScalarBounded(
    (sv) => {
      const [px, py] = csFinal.eval(sv, 0);
      return px * px + py * py;
    },
    0.0,
    sTotal,
    1e-13
  );
  if (sLe <= 1e-6 || sTotal - sLe <= 1e-6) {
    throw geometryError('前縁位置が端点に偏っており上下表面へ分割できません。');
  }

  const nDense = 1001;
  const loPts: Point2D[] = [];
  const upPts: Point2D[] = [];
  for (let i = 0; i < nDense; i++) {
    const tCos = 0.5 * (1.0 - Math.cos((Math.PI * i) / (nDense - 1)));
    loPts.push(csFinal.eval(sLe + tCos * (0.0 - sLe), 0));
    upPts.push(csFinal.eval(sLe + tCos * (sTotal - sLe), 0));
  }
  loPts.sort((a, b) => a[0] - b[0]);
  upPts.sort((a, b) => a[0] - b[0]);

  const loXs = Float64Array.from(loPts, (p) => p[0]);
  const loYs = Float64Array.from(loPts, (p) => p[1]);
  const upXs = Float64Array.from(upPts, (p) => p[0]);
  const upYs = Float64Array.from(upPts, (p) => p[1]);

  const nEval = 501;
  const xEval = new Float64Array(nEval);
  const yLoEval = new Float64Array(nEval);
  const yUpEval = new Float64Array(nEval);
  for (let i = 0; i < nEval; i++) {
    const xVal = i === 0 ? 0.0 : i === nEval - 1 ? 1.0 : 0.5 * (1.0 - Math.cos((Math.PI * i) / (nEval - 1)));
    xEval[i] = xVal;
    yLoEval[i] = interp1dSorted(xVal, loXs, loYs);
    yUpEval[i] = interp1dSorted(xVal, upXs, upYs);
    if (xVal >= 0.01 && xVal <= 0.99 && yUpEval[i] <= yLoEval[i] + 1e-6) {
      throw geometryError('翼型内部において上面座標と下面座標が交差または上下逆転しています。');
    }
  }

  const camberRaw = new Float64Array(nEval);
  let maxThicknessRatio = 0.0;
  for (let i = 0; i < nEval; i++) {
    const th = yUpEval[i] - yLoEval[i];
    if (th > maxThicknessRatio) maxThicknessRatio = th;
    camberRaw[i] = 0.5 * (yUpEval[i] + yLoEval[i]);
  }

  // [0.02, 0.25] の 2次フィット y = c1 * x + c2 * x^2
  let s11 = 0.0;
  let s12 = 0.0;
  let s22 = 0.0;
  let sy1 = 0.0;
  let sy2 = 0.0;
  let fitCount = 0;
  for (let i = 0; i < nEval; i++) {
    const xf = xEval[i];
    if (xf >= 0.02 && xf <= 0.25) {
      const xf2 = xf * xf;
      s11 += xf * xf;
      s12 += xf * xf2;
      s22 += xf2 * xf2;
      sy1 += xf * camberRaw[i];
      sy2 += xf2 * camberRaw[i];
      fitCount++;
    }
  }

  const camberDist = new Float64Array(nEval);
  const det = s11 * s22 - s12 * s12;
  if (fitCount >= 4 && Math.abs(det) > 1e-18) {
    const c1 = (s22 * sy1 - s12 * sy2) / det;
    const c2 = (-s12 * sy1 + s11 * sy2) / det;
    for (let i = 0; i < nEval; i++) {
      const xv = xEval[i];
      const w = Math.min(Math.max((xv - 0.02) / 0.03, 0.0), 1.0);
      const fitVal = c1 * xv + c2 * xv * xv;
      camberDist[i] = (1.0 - w) * fitVal + w * camberRaw[i];
    }
  } else {
    camberDist.set(camberRaw);
  }

  const camberSlope = computeGradient1D(camberDist, xEval);

  let maxAbsCamber = 0.0;
  let idxMaxCam = 0;
  for (let i = 0; i < nEval; i++) {
    const a = Math.abs(camberDist[i]);
    if (a > maxAbsCamber) {
      maxAbsCamber = a;
      idxMaxCam = i;
    }
  }
  const isSymmetric = maxAbsCamber < 1e-4;
  const maxCamberRatio = isSymmetric ? 0.0 : camberDist[idxMaxCam];
  const maxCamberPos = isSymmetric ? 0.0 : xEval[idxMaxCam];

  const xiCos = generateCosineXi(numPanels);
  const nHalf = numPanels / 2;

  const sampleBranch = (sStart: number, sEnd: number, ptTeEnd: Point2D): Point2D[] => {
    const sampled: Point2D[] = new Array(nHalf + 1);
    sampled[0] = [0.0, 0.0];
    sampled[nHalf] = [ptTeEnd[0], ptTeEnd[1]];
    const sLoB = Math.min(sStart, sEnd);
    const sHiB = Math.max(sStart, sEnd);

    for (let k = 1; k < nHalf; k++) {
      const xiK = xiCos[k];
      const ycK = interp1dSorted(xiK, xEval, camberDist);
      const dycK = interp1dSorted(xiK, xEval, camberSlope);
      const thetaK = Math.atan(dycK);
      const ct = Math.cos(thetaK);
      const st = Math.sin(thetaK);

      const projFunc = (sv: number): number => {
        const [pxS, pyS] = csFinal.eval(sv, 0);
        return (pxS - xiK) * ct + (pyS - ycK) * st;
      };

      const fa = projFunc(sLoB);
      const fb = projFunc(sHiB);
      const sK =
        sHiB - sLoB > 1e-14 && fa * fb <= 0.0
          ? brentq(projFunc, sLoB, sHiB, 1e-13)
          : sStart + xiK * (sEnd - sStart);
      sampled[k] = csFinal.eval(sK, 0);
    }
    return sampled;
  };

  const teLowerPt: Point2D = closedTe ? [1.0, 0.0] : [...normPts[0]];
  const teUpperPt: Point2D = closedTe ? [1.0, 0.0] : [...normPts[normPts.length - 1]];

  const lowerBranch = sampleBranch(sLe, 0.0, teLowerPt);
  const upperBranch = sampleBranch(sLe, sTotal, teUpperPt);

  const xNodes = new Float64Array(numPanels + 1);
  const yNodes = new Float64Array(numPanels + 1);
  let ptr = 0;
  for (let k = nHalf; k >= 1; k--) {
    xNodes[ptr] = lowerBranch[k][0];
    yNodes[ptr] = lowerBranch[k][1];
    ptr++;
  }
  xNodes[ptr] = 0.0;
  yNodes[ptr] = 0.0;
  ptr++;
  for (let k = 1; k <= nHalf; k++) {
    xNodes[ptr] = upperBranch[k][0];
    yNodes[ptr] = upperBranch[k][1];
    ptr++;
  }

  if (hasNonAdjacentSelfIntersection(xNodes, yNodes, true)) {
    throw geometryError('再パネル化後の翼型パネル列に自己交差が検出されました。');
  }

  const side: PanelSide[] = Array.from({ length: numPanels }, (_, idx) =>
    idx < nHalf ? 'lower' : 'upper'
  );
  const resolvedName =
    name && name.trim()
      ? name.trim()
      : detectedHeaderName
        ? detectedHeaderName
        : 'Custom Airfoil';
  const actualClosed =
    closedTe ||
    Math.hypot(xNodes[numPanels] - xNodes[0], yNodes[numPanels] - yNodes[0]) <= OPEN_TE_GAP_TOL;

  return buildAirfoilMesh(xNodes, yNodes, {
    name: resolvedName,
    maxThicknessRatio,
    maxCamberRatio,
    maxCamberPos,
    isSymmetric,
    isClosedTe: actualClosed,
    side,
    warnings,
  });
}

export function generateAirfoilMesh(params: {
  sourceType: AirfoilSourceType;
  nacaCode: string | null;
  rawCoordinatesText: string | null;
  name: string | null;
  numPanels: number;
  closedTe: boolean;
}): AirfoilMesh {
  const { sourceType, nacaCode, rawCoordinatesText, name, numPanels, closedTe } = params;
  validateNumPanels(numPanels);

  if (sourceType === 'naca4') {
    if (!nacaCode || !nacaCode.trim()) {
      throw geometryError('source_type="naca4" では naca_code の指定が必須です。');
    }
    return generateNaca4(nacaCode.trim(), numPanels, closedTe, name);
  }

  if (sourceType === 'custom_dat' || sourceType === 'custom_csv') {
    if (!rawCoordinatesText || !rawCoordinatesText.trim()) {
      throw geometryError(
        `source_type="${sourceType}" では raw_coordinates_text の指定が必須です。`
      );
    }
    return parseCustomAirfoil(rawCoordinatesText, numPanels, closedTe, name);
  }

  throw geometryError(`未対応の翼型ソース形式です: '${String(sourceType)}'`);
}
