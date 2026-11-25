/**
 * Hess-Smith 2D パネル法ソルバー・分岐切断フリー影響係数・2段階特異値ガード付き空間速度カーネル。
 *
 * Python 版 `backend/app/solvers/panel/influence.py`, `hess_smith.py`, `models/solver.py` と
 * 数式・Gate 2 閾値・符号規約を完全一致させて移植している。
 */

import type {
  AerodynamicCoefficients,
  AnalysisDiagnostics,
  FailureInfo,
  SurfaceDistribution,
} from '../types/api';
import type { AirfoilMesh } from './geometry';

export const TWO_PI = 2.0 * Math.PI;
export const ENDPOINT_REG_EPS = 1e-6;
export const NEAR_PANEL_ETA_EPS = 1e-3;

export const MAX_CONDITION_NUMBER = 1.0e10;
export const MAX_LINEAR_RESIDUAL = 1.0e-8;
export const BASE_MASS_FLUX_TOL = 0.05;
export const MAX_TE_CP_DIFF = 1.0e-5;
export const MIN_ALLOWED_CP = -500.0;
export const MAX_ALLOWED_CP = 1.0 + 1.0e-6;

export const PHASE1_CD_UNAVAILABLE_REASON =
  '非粘性ポテンシャル流れ（パネル法）では粘性抗力・剥離抗力を算出できません（Phase 2 XFOIL で対応予定）。';

export interface InfluenceMatrices {
  n: number;
  aN: Float64Array;
  aT: Float64Array;
  bN: Float64Array;
  bT: Float64Array;
}

export interface PanelSolveResult {
  status: 'success' | 'failed';
  coefficients: AerodynamicCoefficients | null;
  diagnostics: AnalysisDiagnostics;
  surface: SurfaceDistribution | null;
  failure: FailureInfo | null;
  sigma: Float64Array | null;
  gamma: number | null;
  vtRatio: Float64Array | null;
}

export function computePanelInfluenceMatrices(mesh: AirfoilMesh): InfluenceMatrices {
  const n = mesh.s.length;
  const nn = n * n;
  const aN = new Float64Array(nn);
  const aT = new Float64Array(nn);
  const bN = new Float64Array(nn);
  const bT = new Float64Array(nn);

  for (let i = 0; i < n; i++) {
    const xci = mesh.xC[i];
    const yci = mesh.yC[i];
    const txi = mesh.tx[i];
    const tyi = mesh.ty[i];
    const rowOff = i * n;

    for (let j = 0; j < n; j++) {
      if (i === j && mesh.s[j] > 1e-14) {
        aN[rowOff + j] = 0.5;
        aT[rowOff + j] = 0.0;
        bN[rowOff + j] = 0.0;
        bT[rowOff + j] = 0.5;
        continue;
      }

      const dx = xci - mesh.x[j];
      const dy = yci - mesh.y[j];
      const txj = mesh.tx[j];
      const tyj = mesh.ty[j];
      const sj = mesh.s[j];

      const xi = dx * txj + dy * tyj;
      const eta = -dx * tyj + dy * txj;
      const r1Sq = xi * xi + eta * eta;
      const xims = xi - sj;
      const r2Sq = xims * xims + eta * eta;

      const lam = 0.5 * Math.log(r2Sq / r1Sq);
      const beta = Math.atan2(eta * sj, xi * xims + eta * eta);

      const us = -lam / TWO_PI;
      const vs = beta / TWO_PI;

      const cosDphi = txi * txj + tyi * tyj;
      const sinDphi = tyi * txj - txi * tyj;

      const anVal = -us * sinDphi + vs * cosDphi;
      const atVal = us * cosDphi + vs * sinDphi;

      aN[rowOff + j] = anVal;
      aT[rowOff + j] = atVal;
      bN[rowOff + j] = -atVal;
      bT[rowOff + j] = anVal;
    }
  }

  return { n, aN, aT, bN, bT };
}

interface LUDecomposition {
  m: number;
  lu: Float64Array;
  piv: Int32Array;
}

function factorizeLU(matrix: Float64Array, m: number): LUDecomposition {
  const lu = new Float64Array(matrix);
  const piv = new Int32Array(m);
  for (let i = 0; i < m; i++) piv[i] = i;

  for (let k = 0; k < m; k++) {
    let pRow = k;
    let maxVal = Math.abs(lu[k * m + k]);
    for (let i = k + 1; i < m; i++) {
      const v = Math.abs(lu[i * m + k]);
      if (v > maxVal) {
        maxVal = v;
        pRow = i;
      }
    }

    if (maxVal === 0.0 || !Number.isFinite(maxVal)) {
      throw new Error('Matrix is numerically singular');
    }

    if (pRow !== k) {
      const kOff = k * m;
      const pOff = pRow * m;
      for (let j = 0; j < m; j++) {
        const tmp = lu[kOff + j];
        lu[kOff + j] = lu[pOff + j];
        lu[pOff + j] = tmp;
      }
      const pTmp = piv[k];
      piv[k] = piv[pRow];
      piv[pRow] = pTmp;
    }

    const diag = lu[k * m + k];
    if (Math.abs(diag) <= 1e-300) {
      throw new Error('Zero diagonal pivot encountered');
    }
    const kOff = k * m;
    for (let i = k + 1; i < m; i++) {
      const iOff = i * m;
      const factor = lu[iOff + k] / diag;
      lu[iOff + k] = factor;
      for (let j = k + 1; j < m; j++) {
        lu[iOff + j] -= factor * lu[kOff + j];
      }
    }
  }

  return { m, lu, piv };
}

function solveFromLU(decomp: LUDecomposition, rhs: Float64Array): Float64Array {
  const { m, lu, piv } = decomp;
  const x = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    x[i] = rhs[piv[i]];
  }
  // Forward substitution L y = P b
  for (let i = 0; i < m; i++) {
    let sum = x[i];
    const iOff = i * m;
    for (let j = 0; j < i; j++) {
      sum -= lu[iOff + j] * x[j];
    }
    x[i] = sum;
  }
  // Back substitution U x = y
  for (let i = m - 1; i >= 0; i--) {
    let sum = x[i];
    const iOff = i * m;
    for (let j = i + 1; j < m; j++) {
      sum -= lu[iOff + j] * x[j];
    }
    const diag = lu[iOff + i];
    if (Math.abs(diag) <= 1e-300) {
      throw new Error('Zero upper-triangular pivot encountered');
    }
    x[i] = sum / diag;
  }
  return x;
}

/**
 * 1-ノルム条件数 kappa_1(M) = ||M||_1 * ||M^{-1}||_1 を LU 逆行列列ベクトル求解で精密算出する。
 * m <= 301 のため実行コストは数 ms 以内で、特異・悪条件行列を高感度に検出できる。
 */
function computeConditionNumber1Norm(
  matrix: Float64Array,
  decomp: LUDecomposition
): number {
  const m = decomp.m;

  // ||M||_1 = max_j sum_i |M_{i,j}|
  let normM1 = 0.0;
  for (let j = 0; j < m; j++) {
    let colSum = 0.0;
    for (let i = 0; i < m; i++) {
      colSum += Math.abs(matrix[i * m + j]);
    }
    if (colSum > normM1) normM1 = colSum;
  }

  // ||M^{-1}||_1 = max_j sum_i |(M^{-1})_{i,j}|
  let normInv1 = 0.0;
  const ej = new Float64Array(m);
  for (let j = 0; j < m; j++) {
    ej[j] = 1.0;
    const col = solveFromLU(decomp, ej);
    ej[j] = 0.0;
    let colSum = 0.0;
    for (let i = 0; i < m; i++) {
      const av = Math.abs(col[i]);
      if (!Number.isFinite(av)) return Infinity;
      colSum += av;
    }
    if (colSum > normInv1) normInv1 = colSum;
  }

  return normM1 * normInv1;
}

function makeFailedOutput(params: {
  code: string;
  message: string;
  computeTimeMs: number;
  details?: Record<string, unknown> | null;
  conditionNumber?: number | null;
  linearResidualMax?: number | null;
  teCpDiff?: number | null;
  cpMin?: number | null;
  cpMinXc?: number | null;
  maxVelocityRatio?: number | null;
}): PanelSolveResult {
  const {
    code,
    message,
    computeTimeMs,
    details = null,
    conditionNumber = null,
    linearResidualMax = null,
    teCpDiff = null,
    cpMin = null,
    cpMinXc = null,
    maxVelocityRatio = null,
  } = params;

  const safeCond =
    conditionNumber !== null && Number.isFinite(conditionNumber) ? conditionNumber : null;
  const safeRes =
    linearResidualMax !== null && Number.isFinite(linearResidualMax) ? linearResidualMax : null;

  return {
    status: 'failed',
    coefficients: null,
    surface: null,
    sigma: null,
    gamma: null,
    vtRatio: null,
    diagnostics: {
      converged: false,
      condition_number: safeCond,
      linear_residual_max: safeRes,
      te_cp_diff: teCpDiff,
      cl_discrepancy: null,
      cl_discrepancy_relative: null,
      cd_pressure_numerical_error: null,
      cp_min: cpMin,
      cp_min_xc: cpMinXc,
      max_velocity_ratio: maxVelocityRatio,
      compute_time_ms: computeTimeMs,
    },
    failure: {
      code,
      message,
      details,
    },
  };
}

export function solvePanelMethod(
  mesh: AirfoilMesh,
  alphaRad: number,
  enforceKutta = true
): PanelSolveResult {
  const t0 = performance.now();
  const nPanels = mesh.s.length;

  let minPanelLen = nPanels > 0 ? Infinity : 0.0;
  let allGeomFinite = true;
  for (let i = 0; i < mesh.x.length; i++) {
    if (!Number.isFinite(mesh.x[i]) || !Number.isFinite(mesh.y[i])) {
      allGeomFinite = false;
      break;
    }
  }
  for (let i = 0; i < nPanels; i++) {
    if (!Number.isFinite(mesh.s[i])) {
      allGeomFinite = false;
      break;
    }
    if (mesh.s[i] < minPanelLen) minPanelLen = mesh.s[i];
  }

  if (nPanels < 4 || !allGeomFinite || minPanelLen <= 1e-14) {
    return makeFailedOutput({
      code: 'DEGENERATE_GEOMETRY',
      message: 'ゼロ長パネルまたは非有限座標を含む退化メッシュのため、パネル法解析を中断しました。',
      computeTimeMs: performance.now() - t0,
      details: { num_panels: nPanels, min_panel_length: minPanelLen },
    });
  }

  if (!Number.isFinite(alphaRad)) {
    return makeFailedOutput({
      code: 'NON_FINITE_INPUT',
      message: '迎角に非有限値（NaN/Inf）が指定されたため解析を中断しました。',
      computeTimeMs: performance.now() - t0,
    });
  }

  const { aN, aT, bN, bT } = computePanelInfluenceMatrices(mesh);

  const mDim = enforceKutta ? nPanels + 1 : nPanels;
  const matrix = new Float64Array(mDim * mDim);
  const rhs = new Float64Array(mDim);

  if (enforceKutta) {
    for (let i = 0; i < nPanels; i++) {
      const mRow = i * mDim;
      const aRow = i * nPanels;
      let sumBn = 0.0;
      for (let j = 0; j < nPanels; j++) {
        matrix[mRow + j] = aN[aRow + j];
        sumBn += bN[aRow + j];
      }
      matrix[mRow + nPanels] = sumBn;
      rhs[i] = -Math.sin(alphaRad - mesh.phi[i]);
    }

    const lastRow = nPanels * mDim;
    const lastPanelOff = (nPanels - 1) * nPanels;
    let sumBtKutta = 0.0;
    for (let j = 0; j < nPanels; j++) {
      matrix[lastRow + j] = aT[j] + aT[lastPanelOff + j];
      sumBtKutta += bT[j] + bT[lastPanelOff + j];
    }
    matrix[lastRow + nPanels] = sumBtKutta;
    rhs[nPanels] = -(
      Math.cos(alphaRad - mesh.phi[0]) + Math.cos(alphaRad - mesh.phi[nPanels - 1])
    );
  } else {
    matrix.set(aN);
    for (let i = 0; i < nPanels; i++) {
      rhs[i] = -Math.sin(alphaRad - mesh.phi[i]);
    }
  }

  for (let i = 0; i < matrix.length; i++) {
    if (!Number.isFinite(matrix[i])) {
      return makeFailedOutput({
        code: 'NON_FINITE_MATRIX',
        message: '影響係数行列に NaN または Inf が発生したため（重複パネル等）、解析を中断しました。',
        computeTimeMs: performance.now() - t0,
      });
    }
  }
  for (let i = 0; i < rhs.length; i++) {
    if (!Number.isFinite(rhs[i])) {
      return makeFailedOutput({
        code: 'NON_FINITE_MATRIX',
        message: '影響係数行列に NaN または Inf が発生したため（重複パネル等）、解析を中断しました。',
        computeTimeMs: performance.now() - t0,
      });
    }
  }

  let decomp: LUDecomposition;
  let condNum = Infinity;
  let qSol: Float64Array;

  try {
    decomp = factorizeLU(matrix, mDim);
    condNum = computeConditionNumber1Norm(matrix, decomp);
  } catch (err) {
    return makeFailedOutput({
      code: 'ILL_CONDITIONED_MATRIX',
      message: `パネル法の連立一次方程式の条件数が許容上限（${MAX_CONDITION_NUMBER.toExponential(0)}）を超えたため、解析を中断しました。後縁付近の座標重複や極端に薄い翼型になっていないか確認してください。`,
      computeTimeMs: performance.now() - t0,
      conditionNumber: Infinity,
      details: {
        condition_number: 'inf',
        threshold: MAX_CONDITION_NUMBER,
        cause: err instanceof Error ? err.message : String(err),
      },
    });
  }

  if (!Number.isFinite(condNum) || condNum >= MAX_CONDITION_NUMBER) {
    return makeFailedOutput({
      code: 'ILL_CONDITIONED_MATRIX',
      message: `パネル法の連立一次方程式の条件数が許容上限（${MAX_CONDITION_NUMBER.toExponential(0)}）を超えたため、解析を中断しました。後縁付近の座標重複や極端に薄い翼型になっていないか確認してください。`,
      computeTimeMs: performance.now() - t0,
      conditionNumber: condNum,
      details: {
        condition_number: Number.isFinite(condNum) ? condNum : 'inf',
        threshold: MAX_CONDITION_NUMBER,
      },
    });
  }

  try {
    qSol = solveFromLU(decomp, rhs);
  } catch (err) {
    return makeFailedOutput({
      code: 'SINGULAR_MATRIX',
      message: `パネル法の連立一次方程式が特異行列となったため求解できませんでした: ${err instanceof Error ? err.message : String(err)}`,
      computeTimeMs: performance.now() - t0,
      conditionNumber: condNum,
    });
  }

  for (let i = 0; i < qSol.length; i++) {
    if (!Number.isFinite(qSol[i])) {
      return makeFailedOutput({
        code: 'NON_FINITE_SOLUTION',
        message: '連立一次方程式の解ベクトルに NaN または Inf が検出されたため解析を中断しました。',
        computeTimeMs: performance.now() - t0,
        conditionNumber: condNum,
      });
    }
  }

  // Gate 2-(3): ||M q - b||_inf < 1e-8
  let linearResidualMax = 0.0;
  for (let i = 0; i < mDim; i++) {
    let rowSum = 0.0;
    const iOff = i * mDim;
    for (let j = 0; j < mDim; j++) {
      rowSum += matrix[iOff + j] * qSol[j];
    }
    const diff = Math.abs(rowSum - rhs[i]);
    if (!Number.isFinite(diff) || diff > linearResidualMax) {
      linearResidualMax = diff;
    }
  }

  if (!Number.isFinite(linearResidualMax) || linearResidualMax >= MAX_LINEAR_RESIDUAL) {
    return makeFailedOutput({
      code: 'LINEAR_RESIDUAL_EXCEEDED',
      message: `連立一次方程式の残差ノルム（${linearResidualMax.toExponential(3)}）が許容上限（${MAX_LINEAR_RESIDUAL.toExponential(0)}）を超過しました。`,
      computeTimeMs: performance.now() - t0,
      conditionNumber: condNum,
      linearResidualMax,
      details: {
        linear_residual_max: linearResidualMax,
        threshold: MAX_LINEAR_RESIDUAL,
      },
    });
  }

  const sigma = new Float64Array(nPanels);
  for (let i = 0; i < nPanels; i++) sigma[i] = qSol[i];
  const gamma = enforceKutta ? qSol[nPanels] : 0.0;

  const vtRatio = new Float64Array(nPanels);
  const cp = new Float64Array(nPanels);
  let totalPerimeter = 0.0;

  for (let i = 0; i < nPanels; i++) {
    const iOff = i * nPanels;
    let sumAt = 0.0;
    let sumBt = 0.0;
    for (let j = 0; j < nPanels; j++) {
      sumAt += aT[iOff + j] * sigma[j];
      sumBt += bT[iOff + j];
    }
    const vt = Math.cos(alphaRad - mesh.phi[i]) + sumAt + sumBt * gamma;
    vtRatio[i] = vt;
    cp[i] = 1.0 - vt * vt;
    totalPerimeter += mesh.s[i];
  }

  const gammaCircDimless = gamma * totalPerimeter;
  const clKj = 2.0 * gammaCircDimless;

  let cx = 0.0;
  let cy = 0.0;
  let cmQuarterChord = 0.0;
  for (let i = 0; i < nPanels; i++) {
    const dcx = -cp[i] * mesh.nx[i] * mesh.s[i];
    const dcy = -cp[i] * mesh.ny[i] * mesh.s[i];
    cx += dcx;
    cy += dcy;
    cmQuarterChord -= (mesh.xC[i] - 0.25) * dcy - mesh.yC[i] * dcx;
  }

  const sinA = Math.sin(alphaRad);
  const cosA = Math.cos(alphaRad);
  const clP = -cx * sinA + cy * cosA;
  const cdPNumErr = cx * cosA + cy * sinA;

  let allOutputsFinite =
    Number.isFinite(clKj) && Number.isFinite(clP) && Number.isFinite(cmQuarterChord);
  if (allOutputsFinite) {
    for (let i = 0; i < nPanels; i++) {
      if (!Number.isFinite(vtRatio[i]) || !Number.isFinite(cp[i])) {
        allOutputsFinite = false;
        break;
      }
    }
  }
  if (!allOutputsFinite) {
    return makeFailedOutput({
      code: 'NON_FINITE_SOLUTION',
      message: '表面圧力分布または空力係数に NaN / Inf が発生したため解析を中断しました。',
      computeTimeMs: performance.now() - t0,
      conditionNumber: condNum,
      linearResidualMax,
    });
  }

  let sigmaFlux = 0.0;
  for (let i = 0; i < nPanels; i++) {
    sigmaFlux += sigma[i] * mesh.s[i];
  }
  const massFluxResidual = Math.abs(sigmaFlux);
  const massFluxLimit = BASE_MASS_FLUX_TOL + 2.0 * Math.abs(mesh.teGap);
  const teCpDiff = Math.abs(cp[0] - cp[nPanels - 1]);

  let idxCpMin = 0;
  let cpMin = cp[0];
  let cpMax = cp[0];
  let maxVelRatio = Math.abs(vtRatio[0]);
  for (let i = 1; i < nPanels; i++) {
    if (cp[i] < cpMin) {
      cpMin = cp[i];
      idxCpMin = i;
    }
    if (cp[i] > cpMax) cpMax = cp[i];
    const av = Math.abs(vtRatio[i]);
    if (av > maxVelRatio) maxVelRatio = av;
  }
  const cpMinXc = mesh.xC[idxCpMin];

  if (massFluxResidual >= massFluxLimit) {
    return makeFailedOutput({
      code: 'MASS_CONSERVATION_VIOLATED',
      message: `吹出し強度の総和残差（${massFluxResidual.toFixed(4)}）が許容上限（${massFluxLimit.toFixed(4)}）を超過しました。`,
      computeTimeMs: performance.now() - t0,
      conditionNumber: condNum,
      linearResidualMax,
      teCpDiff,
      details: {
        mass_flux_residual: massFluxResidual,
        threshold: massFluxLimit,
      },
    });
  }

  if (enforceKutta && teCpDiff >= MAX_TE_CP_DIFF) {
    return makeFailedOutput({
      code: 'KUTTA_CONDITION_VIOLATED',
      message: `後縁上下パネルの圧力係数差（${teCpDiff.toExponential(3)}）が許容上限（${MAX_TE_CP_DIFF.toExponential(0)}）を超過しました。`,
      computeTimeMs: performance.now() - t0,
      conditionNumber: condNum,
      linearResidualMax,
      teCpDiff,
      details: { te_cp_diff: teCpDiff, threshold: MAX_TE_CP_DIFF },
    });
  }

  if (cpMin <= MIN_ALLOWED_CP || cpMax > MAX_ALLOWED_CP) {
    return makeFailedOutput({
      code: 'UNPHYSICAL_PRESSURE_COEFFICIENT',
      message: `非物理的な表面圧力係数（min Cp = ${cpMin.toFixed(3)}, max Cp = ${cpMax.toFixed(6)}）が検出されたため描画を遮断しました。`,
      computeTimeMs: performance.now() - t0,
      conditionNumber: condNum,
      linearResidualMax,
      teCpDiff,
      cpMin,
      cpMinXc,
      maxVelocityRatio: maxVelRatio,
      details: {
        cp_min: cpMin,
        cp_max: cpMax,
        min_allowed_cp: MIN_ALLOWED_CP,
        max_allowed_cp: MAX_ALLOWED_CP,
      },
    });
  }

  const clDiscrepancy = Math.abs(clKj - clP);
  const clDiscrepancyRel = Math.abs(clKj) > 1e-12 ? clDiscrepancy / Math.abs(clKj) : 0.0;

  return {
    status: 'success',
    sigma,
    gamma,
    vtRatio,
    failure: null,
    coefficients: {
      cl: clKj,
      cl_kutta_joukowski: clKj,
      cl_pressure_integration: clP,
      cd: null,
      cd_unavailable_reason: PHASE1_CD_UNAVAILABLE_REASON,
      cm_quarter_chord: cmQuarterChord,
    },
    surface: {
      x_c: Array.from(mesh.xC),
      y_c: Array.from(mesh.yC),
      side: [...mesh.side],
      cp: Array.from(cp),
      vt_ratio: Array.from(vtRatio),
    },
    diagnostics: {
      converged: true,
      condition_number: condNum,
      linear_residual_max: linearResidualMax,
      te_cp_diff: teCpDiff,
      cl_discrepancy: clDiscrepancy,
      cl_discrepancy_relative: clDiscrepancyRel,
      cd_pressure_numerical_error: cdPNumErr,
      cp_min: cpMin,
      cp_min_xc: cpMinXc,
      max_velocity_ratio: maxVelRatio,
      compute_time_ms: performance.now() - t0,
    },
  };
}

export function evaluateInducedVelocityBatch(
  px: Float64Array,
  py: Float64Array,
  mesh: AirfoilMesh,
  sigma: Float64Array,
  gamma: number,
  alphaRad: number,
  vtRatio: Float64Array | null
): { u: Float64Array; v: Float64Array } {
  const nPts = px.length;
  const uOut = new Float64Array(nPts);
  const vOut = new Float64Array(nPts);
  if (nPts === 0) return { u: uOut, v: vOut };

  const nPanels = mesh.s.length;
  const uInf = Math.cos(alphaRad);
  const vInf = Math.sin(alphaRad);

  let sMean = 0.0;
  for (let j = 0; j < nPanels; j++) sMean += mesh.s[j];
  sMean = nPanels > 0 ? sMean / nPanels : 0.0;
  const etaClampThresh = NEAR_PANEL_ETA_EPS * sMean;

  const rMinSq = new Float64Array(nPanels);
  for (let j = 0; j < nPanels; j++) {
    const epsS = ENDPOINT_REG_EPS * mesh.s[j];
    rMinSq[j] = Math.max(epsS * epsS, 1e-30);
  }

  for (let p = 0; p < nPts; p++) {
    const qx = px[p];
    const qy = py[p];
    let uSum = uInf;
    let vSum = vInf;

    let nearestEta = Infinity;
    let nearestIdx = -1;

    for (let j = 0; j < nPanels; j++) {
      const dx = qx - mesh.x[j];
      const dy = qy - mesh.y[j];
      const txj = mesh.tx[j];
      const tyj = mesh.ty[j];
      const sj = mesh.s[j];

      const xi = dx * txj + dy * tyj;
      const eta = -dx * tyj + dy * txj;

      if (
        vtRatio !== null &&
        etaClampThresh > 0.0 &&
        xi >= 0.0 &&
        xi <= sj &&
        eta >= 0.0 &&
        eta < etaClampThresh
      ) {
        if (eta < nearestEta) {
          nearestEta = eta;
          nearestIdx = j;
        }
      }

      const xims = xi - sj;
      const rMinSqJ = rMinSq[j];
      const r1Sq = Math.max(xi * xi + eta * eta, rMinSqJ);
      const r2Sq = Math.max(xims * xims + eta * eta, rMinSqJ);

      const lam = 0.5 * Math.log(r2Sq / r1Sq);
      const beta = Math.atan2(eta * sj, xi * xims + eta * eta);

      const sigJ = sigma[j];
      const uLoc = (-lam * sigJ + beta * gamma) / TWO_PI;
      const vLoc = (beta * sigJ + lam * gamma) / TWO_PI;

      uSum += uLoc * txj - vLoc * tyj;
      vSum += uLoc * tyj + vLoc * txj;
    }

    if (nearestIdx >= 0 && vtRatio !== null) {
      uOut[p] = vtRatio[nearestIdx] * mesh.tx[nearestIdx];
      vOut[p] = vtRatio[nearestIdx] * mesh.ty[nearestIdx];
    } else {
      uOut[p] = uSum;
      vOut[p] = vSum;
    }
  }

  return { u: uOut, v: vOut };
}
