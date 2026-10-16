// Cooldown / damage math. Shared by the browser UI and the Node tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LoLCalc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BASIC = ['Q', 'W', 'E'];

  // Riot's stat growth curve: base + growth * (n-1) * (0.7025 + 0.0175 * (n-1))
  function statAtLevel(pair, level) {
    const n = Math.max(0, level - 1);
    return pair[0] + pair[1] * n * (0.7025 + 0.0175 * n);
  }

  const PCT_PEN = ['armorPenPct', 'magicPenPct'];

  function sumItems(items, itemDb) {
    const t = { ad: 0, ap: 0, ah: 0, hp: 0, armor: 0, mr: 0, mana: 0, lethality: 0,
      armorPenPct: 0, magicPenPct: 0, magicPenFlat: 0, apAmpPct: 0 };
    const unknown = [];
    for (const it of items) {
      const d = itemDb[it.id];
      if (!d) { unknown.push(it.name || String(it.id)); continue; }
      for (const [k, v] of Object.entries(d.stats)) {
        if (!(k in t)) continue;
        // percent penetration stacks multiplicatively
        if (PCT_PEN.includes(k)) t[k] = 100 * (1 - (1 - t[k] / 100) * (1 - v / 100));
        else t[k] += v;
      }
    }
    t.unknown = unknown;
    return t;
  }

  function computeStats(champ, level, items, itemDb) {
    const it = sumItems(items, itemDb);
    const base = {};
    for (const k of ['hp', 'ad', 'armor', 'mr', 'mana']) base[k] = statAtLevel(champ.stats[k], level);
    return {
      level,
      baseAd: base.ad, bonusAd: it.ad, ad: base.ad + it.ad,
      ap: it.ap * (1 + it.apAmpPct / 100),
      ah: it.ah,
      baseHp: base.hp, bonusHp: it.hp, hp: base.hp + it.hp,
      bonusArmor: it.armor, armor: base.armor + it.armor,
      bonusMr: it.mr, mr: base.mr + it.mr,
      bonusMana: it.mana, mana: base.mana + it.mana,
      lethality: it.lethality, armorPenPct: it.armorPenPct,
      magicPenFlat: it.magicPenFlat, magicPenPct: it.magicPenPct,
      unknownItems: it.unknown,
    };
  }

  // Guess skill ranks from champion level: R at 6/11/16, one point in each basic by level 3,
  // then max basics in `order`. A basic can reach rank n at level 2n-1.
  function estimateRanks(level, order) {
    order = order || BASIC;
    const ranks = { Q: 0, W: 0, E: 0, R: level >= 16 ? 3 : level >= 11 ? 2 : level >= 6 ? 1 : 0 };
    let pts = level - ranks.R;
    for (const k of order) if (pts > 0) { ranks[k] = 1; pts--; }
    const cap = Math.min(5, Math.floor((level + 1) / 2));
    for (const k of order) while (pts > 0 && ranks[k] < cap) { ranks[k]++; pts--; }
    return ranks;
  }

  // Index into a per-rank array. 18-long arrays scale with champion level instead of rank.
  function pickIndex(values, rank, level) {
    if (!values || !values.length) return -1;
    if (values.length === 1) return 0;
    if (values.length >= 18) return Math.min(Math.max(level, 1), values.length) - 1;
    if (!rank) return -1;
    return Math.min(rank, values.length) - 1;
  }

  // Converts a Meraki unit string ("% AP", "% bonus AD", "% of target's maximum health", ...)
  // into a multiplier. Returns null when it can't be resolved to a number.
  function unitMultiplier(unit, s, target) {
    const u = (unit || '').trim().toLowerCase();
    if (!u) return 1;
    if (!u.startsWith('%') || /per \d+/.test(u)) return null;
    const isTarget = /target|enemy|their/.test(u);
    const src = isTarget ? target : s;
    if (!src) return null;
    let stat;
    if (/missing health/.test(u)) stat = src.hp - (src.currentHp != null ? src.currentHp : src.hp);
    else if (/current health/.test(u)) stat = src.currentHp != null ? src.currentHp : src.hp;
    else if (/bonus health/.test(u)) stat = src.bonusHp;
    else if (/health/.test(u)) stat = src.hp;
    else if (/bonus (ad|attack damage)/.test(u)) stat = s.bonusAd;
    else if (/\bad\b|attack damage/.test(u)) stat = s.ad;
    else if (/\bap\b|ability power/.test(u)) stat = s.ap;
    else if (/bonus armor/.test(u)) stat = src.bonusArmor;
    else if (/armor/.test(u)) stat = src.armor;
    else if (/bonus magic res/.test(u)) stat = src.bonusMr;
    else if (/magic res/.test(u)) stat = src.mr;
    else if (/bonus mana/.test(u)) stat = src.bonusMana;
    else if (/mana/.test(u)) stat = src.mana;
    else return null;
    if (stat == null || isNaN(stat)) return null;
    return stat / 100;
  }

  function damageMultiplier(type, s, target) {
    if (!target) return null;
    if (type === 'true') return 1;
    let res;
    if (type === 'physical') res = target.armor;
    else if (type === 'magic') res = target.mr;
    else return null;
    if (res == null) return null;
    if (res > 0) {
      const pct = type === 'physical' ? s.armorPenPct : s.magicPenPct;
      const flat = type === 'physical' ? s.lethality : s.magicPenFlat;
      res = Math.max(0, res * (1 - pct / 100) - flat);
    }
    return res >= 0 ? 100 / (100 + res) : 2 - 100 / (100 - res);
  }

  function damageType(attribute, ability) {
    const a = attribute.toLowerCase();
    if (/heal|shield/.test(a)) return 'heal';
    if (/physical/.test(a)) return 'physical';
    if (/magic/.test(a)) return 'magic';
    if (/true/.test(a)) return 'true';
    const d = (ability.damageType || '').toLowerCase();
    if (d.startsWith('physical')) return 'physical';
    if (d.startsWith('magic')) return 'magic';
    if (d.startsWith('true')) return 'true';
    return 'mixed';
  }

  const fmtNum = v => (Math.round(v * 100) / 100).toString();

  function abilityLines(ability, rank, level, s, target) {
    const lines = [];
    for (const effect of ability.effects) {
      for (const lv of effect.leveling) {
        if (!/damage|shield|heal/i.test(lv.attribute)) continue;
        let raw = 0;
        let partial = false;
        let any = false;
        const parts = [];
        for (const m of lv.modifiers) {
          const i = pickIndex(m.values, rank, level);
          if (i < 0) continue;
          const v = m.values[i];
          const unit = (m.units[i] || '').trim();
          parts.push(unit ? `${fmtNum(v)}${unit.startsWith('%') ? '' : ' '}${unit}` : fmtNum(v));
          const mult = unitMultiplier(unit, s, target);
          if (mult == null) { partial = true; continue; }
          raw += v * mult;
          any = true;
        }
        if (!any) continue;
        const type = damageType(lv.attribute, ability);
        const mit = type === 'heal' ? null : damageMultiplier(type, s, target);
        lines.push({
          attribute: lv.attribute, type, raw, partial,
          vsYou: mit == null ? null : raw * mit,
          formula: parts.join(' + '),
        });
      }
    }
    return lines;
  }

  function cooldown(ability, rank, level, s) {
    const cd = ability.cooldown;
    if (!cd || !cd.values.length) return null;
    const i = pickIndex(cd.values, rank, level);
    const haste = cd.affectedByCdr ? 100 / (100 + (s.ah || 0)) : 1;
    return {
      base: i < 0 ? null : cd.values[i],
      now: i < 0 ? null : cd.values[i] * haste,
      perRank: cd.values.map(v => v * haste),
      currentIndex: cd.values.length >= 18 ? -1 : i,
      affectedByCdr: cd.affectedByCdr,
    };
  }

  // Full breakdown for one champion.
  function analyze(champ, player, itemDb, target, ranks) {
    const s = computeStats(champ, player.level, player.items, itemDb);
    const slots = [];
    let combo = 0;
    for (const slot of ['P', 'Q', 'W', 'E', 'R']) {
      const rank = slot === 'P' ? 1 : ranks[slot];
      const forms = (champ.abilities[slot] || []).map(ab => ({
        name: ab.name, icon: ab.icon,
        cooldown: cooldown(ab, rank, player.level, s),
        lines: abilityLines(ab, rank, player.level, s, target),
      }));
      if (slot === 'P' && !forms.some(f => (f.cooldown && f.cooldown.now) || f.lines.length)) continue;
      // rough one-rotation burst: first damage line of each basic/ult (first form only)
      if (slot !== 'P' && rank > 0 && forms[0]) {
        const first = forms[0].lines.find(l => l.type !== 'heal');
        if (first) combo += first.vsYou != null ? first.vsYou : first.raw;
      }
      slots.push({ slot, rank, maxRank: slot === 'R' ? 3 : 5, forms });
    }
    return { stats: s, slots, combo };
  }

  function summonerCooldown(spell) {
    return spell && spell.cooldown ? spell.cooldown : null;
  }

  return { statAtLevel, sumItems, computeStats, estimateRanks, pickIndex, unitMultiplier,
    damageMultiplier, abilityLines, cooldown, analyze, summonerCooldown };
});
