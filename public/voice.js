// Turns spoken (or typed) phrases like "ahri flash", "zed ult", "mid E", "cancel jinx flash"
// into timer commands. Pure function — shared by the browser and the Node tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LoLVoice = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Speech engines spell single letters in many ways.
  const ABILITY_WORDS = {
    Q: ['q', 'queue', 'cue', 'kew', 'que', 'qs'],
    W: ['w', 'dub', 'ws'],
    E: ['e', 'ee', 'es'],
    R: ['r', 'are', 'ar', 'rs', 'ult', 'ults', 'ulti', 'ultimate', 'alt'],
  };
  const SUMMONER_WORDS = {
    flash: ['flash', 'flashed', 'flesh', 'flush'],
    ignite: ['ignite', 'ignited', 'ig'],
    teleport: ['teleport', 'tp', 'tele'],
    heal: ['heal', 'heel'],
    barrier: ['barrier'],
    exhaust: ['exhaust', 'exhausted', 'exh'],
    cleanse: ['cleanse', 'cleans'],
    ghost: ['ghost', 'ghosted'],
    smite: ['smite'],
  };
  const ROLE_WORDS = {
    TOP: ['top', 'toplane', 'toplaner'],
    JUNGLE: ['jungle', 'jungler', 'jung', 'jg', 'jungo'],
    MIDDLE: ['mid', 'middle', 'midlane', 'midlaner'],
    BOTTOM: ['bot', 'bottom', 'adc', 'carry', 'marksman'],
    UTILITY: ['support', 'supp', 'sup', 'supporter'],
  };
  const CANCEL_WORDS = ['cancel', 'reset', 'clear', 'scratch', 'undo', 'remove'];
  // Phrases the app itself speaks ("Ahri flash ready") must never re-trigger a timer.
  const IGNORE_WORDS = ['ready', 'up'];

  // Short names, initials and common mishearings, keyed by normalized champion name.
  const ALIASES = {
    ahri: ['ari', 'audrey', 'ahry'], zed: ['said', 'zedd', 'zad'], jhin: ['jin', 'gin', 'jen'],
    vi: ['v', 'vee'], sett: ['set'], lux: ['looks', 'lucks'], ekko: ['echo'], nami: ['naomi'],
    zoe: ['zoey'], kaisa: ['kaiser', 'kysa'], ksante: ['ksanti'], missfortune: ['mf'],
    twistedfate: ['tf'], jarvaniv: ['j4', 'jarvan'], gangplank: ['gp'], warwick: ['ww'],
    leblanc: ['lb'], ezreal: ['ez'], masteryi: ['yi', 'master'], xinzhao: ['xin'],
    aurelionsol: ['asol'], drmundo: ['mundo'], kogmaw: ['kog'], reksai: ['rek'], chogath: ['cho'],
    khazix: ['kha', 'kazix'], velkoz: ['vel'], belveth: ['bel'], nunuwillump: ['nunu'],
    leesin: ['lee'], tahmkench: ['tahm', 'tom'], renataglasc: ['renata'], wukong: ['monkey'],
  };

  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
  const tokenize = s => String(s || '').toLowerCase().replace(/double[\s-]*(u|you)/g, 'w')
    .normalize('NFD').replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);

  function lev(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return d[a.length][b.length];
  }

  function lookup(table, word) {
    for (const [k, words] of Object.entries(table)) if (words.includes(word)) return k;
    return null;
  }

  const isKeyword = w => lookup(ABILITY_WORDS, w) || lookup(SUMMONER_WORDS, w) || lookup(ROLE_WORDS, w) ||
    CANCEL_WORDS.includes(w);

  // Best enemy for the words starting at tokens[i]; tries 1–3 words so "miss fortune" and "lee sin" work.
  function matchChampion(tokens, i, enemies) {
    let best = null;
    for (let len = 1; len <= 3 && i + len <= tokens.length; len++) {
      const words = tokens.slice(i, i + len);
      if (words.some(isKeyword)) break;
      const s = words.join('');
      for (const e of enemies) {
        const names = [norm(e.championName), norm(e.championKey)];
        let score = 0;
        for (const n of names) {
          if (!n) continue;
          if (s === n || (ALIASES[n] || []).includes(s)) score = 1;
          else if (s.length >= 3 && n.startsWith(s)) score = Math.max(score, 0.9);
          else if (s.length >= 3) score = Math.max(score, 1 - lev(s, n) / Math.max(s.length, n.length));
        }
        if (score >= 0.7 && (!best || score > best.score || (score === best.score && len > best.len))) {
          best = { id: e.id, score, len };
        }
      }
    }
    return best;
  }

  function resolveSlot(enemy, kind, value) {
    if (kind === 'ability') return value;
    const i = (enemy.summoners || []).findIndex(n => norm(n).startsWith(value));
    return i < 0 ? null : `S${i}`;
  }

  /**
   * @param text     transcript, e.g. "ahri flash and zed ult"
   * @param enemies  [{ id, championName, championKey, position, summoners: ['Flash', 'Ignite'] }]
   * @param contextId  enemy to use when no champion is named (last one mentioned / selected)
   * @returns { commands: [{ playerId, slot: 'Q'|'W'|'E'|'R'|'S0'|'S1', cancel }], contextId }
   */
  function parse(text, enemies, contextId) {
    const tokens = tokenize(text);
    const commands = [];
    if (tokens.some(t => IGNORE_WORDS.includes(t))) return { commands, contextId };
    let cur = contextId && enemies.some(e => e.id === contextId) ? contextId : null;
    let cancel = false;
    let named = false; // a champion/role was said in this phrase
    let pending = []; // abilities said before any champion ("flash ahri")

    const emit = (id, item) => {
      const enemy = enemies.find(e => e.id === id);
      const slot = enemy && resolveSlot(enemy, item.kind, item.value);
      if (slot) commands.push({ playerId: id, slot, cancel: item.cancel });
    };
    const setCurrent = id => {
      cur = id;
      named = true;
      for (const item of pending) emit(id, item);
      pending = [];
    };

    for (let i = 0; i < tokens.length;) {
      const t = tokens[i];
      if (CANCEL_WORDS.includes(t)) { cancel = true; i++; continue; }
      const role = lookup(ROLE_WORDS, t);
      if (role) {
        const e = enemies.find(x => x.position === role);
        if (e) setCurrent(e.id);
        i++;
        continue;
      }
      const ab = lookup(ABILITY_WORDS, t);
      const sum = !ab && lookup(SUMMONER_WORDS, t);
      if (ab || sum) {
        const item = { kind: ab ? 'ability' : 'summoner', value: ab || sum, cancel };
        if (named && !pending.length) emit(cur, item); else pending.push(item);
        i++;
        continue;
      }
      const champ = matchChampion(tokens, i, enemies);
      if (champ) { setCurrent(champ.id); i += champ.len; continue; }
      i++;
    }
    if (cur) for (const item of pending) emit(cur, item); // "flash" alone → previous champion
    return { commands, contextId: cur };
  }

  return { parse, tokenize };
});
