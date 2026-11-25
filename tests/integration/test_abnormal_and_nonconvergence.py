"""ERR-VAL-01, ERR-VAL-02, ERR-SOL-01, ERR-SOL-02: 異常入力422・未実装501・非収束遮断の統合検証テスト。"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
import jsonschema
import numpy as np
import pytest
from referencing import Registry, Resource

from app.geometry import generate_naca4
from app.main import app

SCHEMAS_DIR = Path(__file__).resolve().parents[2] / "contracts" / "schemas"


def _base_valid_payload() -> dict[str, Any]:
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
        "solver": {"method": "panel_method"},
        "numerical_settings": {
            "num_panels": 160,
            "closed_te": True,
            "grid_nx": 80,
            "grid_ny": 60,
            "x_range": [-0.5, 1.6],
            "y_range": [-0.7, 0.7],
            "num_streamlines": 20,
        },
    }


def _assert_422_error_envelope(resp: Any) -> None:
    assert resp.status_code == 422, f"Expected 422, got {resp.status_code}: {resp.text}"
    body = resp.json()
    assert "error" in body
    assert isinstance(body["error"]["code"], str) and len(body["error"]["code"]) > 0
    assert isinstance(body["error"]["message"], str) and len(body["error"]["message"]) > 0


class TestErrVal01And02AbnormalInputs:
    """ERR-VAL-01, ERR-VAL-02: 物理パラメータ・数値設定・翼型データの 422 遮断検証。"""

    @pytest.mark.parametrize(
        ("mutator"),
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
            lambda p: p["fluid_properties"].update(
                {"preset": "custom", "mode": "direct_mu", "density_kg_m3": 900.0, "dynamic_viscosity_pa_s": 1e-3, "speed_of_sound_mps": None}
            ),
            lambda p: p["numerical_settings"].update({"num_panels": 159}),
            lambda p: p["numerical_settings"].update({"num_panels": 20}),
            lambda p: p["numerical_settings"].update({"num_panels": 500}),
            lambda p: p["numerical_settings"].update({"num_streamlines": 0}),
            lambda p: p["numerical_settings"].update({"num_streamlines": 200}),
            lambda p: p["airfoil"].update({"naca_code": "2012"}),
            lambda p: p["airfoil"].update({"naca_code": "0412"}),
            lambda p: p["airfoil"].update({"naca_code": "0000"}),
            lambda p: p["airfoil"].update({"naca_code": "ABCD"}),
        ],
    )
    def test_err_val_01_02_analysis_run_422_rejection(self, mutator: Any) -> None:
        client = TestClient(app)
        payload = copy.deepcopy(_base_valid_payload())
        mutator(payload)
        resp = client.post("/api/analysis/run", json=payload)
        _assert_422_error_envelope(resp)

    def test_err_val_02_corrupted_custom_dat_rejected_on_generate_and_run(self) -> None:
        client = TestClient(app)

        # ① 空文字列、② 5点のみ、③ 8の字型自己交差、④ 上下逆転データ
        t_vals = np.linspace(0.0, 2.0 * np.pi, 40, endpoint=False)
        fig8_dat = "\n".join(
            f"{0.5 + 0.5 * np.cos(t):.6f} {0.1 * np.sin(2.0 * t):.6f}" for t in t_vals
        )

        src = generate_naca4("0012", num_panels=40, closed_te=True)
        inv_y = src.y.copy()
        inv_y[26:34] = -0.09
        inverted_dat = "\n".join(f"{xv:.6f} {yv:.6f}" for xv, yv in zip(src.x, inv_y))

        bad_dat_samples = [
            "",
            "0.0 0.0\n0.5 0.05\n1.0 0.0\n0.5 -0.05\n0.0 0.0",
            fig8_dat,
            inverted_dat,
        ]

        for bad_txt in bad_dat_samples:
            r_gen = client.post(
                "/api/airfoils/generate",
                json={
                    "source_type": "custom_dat",
                    "raw_coordinates_text": bad_txt,
                    "num_panels": 160,
                    "closed_te": True,
                },
            )
            _assert_422_error_envelope(r_gen)

            run_payload = copy.deepcopy(_base_valid_payload())
            run_payload["airfoil"] = {
                "source_type": "custom_dat",
                "naca_code": None,
                "name": "Bad Airfoil",
                "raw_coordinates_text": bad_txt,
            }
            r_run = client.post("/api/analysis/run", json=run_payload)
            _assert_422_error_envelope(r_run)


def test_err_sol_01_non_converged_failed_response_nulls_visual_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """ERR-SOL-01: ソルバー破綻時に status='failed' かつ描画配列がすべて null となり Schema 準拠すること。"""
    client = TestClient(app)

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
    validator = jsonschema.Draft202012Validator(res_schema, registry=registry)

    # 先に正常な解析を1件実行
    ok_resp = client.post("/api/analysis/run", json=_base_valid_payload())
    assert ok_resp.status_code == 200
    ok_id = ok_resp.json()["analysis_id"]

    # 行列条件数悪化を注入して POST /api/analysis/run を実行
    monkeypatch.setattr(np.linalg, "cond", lambda _m: 4.8e12)
    fail_resp = client.post("/api/analysis/run", json=_base_valid_payload())
    assert fail_resp.status_code == 200

    fail_body = fail_resp.json()
    validator.validate(fail_body)

    assert fail_body["status"] == "failed"
    assert fail_body["diagnostics"]["converged"] is False
    assert fail_body["coefficients"] is None
    assert fail_body["surface"] is None
    assert fail_body["flow_field"] is None
    assert fail_body["streamlines"] is None
    assert fail_body["failure"]["code"] == "ILL_CONDITIONED_MATRIX"

    # 片方が failed の compare では KPI 差分が null になること
    cmp_resp = client.post(
        "/api/analysis/compare",
        json={
            "base_analysis_id": ok_id,
            "target_analysis_id": fail_body["analysis_id"],
        },
    )
    assert cmp_resp.status_code == 200
    diff = cmp_resp.json()["diff"]
    assert diff["delta_cl"] is None
    assert diff["delta_cm_quarter_chord"] is None
    assert diff["delta_cp_min"] is None
    assert diff["delta_cd"] is None


@pytest.mark.parametrize("unimplemented_method", ["xfoil", "cfd_su2"])
def test_err_sol_02_unimplemented_solvers_return_501(unimplemented_method: str) -> None:
    """ERR-SOL-02: 未実装フェーズのソルバー指定時に 501 Not Implemented を返すこと。"""
    client = TestClient(app)
    payload = copy.deepcopy(_base_valid_payload())
    payload["solver"]["method"] = unimplemented_method

    resp = client.post("/api/analysis/run", json=payload)
    assert resp.status_code == 501
    err = resp.json()["error"]
    assert err["code"] == "SOLVER_NOT_IMPLEMENTED"
    assert unimplemented_method in err["message"]
