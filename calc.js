// 小児 緊急気管挿管 薬剤・チューブ計算 ― 計算ロジック
// 画面（index.html）とテスト（tests/calc.test.js）の両方から読み込む
(function (root) {
  'use strict';

  const W_MIN = 0.5;
  const W_MAX = 100;
  const ETT_MAX = 36; // 早見表の上限（kg）

  // 気管チューブ早見表（PALS 表56。フロー④の表と同じ値）
  // min は区分の下限。区分の間の体重（例 5.5kg）は小さい側の区分に入れる
  const ETT = [
    { min: 0,  label: '〜5kg',    age: '3ヵ月未満', cuff: '3.0', uncuff: '3.5', depth: '9〜10.5' },
    { min: 6,  label: '6〜9kg',   age: '3〜11ヵ月', cuff: '3.0', uncuff: '3.5', depth: '10〜11' },
    { min: 10, label: '10〜11kg', age: '1〜2歳',    cuff: '3.5', uncuff: '4.0', depth: '11〜12' },
    { min: 12, label: '12〜14kg', age: '2歳',       cuff: '4.0', uncuff: '4.5', depth: '12.5〜13.5' },
    { min: 15, label: '15〜18kg', age: '3〜4歳',    cuff: '4.5', uncuff: '5.0', depth: '14〜15' },
    { min: 19, label: '19〜23kg', age: '5〜6歳',    cuff: '5.0', uncuff: '5.5', depth: '15.5〜16.5' },
    { min: 24, label: '24〜29kg', age: '7〜9歳',    cuff: '5.5', uncuff: '—',   depth: '17〜18' },
    { min: 30, label: '30〜36kg', age: '10〜11歳',  cuff: '6.0', uncuff: '—',   depth: '18.5〜19.5' },
  ];

  // 薬剤
  //   perKg: 1回量（unit/kg）  conc: 投与液の濃度（unit/mL）
  //   total: 希釈して作る液量（mL）。原液のものは null
  //   vial:  原液のときの1本あたりの量（unit）
  //   max:   1回量の上限（unit）
  const DRUGS = {
    mdz: {
      name: 'ミダゾラム', role: '鎮静', perKg: 0.1, unit: 'mg', conc: 1, concText: '1 mg/mL',
      prep: '10mg/2mL を 2mL ＋ 5%糖液 8mL', total: 10,
    },
    flu: {
      name: 'フルマゼニル', role: '拮抗', perKg: 0.01, unit: 'mg', conc: 0.1, concText: '0.1 mg/mL',
      prep: '原液（0.5mg/5mL）', total: null, vial: 0.5, vialText: '0.5mg/5mL', max: 0.2,
    },
    fen: {
      name: 'フェンタニル', role: '鎮痛', perKg: 1, unit: 'μg', conc: 10, concText: '10 μg/mL',
      prep: '100μg/2mL を 2mL ＋ 5%糖液 8mL', total: 10,
    },
    nal: {
      name: 'ナロキソン', role: '拮抗', perKg: 3, unit: 'μg', conc: 20, concText: '20 μg/mL',
      prep: '0.2mg/1mL を 1mL ＋ 5%糖液 9mL', total: 10,
    },
    roc: {
      name: 'ロクロニウム', role: '筋弛緩', perKg: 1, unit: 'mg', conc: 10, concText: '10 mg/mL',
      prep: '原液（25mg/2.5mL）', total: null, vial: 25, vialText: '25mg/2.5mL',
    },
    sug: {
      name: 'スガマデクス', sub: 'ブリディオン', role: '拮抗', perKg: 16, unit: 'mg', conc: 100, concText: '100 mg/mL',
      prep: '原液（200mg/2mL）', total: null, vial: 200, vialText: '200mg/2mL',
    },
    adr10: {
      name: '10倍アドレナリン', role: '蘇生量', perKg: 10, unit: 'μg', conc: 100, concText: '100 μg/mL（0.1 mg/mL）',
      prep: 'アドレナリン 1mg/1mL を 1mL ＋ 5%糖液 9mL', total: 10, max: 1000,
    },
    adr100: {
      name: '100倍アドレナリン', role: '昇圧量', perKg: 1, unit: 'μg', conc: 10, concText: '10 μg/mL（0.01 mg/mL）',
      prep: '10倍アドレナリン 1mL ＋ 5%糖液 9mL', total: 10,
    },
  };

  // 浮動小数の誤差（1.65×10=16.4999…）で四捨五入がずれないよう、ごくわずかに補正する
  function roundTo(x, digits) {
    const f = Math.pow(10, digits);
    return Math.round(x * f * (1 + 1e-12)) / f;
  }

  // 液量の丸め：1mL未満は0.01mL単位（1mLシリンジ）、1mL以上は0.1mL単位
  function roundVol(ml) {
    return ml < 1 ? roundTo(ml, 2) : roundTo(ml, 1);
  }

  // 薬剤量の表示用の丸め（有効数字おおむね3桁）
  function roundAmount(x) {
    if (x >= 100) return roundTo(x, 0);
    if (x >= 10) return roundTo(x, 1);
    if (x >= 1) return roundTo(x, 2);
    return roundTo(x, 3);
  }

  function isValidWeight(w) {
    return typeof w === 'number' && isFinite(w) && w >= W_MIN && w <= W_MAX;
  }

  function ett(w) {
    if (w > ETT_MAX) return null;
    let row = ETT[0];
    for (const r of ETT) if (w >= r.min) row = r;
    // 3kg未満：サイズは3kgと同じ、深さは 体重(kg)＋6 cm（フロー④の注記）
    const under3 = w < 3;
    return {
      row,
      cuff: row.cuff,
      uncuff: row.uncuff,
      depth: under3 ? String(roundTo(w + 6, 1)) : row.depth,
      under3,
    };
  }

  function drug(id, w) {
    const d = DRUGS[id];
    const raw = w * d.perKg;
    const capped = d.max != null && raw > d.max;
    const dose = capped ? d.max : raw;
    const vol = roundVol(dose / d.conc);
    const warns = [];
    let vials = null;
    if (d.vial) {
      vials = Math.ceil(dose / d.vial - 1e-9);
    } else if (d.total != null && vol > d.total) {
      warns.push('1回量が調製量（' + d.total + 'mL）を超えます。2セット調製してください');
    }
    if (vol < 0.1) warns.push('0.1mL未満：正確に量れないため、さらに希釈を検討');
    return { id, dose: roundAmount(dose), vol, capped, vials, warns };
  }

  function compute(w) {
    if (!isValidWeight(w)) return null;
    const drugs = {};
    for (const id of Object.keys(DRUGS)) drugs[id] = drug(id, w);
    return { w, ett: ett(w), drugs };
  }

  const api = { W_MIN, W_MAX, ETT_MAX, ETT, DRUGS, roundTo, roundVol, roundAmount, isValidWeight, ett, drug, compute };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof self !== 'undefined' ? self : this);
