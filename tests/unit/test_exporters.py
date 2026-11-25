"""INT-IO-01 バックエンドエクスポータ（表面分布CSV・.airflow.json ラウンドトリップ・VTK予約）単体テスト。"""

from __future__ import annotations

import csv
import io
import json
import math

import pytest

from app.exporters import (
    export_analysis_config_json,
    export_surface_csv,
    export_vtk_structured_grid,
    parse_analysis_config_json,
)
from app.models.api_schemas import AnalysisRequest
from app.services import AnalysisService


def _build_sample_request() -> AnalysisRequest:
    return AnalysisRequest.model_validate(
        {
            "airfoil": {
                "source_type": "naca4",
                "naca_code": "4412",
                "name": "NACA 4412",
                "raw_coordinates_text": None,
            },
            "angle_of_attack": 4.5,
            "velocity": 18.0,
            "chord_length": 0.15,
            "fluid_properties": {
                "preset": "air_std_20c",
                "mode": "temperature_auto",
                "temperature_k": 293.15,
                "static_pressure_pa": 101325.0,
                "density_kg_m3": None,
                "dynamic_viscosity_pa_s": None,
                "kinematic_viscosity_m2_s": None,
                "speed_of_sound_mps": None,
            },
            "solver": {"method": "panel_method"},
            "numerical_settings": {
                "num_panels": 200,
                "closed_te": True,
                "grid_nx": 80,
                "grid_ny": 60,
                "x_range": [-0.5, 1.6],
                "y_range": [-0.7, 0.7],
                "num_streamlines": 24,
            },
        }
    )


def test_surface_csv_exporter_metadata_and_columns() -> None:
    """表面分布 CSV の `#` メタデータ（非粘性明記・cd: N/A）および 200行×6列数値整合検証。"""
    svc = AnalysisService()
    req = _build_sample_request()
    res = svc.run_analysis(req)

    csv_text = export_surface_csv(res)
    assert "\r\n" not in csv_text  # LF 改行統一

    all_lines = csv_text.strip().split("\n")
    comment_lines = [ln for ln in all_lines if ln.startswith("#")]
    data_lines = [ln for ln in all_lines if not ln.startswith("#")]

    comment_blob = "\n".join(comment_lines)
    assert "AirFlow Lab" in comment_blob
    assert "inviscid incompressible potential flow" in comment_blob
    assert "# airfoil: NACA 4412" in comment_blob
    assert "# density_kg_m3:" in comment_blob
    assert "# static_pressure_pa:" in comment_blob
    assert "# dynamic_pressure_pa:" in comment_blob
    # cd=0 の誤出力がなく必ず N/A であること
    assert "# cd: N/A" in comment_blob
    assert "# cd: 0" not in comment_blob

    reader = csv.reader(io.StringIO("\n".join(data_lines)))
    rows = list(reader)
    assert rows[0] == ["index", "side", "x_c", "y_c", "cp", "vt_over_vinf"]
    assert len(rows[1:]) == 200

    for idx, row in enumerate(rows[1:]):
        assert len(row) == 6
        assert int(row[0]) == idx
        assert row[1] in ("lower", "upper")
        for col_val in row[2:]:
            fv = float(col_val)
            assert math.isfinite(fv)

    # 非収束 status="failed" のレスポンスからは CSV 出力を拒否すること
    failed_res = res.model_copy(
        update={
            "status": "failed",
            "coefficients": None,
            "surface": None,
            "flow_field": None,
            "streamlines": None,
            "failure": {"code": "ILL_CONDITIONED_MATRIX", "message": "failed", "details": None},
        }
    )
    with pytest.raises(ValueError):
        export_surface_csv(failed_res)


def test_json_exporter_roundtrip_and_invalid_schema_guard() -> None:
    """.airflow.json 保存 -> 再読込 -> 再解析ラウンドトリップ100%一致および破損JSON検証。"""
    svc = AnalysisService()
    req_orig = _build_sample_request()
    res_orig = svc.run_analysis(req_orig)

    exported_json = export_analysis_config_json(res_orig)
    parsed_doc = json.loads(exported_json)
    assert parsed_doc["schema_version"] == "1.0"
    assert parsed_doc["app"] == "AirFlow Lab"
    assert parsed_doc["summary"]["cd"] is None

    restored_req = parse_analysis_config_json(exported_json)
    assert restored_req == req_orig

    res_recomputed = svc.run_analysis(restored_req)
    assert res_orig.coefficients is not None and res_recomputed.coefficients is not None
    assert res_orig.surface is not None and res_recomputed.surface is not None
    assert abs(res_orig.coefficients.cl - res_recomputed.coefficients.cl) == 0.0
    assert (
        abs(res_orig.coefficients.cm_quarter_chord - res_recomputed.coefficients.cm_quarter_chord)
        == 0.0
    )
    assert res_orig.surface.cp == res_recomputed.surface.cp

    # 破損JSON・未知バージョン・不正configの拒否検証
    with pytest.raises(ValueError):
        parse_analysis_config_json("{ broken json ")

    bad_ver = json.dumps({**parsed_doc, "schema_version": "9.9"})
    with pytest.raises(ValueError):
        parse_analysis_config_json(bad_ver)

    bad_cfg = json.dumps(
        {
            **parsed_doc,
            "config": {**parsed_doc["config"], "velocity": -5.0},
        }
    )
    with pytest.raises(ValueError):
        parse_analysis_config_json(bad_cfg)


def test_vtk_placeholder_raises_not_implemented() -> None:
    """Phase 3 予約 VTK エクスポータが NotImplementedError を送出すること。"""
    svc = AnalysisService()
    res = svc.run_analysis(_build_sample_request())
    with pytest.raises(NotImplementedError):
        export_vtk_structured_grid(res)
