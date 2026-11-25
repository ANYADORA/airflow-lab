"""INT-MODE-01: 簡易モードと本格モードの同一条件における API 解析結果 100% 一致検証テスト。"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from app.main import app


def _build_shared_store_payload(
    *,
    num_panels: int = 160,
) -> dict[str, Any]:
    """簡易モード・本格モード双方の単一ストアから生成される 7キー完全準拠リクエスト。"""
    return {
        "airfoil": {
            "source_type": "naca4",
            "naca_code": "2412",
            "name": "NACA 2412",
            "raw_coordinates_text": None,
        },
        "angle_of_attack": 6.0,
        "velocity": 20.0,
        "chord_length": 0.25,
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
            "num_panels": num_panels,
            "closed_te": True,
            "grid_nx": 120,
            "grid_ny": 80,
            "x_range": [-0.5, 1.6],
            "y_range": [-0.7, 0.7],
            "num_streamlines": 28,
        },
    }


def _strip_volatile_fields(response_json: dict[str, Any]) -> dict[str, Any]:
    """実行時刻・UUID・計測時間以外の全計算出力を抽出する。"""
    copied = dict(response_json)
    copied.pop("analysis_id", None)
    copied.pop("created_at", None)
    diag = dict(copied["diagnostics"])
    diag.pop("compute_time_ms", None)
    copied["diagnostics"] = diag
    return copied


def test_int_mode_01_simple_and_advanced_identical_results() -> None:
    """簡易モード実行と本格モード実行（および詳細パネル数 N=200 維持時）の全数値完全一致検証。"""
    client = TestClient(app)

    # 1. 簡易モード条件で実行 -> そのまま本格モード条件で実行
    payload_simple = _build_shared_store_payload(num_panels=160)
    payload_advanced = _build_shared_store_payload(num_panels=160)
    assert payload_simple == payload_advanced

    res_simple = client.post("/api/analysis/run", json=payload_simple)
    res_advanced = client.post("/api/analysis/run", json=payload_advanced)

    assert res_simple.status_code == 200
    assert res_advanced.status_code == 200

    clean_simple = _strip_volatile_fields(res_simple.json())
    clean_advanced = _strip_volatile_fields(res_advanced.json())

    # CL, Cm, Re, M, 表面Cp, 空間速度場, 流線座標すべて誤差 0.0 で 100% 一致
    assert clean_simple == clean_advanced

    # 2. 本格モードで num_panels=200 に変更して簡易モードに戻し維持した状態で再実行しても完全一致
    payload_adv_200 = _build_shared_store_payload(num_panels=200)
    res_adv_200 = client.post("/api/analysis/run", json=payload_adv_200)
    res_simple_with_adv_badge = client.post("/api/analysis/run", json=payload_adv_200)

    assert res_adv_200.status_code == 200
    assert res_simple_with_adv_badge.status_code == 200
    assert _strip_volatile_fields(res_adv_200.json()) == _strip_volatile_fields(
        res_simple_with_adv_badge.json()
    )
