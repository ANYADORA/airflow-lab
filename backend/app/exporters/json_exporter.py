"""解析条件・サマリ保存／再読込用 JSON（*.airflow.json）エクスポータ（API_SPEC.md 3-1節準拠）。"""

from __future__ import annotations

from datetime import datetime, timezone
import json
from typing import Any

from pydantic import ValidationError

from app.models.api_schemas import AnalysisRequest, AnalysisResponse

AIRFLOW_JSON_SCHEMA_VERSION = "1.0"
AIRFLOW_APP_NAME = "AirFlow Lab"


def export_analysis_config_json(res: AnalysisResponse) -> str:
    """AnalysisResponse から再読込互換の `.airflow.json` 文字列（UTF-8）を生成する。"""
    exported_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    config_dict = res.inputs.model_dump(mode="json")

    summary: dict[str, Any] | None
    if res.status == "success" and res.coefficients is not None:
        summary = {
            "solver_model": res.solver_info.model_type,
            "cl": res.coefficients.cl,
            "cm_quarter_chord": res.coefficients.cm_quarter_chord,
            "cd": res.coefficients.cd,  # Phase 1 では常に null
            "reynolds_number": res.dimensionless.reynolds_number,
            "mach_number": res.dimensionless.mach_number,
        }
    else:
        summary = None

    payload: dict[str, Any] = {
        "schema_version": AIRFLOW_JSON_SCHEMA_VERSION,
        "app": AIRFLOW_APP_NAME,
        "exported_at": exported_at,
        "config": config_dict,
        "summary": summary,
    }
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def parse_analysis_config_json(raw_json: str) -> AnalysisRequest:
    """保存済み `.airflow.json` 文字列を検証し、7キー契約準拠の AnalysisRequest を復元する。

    破損 JSON、未知の schema_version、不正な config スキーマの場合は ValueError を送出する。
    """
    if not isinstance(raw_json, str) or not raw_json.strip():
        raise ValueError("読み込まれた JSON データが空です。")

    try:
        parsed = json.loads(raw_json)
    except json.JSONDecodeError as exc:
        raise ValueError(f"JSON の構文解析に失敗しました: {exc}") from exc

    if not isinstance(parsed, dict):
        raise ValueError("解析設定 JSON のルート要素はオブジェクトである必要があります。")

    version = parsed.get("schema_version")
    if version != AIRFLOW_JSON_SCHEMA_VERSION:
        raise ValueError(
            f"未対応の schema_version です: '{version}'（対応バージョン: '{AIRFLOW_JSON_SCHEMA_VERSION}'）。"
        )

    config_raw = parsed.get("config")
    if not isinstance(config_raw, dict):
        raise ValueError("解析設定 JSON に有効な 'config' オブジェクトが含まれていません。")

    try:
        return AnalysisRequest.model_validate(config_raw)
    except ValidationError as exc:
        raise ValueError(f"保存データの解析条件が契約スキーマに適合しません: {exc}") from exc
