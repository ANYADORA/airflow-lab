"""INT-API-01, INT-SAFE-01, INT-SAFE-02, INT-IO-01: 必須6エンドポイント統合ワークフロー検証テスト。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
import jsonschema
from referencing import Registry, Resource

from app.exporters import (
    export_analysis_config_json,
    export_surface_csv,
    parse_analysis_config_json,
)
from app.geometry import generate_naca4
from app.main import app
from app.models.api_schemas import AnalysisResponse

SCHEMAS_DIR = Path(__file__).resolve().parents[2] / "contracts" / "schemas"


def _build_response_validator() -> jsonschema.Draft202012Validator:
    req_schema = json.loads(
        (SCHEMAS_DIR / "analysis_request.schema.json").read_text(encoding="utf-8")
    )
    res_schema = json.loads(
        (SCHEMAS_DIR / "analysis_response.schema.json").read_text(encoding="utf-8")
    )
    registry = Registry().with_resources(
        [
            (req_schema["$id"], Resource.from_contents(req_schema)),
            (res_schema["$id"], Resource.from_contents(res_schema)),
        ]
    )
    return jsonschema.Draft202012Validator(res_schema, registry=registry)


def _standard_analysis_payload(
    *,
    naca_code: str = "2412",
    aoa: float = 4.0,
    velocity: float = 15.0,
    chord: float = 0.2,
) -> dict[str, Any]:
    return {
        "airfoil": {
            "source_type": "naca4",
            "naca_code": naca_code,
            "name": f"NACA {naca_code}",
            "raw_coordinates_text": None,
        },
        "angle_of_attack": aoa,
        "velocity": velocity,
        "chord_length": chord,
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
            "num_panels": 160,
            "closed_te": True,
            "grid_nx": 120,
            "grid_ny": 80,
            "x_range": [-0.5, 1.6],
            "y_range": [-0.7, 0.7],
            "num_streamlines": 28,
        },
    }


def test_int_api_01_all_six_endpoints_end_to_end_workflow() -> None:
    """必須6エンドポイントの連携・JSON Schema適合・cd=nullガード・比較差分を検証する。"""
    client = TestClient(app)
    res_validator = _build_response_validator()

    # 1. GET /api/health
    r_health = client.get("/api/health")
    assert r_health.status_code == 200
    health_data = r_health.json()
    assert health_data["status"] == "ok"
    solvers_by_id = {s["method"]: s for s in health_data["solvers"]}
    assert solvers_by_id["panel_method"]["available"] is True
    assert solvers_by_id["panel_method"]["supports_cd"] is False
    assert solvers_by_id["xfoil"]["available"] is False
    assert solvers_by_id["cfd_su2"]["available"] is False

    # 2. GET /api/airfoils
    r_presets = client.get("/api/airfoils")
    assert r_presets.status_code == 200
    presets = r_presets.json()["presets"]
    preset_codes = [p["naca_code"] for p in presets]
    assert preset_codes == ["0012", "2412", "4412", "6412"]

    # 3. POST /api/airfoils/generate (NACA 4412 + カスタムDAT)
    r_gen = client.post(
        "/api/airfoils/generate",
        json={
            "source_type": "naca4",
            "naca_code": "4412",
            "num_panels": 160,
            "closed_te": True,
        },
    )
    assert r_gen.status_code == 200
    gen_body = r_gen.json()
    assert gen_body["geometry"]["num_panels"] == 160
    assert len(gen_body["coordinates"]["x"]) == 161

    src_open = generate_naca4("2412", num_panels=60, closed_te=False)
    selig_txt = "NACA 2412 Custom\n" + "\n".join(
        f"{xv:.6f} {yv:.6f}" for xv, yv in zip(src_open.x[::-1], src_open.y[::-1])
    )
    r_gen_dat = client.post(
        "/api/airfoils/generate",
        json={
            "source_type": "custom_dat",
            "raw_coordinates_text": selig_txt,
            "num_panels": 160,
            "closed_te": True,
        },
    )
    assert r_gen_dat.status_code == 200
    assert any(w["code"] == "OPEN_TE_CLOSED_AUTO" for w in r_gen_dat.json()["warnings"])

    # 4. POST /api/analysis/run: Case A (alpha=0°) と Case B (alpha=5°)
    r_case_a = client.post(
        "/api/analysis/run",
        json=_standard_analysis_payload(naca_code="2412", aoa=0.0),
    )
    assert r_case_a.status_code == 200
    body_a = r_case_a.json()
    res_validator.validate(body_a)
    assert body_a["status"] == "success"
    # INT-SAFE-01: cd は厳密に null（0 や 0.0 でない）
    assert body_a["coefficients"]["cd"] is None
    assert len(body_a["coefficients"]["cd_unavailable_reason"]) > 0

    r_case_b = client.post(
        "/api/analysis/run",
        json=_standard_analysis_payload(naca_code="2412", aoa=5.0),
    )
    assert r_case_b.status_code == 200
    body_b = r_case_b.json()
    res_validator.validate(body_b)
    assert body_b["coefficients"]["cd"] is None

    id_a = body_a["analysis_id"]
    id_b = body_b["analysis_id"]

    # 5. GET /api/analysis/{analysis_id} (正常取得 & 未知ID 404)
    r_get_a = client.get(f"/api/analysis/{id_a}")
    assert r_get_a.status_code == 200
    assert r_get_a.json() == body_a

    r_missing = client.get("/api/analysis/00000000-0000-0000-0000-000000000000")
    assert r_missing.status_code == 404
    assert r_missing.json()["error"]["code"] == "ANALYSIS_NOT_FOUND"

    # 6. POST /api/analysis/compare (保存ID参照 および 混在リクエスト)
    r_cmp = client.post(
        "/api/analysis/compare",
        json={"base_analysis_id": id_a, "target_analysis_id": id_b},
    )
    assert r_cmp.status_code == 200
    cmp_body = r_cmp.json()
    assert cmp_body["diff"]["delta_cl"] > 0.0
    assert cmp_body["diff"]["delta_cd"] is None

    r_cmp_mixed = client.post(
        "/api/analysis/compare",
        json={
            "base_analysis_id": id_a,
            "target_request": _standard_analysis_payload(naca_code="4412", aoa=0.0),
        },
    )
    assert r_cmp_mixed.status_code == 200
    assert r_cmp_mixed.json()["diff"]["delta_cl"] > 0.0
    assert r_cmp_mixed.json()["diff"]["delta_cd"] is None

    # INT-IO-01: API応答からの JSON 保存 -> 復元 -> 再POST一致 & CSV出力
    parsed_res = AnalysisResponse.model_validate(body_b)
    exported_json = export_analysis_config_json(parsed_res)
    restored_req = parse_analysis_config_json(exported_json)
    r_rerun = client.post("/api/analysis/run", json=restored_req.model_dump(mode="json"))
    assert r_rerun.status_code == 200
    rerun_body = r_rerun.json()
    assert rerun_body["coefficients"]["cl"] == body_b["coefficients"]["cl"]
    assert rerun_body["surface"]["cp"] == body_b["surface"]["cp"]

    csv_out = export_surface_csv(parsed_res)
    assert "# cd: N/A" in csv_out


def test_int_safe_02_warning_banners_via_api() -> None:
    """API エンドポイント経由での統一警告境界値（Case A〜F）発火検証。"""
    client = TestClient(app)

    # Case A: alpha = 10.0 deg -> 高迎角警告なし
    ra = client.post("/api/analysis/run", json=_standard_analysis_payload(naca_code="0012", aoa=10.0))
    codes_a = {w["code"] for w in ra.json()["warnings"]}
    assert "HIGH_AOA_CAUTION" not in codes_a
    assert "STALL_UNMODELED" not in codes_a

    # Case B: alpha = 11.0 deg -> HIGH_AOA_CAUTION
    rb = client.post("/api/analysis/run", json=_standard_analysis_payload(naca_code="0012", aoa=11.0))
    codes_b = {w["code"] for w in rb.json()["warnings"]}
    assert "HIGH_AOA_CAUTION" in codes_b
    assert "STALL_UNMODELED" not in codes_b

    # Case C: alpha = 12.5 deg -> STALL_UNMODELED（HIGH_AOA_CAUTION 重複抑止）
    rc = client.post("/api/analysis/run", json=_standard_analysis_payload(naca_code="0012", aoa=12.5))
    codes_c = {w["code"] for w in rc.json()["warnings"]}
    assert "STALL_UNMODELED" in codes_c
    assert "HIGH_AOA_CAUTION" not in codes_c

    # Case D: V = 120 m/s -> COMPRESSIBILITY_CAUTION
    rd = client.post(
        "/api/analysis/run",
        json=_standard_analysis_payload(naca_code="0012", aoa=2.0, velocity=120.0),
    )
    codes_d = {w["code"] for w in rd.json()["warnings"]}
    assert "COMPRESSIBILITY_CAUTION" in codes_d
    assert "TRANSONIC_OUT_OF_RANGE" not in codes_d

    # Case E: NACA 2412, alpha=8°, V=200 m/s -> TRANSONIC_OUT_OF_RANGE
    re = client.post(
        "/api/analysis/run",
        json=_standard_analysis_payload(naca_code="2412", aoa=8.0, velocity=200.0),
    )
    codes_e = {w["code"] for w in re.json()["warnings"]}
    assert "TRANSONIC_OUT_OF_RANGE" in codes_e
    assert "COMPRESSIBILITY_CAUTION" not in codes_e

    # Case F: V=2.0 m/s, c=0.05 m -> LOW_RE_CAUTION
    rf = client.post(
        "/api/analysis/run",
        json=_standard_analysis_payload(naca_code="0012", aoa=4.0, velocity=2.0, chord=0.05),
    )
    codes_f = {w["code"] for w in rf.json()["warnings"]}
    assert "LOW_RE_CAUTION" in codes_f
