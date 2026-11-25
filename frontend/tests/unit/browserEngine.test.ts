import { describe, expect, it } from 'vitest';
import { BrowserAnalysisEngine } from '../../src/engine/browserAnalysisEngine';
import { generateNaca4, pointInPolygonBatch } from '../../src/engine/geometry';
import { ApiClientError } from '../../src/services/apiClientError';
import type { AnalysisRequest } from '../../src/types/api';

function makeDefaultRequest(
  overrides: Partial<AnalysisRequest> = {}
): AnalysisRequest {
  return {
    airfoil: {
      source_type: 'naca4',
      naca_code: '0012',
      name: 'NACA 0012',
      raw_coordinates_text: null,
    },
    angle_of_attack: 0.0,
    velocity: 15.0,
    chord_length: 0.2,
    fluid_properties: {
      preset: 'air_std_20c',
      mode: 'temperature_auto',
      temperature_k: 293.15,
      static_pressure_pa: 101325.0,
      density_kg_m3: null,
      dynamic_viscosity_pa_s: null,
      kinematic_viscosity_m2_s: null,
      speed_of_sound_mps: null,
    },
    solver: {
      method: 'panel_method',
    },
    numerical_settings: {
      num_panels: 160,
      closed_te: true,
      grid_nx: 60,
      grid_ny: 40,
      x_range: [-0.5, 1.6],
      y_range: [-0.7, 0.7],
      num_streamlines: 18,
    },
    ...overrides,
  };
}

function buildSeligNaca0012Text(scale = 1.0, offsetX = 0.0, openGap = 0.0): string {
  const nHalf = 35;
  const lines: string[] = ['Custom Test Foil'];
  const xi = Array.from({ length: nHalf + 1 }, (_, k) =>
    0.5 * (1.0 - Math.cos((Math.PI * k) / nHalf))
  );
  const halfThick = (x: number, isUpper: boolean): number => {
    const a4 = openGap > 0 ? -0.1015 : -0.1036;
    const yt =
      5.0 *
      0.12 *
      (0.2969 * Math.sqrt(Math.max(x, 0)) -
        0.126 * x -
        0.3516 * x * x +
        0.2843 * x * x * x +
        a4 * x * x * x * x);
    return isUpper ? yt + openGap * x : -yt - openGap * x;
  };
  // Selig CCW: Upper TE -> LE -> Lower TE
  for (let k = nHalf; k >= 0; k--) {
    const x = xi[k] * scale + offsetX;
    const y = halfThick(xi[k], true) * scale;
    lines.push(`${x.toFixed(6)}  ${y.toFixed(6)}`);
  }
  for (let k = 1; k <= nHalf; k++) {
    const x = xi[k] * scale + offsetX;
    const y = halfThick(xi[k], false) * scale;
    lines.push(`${x.toFixed(6)}  ${y.toFixed(6)}`);
  }
  return lines.join('\n');
}

function buildLednicerNaca0012Text(): string {
  const nHalf = 30;
  const xi = Array.from({ length: nHalf + 1 }, (_, k) =>
    0.5 * (1.0 - Math.cos((Math.PI * k) / nHalf))
  );
  const ytFn = (x: number) =>
    5.0 *
    0.12 *
    (0.2969 * Math.sqrt(Math.max(x, 0)) -
      0.126 * x -
      0.3516 * x * x +
      0.2843 * x * x * x -
      0.1036 * x * x * x * x);

  const lines: string[] = ['Lednicer NACA0012', `${nHalf + 1}.  ${nHalf + 1}.`, ''];
  for (const x of xi) {
    lines.push(`${x.toFixed(6)}  ${ytFn(x).toFixed(6)}`);
  }
  lines.push('');
  for (const x of xi) {
    lines.push(`${x.toFixed(6)}  ${(-ytFn(x)).toFixed(6)}`);
  }
  return lines.join('\n');
}

describe('BrowserAnalysisEngine', () => {
  it('exposes health & 4 standard airfoil presets matching FastAPI contract', async () => {
    const engine = new BrowserAnalysisEngine();
    const health = await engine.getHealth();
    expect(health.status).toBe('ok');
    expect(health.solvers).toHaveLength(3);
    expect(health.solvers.find((s) => s.method === 'panel_method')?.available).toBe(true);
    expect(health.solvers.find((s) => s.method === 'xfoil')?.available).toBe(false);
    expect(health.solvers.find((s) => s.method === 'cfd_su2')?.available).toBe(false);

    const presets = await engine.listAirfoils();
    expect(presets.presets.map((p) => p.naca_code)).toEqual(['0012', '2412', '4412', '6412']);
    expect(presets.presets[0].preview_coords.x.length).toBe(81);
  });

  it('produces exact zero lift and moment on symmetric NACA 0012 at alpha = 0 deg', async () => {
    const engine = new BrowserAnalysisEngine();
    const res = await engine.runAnalysis(makeDefaultRequest({ angle_of_attack: 0.0 }));

    expect(res.status).toBe('success');
    expect(res.solver_info.supports_cd).toBe(false);
    expect(res.coefficients).not.toBeNull();
    expect(Math.abs(res.coefficients!.cl)).toBeLessThan(1e-12);
    expect(Math.abs(res.coefficients!.cm_quarter_chord)).toBeLessThan(1e-12);
    expect(res.coefficients!.cd).toBeNull();
    expect(res.coefficients!.cd_unavailable_reason).toContain('非粘性ポテンシャル流れ');
  });

  it('matches Python Hess-Smith benchmark on NACA 2412 at alpha = 5 deg', async () => {
    const engine = new BrowserAnalysisEngine();
    const res = await engine.runAnalysis(
      makeDefaultRequest({
        airfoil: {
          source_type: 'naca4',
          naca_code: '2412',
          name: 'NACA 2412',
          raw_coordinates_text: null,
        },
        angle_of_attack: 5.0,
      })
    );

    expect(res.status).toBe('success');
    expect(res.coefficients).not.toBeNull();
    expect(res.coefficients!.cl).toBeCloseTo(0.863846, 5);
    expect(res.coefficients!.cm_quarter_chord).toBeCloseTo(-0.061194, 5);
    expect(res.coefficients!.cd).toBeNull();
    expect(res.diagnostics.converged).toBe(true);
    expect(res.diagnostics.te_cp_diff).toBeLessThan(1e-5);
  });

  it('rejects unimplemented solvers (xfoil, cfd_su2) with 501 SOLVER_NOT_IMPLEMENTED', async () => {
    const engine = new BrowserAnalysisEngine();
    await expect(
      engine.runAnalysis(makeDefaultRequest({ solver: { method: 'xfoil' } }))
    ).rejects.toMatchObject({
      status: 501,
      code: 'SOLVER_NOT_IMPLEMENTED',
    });
    await expect(
      engine.runAnalysis(makeDefaultRequest({ solver: { method: 'cfd_su2' } }))
    ).rejects.toMatchObject({
      status: 501,
      code: 'SOLVER_NOT_IMPLEMENTED',
    });
  });

  it('rejects out-of-range inputs and missing analyses with 422 / 404 ApiClientError', async () => {
    const engine = new BrowserAnalysisEngine();
    await expect(
      engine.runAnalysis(makeDefaultRequest({ angle_of_attack: 50.0 }))
    ).rejects.toBeInstanceOf(ApiClientError);

    await expect(
      engine.runAnalysis(makeDefaultRequest({ velocity: -1.0 }))
    ).rejects.toMatchObject({ status: 422 });

    await expect(
      engine.runAnalysis(
        makeDefaultRequest({
          airfoil: {
            source_type: 'naca4',
            naca_code: '0412',
            name: null,
            raw_coordinates_text: null,
          },
        })
      )
    ).rejects.toMatchObject({ status: 422, code: 'INVALID_AIRFOIL_GEOMETRY' });

    await expect(
      engine.runAnalysis(
        makeDefaultRequest({
          fluid_properties: {
            preset: 'custom',
            mode: 'direct_mu',
            temperature_k: 293.15,
            static_pressure_pa: 101325.0,
            density_kg_m3: 998.0,
            dynamic_viscosity_pa_s: 1e-3,
            kinematic_viscosity_m2_s: null,
            speed_of_sound_mps: null,
          },
        })
      )
    ).rejects.toMatchObject({ status: 422, code: 'INVALID_FLUID_PROPERTIES' });

    await expect(engine.getAnalysis('non-existent-id')).rejects.toMatchObject({
      status: 404,
      code: 'ANALYSIS_NOT_FOUND',
    });
  });

  it('emits educational applicability warnings for high AoA, compressibility, and low Re', async () => {
    const engine = new BrowserAnalysisEngine();

    const stallRes = await engine.runAnalysis(
      makeDefaultRequest({ angle_of_attack: 14.0, velocity: 2.0, chord_length: 0.01 })
    );
    const stallCodes = stallRes.warnings.map((w) => w.code);
    expect(stallCodes).toContain('STALL_UNMODELED');
    expect(stallCodes).not.toContain('HIGH_AOA_CAUTION');
    expect(stallCodes).toContain('LOW_RE_CAUTION');

    const transonicRes = await engine.runAnalysis(
      makeDefaultRequest({ angle_of_attack: 11.0, velocity: 120.0 })
    );
    const transonicCodes = transonicRes.warnings.map((w) => w.code);
    expect(transonicCodes).toContain('HIGH_AOA_CAUTION');
    expect(transonicCodes).toContain('TRANSONIC_OUT_OF_RANGE');

    const compRes = await engine.runAnalysis(
      makeDefaultRequest({ angle_of_attack: 0.0, velocity: 110.0 })
    );
    const compCodes = compRes.warnings.map((w) => w.code);
    expect(compCodes).toContain('COMPRESSIBILITY_CAUTION');
    expect(compCodes).not.toContain('TRANSONIC_OUT_OF_RANGE');
  });

  it('masks internal flow field cells as null and keeps RK4 streamlines outside airfoil', async () => {
    const engine = new BrowserAnalysisEngine();
    const req = makeDefaultRequest({
      angle_of_attack: 4.0,
      numerical_settings: {
        num_panels: 120,
        closed_te: true,
        grid_nx: 50,
        grid_ny: 36,
        x_range: [-0.4, 1.5],
        y_range: [-0.6, 0.6],
        num_streamlines: 16,
      },
    });
    const res = await engine.runAnalysis(req);
    expect(res.flow_field).not.toBeNull();
    expect(res.streamlines).not.toBeNull();
    expect(res.streamlines!.length).toBeGreaterThan(0);

    const ff = res.flow_field!;
    let insideCount = 0;
    let outsideCount = 0;
    for (let iy = 0; iy < ff.y_grid.length; iy++) {
      for (let ix = 0; ix < ff.x_grid.length; ix++) {
        if (ff.is_inside_airfoil[iy][ix]) {
          insideCount++;
          expect(ff.u_ratio[iy][ix]).toBeNull();
          expect(ff.v_ratio[iy][ix]).toBeNull();
          expect(ff.speed_ratio[iy][ix]).toBeNull();
          expect(ff.cp[iy][ix]).toBeNull();
        } else {
          outsideCount++;
          expect(typeof ff.speed_ratio[iy][ix]).toBe('number');
          expect(Number.isFinite(ff.cp[iy][ix]!)).toBe(true);
        }
      }
    }
    expect(insideCount).toBeGreaterThan(0);
    expect(outsideCount).toBeGreaterThan(0);

    const mesh = generateNaca4('0012', 120, true);
    for (const line of res.streamlines!) {
      expect(line.x.length).toBeGreaterThanOrEqual(2);
      const px = Float64Array.from(line.x);
      const py = Float64Array.from(line.y);
      const insideFlags = pointInPolygonBatch(px, py, mesh.x, mesh.y);
      for (let k = 0; k < insideFlags.length; k++) {
        expect(insideFlags[k]).toBe(0);
      }
    }
  });

  it('normalizes Selig/Lednicer custom DAT coordinates and auto-closes open TE', async () => {
    const engine = new BrowserAnalysisEngine();
    const seligText = buildSeligNaca0012Text(2.5, 10.0, 0.002);
    const genRes = await engine.generateAirfoil({
      source_type: 'custom_dat',
      naca_code: null,
      name: null,
      raw_coordinates_text: seligText,
      num_panels: 120,
      closed_te: true,
    });
    expect(genRes.name).toBe('Custom Test Foil');
    expect(genRes.geometry.is_closed_te).toBe(true);
    expect(genRes.warnings.map((w) => w.code)).toContain('CUSTOM_AIRFOIL_NORMALIZED');
    expect(genRes.warnings.map((w) => w.code)).toContain('OPEN_TE_CLOSED_AUTO');

    const lednicerRes = await engine.runAnalysis(
      makeDefaultRequest({
        airfoil: {
          source_type: 'custom_dat',
          naca_code: null,
          name: 'Lednicer Foil',
          raw_coordinates_text: buildLednicerNaca0012Text(),
        },
        angle_of_attack: 0.0,
      })
    );
    expect(lednicerRes.status).toBe('success');
    expect(Math.abs(lednicerRes.coefficients!.cl)).toBeLessThan(1e-3);
  });

  it('supports store lookup (getAnalysis) and 2-case comparison (compareAnalyses)', async () => {
    const engine = new BrowserAnalysisEngine();
    const base = await engine.runAnalysis(makeDefaultRequest({ angle_of_attack: 0.0 }));
    const fetched = await engine.getAnalysis(base.analysis_id);
    expect(fetched.analysis_id).toBe(base.analysis_id);

    const compared = await engine.compareAnalyses({
      base_analysis_id: base.analysis_id,
      target_request: makeDefaultRequest({
        airfoil: {
          source_type: 'naca4',
          naca_code: '2412',
          name: 'NACA 2412',
          raw_coordinates_text: null,
        },
        angle_of_attack: 5.0,
      }),
    });
    expect(compared.diff.delta_cl).toBeCloseTo(0.863846, 5);
    expect(compared.diff.delta_cd).toBeNull();
  });
});
