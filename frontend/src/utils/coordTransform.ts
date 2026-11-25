/**
 * 物理座標（無次元翼弦座標 x/c, y/c）⇔ スクリーン座標（Canvas px）の 1:1 等方変換。
 * - アスペクト比 1:1 を厳守し、翼型の縦横歪みを防止する。
 * - 標準（翼固定視点）と風洞視点（一様流水平・翼型を時計回りに α 回転）を可逆変換する。
 */

import type { ViewFrame, ViewportTransform } from '../types/ui';

export interface Point2D {
  x: number;
  y: number;
}

export interface CoordTransformParams {
  canvasWidth: number;
  canvasHeight: number;
  xRange: [number, number];
  yRange: [number, number];
  viewport: ViewportTransform;
  viewFrame: ViewFrame;
  alphaDeg: number;
  paddingPx?: number;
}

export interface ComputedTransform {
  scale: number;
  originX: number;
  originY: number;
  pivotX: number;
  pivotY: number;
  cosRot: number;
  sinRot: number;
}

const DEFAULT_PADDING_PX = 24;
const ROTATION_PIVOT_X = 0.5;
const ROTATION_PIVOT_Y = 0.0;

/**
 * 描画パラメータから等方スケール・原点・回転係数を算出する。
 */
export function computeTransform(params: CoordTransformParams): ComputedTransform {
  const {
    canvasWidth,
    canvasHeight,
    xRange,
    yRange,
    viewport,
    viewFrame,
    alphaDeg,
    paddingPx = DEFAULT_PADDING_PX,
  } = params;

  const domainWidth = Math.max(1e-6, xRange[1] - xRange[0]);
  const domainHeight = Math.max(1e-6, yRange[1] - yRange[0]);
  const usableW = Math.max(1, canvasWidth - paddingPx * 2);
  const usableH = Math.max(1, canvasHeight - paddingPx * 2);

  // アスペクト比 1:1 等方スケーリング
  const baseScale = Math.min(usableW / domainWidth, usableH / domainHeight);
  const scale = baseScale * Math.max(0.1, viewport.zoom);

  const centerWorldX = 0.5 * (xRange[0] + xRange[1]);
  const centerWorldY = 0.5 * (yRange[0] + yRange[1]);

  const originX = canvasWidth * 0.5 + viewport.panX - centerWorldX * scale;
  const originY = canvasHeight * 0.5 + viewport.panY + centerWorldY * scale;

  // 風洞視点では翼型を時計回りに α 回転（数学角 -α）
  const rotRad = viewFrame === 'wind_tunnel' ? (-alphaDeg * Math.PI) / 180.0 : 0.0;

  return {
    scale,
    originX,
    originY,
    pivotX: ROTATION_PIVOT_X,
    pivotY: ROTATION_PIVOT_Y,
    cosRot: Math.cos(rotRad),
    sinRot: Math.sin(rotRad),
  };
}

/**
 * 翼固定座標 (x/c, y/c) → 表示フレーム座標（風洞視点時は -α 回転済み）へ変換する。
 */
export function worldToViewFrame(point: Point2D, t: ComputedTransform): Point2D {
  const dx = point.x - t.pivotX;
  const dy = point.y - t.pivotY;
  return {
    x: t.pivotX + dx * t.cosRot - dy * t.sinRot,
    y: t.pivotY + dx * t.sinRot + dy * t.cosRot,
  };
}

/**
 * 表示フレーム座標 → 翼固定座標 (x/c, y/c) へ逆変換する。
 */
export function viewFrameToWorld(point: Point2D, t: ComputedTransform): Point2D {
  const dx = point.x - t.pivotX;
  const dy = point.y - t.pivotY;
  // 逆回転（+α）：cos(-θ)=cos, sin(-θ)=-sin
  return {
    x: t.pivotX + dx * t.cosRot + dy * t.sinRot,
    y: t.pivotY - dx * t.sinRot + dy * t.cosRot,
  };
}

/**
 * 翼固定の物理座標 (x/c, y/c) を Canvas スクリーン座標 (px) へ変換する。
 */
export function worldToScreen(point: Point2D, params: CoordTransformParams): Point2D {
  const t = computeTransform(params);
  return worldToScreenFast(point, t);
}

/**
 * 事前計算済み変換係数で物理座標 → スクリーン座標へ高速変換する。
 */
export function worldToScreenFast(point: Point2D, t: ComputedTransform): Point2D {
  const vf = worldToViewFrame(point, t);
  return {
    x: t.originX + vf.x * t.scale,
    y: t.originY - vf.y * t.scale,
  };
}

/**
 * Canvas スクリーン座標 (px) を翼固定の物理座標 (x/c, y/c) へ逆変換する。
 * 風洞視点でも回転前の翼弦座標 (x/c, y/c) を返すため、Cp グラフ同期にそのまま使える。
 */
export function screenToWorld(screenPoint: Point2D, params: CoordTransformParams): Point2D {
  const t = computeTransform(params);
  return screenToWorldFast(screenPoint, t);
}

/**
 * 事前計算済み変換係数でスクリーン座標 → 物理座標へ高速逆変換する。
 */
export function screenToWorldFast(screenPoint: Point2D, t: ComputedTransform): Point2D {
  const vf: Point2D = {
    x: (screenPoint.x - t.originX) / t.scale,
    y: (t.originY - screenPoint.y) / t.scale,
  };
  return viewFrameToWorld(vf, t);
}

/**
 * 速度ベクトル (u, v) を表示フレームに合わせて回転させる（風洞視点時は -α 回転）。
 */
export function rotateVectorToViewFrame(u: number, v: number, t: ComputedTransform): Point2D {
  return {
    x: u * t.cosRot - v * t.sinRot,
    y: u * t.sinRot + v * t.cosRot,
  };
}
