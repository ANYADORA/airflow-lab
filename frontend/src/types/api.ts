/** contracts/ 配下の JSON Schema / OpenAPI 3.1 に100%準拠するAPI型定義。 */

export type SolverMethod = 'panel_method' | 'xfoil' | 'cfd_su2';

export type AirfoilSourceType = 'naca4' | 'custom_dat' | 'custom_csv';

export type FluidPreset = 'air_std_20c' | 'air_0c' | 'water_20c' | 'custom';

export type FluidMode = 'temperature_auto' | 'direct_mu' | 'direct_nu';

export type WarningCode =
  | 'HIGH_AOA_CAUTION'
  | 'STALL_UNMODELED'
  | 'COMPRESSIBILITY_CAUTION'
  | 'TRANSONIC_OUT_OF_RANGE'
  | 'LOW_RE_CAUTION'
  | 'CL_CROSSCHECK_WARN'
  | 'CUSTOM_AIRFOIL_NORMALIZED'
  | 'OPEN_TE_CLOSED_AUTO';

export type WarningSeverity = 'info' | 'warning' | 'critical';

export interface ErrorDetail {
  code: string;
  message: string;
  details: Record<string, unknown> | null;
}

export interface ErrorResponse {
  error: ErrorDetail;
}

export interface WarningItem {
  code: WarningCode;
  severity: WarningSeverity;
  title: string;
  message: string;
}

export interface SolverCapability {
  method: SolverMethod;
  label: string;
  available: boolean;
  phase: 1 | 2 | 3;
  supports_cd: boolean;
  description: string;
}

export interface HealthResponse {
  status: 'ok';
  version: string;
  solvers: SolverCapability[];
}

export interface PreviewCoords {
  x: number[];
  y: number[];
}

export interface AirfoilPresetItem {
  id: string;
  name: string;
  naca_code: string;
  is_symmetric: boolean;
  max_thickness_ratio: number;
  max_camber_ratio: number;
  max_camber_pos: number;
  description: string;
  preview_coords: PreviewCoords;
}

export interface AirfoilPresetListResponse {
  presets: AirfoilPresetItem[];
}

export interface AirfoilInput {
  source_type: AirfoilSourceType;
  naca_code: string | null;
  name: string | null;
  raw_coordinates_text: string | null;
}

export interface AirfoilGenerateRequest {
  source_type: AirfoilSourceType;
  naca_code: string | null;
  name: string | null;
  raw_coordinates_text: string | null;
  num_panels: number;
  closed_te: boolean;
}

export interface AirfoilGeometrySummary {
  num_panels: number;
  max_thickness_ratio: number;
  max_camber_ratio: number;
  max_camber_pos: number;
  is_symmetric: boolean;
  is_closed_te: boolean;
}

export interface AirfoilGenerateResponse {
  name: string;
  coordinates: PreviewCoords;
  geometry: AirfoilGeometrySummary;
  warnings: WarningItem[];
}

export interface FluidPropertiesInput {
  preset: FluidPreset;
  mode: FluidMode;
  temperature_k: number;
  static_pressure_pa: number | null;
  density_kg_m3: number | null;
  dynamic_viscosity_pa_s: number | null;
  kinematic_viscosity_m2_s: number | null;
  speed_of_sound_mps: number | null;
}

export interface SolverInput {
  method: SolverMethod;
}

export interface NumericalSettingsInput {
  num_panels: number;
  closed_te: boolean;
  grid_nx: number;
  grid_ny: number;
  x_range: [number, number];
  y_range: [number, number];
  num_streamlines: number;
}

/** POST /api/analysis/run の必須7キー契約モデル。 */
export interface AnalysisRequest {
  airfoil: AirfoilInput;
  angle_of_attack: number;
  velocity: number;
  chord_length: number;
  fluid_properties: FluidPropertiesInput;
  solver: SolverInput;
  numerical_settings: NumericalSettingsInput;
}

export interface SolverInfo {
  method: SolverMethod;
  model_type: string;
  version: string;
  supports_cd: boolean;
}

export interface ResolvedFluid {
  density_kg_m3: number;
  dynamic_viscosity_pa_s: number;
  kinematic_viscosity_m2_s: number;
  temperature_k: number;
  static_pressure_pa: number;
  speed_of_sound_mps: number;
}

export interface AirfoilGeometryResult {
  name: string;
  x: number[];
  y: number[];
  num_panels: number;
  max_thickness_ratio: number;
  max_camber_ratio: number;
  max_camber_pos: number;
  is_symmetric: boolean;
  is_closed_te: boolean;
}

export interface DimensionlessNumbers {
  reynolds_number: number;
  mach_number: number;
}

export interface AerodynamicCoefficients {
  cl: number;
  cl_kutta_joukowski: number;
  cl_pressure_integration: number;
  /** Phase 1 パネル法では常時 null（0 の代用禁止）。 */
  cd: number | null;
  cd_unavailable_reason: string | null;
  cm_quarter_chord: number;
}

export interface AnalysisDiagnostics {
  converged: boolean;
  condition_number: number | null;
  linear_residual_max: number | null;
  te_cp_diff: number | null;
  cl_discrepancy: number | null;
  cl_discrepancy_relative: number | null;
  cd_pressure_numerical_error: number | null;
  cp_min: number | null;
  cp_min_xc: number | null;
  max_velocity_ratio: number | null;
  compute_time_ms: number;
}

export interface SurfaceDistribution {
  x_c: number[];
  y_c: number[];
  side: ('upper' | 'lower')[];
  cp: number[];
  vt_ratio: number[];
}

export interface FlowFieldData {
  x_grid: number[];
  y_grid: number[];
  u_ratio: (number | null)[][];
  v_ratio: (number | null)[][];
  speed_ratio: (number | null)[][];
  cp: (number | null)[][];
  is_inside_airfoil: boolean[][];
}

export interface StreamlinePolyline {
  x: number[];
  y: number[];
}

export interface FailureInfo {
  code: string;
  message: string;
  details: Record<string, unknown> | null;
}

export interface AnalysisResponse {
  analysis_id: string;
  created_at: string;
  status: 'success' | 'failed';
  solver_info: SolverInfo;
  inputs: AnalysisRequest;
  resolved_fluid: ResolvedFluid;
  airfoil_geometry: AirfoilGeometryResult | null;
  dimensionless: DimensionlessNumbers;
  coefficients: AerodynamicCoefficients | null;
  diagnostics: AnalysisDiagnostics;
  surface: SurfaceDistribution | null;
  flow_field: FlowFieldData | null;
  streamlines: StreamlinePolyline[] | null;
  warnings: WarningItem[];
  failure: FailureInfo | null;
}

export interface CompareRequest {
  base_analysis_id?: string | null;
  target_analysis_id?: string | null;
  base_request?: AnalysisRequest | null;
  target_request?: AnalysisRequest | null;
}

export interface CompareDiff {
  delta_cl: number | null;
  delta_cm_quarter_chord: number | null;
  delta_cd: number | null;
  delta_cp_min: number | null;
  delta_reynolds_number: number;
  delta_mach_number: number;
}

export interface CompareResponse {
  base: AnalysisResponse;
  target: AnalysisResponse;
  diff: CompareDiff;
}
