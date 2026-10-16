'use strict';
// Downloads and normalizes the static game database:
//   - Meraki Analytics (community-maintained): per-rank ability cooldowns, damage values and ratios
//   - Riot Data Dragon (official): champion base stats, item stats, summoner spells, icons
// Everything is cached in ./cache so the app still starts without internet.

const fs = require('fs');
const path = require('path');

const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, 'cache');
const OFFLINE = !!process.env.OFFLINE;
const DD = 'https://ddragon.leagueoflegends.com';
const MERAKI = 'https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US';

async function cached(name, url, maxAgeHours) {
  const file = path.join(CACHE_DIR, name);
  let stat = null;
  try { stat = fs.statSync(file); } catch {}
  const fresh = stat && Date.now() - stat.mtimeMs < maxAgeHours * 3600e3;
  if (!fresh && !OFFLINE) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const json = JSON.parse(text);
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(file, text);
      return json;
    } catch (e) {
      console.warn(`  ! could not download ${name}: ${e.message}${stat ? ' (using cached copy)' : ''}`);
    }
  }
  if (!stat) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// ---------- champions ----------

const MERAKI_STATS = { hp: 'health', ad: 'attackDamage', armor: 'armor', mr: 'magicResistance', mana: 'mana' };
const DD_STATS = {
  hp: ['hp', 'hpperlevel'], ad: ['attackdamage', 'attackdamageperlevel'], armor: ['armor', 'armorperlevel'],
  mr: ['spellblock', 'spellblockperlevel'], mana: ['mp', 'mpperlevel'],
};

function normMerakiAbility(a) {
  const cd = a.cooldown && a.cooldown.modifiers && a.cooldown.modifiers[0];
  return {
    name: a.name,
    icon: a.icon || null,
    damageType: a.damageType || null,
    cooldown: cd ? { values: cd.values || [], affectedByCdr: a.cooldown.affectedByCdr !== false } : null,
    effects: (a.effects || []).map(e => ({
      description: e.description || '',
      leveling: (e.leveling || []).map(l => ({
        attribute: l.attribute || '',
        modifiers: (l.modifiers || []).map(m => ({ values: m.values || [], units: m.units || [] })),
      })),
    })),
  };
}

function normChampion(key, meraki, dd, version) {
  const stats = {};
  for (const k of Object.keys(MERAKI_STATS)) {
    if (dd && dd.stats) stats[k] = [dd.stats[DD_STATS[k][0]] || 0, dd.stats[DD_STATS[k][1]] || 0];
    else {
      const s = meraki && meraki.stats && meraki.stats[MERAKI_STATS[k]];
      stats[k] = [(s && s.flat) || 0, (s && s.perLevel) || 0];
    }
  }

  const abilities = {};
  ['P', 'Q', 'W', 'E', 'R'].forEach((slot, i) => {
    if (meraki && meraki.abilities && meraki.abilities[slot]) {
      abilities[slot] = meraki.abilities[slot].map(normMerakiAbility);
    } else if (dd) {
      // Data Dragon fallback: cooldowns only, no reliable damage numbers
      const sp = slot === 'P' ? dd.passive : dd.spells && dd.spells[i - 1];
      abilities[slot] = sp ? [{
        name: sp.name,
        icon: sp.image ? `${DD}/cdn/${version}/img/${slot === 'P' ? 'passive' : 'spell'}/${sp.image.full}` : null,
        damageType: null,
        cooldown: sp.cooldown ? { values: sp.cooldown, affectedByCdr: true } : null,
        effects: [],
      }] : [];
    } else abilities[slot] = [];
  });

  // Prefer the versioned Data Dragon spell icons
  if (dd && dd.spells) {
    dd.spells.forEach((sp, i) => {
      const forms = abilities['QWER'[i]];
      if (forms && forms[0] && sp.image) forms[0].icon = `${DD}/cdn/${version}/img/spell/${sp.image.full}`;
    });
  }

  return {
    key,
    name: (dd && dd.name) || (meraki && meraki.name) || key,
    stats,
    abilities,
    hasDamageData: !!(meraki && meraki.abilities),
  };
}

// ---------- items ----------

const DD_ITEM_STATS = {
  FlatPhysicalDamageMod: 'ad', FlatMagicDamageMod: 'ap', FlatHPPoolMod: 'hp',
  FlatArmorMod: 'armor', FlatSpellBlockMod: 'mr', FlatMPPoolMod: 'mana',
};
const DESC_STATS = {
  'attack damage': 'ad', 'ability power': 'ap', 'ability haste': 'ah', 'health': 'hp', 'armor': 'armor',
  'magic resist': 'mr', 'lethality': 'lethality', 'armor penetration': 'armorPenPct', 'mana': 'mana',
};

function parseItemDescription(desc) {
  const out = {};
  const m = /<stats>([\s\S]*?)<\/stats>/i.exec(desc || '');
  if (m) {
    const re = /<attention>\s*([\d.]+)\s*(%?)\s*<\/attention>\s*([^<]+)/gi;
    let s;
    while ((s = re.exec(m[1]))) {
      const value = parseFloat(s[1]);
      const pct = s[2] === '%';
      const name = s[3].trim().toLowerCase();
      if (name === 'magic penetration') out[pct ? 'magicPenPct' : 'magicPenFlat'] = value;
      else if (DESC_STATS[name]) out[DESC_STATS[name]] = value;
    }
  }
  const plain = (desc || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const amp = /Ability Power by (\d+)%/i.exec(plain);
  if (amp) out.apAmpPct = parseFloat(amp[1]);
  return out;
}

function merakiItemStats(item) {
  const s = (item && item.stats) || {};
  const f = (k, sub = 'flat') => (s[k] && s[k][sub]) || 0;
  const out = {
    ad: f('attackDamage'), ap: f('abilityPower'), ah: f('abilityHaste'), hp: f('health'),
    armor: f('armor'), mr: f('magicResistance'), mana: f('mana'), lethality: f('lethality'),
    armorPenPct: f('armorPenetration', 'percent'),
    magicPenFlat: f('magicPenetration'), magicPenPct: f('magicPenetration', 'percent'),
  };
  for (const k of Object.keys(out)) if (!out[k]) delete out[k];
  return out;
}

function normItems(ddItems, merakiItems) {
  const items = {};
  const ids = new Set([
    ...Object.keys((ddItems && ddItems.data) || {}),
    ...Object.keys(merakiItems || {}),
  ]);
  for (const id of ids) {
    const d = ddItems && ddItems.data && ddItems.data[id];
    const m = merakiItems && merakiItems[id];
    const stats = Object.assign({}, merakiItemStats(m));
    if (d) {
      Object.assign(stats, parseItemDescription(d.description));
      for (const [k, v] of Object.entries(DD_ITEM_STATS)) if (d.stats && d.stats[k]) stats[v] = d.stats[k];
    }
    items[id] = { id: +id, name: (d && d.name) || (m && m.name) || `Item ${id}`, stats };
  }
  return items;
}

// ---------- summoner spells ----------

function normSummoners(dd, version) {
  const out = {};
  for (const s of Object.values((dd && dd.data) || {})) {
    out[s.id] = {
      key: s.id, name: s.name, cooldown: (s.cooldown && s.cooldown[0]) || null,
      icon: `${DD}/cdn/${version}/img/spell/${s.image.full}`,
    };
  }
  return out;
}

// ---------- entry point ----------

async function loadData() {
  console.log('Loading game data...');
  const versions = await cached('versions.json', `${DD}/api/versions.json`, 3);
  const version = (versions && versions[0]) || null;
  const ddUrl = f => `${DD}/cdn/${version}/data/en_US/${f}`;
  const [merakiChamps, merakiItems, ddChamps, ddItems, ddSumms] = await Promise.all([
    cached('meraki-champions.json', `${MERAKI}/champions.json`, 24),
    cached('meraki-items.json', `${MERAKI}/items.json`, 24),
    version ? cached(`dd-${version}-championFull.json`, ddUrl('championFull.json'), 24 * 30) : null,
    version ? cached(`dd-${version}-item.json`, ddUrl('item.json'), 24 * 30) : null,
    version ? cached(`dd-${version}-summoner.json`, ddUrl('summoner.json'), 24 * 30) : null,
  ]);

  const champions = {};
  const keys = new Set([...Object.keys(merakiChamps || {}), ...Object.keys((ddChamps && ddChamps.data) || {})]);
  for (const key of keys) {
    champions[key] = normChampion(key, merakiChamps && merakiChamps[key], ddChamps && ddChamps.data && ddChamps.data[key], version);
  }
  const byName = {};
  for (const c of Object.values(champions)) byName[c.name.toLowerCase()] = c.key;

  const data = {
    version,
    champions,
    championKeyByName: byName,
    items: normItems(ddItems, merakiItems),
    summoners: normSummoners(ddSumms, version),
  };
  console.log(`  patch ${version || '?'}: ${Object.keys(champions).length} champions, ` +
    `${Object.keys(data.items).length} items, ${Object.keys(data.summoners).length} summoner spells` +
    (merakiChamps ? '' : '  (WARNING: no ability damage data — cooldowns only)'));
  return data;
}

module.exports = { loadData, parseItemDescription };
