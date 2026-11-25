import { describe, expect, it } from 'vitest';
import {
  computeTransform,
  screenToWorld,
  worldToScreen,
  type CoordTransformParams,
} from '../../src/utils/coordTransform';

describe('UT-FE-01: coordTransform (1:1 等方スケーリング & 往復変換)', () => {
  const configs: CoordTransformParams[] = [
    {
      canvasWidth: 960,
      canvasHeight: 540,
      xRange: [-0.5, 1.6],
      yRange: [-0.7, 0.7],
      viewport: { zoom: 1.0, panX: 0, panY: 0 },
      viewFrame: 'airfoil_fixed',
      alphaDeg: 4.0,
    },
    {
      canvasWidth: 375,
      canvasHeight: 300,
      xRange: [-0.5, 1.6],
      yRange: [-0.7, 0.7],
      viewport: { zoom: 2.3, panX: -42, panY: 28 },
      viewFrame: 'wind_tunnel',
      alphaDeg: 8.0,
    },
    {
      canvasWidth: 800,
      canvasHeight: 420,
      xRange: [-1.0, 2.0],
      yRange: [-1.0, 1.0],
      viewport: { zoom: 1.5, panX: 15, panY: -10 },
      viewFrame: 'wind_tunnel',
      alphaDeg: -12.5,
    },
  ];

  it('x方向とy方向の1単位長あたりピクセル数が 1:1（誤差 <= 1e-12）である', () => {
    for (const cfg of configs) {
      const origin = worldToScreen({ x: 0, y: 0 }, cfg);
      const unitX = worldToScreen({ x: 1, y: 0 }, cfg);
      const unitY = worldToScreen({ x: 0, y: 1 }, cfg);

      const lenX = Math.hypot(unitX.x - origin.x, unitX.y - origin.y);
      const lenY = Math.hypot(unitY.x - origin.x, unitY.y - origin.y);
      const ratioErr = Math.abs(lenX / lenY - 1.0);

      expect(ratioErr).toBeLessThanOrEqual(1e-12);
      const t = computeTransform(cfg);
      expect(Math.abs(lenX - t.scale)).toBeLessThanOrEqual(1e-10);
    }
  });

  it('worldToScreen -> screenToWorld の往復誤差が 1e-10 以下である', () => {
    const testPoints = [
      { x: 0.0, y: 0.0 },
      { x: 1.0, y: 0.0 },
      { x: 0.25, y: 0.08 },
      { x: -0.35, y: -0.45 },
      { x: 1.4, y: 0.52 },
    ];

    for (const cfg of configs) {
      for (const pt of testPoints) {
        const scr = worldToScreen(pt, cfg);
        const back = screenToWorld(scr, cfg);
        const err = Math.hypot(back.x - pt.x, back.y - pt.y);
        expect(err).toBeLessThanOrEqual(1e-10);
      }
    }
  });

  it('風洞視点（正迎角）で前縁が上向き・後縁が下向きに傾く', () => {
    const cfg: CoordTransformParams = {
      canvasWidth: 800,
      canvasHeight: 400,
      xRange: [-0.5, 1.6],
      yRange: [-0.7, 0.7],
      viewport: { zoom: 1.0, panX: 0, panY: 0 },
      viewFrame: 'wind_tunnel',
      alphaDeg: 10.0,
    };
    const le = worldToScreen({ x: 0.0, y: 0.0 }, cfg);
    const te = worldToScreen({ x: 1.0, y: 0.0 }, cfg);
    // Canvas y軸は下向き正のため、前縁が上にあるとは le.y < te.y
    expect(le.y).toBeLessThan(te.y);
  });
});
