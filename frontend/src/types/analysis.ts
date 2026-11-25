/** フロントエンド解析ドメイン状態・エクスポートファイル型定義。 */

import type {
  AnalysisRequest,
  AnalysisResponse,
  CompareDiff,
  CompareResponse,
} from './api';

export type AnalysisConfig = AnalysisRequest;
export type AnalysisResult = AnalysisResponse;

export interface CompareState {
  pinnedBase: AnalysisResponse | null;
  compareResult: CompareResponse | null;
  diff: CompareDiff | null;
  isCompareActive: boolean;
  isComparing: boolean;
}

export interface AirflowSavedSummary {
  solver_model: string;
  cl: number | null;
  cm_quarter_chord: number | null;
  cd: number | null;
  reynolds_number: number | null;
  mach_number: number | null;
}

export interface AirflowProjectFile {
  schema_version: '1.0';
  app: string;
  exported_at: string;
  config: AnalysisRequest;
  summary?: AirflowSavedSummary | null;
}

export interface FluidPreviewMetrics {
  density_kg_m3: number;
  dynamic_viscosity_pa_s: number;
  kinematic_viscosity_m2_s: number;
  speed_of_sound_mps: number;
  reynolds_number: number;
  mach_number: number;
  dynamic_pressure_pa: number;
}

export interface ExplanationBlock {
  id: 'summary' | 'mechanism' | 'assumptions' | 'inquiry';
  title: string;
  paragraphs: string[];
  bullets?: string[];
}

export interface MisconceptionCallout {
  title: string;
  misconceptionLabel: string;
  correctionParagraphs: string[];
  tryItSteps: string[];
}

export interface GeneratedExplanation {
  sourceBadge: string;
  blocks: ExplanationBlock[];
  misconception: MisconceptionCallout;
}
