/**
 * 実数値連動・決定論的ルールベース教育解説エンジン（PRODUCT_SPEC.md 第8章・NUMERICAL_METHOD.md 第11章）。
 *
 * 【絶対遵守ルール】
 * 誤った「同着理論（Equal Transit-Time Fallacy）」を肯定・使用する表現は一切含めない。
 * クッタの条件と循環 → 流線の曲率と圧力勾配 → ベルヌーイの定理 → 圧力差の合力（反作用）の4段階で解説する。
 */

import type { AnalysisResponse } from '../types/api';
import type { GeneratedExplanation } from '../types/analysis';
import { computeDynamicPressure, computeUnitSpanLift, formatReynolds } from './fluidPhysics';

function describeReynoldsRegime(re: number): string {
  if (re < 5e4) {
    return '小型模型や昆虫スケールに近い低レイノルズ数域であり、実際の流れでは粘性の影響（層流剥離泡など）が非常に強く表れます。';
  }
  if (re < 5e5) {
    return '自作風洞の翼型模型や小型無人機（UAV）に相当する中程度のレイノルズ数域です。';
  }
  if (re < 3e6) {
    return 'グライダーや小型プロペラ機に近いレイノルズ数域で、境界層が薄く理想流体モデルが低迎角域でよい目安になります。';
  }
  return '大型航空機スケールに近い高レイノルズ数域です。';
}

export function generateRuleBasedExplanation(result: AnalysisResponse): GeneratedExplanation {
  const geom = result.airfoil_geometry;
  const coeff = result.coefficients;
  const diag = result.diagnostics;
  const inputs = result.inputs;
  const fluid = result.resolved_fluid;
  const dim = result.dimensionless;

  const airfoilName = geom?.name ?? inputs.airfoil.name ?? `NACA ${inputs.airfoil.naca_code ?? 'Custom'}`;
  const isSymmetric = geom?.is_symmetric ?? false;
  const shapeTypeLabel = isSymmetric ? '対称翼' : 'キャンバー翼（反りのある翼）';
  const alpha = inputs.angle_of_attack;
  const alphaStr = `${alpha.toFixed(1)}°`;

  const cl = coeff?.cl ?? 0;
  const clStr = cl.toFixed(3);
  const cm = coeff?.cm_quarter_chord ?? 0;
  const cmStr = cm.toFixed(4);
  const cpMin = diag.cp_min ?? 0;
  const cpMinXc = diag.cp_min_xc ?? 0;
  const maxVelRatio = diag.max_velocity_ratio ?? 1;
  const reStr = formatReynolds(dim.reynolds_number);
  const machStr = dim.mach_number.toFixed(3);

  const qInf = computeDynamicPressure(fluid.density_kg_m3, inputs.velocity);
  const liftPerSpan = computeUnitSpanLift(
    fluid.density_kg_m3,
    inputs.velocity,
    inputs.chord_length,
    cl
  );

  const isNearZeroLift = Math.abs(cl) < 0.02;
  const liftDirectionLabel = isNearZeroLift
    ? 'ほぼゼロの揚力'
    : cl > 0
      ? '上向きの揚力'
      : '下向きの揚力（負揚力）';

  // 1. 結果の要約
  const summaryParagraphs: string[] = [
    `${airfoilName}（${shapeTypeLabel}）を迎角 ${alphaStr}、風速 ${inputs.velocity.toFixed(1)} m/s、翼弦長 ${inputs.chord_length.toFixed(2)} m で解析した結果、揚力係数 CL = ${clStr}（${liftDirectionLabel}）、1/4弦点周りピッチングモーメント係数 Cm,c/4 = ${cmStr} が得られました。`,
  ];

  if (isSymmetric && Math.abs(alpha) < 0.05) {
    summaryParagraphs.push(
      '対称翼で迎角が 0° のため、上面と下面の流れが完全に対称になり、上下の圧力差が生まれないことから CL ≈ 0 となっています。'
    );
  } else if (!isSymmetric && Math.abs(alpha) < 0.05) {
    summaryParagraphs.push(
      `迎角は 0° ですが、翼に反り（キャンバー）があるため翼周りの流れが非対称に曲がり、CL = ${clStr} の揚力が発生しています。`
    );
  }

  const waterCaveat =
    inputs.fluid_properties.preset === 'water_20c'
      ? '（※水プリセットではキャビテーション発生は未考慮です）'
      : '';

  summaryParagraphs.push(
    `参考換算値：動圧 q∞ = ${qInf.toFixed(1)} Pa、単位スパン（幅 1 m）あたりの理論揚力 L' = ${liftPerSpan.toFixed(2)} N/m${waterCaveat}。`
  );

  // 2. 揚力のしくみ（正しい4段階ロジック）
  const mechanismBullets: string[] = [
    `① クッタの条件と循環の発生：翼に迎角（${alphaStr}）や反りがあると、流れは尖った後縁を下から上へ急激に回り込めず、後縁から滑らかに後ろへ流れ去ります（クッタの条件）。この結果、翼の周りに循環（渦の成分）が自然に定まり、前縁から上面へ向かう流線が強く曲げられます。`,
    `② 流線の曲率と圧力勾配：空気が翼面に沿ってカーブを描いて曲がるには、カーブの内側へ向かう向心力が必要です。周囲の大気圧より翼表面側の圧力が低くなる（負圧 Cp < 0）ことで、流れを翼面側へ引き寄せる圧力勾配が釣り合っています。`,
    `③ ベルヌーイの定理と今回の実測値：圧力が下がる領域では流体が引き込まれて加速します（p + ½ρV² = 一定）。今回の解析では x/c = ${cpMinXc.toFixed(2)} 付近で流速が一様流の ${maxVelRatio.toFixed(2)} 倍に達し、最小圧力係数 Cp,min = ${cpMin.toFixed(2)} の負圧ピークが形成されています。`,
    `④ 上下の圧力差の合力と反作用：上面の負圧による吸い上げと下面の正圧による押し上げを翼全体で足し合わせた合力が揚力（CL = ${clStr}）です。これは翼が空気全体を下向きに押し下げた反作用（ニュートンの第3法則）とも一致します。`,
  ];

  // 3. 前提条件と限界
  const assumptionsParagraphs: string[] = [
    `今回のレイノルズ数は Re = ${reStr}（マッハ数 M = ${machStr}）です。${describeReynoldsRegime(dim.reynolds_number)}`,
    '本解析（Phase 1）は「2次元・非粘性・非圧縮ポテンシャル流れ（Hess-Smith パネル法）」に基づいています。無次元係数（CL, Cp, 流線形状）は形状と迎角のみで決まり、粘性摩擦・境界層の剥離・高迎角での失速はモデルに含まれません。そのため抗力係数 CD は算出不可（—）としています。',
  ];

  if (Math.abs(alpha) > 10) {
    assumptionsParagraphs.push(
      `現在の迎角 ${alphaStr} は実際の翼で境界層の剥離や失速が始まりやすい領域です。非粘性パネル法は失速による揚力低下を再現できないため、表示される CL = ${clStr} は現実より過大評価になっている点に注意してください。`
    );
  }

  // 4. 次の探究ヒント
  const inquiryBullets: string[] = [];
  if (isSymmetric && Math.abs(alpha) < 0.5) {
    inquiryBullets.push(
      '迎角を +5° に増やし、上面と下面の形状長さが全く同じ対称翼でも負圧ピークと揚力が発生することを Cp グラフで確認してみよう。'
    );
  } else if (!isSymmetric && Math.abs(alpha) > 0.5) {
    inquiryBullets.push(
      '迎角を 0° に下げて、キャンバー翼では迎角 0° でも揚力が残る（ゼロ揚力迎角が負側にある）ことを確かめてみよう。'
    );
  } else {
    inquiryBullets.push(
      '同じ迎角のまま NACA 0012（対称翼）と NACA 4412（中キャンバー翼）を切り替え、Cp 分布の山と CL の違いを比較してみよう。'
    );
  }
  inquiryBullets.push(
    '迎角を +4° と -4° で比較し、対称翼なら CL の符号が反転し、キャンバー翼では非対称になる理由を考察してみよう。'
  );
  inquiryBullets.push(
    '本格モードでパネル数（例：80 と 200）を変えても CL がほぼ収束することや、2条件比較機能で翼型差を数値比較してみよう。'
  );

  return {
    sourceBadge: 'ルールベース解説（計算結果に基づく定式生成）',
    blocks: [
      {
        id: 'summary',
        title: '1. 結果の要約',
        paragraphs: summaryParagraphs,
      },
      {
        id: 'mechanism',
        title: '2. 揚力のしくみ（正しい物理法則）',
        paragraphs: [
          '揚力は「流線の曲がり（循環）」「圧力勾配」「ベルヌーイの定理」が結びついて生まれます。',
        ],
        bullets: mechanismBullets,
      },
      {
        id: 'assumptions',
        title: '3. この計算モデルの前提と限界',
        paragraphs: assumptionsParagraphs,
      },
      {
        id: 'inquiry',
        title: '4. 次の探究ヒント',
        paragraphs: ['パラメータを少しずつ動かして、物理法則を自分の目で確かめてみましょう。'],
        bullets: inquiryBullets,
      },
    ],
    misconception: {
      title: 'よくある誤解：前縁で分かれた空気は後縁で一緒に合流するの？',
      misconceptionLabel: '同着仮説（Equal Transit-Time Fallacy）は物理学的に誤りです',
      correctionParagraphs: [
        '入門書などで見かける「翼の上面が長いので、前縁で上下に分かれた空気の粒が後縁で合流するために上面が速くなる」という説明は誤りです。流体粒子が後縁で合流する物理法則は存在しません。',
        '実際の風洞の煙線実験や本ソフトの速度分布が示す通り、正の揚力が出ているときは、上面を通る空気の粒の方が下面の粒よりもずっと早く後縁を通過して追い越していきます（これが翼周りの循環 Γ の正体です）。',
      ],
      tryItSteps: [
        '翼型を対称翼「NACA 0012」に選び、迎角を 5.0° にして解析してみよう。',
        '上面と下面の輪郭長さは完全に等しいのに、上面の速度比 |V|/V∞ が大きく上がり、明確な揚力（CL ≈ 0.60）が生じることを確認しよう。',
      ],
    },
  };
}
