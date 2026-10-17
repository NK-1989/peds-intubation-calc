// 小児 緊急気管挿管 薬剤・チューブ計算 ― 計算ロジック
// 画面（index.html）とテスト（tests/calc.test.js）の両方から読み込む
(function (root) {
  'use strict';

  const W_MIN = 0.5;
  const W_MAX = 100;
  const ETT_MAX = 36; // 早見表の上限（kg）

  // 気管チューブ早見表（PALSプロバイダーマニュアル 日本語版2021 表56「身長別カラーコード化蘇生テープ」）
  // min は区分の下限。区分の間の体重（例 7.5kg）は小さい側の区分に入れる
  const ETT = [
    { min: 0,  color: '',       label: '3kg',      age: '3ヵ月未満',  cuff: '3.0', uncuff: '3.5', depth: '9〜9.5' },
    { min: 4,  color: '',       label: '4kg',      age: '3ヵ月未満',  cuff: '3.0', uncuff: '3.5', depth: '9.5〜10' },
    { min: 5,  color: '',       label: '5kg',      age: '3ヵ月未満',  cuff: '3.0', uncuff: '3.5', depth: '10〜10.5' },
    { min: 6,  color: 'ピンク', label: '6〜7kg',   age: '3〜5ヵ月',   cuff: '3.0', uncuff: '3.5', depth: '10〜10.5' },
    { min: 8,  color: '赤',     label: '8〜9kg',   age: '6〜11ヵ月',  cuff: '3.0', uncuff: '3.5', depth: '10.5〜11' },
    { min: 10, color: '紫',     label: '10〜11kg', age: '12〜24ヵ月', cuff: '3.5', uncuff: '4.0', depth: '11〜12' },
    { min: 12, color: '黄',     label: '12〜14kg', age: '2歳',        cuff: '4.0', uncuff: '4.5', depth: '12.5〜13.5' },
    { min: 15, color: '白',     label: '15〜18kg', age: '3〜4歳',     cuff: '4.5', uncuff: '5.0', depth: '14〜15' },
    { min: 19, color: '青',     label: '19〜23kg', age: '5〜6歳',     cuff: '5.0', uncuff: '5.5', depth: '15.5〜16.5' },
    { min: 24, color: 'オレンジ', label: '24〜29kg', age: '7〜9歳',   cuff: '5.5', uncuff: '—',   depth: '17〜18' },
    { min: 30, color: '緑',     label: '30〜36kg', age: '10〜11歳',   cuff: '6.0', uncuff: '—',   depth: '18.5〜19.5' },
  ];

  // i-gel（声門上器具）の体重区分（目安）。両端を含む区間で、重なる体重では2サイズが当てはまる
  //   インターサージカル i-gel 添付文書（認証番号 22200BZX00120000、2017年5月 第2版）の表。
  //   メーカーのポスター（IGELPOSTER issue 3, 2018）と、小児サイズは Kayhan 2015・Abukawa 2012 とも一致
  const IGEL = [
    { size: '1',   min: 2,  max: 5,        text: '2〜5kg' },
    { size: '1.5', min: 5,  max: 12,       text: '5〜12kg' },
    { size: '2',   min: 10, max: 25,       text: '10〜25kg' },
    { size: '2.5', min: 25, max: 35,       text: '25〜35kg' },
    { size: '3',   min: 30, max: 60,       text: '30〜60kg' },
    { size: '4',   min: 50, max: 90,       text: '50〜90kg' },
    { size: '5',   min: 90, max: Infinity, text: '90kg超', openMin: true },
  ];

  function igel(w) {
    const hits = IGEL.filter((r) =>
      (r.openMin ? w > r.min : w >= r.min) && (r.openMax ? w < r.max : w <= r.max));
    return { sizes: hits.map((r) => r.size), rows: hits, overlap: hits.length > 1 };
  }

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
    // エクセル25行目と同じ作り方：蘇生量の10倍アドレナリン（その子の1回量）を計10mLに薄める。
    // 濃度は体重によって変わり、1mL＝1μg/kg になる
    adr100: {
      name: '昇圧用アドレナリン', sub: '体重別希釈', role: '昇圧量', perKg: 1, unit: 'μg',
      dilutedFrom: 'adr10', total: 10,
    },
  };

  // 浮動小数の誤差（1.65×10=16.4999…）で四捨五入がずれないよう、ごくわずかに補正する。
  // 負の数も絶対値で四捨五入する（エクセルの ROUND と同じ）
  function roundTo(x, digits) {
    const f = Math.pow(10, digits);
    return Math.sign(x) * Math.round(Math.abs(x) * f * (1 + 1e-12)) / f;
  }

  // 液量の丸め：0.1mL単位で四捨五入（院内の緊急薬剤計算表と同じ）
  function roundVol(ml) {
    return roundTo(ml, 1);
  }

  // 四捨五入で実際に入る量が目的量から何%ずれるか（小数第1位）。ずれがなければ null
  function errorPct(actual, target) {
    const e = (actual - target) / target * 100;
    return Math.abs(e) < 0.05 ? null : roundTo(e, 1);
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
    // 3kg未満：サイズは3kgと同じ（フロー④の決定）、深さは 体重(kg)＋6 cm（ESAIC）
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
    if (d.dilutedFrom) return dilutedDrug(id, w);
    const raw = w * d.perKg;
    const capped = d.max != null && raw > d.max;
    const dose = capped ? d.max : raw;        // 目的量
    const exact = dose / d.conc;              // 目的量どおりの液量（丸める前）
    const vol = roundVol(exact);
    const actual = vol * d.conc;              // 四捨五入した液量で実際に入る量
    const warns = [];
    let vials = null;
    if (d.vial) {
      vials = Math.ceil(actual / d.vial - 1e-9);
    } else if (d.total != null && vol > d.total) {
      warns.push('1回量が調製量（' + d.total + 'mL）を超えます。2セット調製してください');
    }
    if (exact < 0.1) warns.push('目的量が0.1mL未満：さらに希釈して量を増やすことを検討');
    return {
      id, dose: roundAmount(actual), target: roundAmount(dose), exact: roundTo(exact, 3), errPct: errorPct(actual, dose),
      vol, capped, vials, warns, prep: d.prep, total: d.total, concText: d.concText,
    };
  }

  // 体重別に希釈する薬剤（昇圧用アドレナリン）。元の液の採取量は、画面に出す元の薬剤の1回量（mL）と同じにする
  function dilutedDrug(id, w) {
    const d = DRUGS[id];
    const src = drug(d.dilutedFrom, w);
    const conc = DRUGS[d.dilutedFrom].conc * src.vol / d.total;
    const dose = w * d.perKg;
    const exact = dose / conc;
    const vol = roundVol(exact);
    const actual = vol * conc;
    const diluent = roundTo(d.total - src.vol, 1);
    const srcName = DRUGS[d.dilutedFrom].name;
    const warns = [];
    return {
      id, dose: roundAmount(actual), target: roundAmount(dose), exact: roundTo(exact, 3), errPct: errorPct(actual, dose),
      vol, capped: false, vials: null, warns, total: d.total,
      prep: diluent > 0 ? srcName + ' ' + src.vol + 'mL ＋ 5%糖液 ' + diluent + 'mL' : srcName + ' ' + src.vol + 'mL（希釈なし）',
      concText: roundAmount(conc) + ' μg/mL（体重で変わる）',
      srcVol: src.vol, conc: roundAmount(conc),
    };
  }

  function compute(w) {
    if (!isValidWeight(w)) return null;
    const drugs = {};
    for (const id of Object.keys(DRUGS)) drugs[id] = drug(id, w);
    return { w, ett: ett(w), igel: igel(w), drugs };
  }

  const api = { W_MIN, W_MAX, ETT_MAX, ETT, IGEL, DRUGS, roundTo, roundVol, roundAmount, errorPct, isValidWeight, ett, igel, drug, compute };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof self !== 'undefined' ? self : this);
