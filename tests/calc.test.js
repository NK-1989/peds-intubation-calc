// 計算ロジックのテスト（node tests/calc.test.js）
'use strict';
const assert = require('assert');
const C = require('../calc.js');

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok  ' + name); }

// エクセル（★緊急シート）の ROUND(体重×1回量/濃度, 1) を再現
function excelRound1(x) { return Math.round(x * 10 * (1 + 1e-12)) / 10; }
const EXCEL = { mdz: [0.1, 1], flu: [0.01, 0.1], fen: [1, 10], nal: [3, 20], roc: [1, 10], sug: [16, 100], adr10: [0.01 * 1000, 0.1 * 1000] };

t('体重11kg：エクセルの表示値と一致', () => {
  const r = C.compute(11).drugs;
  assert.strictEqual(r.mdz.vol, 1.1);
  assert.strictEqual(r.flu.vol, 1.1);
  assert.strictEqual(r.fen.vol, 1.1);
  assert.strictEqual(r.nal.vol, 1.7);
  assert.strictEqual(r.roc.vol, 1.1);
  assert.strictEqual(r.sug.vol, 1.8);
  assert.strictEqual(r.adr10.vol, 1.1);
  assert.strictEqual(r.adr100.vol, 1.1); // 100倍（10μg/mL）で 1μg/kg
});

t('1mL以上はエクセルと同じ丸め、1mL未満は差が0.05mL以内（0.5〜100kg、0.1kg刻み）', () => {
  for (let i = 5; i <= 1000; i++) {
    const w = i / 10;
    const r = C.compute(w).drugs;
    for (const id of Object.keys(EXCEL)) {
      if (id === 'flu' && w > 20) continue; // フルマゼニルは上限0.2mgをかけているので別に確認
      const [perKg, conc] = EXCEL[id];
      const ex = excelRound1(w * perKg / conc);
      const app = r[id].vol;
      if (app >= 1) assert.strictEqual(app, ex, id + ' ' + w + 'kg: app ' + app + ' / excel ' + ex);
      else assert.ok(Math.abs(app - ex) <= 0.05 + 1e-9, id + ' ' + w + 'kg: app ' + app + ' / excel ' + ex);
    }
  }
});

t('浮動小数の誤差で四捨五入がずれない', () => {
  assert.strictEqual(C.roundTo(1.65, 1), 1.7);
  assert.strictEqual(C.roundTo(0.145, 2), 0.15);
  assert.strictEqual(C.roundTo(2.675, 2), 2.68);
  assert.strictEqual(C.roundVol(0.45), 0.45);
  assert.strictEqual(C.roundVol(0.996), 1);
});

t('フルマゼニルは1回0.2mg（2mL）で頭打ち', () => {
  assert.strictEqual(C.drug('flu', 20).capped, false);
  assert.strictEqual(C.drug('flu', 20).vol, 2);
  const r = C.drug('flu', 35);
  assert.strictEqual(r.capped, true);
  assert.strictEqual(r.dose, 0.2);
  assert.strictEqual(r.vol, 2);
});

t('原液の必要本数', () => {
  assert.strictEqual(C.drug('roc', 25).vials, 1);
  assert.strictEqual(C.drug('roc', 25.1).vials, 2);
  assert.strictEqual(C.drug('sug', 12.5).vials, 1);   // 200mg ちょうど
  assert.strictEqual(C.drug('sug', 36).vials, 3);     // 576mg
});

t('希釈液が10mLを超えると警告、0.1mL未満も警告', () => {
  assert.ok(C.drug('nal', 70).warns.some((m) => m.includes('2セット'))); // 210μg > 200μg
  assert.ok(!C.drug('nal', 66).warns.some((m) => m.includes('2セット')));
  assert.ok(C.drug('mdz', 0.5).warns.some((m) => m.includes('0.1mL未満')));
  assert.strictEqual(C.drug('mdz', 1).warns.length, 0);
});

t('10倍と100倍アドレナリンは同じmL・10倍違う量', () => {
  const a = C.drug('adr10', 7.3), b = C.drug('adr100', 7.3);
  assert.strictEqual(a.vol, b.vol);
  assert.strictEqual(a.dose, 73);
  assert.strictEqual(b.dose, 7.3);
});

t('気管チューブ：PALS 表56 の区分と境界', () => {
  const cases = [
    [2.5, '3.0', '3.5', '8.5'], [3, '3.0', '3.5', '9〜9.5'], [3.9, '3.0', '3.5', '9〜9.5'],
    [4, '3.0', '3.5', '9.5〜10'], [5, '3.0', '3.5', '10〜10.5'], [5.9, '3.0', '3.5', '10〜10.5'],
    [6, '3.0', '3.5', '10〜10.5'], [7.9, '3.0', '3.5', '10〜10.5'], [8, '3.0', '3.5', '10.5〜11'],
    [9.9, '3.0', '3.5', '10.5〜11'], [10, '3.5', '4.0', '11〜12'],
    [11.5, '3.5', '4.0', '11〜12'], [12, '4.0', '4.5', '12.5〜13.5'], [15, '4.5', '5.0', '14〜15'],
    [19, '5.0', '5.5', '15.5〜16.5'], [24, '5.5', '—', '17〜18'], [30, '6.0', '—', '18.5〜19.5'],
    [36, '6.0', '—', '18.5〜19.5'],
  ];
  assert.strictEqual(C.ETT.length, 11);
  assert.strictEqual(C.ett(7).row.color, 'ピンク');
  for (const [w, cuff, uncuff, depth] of cases) {
    const e = C.ett(w);
    assert.deepStrictEqual([e.cuff, e.uncuff, e.depth], [cuff, uncuff, depth], w + 'kg');
  }
  assert.strictEqual(C.ett(36.1), null);
});

t('入力範囲外は計算しない', () => {
  assert.strictEqual(C.compute(0.4), null);
  assert.strictEqual(C.compute(100.1), null);
  assert.strictEqual(C.compute(NaN), null);
  assert.ok(C.compute(0.5));
  assert.ok(C.compute(100));
});

console.log('\n' + n + ' tests passed');
