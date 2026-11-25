/**
 * 空間速度場・圧力場計算および弧長正規化 4 次 Runge-Kutta (RK4) 流線積分モジュール。
 *
 * Python 版 `backend/app/visualization/velocity_field.py`, `streamlines.py` と
 * 数式・丸め精度・停止条件・翼内部マスク仕様を完全一致させて移植している。
 */

import type { FlowFieldData, StreamlinePolyline } from '../types/api';
import {
  type AirfoilMesh,
  minDistanceToPanelsBatch,
  pointInPolygonBatch,
  roundDecimals,
} from './geometry';
import { evaluateInducedVelocityBatch } from './hessSmith';

export const FIELD_ROUND_DECIMALS = 6;
export const NEAR_AIRFOIL_DIST = 0.08;
export const STEP_NEAR = 0.004;
export const STEP_FAR = 0.015;
export const WALL_COLLISION_DIST = 1.5e-3;
export const STAGNATION_SPEED_TOL = 1.0e-3;
export const DOMAIN_EXIT_MARGIN = 0.05;
export const STREAMLINE_ROUND_DECIMALS = 6;

function linspace(start: number, stop: number, count: number): Float64Array {
  const arr = new Float64Array(count);
  if (count <= 0) return arr;
  if (count === 1) {
    arr[0] = start;
    return arr;
  }
  const step = (stop - start) / (count - 1);
  for (let i = 0; i < count; i++) {
    arr[i] = start + i * step;
  }
  arr[count - 1] = stop;
  return arr;
}

export function computeVelocityField(
  mesh: AirfoilMesh,
  sigma: Float64Array,
  gamma: number,
  alphaRad: number,
  vtRatio: Float64Array | null,
  options: {
    gridNx?: number;
    gridNy?: number;
    xRange?: [number, number];
    yRange?: [number, number];
  } = {}
): FlowFieldData {
  const {
    gridNx = 120,
    gridNy = 80,
    xRange = [-0.5, 1.6],
    yRange = [-0.7, 0.7],
  } = options;

  const xGridArr = linspace(xRange[0], xRange[1], gridNx);
  const yGridArr = linspace(yRange[0], yRange[1], gridNy);

  const totalPts = gridNx * gridNy;
  const pxAll = new Float64Array(totalPts);
  const pyAll = new Float64Array(totalPts);

  for (let iy = 0; iy < gridNy; iy++) {
    const yv = yGridArr[iy];
    const rowOff = iy * gridNx;
    for (let ix = 0; ix < gridNx; ix++) {
      pxAll[rowOff + ix] = xGridArr[ix];
      pyAll[rowOff + ix] = yv;
    }
  }

  const insideMask = pointInPolygonBatch(pxAll, pyAll, mesh.x, mesh.y);

  let extCount = 0;
  for (let i = 0; i < totalPts; i++) {
    if (insideMask[i] === 0) extCount++;
  }

  const extIndices = new Int32Array(extCount);
  const extX = new Float64Array(extCount);
  const extY = new Float64Array(extCount);
  let ptr = 0;
  for (let i = 0; i < totalPts; i++) {
    if (insideMask[i] === 0) {
      extIndices[ptr] = i;
      extX[ptr] = pxAll[i];
      extY[ptr] = pyAll[i];
      ptr++;
    }
  }

  const uExtAll = new Float64Array(totalPts);
  const vExtAll = new Float64Array(totalPts);
  const spdExtAll = new Float64Array(totalPts);
  const cpExtAll = new Float64Array(totalPts);

  if (extCount > 0) {
    const { u: uExt, v: vExt } = evaluateInducedVelocityBatch(
      extX,
      extY,
      mesh,
      sigma,
      gamma,
      alphaRad,
      vtRatio
    );
    for (let k = 0; k < extCount; k++) {
      const idx = extIndices[k];
      const uk = uExt[k];
      const vk = vExt[k];
      const spd = Math.hypot(uk, vk);
      uExtAll[idx] = uk;
      vExtAll[idx] = vk;
      spdExtAll[idx] = spd;
      cpExtAll[idx] = 1.0 - spd * spd;
    }
  }

  const uRatio: (number | null)[][] = new Array(gridNy);
  const vRatio: (number | null)[][] = new Array(gridNy);
  const speedRatio: (number | null)[][] = new Array(gridNy);
  const cpGrid: (number | null)[][] = new Array(gridNy);
  const isInsideAirfoil: boolean[][] = new Array(gridNy);

  for (let iy = 0; iy < gridNy; iy++) {
    const rowOff = iy * gridNx;
    const uRow = new Array<number | null>(gridNx);
    const vRow = new Array<number | null>(gridNx);
    const sRow = new Array<number | null>(gridNx);
    const cRow = new Array<number | null>(gridNx);
    const inRow = new Array<boolean>(gridNx);

    for (let ix = 0; ix < gridNx; ix++) {
      const idx = rowOff + ix;
      if (insideMask[idx] === 1) {
        uRow[ix] = null;
        vRow[ix] = null;
        sRow[ix] = null;
        cRow[ix] = null;
        inRow[ix] = true;
      } else {
        uRow[ix] = roundDecimals(uExtAll[idx], FIELD_ROUND_DECIMALS);
        vRow[ix] = roundDecimals(vExtAll[idx], FIELD_ROUND_DECIMALS);
        sRow[ix] = roundDecimals(spdExtAll[idx], FIELD_ROUND_DECIMALS);
        cRow[ix] = roundDecimals(cpExtAll[idx], FIELD_ROUND_DECIMALS);
        inRow[ix] = false;
      }
    }

    uRatio[iy] = uRow;
    vRatio[iy] = vRow;
    speedRatio[iy] = sRow;
    cpGrid[iy] = cRow;
    isInsideAirfoil[iy] = inRow;
  }

  return {
    x_grid: Array.from(xGridArr, (v) => roundDecimals(v, FIELD_ROUND_DECIMALS)),
    y_grid: Array.from(yGridArr, (v) => roundDecimals(v, FIELD_ROUND_DECIMALS)),
    u_ratio: uRatio,
    v_ratio: vRatio,
    speed_ratio: speedRatio,
    cp: cpGrid,
    is_inside_airfoil: isInsideAirfoil,
  };
}

function generateRakeSeedPoints(
  alphaRad: number,
  xRange: [number, number],
  yRange: [number, number],
  numStreamlines: number
): { seedX: Float64Array; seedY: Float64Array } {
  const [xMin, xMax] = xRange;
  const [yMin, yMax] = yRange;
  const cosA = Math.cos(alphaRad);
  const sinA = Math.sin(alphaRad);

  const halfSpan = Math.min(0.7, Math.max(Math.abs(yMin), Math.abs(yMax)));
  const etas = linspace(-halfSpan, halfSpan, numStreamlines);
  const seedX = new Float64Array(numStreamlines);
  const seedY = new Float64Array(numStreamlines);

  for (let i = 0; i < numStreamlines; i++) {
    const eta = etas[i];
    const xr = 0.5 - eta * sinA;
    const yr = eta * cosA;

    let tauX = Infinity;
    if (Math.abs(cosA) > 1e-12) {
      const candidate = cosA > 0.0 ? (xr - xMin) / cosA : (xr - xMax) / cosA;
      if (candidate >= 0.0) tauX = candidate;
    }

    let tauY = Infinity;
    if (sinA > 1e-12) {
      const candidate = (yr - yMin) / sinA;
      if (candidate >= 0.0) tauY = candidate;
    } else if (sinA < -1e-12) {
      const candidate = (yr - yMax) / sinA;
      if (candidate >= 0.0) tauY = candidate;
    }

    const tauMin = Math.min(tauX, tauY);
    const tau = Number.isFinite(tauMin) ? tauMin : 0.0;

    seedX[i] = Math.min(Math.max(xr - tau * cosA, xMin), xMax);
    seedY[i] = Math.min(Math.max(yr - tau * sinA, yMin), yMax);
  }

  return { seedX, seedY };
}

export function computeStreamlines(
  mesh: AirfoilMesh,
  sigma: Float64Array,
  gamma: number,
  alphaRad: number,
  vtRatio: Float64Array | null,
  options: {
    xRange?: [number, number];
    yRange?: [number, number];
    numStreamlines?: number;
    maxSteps?: number;
  } = {}
): StreamlinePolyline[] {
  const {
    xRange = [-0.5, 1.6],
    yRange = [-0.7, 0.7],
    numStreamlines = 28,
    maxSteps = 800,
  } = options;
  const [xMin, xMax] = xRange;
  const [yMin, yMax] = yRange;

  const { seedX, seedY } = generateRakeSeedPoints(
    alphaRad,
    xRange,
    yRange,
    numStreamlines
  );
  const nLines = numStreamlines;
  const stride = maxSteps + 1;

  const trajX = new Float64Array(nLines * stride);
  const trajY = new Float64Array(nLines * stride);
  const lengths = new Int32Array(nLines);

  const seedInside = pointInPolygonBatch(seedX, seedY, mesh.x, mesh.y);
  const currDmin = minDistanceToPanelsBatch(seedX, seedY, mesh);
  const active = new Uint8Array(nLines);
  const currX = new Float64Array(seedX);
  const currY = new Float64Array(seedY);

  for (let i = 0; i < nLines; i++) {
    if (seedInside[i] === 0 && currDmin[i] >= WALL_COLLISION_DIST) {
      active[i] = 1;
      trajX[i * stride] = currX[i];
      trajY[i * stride] = currY[i];
      lengths[i] = 1;
    }
  }

  const evalUnitDir = (
    px: Float64Array,
    py: Float64Array
  ): { kx: Float64Array; ky: Float64Array; spd: Float64Array } => {
    const n = px.length;
    const { u, v } = evaluateInducedVelocityBatch(
      px,
      py,
      mesh,
      sigma,
      gamma,
      alphaRad,
      vtRatio
    );
    const kx = new Float64Array(n);
    const ky = new Float64Array(n);
    const spd = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const s = Math.hypot(u[i], v[i]);
      spd[i] = s;
      const inv = 1.0 / Math.max(s, 1e-12);
      kx[i] = u[i] * inv;
      ky[i] = v[i] * inv;
    }
    return { kx, ky, spd };
  };

  for (let step = 0; step < maxSteps; step++) {
    const actIndices: number[] = [];
    for (let i = 0; i < nLines; i++) {
      if (active[i] === 1) actIndices.push(i);
    }
    if (actIndices.length === 0) break;

    const posX = new Float64Array(actIndices.length);
    const posY = new Float64Array(actIndices.length);
    for (let k = 0; k < actIndices.length; k++) {
      const idx = actIndices[k];
      posX[k] = currX[idx];
      posY[k] = currY[idx];
    }

    const r1 = evalUnitDir(posX, posY);
    const validIndices: number[] = [];
    const validK1Pos: number[] = [];
    for (let k = 0; k < actIndices.length; k++) {
      const s1 = r1.spd[k];
      if (Number.isFinite(s1) && s1 >= STAGNATION_SPEED_TOL) {
        validIndices.push(actIndices[k]);
        validK1Pos.push(k);
      } else {
        active[actIndices[k]] = 0;
      }
    }
    if (validIndices.length === 0) break;

    const nAct = validIndices.length;
    const xA = new Float64Array(nAct);
    const yA = new Float64Array(nAct);
    const ds = new Float64Array(nAct);
    const k1x = new Float64Array(nAct);
    const k1y = new Float64Array(nAct);

    const p2x = new Float64Array(nAct);
    const p2y = new Float64Array(nAct);
    for (let k = 0; k < nAct; k++) {
      const idx = validIndices[k];
      const origK = validK1Pos[k];
      xA[k] = currX[idx];
      yA[k] = currY[idx];
      ds[k] = currDmin[idx] < NEAR_AIRFOIL_DIST ? STEP_NEAR : STEP_FAR;
      k1x[k] = r1.kx[origK];
      k1y[k] = r1.ky[origK];
      p2x[k] = xA[k] + 0.5 * ds[k] * k1x[k];
      p2y[k] = yA[k] + 0.5 * ds[k] * k1y[k];
    }

    const r2 = evalUnitDir(p2x, p2y);
    const p3x = new Float64Array(nAct);
    const p3y = new Float64Array(nAct);
    for (let k = 0; k < nAct; k++) {
      p3x[k] = xA[k] + 0.5 * ds[k] * r2.kx[k];
      p3y[k] = yA[k] + 0.5 * ds[k] * r2.ky[k];
    }

    const r3 = evalUnitDir(p3x, p3y);
    const p4x = new Float64Array(nAct);
    const p4y = new Float64Array(nAct);
    for (let k = 0; k < nAct; k++) {
      p4x[k] = xA[k] + ds[k] * r3.kx[k];
      p4y[k] = yA[k] + ds[k] * r3.ky[k];
    }

    const r4 = evalUnitDir(p4x, p4y);
    const nextX = new Float64Array(nAct);
    const nextY = new Float64Array(nAct);
    const substepOk = new Uint8Array(nAct);

    for (let k = 0; k < nAct; k++) {
      const nx =
        xA[k] + (ds[k] / 6.0) * (k1x[k] + 2.0 * r2.kx[k] + 2.0 * r3.kx[k] + r4.kx[k]);
      const ny =
        yA[k] + (ds[k] / 6.0) * (k1y[k] + 2.0 * r2.ky[k] + 2.0 * r3.ky[k] + r4.ky[k]);
      nextX[k] = nx;
      nextY[k] = ny;
      substepOk[k] =
        Number.isFinite(nx) &&
        Number.isFinite(ny) &&
        r2.spd[k] >= 1e-6 &&
        r3.spd[k] >= 1e-6 &&
        r4.spd[k] >= 1e-6
          ? 1
          : 0;
    }

    const dminNext = minDistanceToPanelsBatch(nextX, nextY, mesh);

    const nearIndices: number[] = [];
    for (let k = 0; k < nAct; k++) {
      if (
        nextX[k] >= -0.05 &&
        nextX[k] <= 1.05 &&
        Math.abs(nextY[k]) <= 0.35
      ) {
        nearIndices.push(k);
      }
    }

    const insideNext = new Uint8Array(nAct);
    const insideMid = new Uint8Array(nAct);
    if (nearIndices.length > 0) {
      const nNear = nearIndices.length;
      const nearX = new Float64Array(nNear);
      const nearY = new Float64Array(nNear);
      const midX = new Float64Array(nNear);
      const midY = new Float64Array(nNear);
      for (let m = 0; m < nNear; m++) {
        const k = nearIndices[m];
        nearX[m] = nextX[k];
        nearY[m] = nextY[k];
        midX[m] = 0.5 * (xA[k] + nextX[k]);
        midY[m] = 0.5 * (yA[k] + nextY[k]);
      }
      const inN = pointInPolygonBatch(nearX, nearY, mesh.x, mesh.y);
      const inM = pointInPolygonBatch(midX, midY, mesh.x, mesh.y);
      for (let m = 0; m < nNear; m++) {
        const k = nearIndices[m];
        insideNext[k] = inN[m];
        insideMid[k] = inM[m];
      }
    }

    for (let k = 0; k < nAct; k++) {
      const idx = validIndices[k];
      const hitAirfoil =
        substepOk[k] === 0 ||
        insideNext[k] === 1 ||
        insideMid[k] === 1 ||
        dminNext[k] < WALL_COLLISION_DIST;

      if (hitAirfoil) {
        active[idx] = 0;
        continue;
      }

      const col = lengths[idx];
      trajX[idx * stride + col] = nextX[k];
      trajY[idx * stride + col] = nextY[k];
      lengths[idx] = col + 1;
      currX[idx] = nextX[k];
      currY[idx] = nextY[k];
      currDmin[idx] = dminNext[k];

      const exited =
        nextX[k] > xMax ||
        nextX[k] < xMin - DOMAIN_EXIT_MARGIN ||
        nextY[k] < yMin - DOMAIN_EXIT_MARGIN ||
        nextY[k] > yMax + DOMAIN_EXIT_MARGIN;
      if (exited) {
        active[idx] = 0;
      }
    }
  }

  const polylines: StreamlinePolyline[] = [];
  for (let i = 0; i < nLines; i++) {
    const nPts = lengths[i];
    if (nPts >= 2) {
      const xs: number[] = new Array(nPts);
      const ys: number[] = new Array(nPts);
      const base = i * stride;
      for (let p = 0; p < nPts; p++) {
        xs[p] = roundDecimals(trajX[base + p], STREAMLINE_ROUND_DECIMALS);
        ys[p] = roundDecimals(trajY[base + p], STREAMLINE_ROUND_DECIMALS);
      }
      polylines.push({ x: xs, y: ys });
    }
  }

  return polylines;
}
