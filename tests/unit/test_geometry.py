"""翼型幾何生成・時計回りパネル離散化・カスタムDAT/CSV前処理の単体テスト（UT-GEOM-01..03）。"""

from __future__ import annotations

import math

import numpy as np
import pytest

from app.geometry import (
    AirfoilGeometryError,
    evaluate_naca4_camber,
    generate_naca4,
    parse_custom_airfoil,
    point_in_polygon,
)


class TestUtGeom01Naca0012SymmetryAndTe:
    """UT-GEOM-01: NACA 0012 座標生成精度・上下対称性・後縁閉合検証。"""

    def test_naca0012_closed_te_symmetry_and_thickness(self) -> None:
        mesh = generate_naca4("0012", num_panels=160, closed_te=True)

        assert mesh.num_panels == 160
        assert mesh.num_nodes == 161
        assert mesh.is_symmetric is True
        assert mesh.is_closed_te is True

        # 前縁節点インデックス k=80 (1始まり 81) が厳密に (0.0, 0.0)
        assert abs(mesh.x[80] - 0.0) <= 1e-15
        assert abs(mesh.y[80] - 0.0) <= 1e-15

        # 上下対応節点の対称誤差 <= 1e-15
        x_sym_err = float(np.max(np.abs(mesh.x[:80] - mesh.x[160:80:-1])))
        y_sym_err = float(np.max(np.abs(mesh.y[:80] + mesh.y[160:80:-1])))
        assert x_sym_err <= 1e-15
        assert y_sym_err <= 1e-15

        # 閉後縁座標誤差 <= 1e-15
        assert abs(mesh.y[0]) <= 1e-15
        assert abs(mesh.y[160]) <= 1e-15
        assert abs(mesh.x[0] - 1.0) <= 1e-15
        assert abs(mesh.x[160] - 1.0) <= 1e-15
        assert mesh.te_gap <= 1e-15

        # 離散コサイン点上の最大翼厚比誤差 <= 5e-4
        discrete_thickness = mesh.y[80:] - mesh.y[80::-1]
        max_thick = float(np.max(discrete_thickness))
        assert abs(max_thick - 0.12) <= 5e-4

    def test_naca0012_open_te_exact_gap(self) -> None:
        mesh = generate_naca4("0012", num_panels=160, closed_te=False)

        assert mesh.is_closed_te is False
        expected_half_te = 0.0105 * 0.12  # +0.00126
        assert abs(mesh.y[160] - expected_half_te) <= 1e-15
        assert abs(mesh.y[0] - (-expected_half_te)) <= 1e-15
        assert abs(mesh.x[0] - 1.0) <= 1e-15
        assert abs(mesh.x[160] - 1.0) <= 1e-15
        assert abs(mesh.te_gap - 2.0 * expected_half_te) <= 1e-15

    @pytest.mark.parametrize(
        "invalid_code",
        ["2012", "0412", "0000", "0041", "ABCD", "123", "12345", ""],
    )
    def test_invalid_naca4_codes_rejected(self, invalid_code: str) -> None:
        with pytest.raises(AirfoilGeometryError) as exc_info:
            generate_naca4(invalid_code, num_panels=160)
        assert exc_info.value.code == "INVALID_AIRFOIL_GEOMETRY"

    @pytest.mark.parametrize("bad_panels", [20, 38, 159, 302, 500, True])
    def test_invalid_num_panels_rejected(self, bad_panels: int) -> None:
        with pytest.raises(AirfoilGeometryError) as exc_info:
            generate_naca4("0012", num_panels=bad_panels)
        assert exc_info.value.code == "INVALID_NUM_PANELS"


class TestUtGeom02CamberAndOutwardNormals:
    """UT-GEOM-02: NACA 2412 / 4412 / 6412 キャンバー幾何・時計回り法線ベクトル検証。"""

    @pytest.mark.parametrize(
        ("code", "expected_m"),
        [("2412", 0.02), ("4412", 0.04), ("6412", 0.06)],
    )
    def test_camber_peak_clockwise_area_and_outward_normals(
        self,
        code: str,
        expected_m: float,
    ) -> None:
        # 1. xi = p = 0.4 におけるキャンバーピーク・勾配ゼロの検算
        yc_peak, dyc_peak = evaluate_naca4_camber(code, 0.4)
        assert abs(float(yc_peak) - expected_m) <= 1e-15
        assert abs(float(dyc_peak)) <= 1e-15

        # 2. パネルメッシュ構築・時計回り負面積確認
        mesh = generate_naca4(code, num_panels=160, closed_te=True)
        assert mesh.is_symmetric is False
        assert abs(mesh.max_camber_ratio - expected_m) <= 1e-15
        assert abs(mesh.max_camber_pos - 0.4) <= 1e-15
        assert mesh.signed_area < 0.0
        assert mesh.side[:80] == ["lower"] * 80
        assert mesh.side[80:] == ["upper"] * 80

        # 3. 単位接線・単位法線の正規直交性と右手系 det[t, n] = +1
        t_norm_err = float(np.max(np.abs(np.hypot(mesh.tx, mesh.ty) - 1.0)))
        n_norm_err = float(np.max(np.abs(np.hypot(mesh.nx, mesh.ny) - 1.0)))
        ortho_err = float(np.max(np.abs(mesh.tx * mesh.nx + mesh.ty * mesh.ny)))
        det_err = float(np.max(np.abs((mesh.tx * mesh.ny - mesh.ty * mesh.nx) - 1.0)))

        assert t_norm_err <= 1e-15
        assert n_norm_err <= 1e-15
        assert ortho_err <= 1e-15
        assert det_err <= 1e-15

        # nx = -sin(phi), ny = cos(phi) の明示一致確認
        assert float(np.max(np.abs(mesh.nx - (-np.sin(mesh.phi))))) <= 1e-15
        assert float(np.max(np.abs(mesh.ny - np.cos(mesh.phi)))) <= 1e-15

        # 4. 全160パネルで外向き微小オフセット点が翼外部 (is_inside == False) となること
        ext_x = mesh.x_c + 1e-4 * mesh.nx
        ext_y = mesh.y_c + 1e-4 * mesh.ny
        inside_flags = point_in_polygon(ext_x, ext_y, mesh.x, mesh.y)
        assert isinstance(inside_flags, np.ndarray)
        assert inside_flags.shape == (160,)
        assert int(np.count_nonzero(inside_flags)) == 0

        # 弦中央内部点 (0.3, yc(0.3)) は確実に内部 (True) であること
        yc_mid, _ = evaluate_naca4_camber(code, 0.3)
        assert point_in_polygon(0.3, float(yc_mid), mesh.x, mesh.y) is True


class TestUtGeom03CustomAirfoilIo:
    """UT-GEOM-03: カスタム翼型（Selig / Lednicer DAT・CSV）前処理・再パネル化検証。"""

    def test_selig_open_te_dat_normalization_and_auto_closure(self) -> None:
        # ① Selig 形式（反時計回り61点＝N=60パネル相当、開後縁）を作成
        src_open = generate_naca4("2412", num_panels=60, closed_te=False)
        selig_x = src_open.x[::-1]  # 上面後縁 -> 前縁 -> 下面後縁
        selig_y = src_open.y[::-1]
        lines = ["NACA 2412 Selig Open TE", "# generated for UT-GEOM-03"]
        lines.extend(f"  {xv:.8f}   {yv:.8f}" for xv, yv in zip(selig_x, selig_y))
        selig_dat = "\n".join(lines)

        mesh = parse_custom_airfoil(selig_dat, num_panels=160, closed_te=True)
        exact = generate_naca4("2412", num_panels=160, closed_te=True)

        assert mesh.num_panels == 160
        assert math.hypot(mesh.x[0] - 1.0, mesh.y[0] - 0.0) <= 1e-12
        assert math.hypot(mesh.x[-1] - 1.0, mesh.y[-1] - 0.0) <= 1e-12

        max_node_diff = float(np.max(np.hypot(mesh.x - exact.x, mesh.y - exact.y)))
        assert max_node_diff <= 1.5e-3

        warn_codes = [w.code for w in mesh.warnings]
        assert "OPEN_TE_CLOSED_AUTO" in warn_codes

    def test_lednicer_dat_crlf_and_point_count_header(self) -> None:
        # ② Lednicer 形式（上下各31点ブロック、ヘッダ・点数行・CRLF改行付き）
        src = generate_naca4("2412", num_panels=60, closed_te=True)
        # src: 0..30 が下面(TE->LE), 30..60 が上面(LE->TE)
        upper_le_to_te = np.column_stack([src.x[30:], src.y[30:]])  # 31点
        lower_le_to_te = np.column_stack([src.x[30::-1], src.y[30::-1]])  # 31点

        lines = [
            "NACA 2412 LEDNICER FORMAT",
            "  31.   31.",
            "",
        ]
        lines.extend(f"{pt[0]:.8f}  {pt[1]:.8f}" for pt in upper_le_to_te)
        lines.append("")
        lines.extend(f"{pt[0]:.8f}  {pt[1]:.8f}" for pt in lower_le_to_te)
        lednicer_text = "\r\n".join(lines) + "\r\n"

        mesh = parse_custom_airfoil(lednicer_text, num_panels=160, closed_te=True)
        exact = generate_naca4("2412", num_panels=160, closed_te=True)

        assert math.hypot(mesh.x[0] - 1.0, mesh.y[0] - 0.0) <= 1e-12
        assert math.hypot(mesh.x[-1] - 1.0, mesh.y[-1] - 0.0) <= 1e-12
        max_node_diff = float(np.max(np.hypot(mesh.x - exact.x, mesh.y - exact.y)))
        assert max_node_diff <= 1.5e-3

    def test_scaled_rotated_offset_csv_normalization_warning(self) -> None:
        # ③ 弦長 250 mm・取付角 +3.0° 回転・原点オフセット付き CSV
        src = generate_naca4("2412", num_panels=80, closed_te=True)
        chord_mm = 250.0
        psi_rad = math.radians(3.0)
        cos_p, sin_p = math.cos(psi_rad), math.sin(psi_rad)
        offset_x, offset_y = 15.0, -25.0

        sx = src.x * chord_mm
        sy = src.y * chord_mm
        rx = offset_x + sx * cos_p - sy * sin_p
        ry = offset_y + sx * sin_p + sy * cos_p

        csv_lines = ["x,y"] + [f"{xv:.8f},{yv:.8f}" for xv, yv in zip(rx, ry)]
        csv_text = "\n".join(csv_lines)

        mesh = parse_custom_airfoil(csv_text, num_panels=160, closed_te=True)
        exact = generate_naca4("2412", num_panels=160, closed_te=True)

        assert math.hypot(mesh.x[0] - 1.0, mesh.y[0] - 0.0) <= 1e-12
        assert math.hypot(mesh.x[-1] - 1.0, mesh.y[-1] - 0.0) <= 1e-12
        max_node_diff = float(np.max(np.hypot(mesh.x - exact.x, mesh.y - exact.y)))
        assert max_node_diff <= 1.5e-3

        norm_warns = [w for w in mesh.warnings if w.code == "CUSTOM_AIRFOIL_NORMALIZED"]
        assert len(norm_warns) == 1
        assert "250" in norm_warns[0].message
        assert "3." in norm_warns[0].message

    def test_abnormal_custom_dat_rejected(self) -> None:
        # 1. 空文字列
        with pytest.raises(AirfoilGeometryError):
            parse_custom_airfoil("   \n  ")

        # 2. 点数不足（5点のみ）
        few_pts = "0.0,0.0\n0.5,0.05\n1.0,0.0\n0.5,-0.05\n0.0,0.0"
        with pytest.raises(AirfoilGeometryError):
            parse_custom_airfoil(few_pts)

        # 3. 8の字型に自己交差するポリゴン
        t_vals = np.linspace(0.0, 2.0 * np.pi, 40, endpoint=False)
        fig8_x = 0.5 + 0.5 * np.cos(t_vals)
        fig8_y = 0.1 * np.sin(2.0 * t_vals)
        fig8_dat = "\n".join(f"{xv:.6f} {yv:.6f}" for xv, yv in zip(fig8_x, fig8_y))
        with pytest.raises(AirfoilGeometryError):
            parse_custom_airfoil(fig8_dat)

        # 4. 上面と下面が途中で逆転（y_U < y_L）または接触（厚さゼロピンチ）したデータ
        src = generate_naca4("0012", num_panels=40, closed_te=True)
        bad_y = src.y.copy()
        bad_y[28:33] = -0.08
        inverted_dat = "\n".join(f"{xv:.6f} {yv:.6f}" for xv, yv in zip(src.x, bad_y))
        with pytest.raises(AirfoilGeometryError):
            parse_custom_airfoil(inverted_dat)

        # 5. 内部 x=0.5 で上面と下面が接触（y_U == y_L）するピンチ形状
        pinch_y = src.y * ((src.x - 0.5) ** 2) * 4.0
        pinch_dat = "\n".join(f"{xv:.6f} {yv:.6f}" for xv, yv in zip(src.x, pinch_y))
        with pytest.raises(AirfoilGeometryError):
            parse_custom_airfoil(pinch_dat)
