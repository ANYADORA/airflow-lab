"""API契約スキーマ・異常入力422・未実装ソルバー501の単体テスト（UT-SCHEMA-01, ERR-VAL-01..02, ERR-SOL-02）。"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator
from pydantic import ValidationError
from referencing import Registry, Resource

from app.main import app
from app.models.api_schemas import AnalysisRequest, AnalysisResponse

REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEMAS_DIR = REPO_ROOT / "contracts" / "schemas"


def _load_schema(filename: str) -> dict[str, Any]:
    with (SCHEMAS_DIR / filename).open("r", encoding="utf-8") as f:
        return json.load(f)


def _build_validators() -> tuple[Draft202012Validator, Draft202012Validator]:
    req_schema = _load_schema("analysis_request.schema.json")
    res_schema = _load_schema("analysis_response.schema.json")

    registry = Registry().with_resources(
        [
            (req_schema["$id"], Resource.from_contents(req_schema)),
            (res_schema["$id"], Resource.from_contents(res_schema)),
        ]
    )
    req_validator = Draft202012Validator(req_schema, registry=registry)
    res_validator = Draft202012Validator(res_schema, registry=registry)
    return req_validator, res_validator


def _base_valid_request() -> dict[str, Any]:
    return {
        "airfoil": {
            "source_type": "naca4",
            "naca_code": "2412",
            "name": "NACA 2412",
            "raw_coordinates_text": None,
        },
        "angle_of_attack": 4.0,
        "velocity": 15.0,
        "chord_length": 0.2,
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
        "solver": {
            "method": "panel_method",
        },
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


def _assert_error_envelope(body: dict[str, Any]) -> None:
    assert "error" in body
    err = body["error"]
    assert isinstance(err.get("code"), str) and len(err["code"]) > 0
    assert isinstance(err.get("message"), str) and len(err["message"]) > 0
    assert "details" in err


# ---------------------------------------------------------------------------
# UT-SCHEMA-01: JSON Schema (Draft 2020-12) と Pydantic v2 の契約一致
# ---------------------------------------------------------------------------


def test_ut_schema_01_valid_requests_match_jsonschema_and_pydantic() -> None:
    req_validator, _ = _build_validators()

    # 1. 標準 NACA 4桁（簡易モード相当）
    sample_simple = _base_valid_request()

    # 2. 本格モード direct_mu 指定
    sample_direct_mu = _base_valid_request()
    sample_direct_mu["fluid_properties"] = {
        "preset": "custom",
        "mode": "direct_mu",
        "temperature_k": 288.15,
        "static_pressure_pa": 101325.0,
        "density_kg_m3": 1.225,
        "dynamic_viscosity_pa_s": 1.7894e-5,
        "kinematic_viscosity_m2_s": None,
        "speed_of_sound_mps": 340.3,
    }
    sample_direct_mu["numerical_settings"]["num_panels"] = 200

    # 3. カスタム DAT 指定
    sample_custom_dat = _base_valid_request()
    sample_custom_dat["airfoil"] = {
        "source_type": "custom_dat",
        "naca_code": None,
        "name": "Custom Test",
        "raw_coordinates_text": "Custom\n1.0 0.0\n0.5 0.06\n0.0 0.0\n0.5 -0.06\n1.0 0.0\n",
    }

    for payload in (sample_simple, sample_direct_mu, sample_custom_dat):
        assert set(payload.keys()) == {
            "airfoil",
            "angle_of_attack",
            "velocity",
            "chord_length",
            "fluid_properties",
            "solver",
            "numerical_settings",
        }
        schema_errors = list(req_validator.iter_errors(payload))
        assert schema_errors == []
        parsed = AnalysisRequest.model_validate(payload)
        assert parsed.solver.method == "panel_method"


def test_ut_schema_01_invalid_requests_rejected_by_both_validators() -> None:
    req_validator, _ = _build_validators()

    # 欠損キー
    missing_key = _base_valid_request()
    del missing_key["numerical_settings"]

    # 余剰キー
    extra_key = _base_valid_request()
    extra_key["unexpected_field"] = 123

    # 奇数パネル
    odd_panels = _base_valid_request()
    odd_panels["numerical_settings"]["num_panels"] = 155

    # 高密度液体相当で speed_of_sound_mps 欠落
    liquid_no_sound = _base_valid_request()
    liquid_no_sound["fluid_properties"] = {
        "preset": "custom",
        "mode": "direct_mu",
        "temperature_k": 293.15,
        "static_pressure_pa": 101325.0,
        "density_kg_m3": 998.2,
        "dynamic_viscosity_pa_s": 1.002e-3,
        "kinematic_viscosity_m2_s": None,
        "speed_of_sound_mps": None,
    }

    for bad_payload in (missing_key, extra_key, odd_panels, liquid_no_sound):
        schema_valid = req_validator.is_valid(bad_payload)
        try:
            AnalysisRequest.model_validate(bad_payload)
            pydantic_valid = True
        except ValidationError:
            pydantic_valid = False

        assert schema_valid is False
        assert pydantic_valid is False


def test_ut_schema_01_response_schema_validates_success_and_failed() -> None:
    _, res_validator = _build_validators()

    success_response: dict[str, Any] = {
        "analysis_id": "550e8400-e29b-41d4-a716-446655440000",
        "created_at": "2026-11-24T12:10:00Z",
        "status": "success",
        "solver_info": {
            "method": "panel_method",
            "model_type": "inviscid_incompressible_potential",
            "version": "0.1.0",
            "supports_cd": False,
        },
        "inputs": _base_valid_request(),
        "resolved_fluid": {
            "density_kg_m3": 1.204085,
            "dynamic_viscosity_pa_s": 1.813322e-5,
            "kinematic_viscosity_m2_s": 1.505975e-5,
            "temperature_k": 293.15,
            "static_pressure_pa": 101325.0,
            "speed_of_sound_mps": 343.2368,
        },
        "airfoil_geometry": {
            "name": "NACA 2412",
            "x": [1.0, 0.5, 0.0, 0.5, 1.0],
            "y": [0.0, -0.03, 0.0, 0.07, 0.0],
            "num_panels": 160,
            "max_thickness_ratio": 0.12,
            "max_camber_ratio": 0.02,
            "max_camber_pos": 0.4,
            "is_symmetric": False,
            "is_closed_te": True,
        },
        "dimensionless": {
            "reynolds_number": 199206.4,
            "mach_number": 0.043702,
        },
        "coefficients": {
            "cl": 0.7284,
            "cl_kutta_joukowski": 0.7284,
            "cl_pressure_integration": 0.7261,
            "cd": None,
            "cd_unavailable_reason": "非粘性パネル法では抗力係数を算出できません。",
            "cm_quarter_chord": -0.0531,
        },
        "diagnostics": {
            "converged": True,
            "condition_number": 384.2,
            "linear_residual_max": 1.4e-14,
            "te_cp_diff": 2.1e-13,
            "cl_discrepancy": 0.0023,
            "cl_discrepancy_relative": 0.00316,
            "cd_pressure_numerical_error": 0.0004,
            "cp_min": -1.502,
            "cp_min_xc": 0.042,
            "max_velocity_ratio": 1.582,
            "compute_time_ms": 38.4,
        },
        "surface": {
            "x_c": [0.99, 0.5, 0.01],
            "y_c": [0.0, 0.05, 0.0],
            "side": ["lower", "upper", "upper"],
            "cp": [0.2, -0.6, 0.9],
            "vt_ratio": [-0.9, 1.26, 0.3],
        },
        "flow_field": {
            "x_grid": [-0.5, 1.6],
            "y_grid": [-0.7, 0.7],
            "u_ratio": [[1.0, 1.0], [1.0, 1.0]],
            "v_ratio": [[0.0, 0.0], [0.0, 0.0]],
            "speed_ratio": [[1.0, 1.0], [1.0, 1.0]],
            "cp": [[0.0, 0.0], [0.0, 0.0]],
            "is_inside_airfoil": [[False, False], [False, False]],
        },
        "streamlines": [{"x": [-0.5, 1.6], "y": [0.2, 0.2]}],
        "warnings": [],
        "failure": None,
    }

    assert list(res_validator.iter_errors(success_response)) == []
    AnalysisResponse.model_validate(success_response)

    # cd が 0.0 の場合は両方とも拒否すること
    bad_cd_response = copy.deepcopy(success_response)
    bad_cd_response["coefficients"]["cd"] = 0.0
    assert res_validator.is_valid(bad_cd_response) is False
    with pytest.raises(ValidationError):
        AnalysisResponse.model_validate(bad_cd_response)

    # failed レスポンス
    failed_response = copy.deepcopy(success_response)
    failed_response["status"] = "failed"
    failed_response["coefficients"] = None
    failed_response["surface"] = None
    failed_response["flow_field"] = None
    failed_response["streamlines"] = None
    failed_response["diagnostics"]["converged"] = False
    failed_response["failure"] = {
        "code": "ILL_CONDITIONED_MATRIX",
        "message": "条件数超過により中断しました。",
        "details": {"condition_number": 1e12},
    }
    assert list(res_validator.iter_errors(failed_response)) == []
    AnalysisResponse.model_validate(failed_response)


# ---------------------------------------------------------------------------
# ERR-VAL-01: 物理パラメータ異常入力に対する 422 拒否
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "mutator",
    [
        lambda p: p.update({"velocity": 0.0}),
        lambda p: p.update({"velocity": -10.0}),
        lambda p: p.update({"chord_length": 0.0}),
        lambda p: p.update({"chord_length": -0.2}),
        lambda p: p.update({"angle_of_attack": 60.0}),
        lambda p: p.update({"angle_of_attack": -50.0}),
        lambda p: p["fluid_properties"].update({"temperature_k": 0.0}),
        lambda p: p["fluid_properties"].update({"temperature_k": -273.15}),
        lambda p: p["fluid_properties"].update(
            {"preset": "custom", "mode": "direct_mu", "density_kg_m3": -1.2, "dynamic_viscosity_pa_s": 1.8e-5}
        ),
        lambda p: p["fluid_properties"].update(
            {"preset": "custom", "mode": "direct_mu", "density_kg_m3": 1.2, "dynamic_viscosity_pa_s": 0.0}
        ),
        lambda p: p["fluid_properties"].update(
            {"preset": "custom", "mode": "direct_nu", "density_kg_m3": 1.2, "kinematic_viscosity_m2_s": -1e-5}
        ),
    ],
)
def test_err_val_01_invalid_physics_returns_422(mutator: Any) -> None:
    client = TestClient(app)
    payload = _base_valid_request()
    mutator(payload)

    res = client.post("/api/analysis/run", json=payload)
    assert res.status_code == 422
    _assert_error_envelope(res.json())


# ---------------------------------------------------------------------------
# ERR-VAL-02: 数値設定・翼型データ異常入力に対する 422 拒否
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "mutator",
    [
        lambda p: p["numerical_settings"].update({"num_panels": 159}),
        lambda p: p["numerical_settings"].update({"num_panels": 20}),
        lambda p: p["numerical_settings"].update({"num_panels": 500}),
        lambda p: p["numerical_settings"].update({"num_streamlines": 0}),
        lambda p: p["numerical_settings"].update({"num_streamlines": 200}),
        lambda p: p["airfoil"].update({"naca_code": "ABCD"}),
        lambda p: p["airfoil"].update({"naca_code": "2012"}),
        lambda p: p["airfoil"].update({"naca_code": "0412"}),
        lambda p: p["airfoil"].update({"naca_code": "0000"}),
        lambda p: p["airfoil"].update(
            {"source_type": "custom_dat", "naca_code": None, "raw_coordinates_text": ""}
        ),
        lambda p: p["airfoil"].update(
            {
                "source_type": "custom_dat",
                "naca_code": None,
                "raw_coordinates_text": "TooFew\n1.0 0.0\n0.5 0.05\n0.0 0.0\n0.5 -0.05\n1.0 0.0\n",
            }
        ),
    ],
)
def test_err_val_02_invalid_numerical_or_airfoil_returns_422(mutator: Any) -> None:
    client = TestClient(app)
    payload = _base_valid_request()
    mutator(payload)

    res = client.post("/api/analysis/run", json=payload)
    assert res.status_code == 422
    _assert_error_envelope(res.json())


def test_err_val_02_airfoil_generate_invalid_naca_and_self_intersecting_returns_422() -> None:
    client = TestClient(app)

    # 不正 NACA コード
    res_naca = client.post(
        "/api/airfoils/generate",
        json={"source_type": "naca4", "naca_code": "2012", "num_panels": 160, "closed_te": True},
    )
    assert res_naca.status_code == 422
    _assert_error_envelope(res_naca.json())

    # 8の字型自己交差 DAT
    figure_eight_dat = "\n".join(
        [
            "FigureEight",
            "1.0 0.0",
            "0.8 0.05",
            "0.6 0.05",
            "0.4 -0.05",
            "0.2 -0.05",
            "0.0 0.0",
            "0.2 0.05",
            "0.4 0.05",
            "0.6 -0.05",
            "0.8 -0.05",
            "0.9 -0.02",
            "1.0 0.0",
        ]
    )
    res_dat = client.post(
        "/api/airfoils/generate",
        json={
            "source_type": "custom_dat",
            "raw_coordinates_text": figure_eight_dat,
            "num_panels": 160,
            "closed_te": True,
        },
    )
    assert res_dat.status_code == 422
    _assert_error_envelope(res_dat.json())


# ---------------------------------------------------------------------------
# ERR-SOL-02: 未実装ソルバー指定時の 501 Not Implemented ガード
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("method", ["xfoil", "cfd_su2"])
def test_err_sol_02_unimplemented_solver_returns_501(method: str) -> None:
    client = TestClient(app)
    payload = _base_valid_request()
    payload["solver"]["method"] = method

    res = client.post("/api/analysis/run", json=payload)
    assert res.status_code == 501
    body = res.json()
    _assert_error_envelope(body)
    assert body["error"]["code"] == "SOLVER_NOT_IMPLEMENTED"
