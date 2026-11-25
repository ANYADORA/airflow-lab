/**
 * HTML5 Canvas 2D による 2D 流れ場レンダラ実装。
 *
 * 描画順序:
 * 1. オフスクリーン ImageData による双線形補間コンター（Viridis 速度比 / RdBu 圧力係数）
 * 2. グリッド速度ベクトル矢印
 * 3. 弧長正規化 RK4 流線ポリライン
 * 4. 翼型断面ポリゴン（ニュートラルグレー塗りつぶし + 明瞭な輪郭線）
 * 5. Cp,min 点マーカーおよびホバー x/c 縦ガイド線
 *
 * ※ jsdom 等の getContext('2d') === null 環境でも安全に no-op で終了する null ガードを備える。
 */

import type { FlowFieldData } from '../types/api';
import type { FlowHoverSample } from '../types/ui';
import { mapCpToRgb, mapSpeedRatioToRgb } from '../utils/colormaps';
import {
  computeTransform,
  rotateVectorToViewFrame,
  screenToWorldFast,
  worldToScreenFast,
  type ComputedTransform,
} from '../utils/coordTransform';
import type { FlowRenderOptions, FlowRenderer } from './FlowRenderer';

function findBracket(arr: number[], val: number): [number, number, number] | null {
  const n = arr.length;
  if (n < 2) return null;
  if (val < arr[0] || val > arr[n - 1]) return null;

  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= val) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const span = arr[hi] - arr[lo];
  const frac = span > 0 ? (val - arr[lo]) / span : 0;
  return [lo, hi, frac];
}

function bilinearSample(
  grid: (number | null)[][],
  iy0: number,
  iy1: number,
  ty: number,
  ix0: number,
  ix1: number,
  tx: number
): number | null {
  const v00 = grid[iy0]?.[ix0] ?? null;
  const v10 = grid[iy0]?.[ix1] ?? null;
  const v01 = grid[iy1]?.[ix0] ?? null;
  const v11 = grid[iy1]?.[ix1] ?? null;

  const w00 = (1 - tx) * (1 - ty);
  const w10 = tx * (1 - ty);
  const w01 = (1 - tx) * ty;
  const w11 = tx * ty;

  let sum = 0;
  let wSum = 0;
  if (v00 !== null) {
    sum += v00 * w00;
    wSum += w00;
  }
  if (v10 !== null) {
    sum += v10 * w10;
    wSum += w10;
  }
  if (v01 !== null) {
    sum += v01 * w01;
    wSum += w01;
  }
  if (v11 !== null) {
    sum += v11 * w11;
    wSum += w11;
  }

  return wSum > 1e-6 ? sum / wSum : null;
}

export class Canvas2DFlowRenderer implements FlowRenderer {
  private offscreenCanvas: HTMLCanvasElement | null = null;

  public clear(canvas: HTMLCanvasElement): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  public render(canvas: HTMLCanvasElement, options: FlowRenderOptions): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { result, viewSettings, viewport, hoveredXc } = options;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const cssWidth = canvas.clientWidth || canvas.width / dpr || 640;
    const cssHeight = canvas.clientHeight || canvas.height / dpr || 360;

    if (canvas.width !== Math.round(cssWidth * dpr) || canvas.height !== Math.round(cssHeight * dpr)) {
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
    }

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    if (result.status !== 'success' || !result.flow_field || !result.airfoil_geometry) {
      ctx.restore();
      return;
    }

    const xRange = result.inputs.numerical_settings.x_range;
    const yRange = result.inputs.numerical_settings.y_range;
    const alphaDeg = result.inputs.angle_of_attack;

    const transform = computeTransform({
      canvasWidth: cssWidth,
      canvasHeight: cssHeight,
      xRange,
      yRange,
      viewport,
      viewFrame: viewSettings.viewFrame,
      alphaDeg,
    });

    // 1. 背景コンター
    if (viewSettings.contourLayer !== 'none') {
      this.drawContour(
        ctx,
        cssWidth,
        cssHeight,
        result.flow_field,
        viewSettings.contourLayer,
        transform
      );
    }

    // 補助軸グリッド（x/c = 0, 1 および y/c = 0）
    this.drawReferenceAxes(ctx, xRange, yRange, transform);

    // 2. 速度ベクトル矢印
    if (viewSettings.showVectors) {
      this.drawVelocityVectors(ctx, result.flow_field, transform);
    }

    // 3. 流線
    if (viewSettings.showStreamlines && result.streamlines) {
      this.drawStreamlines(
        ctx,
        result.streamlines,
        transform,
        viewSettings.contourLayer !== 'none'
      );
    }

    // 4. 翼型断面ポリゴン
    this.drawAirfoil(ctx, result.airfoil_geometry.x, result.airfoil_geometry.y, transform);

    // 5. Cp,min マーカー & ホバーガイド
    if (result.diagnostics.cp_min_xc !== null && result.surface) {
      this.drawCpMinMarker(ctx, result.surface.x_c, result.surface.y_c, result.surface.cp, transform);
    }
    if (hoveredXc !== null && hoveredXc >= 0 && hoveredXc <= 1) {
      this.drawHoverGuide(ctx, hoveredXc, yRange, transform);
    }

    ctx.restore();
  }

  public hitTest(
    canvas: HTMLCanvasElement,
    clientOffsetX: number,
    clientOffsetY: number,
    options: FlowRenderOptions
  ): FlowHoverSample | null {
    const { result, viewSettings, viewport } = options;
    if (result.status !== 'success' || !result.flow_field) return null;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const cssWidth = canvas.clientWidth || canvas.width / dpr || 640;
    const cssHeight = canvas.clientHeight || canvas.height / dpr || 360;

    const transform = computeTransform({
      canvasWidth: cssWidth,
      canvasHeight: cssHeight,
      xRange: result.inputs.numerical_settings.x_range,
      yRange: result.inputs.numerical_settings.y_range,
      viewport,
      viewFrame: viewSettings.viewFrame,
      alphaDeg: result.inputs.angle_of_attack,
    });

    const world = screenToWorldFast({ x: clientOffsetX, y: clientOffsetY }, transform);
    const ff = result.flow_field;
    const bx = findBracket(ff.x_grid, world.x);
    const by = findBracket(ff.y_grid, world.y);
    if (!bx || !by) return null;

    const [ix0, ix1, tx] = bx;
    const [iy0, iy1, ty] = by;
    const nearX = tx < 0.5 ? ix0 : ix1;
    const nearY = ty < 0.5 ? iy0 : iy1;
    const isInside = ff.is_inside_airfoil[nearY]?.[nearX] ?? false;

    if (isInside) {
      return {
        x_c: world.x,
        y_c: world.y,
        screenX: clientOffsetX,
        screenY: clientOffsetY,
        isInsideAirfoil: true,
        u_ratio: null,
        v_ratio: null,
        speed_ratio: null,
        speed_mps: null,
        cp: null,
      };
    }

    const uRatio = bilinearSample(ff.u_ratio, iy0, iy1, ty, ix0, ix1, tx);
    const vRatio = bilinearSample(ff.v_ratio, iy0, iy1, ty, ix0, ix1, tx);
    const speedRatio = bilinearSample(ff.speed_ratio, iy0, iy1, ty, ix0, ix1, tx);
    const cp = bilinearSample(ff.cp, iy0, iy1, ty, ix0, ix1, tx);

    return {
      x_c: world.x,
      y_c: world.y,
      screenX: clientOffsetX,
      screenY: clientOffsetY,
      isInsideAirfoil: false,
      u_ratio: uRatio,
      v_ratio: vRatio,
      speed_ratio: speedRatio,
      speed_mps: speedRatio !== null ? speedRatio * result.inputs.velocity : null,
      cp,
    };
  }

  public dispose(): void {
    this.offscreenCanvas = null;
  }

  private drawContour(
    ctx: CanvasRenderingContext2D,
    cssWidth: number,
    cssHeight: number,
    flowField: FlowFieldData,
    layer: 'speed' | 'cp',
    transform: ComputedTransform
  ): void {
    // 描画負荷を抑えつつ滑らかに補間するため最大 240x160 相当のオフスクリーン解像度で生成
    const offW = Math.max(60, Math.min(260, Math.round(cssWidth * 0.45)));
    const offH = Math.max(40, Math.min(180, Math.round(cssHeight * 0.45)));

    if (!this.offscreenCanvas) {
      this.offscreenCanvas = document.createElement('canvas');
    }
    this.offscreenCanvas.width = offW;
    this.offscreenCanvas.height = offH;
    const offCtx = this.offscreenCanvas.getContext('2d');
    if (!offCtx) return;

    const img = offCtx.createImageData(offW, offH);
    const data = img.data;
    const fieldGrid = layer === 'speed' ? flowField.speed_ratio : flowField.cp;

    for (let py = 0; py < offH; py += 1) {
      const sy = ((py + 0.5) / offH) * cssHeight;
      for (let px = 0; px < offW; px += 1) {
        const sx = ((px + 0.5) / offW) * cssWidth;
        const w = screenToWorldFast({ x: sx, y: sy }, transform);
        const bx = findBracket(flowField.x_grid, w.x);
        const by = findBracket(flowField.y_grid, w.y);
        const idx = (py * offW + px) * 4;

        if (!bx || !by) {
          data[idx + 3] = 0;
          continue;
        }

        const [ix0, ix1, tx] = bx;
        const [iy0, iy1, ty] = by;
        const val = bilinearSample(fieldGrid, iy0, iy1, ty, ix0, ix1, tx);
        if (val === null) {
          data[idx + 3] = 0;
          continue;
        }

        const [r, g, b] = layer === 'speed' ? mapSpeedRatioToRgb(val) : mapCpToRgb(val);
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 220;
      }
    }

    offCtx.putImageData(img, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.offscreenCanvas, 0, 0, cssWidth, cssHeight);
    ctx.restore();
  }

  private drawReferenceAxes(
    ctx: CanvasRenderingContext2D,
    xRange: [number, number],
    yRange: [number, number],
    transform: ComputedTransform
  ): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(100, 116, 139, 0.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    // 弦線 (y/c = 0)
    const p0 = worldToScreenFast({ x: xRange[0], y: 0 }, transform);
    const p1 = worldToScreenFast({ x: xRange[1], y: 0 }, transform);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();

    // 前縁 (x/c = 0) と後縁 (x/c = 1)
    for (const xc of [0, 1]) {
      const a = worldToScreenFast({ x: xc, y: yRange[0] }, transform);
      const b = worldToScreenFast({ x: xc, y: yRange[1] }, transform);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawVelocityVectors(
    ctx: CanvasRenderingContext2D,
    flowField: FlowFieldData,
    transform: ComputedTransform
  ): void {
    const nx = flowField.x_grid.length;
    const ny = flowField.y_grid.length;
    const stepX = Math.max(1, Math.floor(nx / 24));
    const stepY = Math.max(1, Math.floor(ny / 16));
    const arrowScalePx = Math.max(8, Math.min(20, transform.scale * 0.045));

    ctx.save();
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.72)';
    ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
    ctx.lineWidth = 1.1;

    for (let iy = 0; iy < ny; iy += stepY) {
      const wy = flowField.y_grid[iy];
      for (let ix = 0; ix < nx; ix += stepX) {
        if (flowField.is_inside_airfoil[iy]?.[ix]) continue;
        const u = flowField.u_ratio[iy]?.[ix];
        const v = flowField.v_ratio[iy]?.[ix];
        if (u === null || u === undefined || v === null || v === undefined) continue;

        const wx = flowField.x_grid[ix];
        const base = worldToScreenFast({ x: wx, y: wy }, transform);
        const rot = rotateVectorToViewFrame(u, v, transform);
        const mag = Math.hypot(rot.x, rot.y);
        if (mag < 1e-4) continue;

        const clampedMag = Math.min(2.0, mag);
        const dx = (rot.x / mag) * clampedMag * arrowScalePx;
        const dy = -(rot.y / mag) * clampedMag * arrowScalePx;
        const tipX = base.x + dx;
        const tipY = base.y + dy;

        ctx.beginPath();
        ctx.moveTo(base.x, base.y);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();

        // 矢印先端
        const angle = Math.atan2(dy, dx);
        const headLen = 4.5;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(
          tipX - headLen * Math.cos(angle - Math.PI / 6),
          tipY - headLen * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
          tipX - headLen * Math.cos(angle + Math.PI / 6),
          tipY - headLen * Math.sin(angle + Math.PI / 6)
        );
        ctx.closePath();
        ctx.fill();
      }
    }

    ctx.restore();
  }

  private drawStreamlines(
    ctx: CanvasRenderingContext2D,
    streamlines: Array<{ x: number[]; y: number[] }>,
    transform: ComputedTransform,
    hasContour: boolean
  ): void {
    ctx.save();
    ctx.strokeStyle = hasContour ? 'rgba(255, 255, 255, 0.85)' : 'rgba(30, 64, 175, 0.8)';
    ctx.lineWidth = hasContour ? 1.25 : 1.4;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    for (const line of streamlines) {
      if (line.x.length < 2) continue;
      ctx.beginPath();
      const p0 = worldToScreenFast({ x: line.x[0], y: line.y[0] }, transform);
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < line.x.length; i += 1) {
        const pt = worldToScreenFast({ x: line.x[i], y: line.y[i] }, transform);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawAirfoil(
    ctx: CanvasRenderingContext2D,
    xs: number[],
    ys: number[],
    transform: ComputedTransform
  ): void {
    if (xs.length < 3) return;
    ctx.save();
    ctx.beginPath();
    const first = worldToScreenFast({ x: xs[0], y: ys[0] }, transform);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < xs.length; i += 1) {
      const pt = worldToScreenFast({ x: xs[i], y: ys[i] }, transform);
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.closePath();
    ctx.fillStyle = '#94a3b8';
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  private drawCpMinMarker(
    ctx: CanvasRenderingContext2D,
    xC: number[],
    yC: number[],
    cp: number[],
    transform: ComputedTransform
  ): void {
    if (cp.length === 0) return;
    let minIdx = 0;
    for (let i = 1; i < cp.length; i += 1) {
      if (cp[i] < cp[minIdx]) minIdx = i;
    }
    const pt = worldToScreenFast({ x: xC[minIdx], y: yC[minIdx] }, transform);
    ctx.save();
    ctx.fillStyle = '#f59e0b';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawHoverGuide(
    ctx: CanvasRenderingContext2D,
    xc: number,
    yRange: [number, number],
    transform: ComputedTransform
  ): void {
    const pTop = worldToScreenFast({ x: xc, y: yRange[1] }, transform);
    const pBot = worldToScreenFast({ x: xc, y: yRange[0] }, transform);
    ctx.save();
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.85)';
    ctx.lineWidth = 1.25;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(pTop.x, pTop.y);
    ctx.lineTo(pBot.x, pBot.y);
    ctx.stroke();
    ctx.restore();
  }
}
