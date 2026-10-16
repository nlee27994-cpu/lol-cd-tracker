'use strict';
// Offline tests: loads the fixture database + mock game and checks the math.
process.env.CACHE_DIR = require('path').join(__dirname, 'fixtures');
process.env.OFFLINE = '1';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { loadData, parseItemDescription } = require('../data');
const { buildState } = require('../server');
const C = require('../public/calc');

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg}: expected ${b}, got ${a}`);

(async () => {
  // stat growth: level 1 = base, level 18 = base + 17*growth
  near(C.statAtLevel([100, 10], 1), 100, 'lvl1');
  near(C.statAtLevel([100, 10], 18), 270, 'lvl18');

  // rank estimation
  assert.deepStrictEqual(C.estimateRanks(1), { Q: 1, W: 0, E: 0, R: 0 });
  assert.deepStrictEqual(C.estimateRanks(6), { Q: 3, W: 1, E: 1, R: 1 });
  assert.deepStrictEqual(C.estimateRanks(11, ['Q', 'E', 'W']), { Q: 5, W: 1, E: 3, R: 2 });
  assert.deepStrictEqual(C.estimateRanks(18), { Q: 5, W: 5, E: 5, R: 3 });

  // item description parsing
  assert.deepStrictEqual(parseItemDescription('<stats><attention>40%</attention> Magic Penetration<br><attention>15</attention> Ability Haste</stats>'),
    { magicPenPct: 40, ah: 15 });

  const data = await loadData();
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'mock', 'allgamedata.json'), 'utf8'));
  const st = buildState(raw, data);
  assert.strictEqual(st.me.id, 'You#NA1');
  const enemies = st.players.filter(p => p.side === 'enemy');
  assert.deepStrictEqual(enemies.map(p => p.championKey), ['Ahri', 'Zed', 'Jinx']);
  assert.strictEqual(enemies[0].summoners[1].name, 'Ignite');
  assert.strictEqual(enemies[0].summoners[1].cooldown, 180);

  // Ahri: Rabadon (130 AP, +30%) + Luden (100 AP, 10 AH) + Sorc shoes (12 mpen)
  const ahri = data.champions.Ahri;
  const a = C.analyze(ahri, enemies[0], data.items, st.me.stats, C.estimateRanks(11));
  near(a.stats.ap, 230 * 1.3, 'Ahri AP');
  near(a.stats.ah, 10, 'Ahri haste');
  near(a.stats.magicPenFlat, 12, 'Ahri mpen');
  const q = a.slots.find(s => s.slot === 'Q');
  near(q.forms[0].cooldown.now, 7 * 100 / 110, 'Ahri Q cd');
  const qMagic = q.forms[0].lines[0];
  near(qMagic.raw, 140 + 0.45 * 299, 'Ahri Q dmg');           // rank 5
  near(qMagic.vsYou, qMagic.raw * 100 / (100 + 48 - 12), 'Ahri Q vs 48 MR - 12 pen');
  near(q.forms[0].lines[1].vsYou, q.forms[0].lines[1].raw, 'true damage unmitigated');
  const r = a.slots.find(s => s.slot === 'R');
  near(r.forms[0].cooldown.now, 105 * 100 / 110, 'Ahri R rank 2 cd');

  // Zed lvl 9: Youmuu (55 AD, 18 leth, 15 AH) + Serylda (45 AD, 35% arpen, 15 AH) + unknown item
  const z = C.analyze(data.champions.Zed, enemies[1], data.items, st.me.stats, C.estimateRanks(9));
  near(z.stats.bonusAd, 100, 'Zed bonus AD');
  near(z.stats.ah, 30, 'Zed AH');
  assert.deepStrictEqual(z.stats.unknownItems, ['Mystery Item']);
  const zq = z.slots.find(s => s.slot === 'Q').forms[0].lines[0];
  const effArmor = 72 * 0.65 - 18;
  near(zq.raw, 220 + 110, 'Zed Q dmg');
  near(zq.vsYou, 330 * 100 / (100 + effArmor), 'Zed Q vs armor');
  const zp = z.slots.find(s => s.slot === 'P');
  near(zp.forms[0].lines[0].raw, 0.06 * 1450, 'Zed passive % target max hp');
  near(zp.forms[0].cooldown.now, 10, 'passive cd not reduced by haste');
  const zr = z.slots.find(s => s.slot === 'R').forms[0];
  assert.ok(zr.lines.every(l => l.attribute !== 'Damage Stored' || l.partial === true) || zr.lines.length === 1, 'unresolvable units flagged');

  console.log('Ahri burst vs you:', Math.round(a.combo), '| Zed burst vs you:', Math.round(z.combo));
  console.log('All tests passed.');
})().catch(e => { console.error(e); process.exit(1); });
