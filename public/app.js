'use strict';
/* global LoLCalc, LoLVoice */

const DD = 'https://ddragon.leagueoflegends.com/cdn';
const ORDERS = ['QWE', 'QEW', 'WQE', 'WEQ', 'EQW', 'EWQ'];
const grid = document.getElementById('grid');
const statusEl = document.getElementById('status');
const meEl = document.getElementById('me');
const alliesBox = document.getElementById('showAllies');

let staticData = { version: null, champions: {}, items: {} };
let live = { status: 'waiting' };
const timers = {}; // key -> { end, label, announced }
let selectedId = null; // enemy picked by keyboard/voice; bare commands apply to it
let selectedAt = 0;
let voiceContext = null; // last champion named by voice or keyboard

// ---- persisted preferences ----
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem('lolcd') || '{}'); } catch { return {}; }
}
const prefs = Object.assign({ order: {}, ranks: {}, showAllies: false, alerts: true, voiceDelay: 1 }, loadPrefs());
function savePrefs() { try { localStorage.setItem('lolcd', JSON.stringify(prefs)); } catch {} }
alliesBox.checked = prefs.showAllies;
alliesBox.onchange = () => { prefs.showAllies = alliesBox.checked; savePrefs(); alliesBox.blur(); render(); };

// ---- helpers ----
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r0 = v => Math.round(v);
const r1 = v => (Math.round(v * 10) / 10).toString();
const fmtTime = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function ranksFor(p) {
  const order = (prefs.order[p.championKey] || 'QWE').split('');
  const manual = prefs.ranks[p.id];
  const est = LoLCalc.estimateRanks(p.level, order);
  return manual ? { ranks: manual, manual: true, order } : { ranks: est, manual: false, order };
}

function timerAttrs(key, cd, label) {
  return `data-action="timer" data-key="${esc(key)}" data-cd="${cd || ''}" data-label="${esc(label)}"`;
}

const iconFor = key => grid.querySelector(`.icon[data-key="${CSS.escape(key)}"]`);

// Starts (or with toggle, cancels) the timer for an icon. `lateBy` = seconds since it was actually used.
function startTimer(key, { toggle = false, cancel = false, lateBy = 0 } = {}) {
  const el = iconFor(key);
  const running = timers[key] && timers[key].end > Date.now();
  if (cancel || (toggle && running) || !el || !(+el.dataset.cd > 0)) {
    delete timers[key];
    return el ? (cancel || running ? 'cleared' : 'no cooldown') : 'not found';
  }
  timers[key] = { end: Date.now() + (+el.dataset.cd - lateBy) * 1000, label: el.dataset.label };
  return `${r1(+el.dataset.cd)}s`;
}

function say(text) {
  if (!prefs.alerts || !window.speechSynthesis) return;
  speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

// Countdown labels are patched in place (not part of the rendered HTML) so the grid
// is only rebuilt when game data actually changes and taps never land on replaced nodes.
function updateTimers() {
  const now = Date.now();
  for (const t of Object.values(timers)) {
    if (!t.announced && t.end <= now) { t.announced = true; say(`${t.label} ready`); }
  }
  for (const el of grid.querySelectorAll('.icon[data-key]')) {
    const t = timers[el.dataset.key];
    const left = t ? (t.end - now) / 1000 : 0;
    el.classList.toggle('running', left > 0);
    el.classList.toggle('ready', !!t && left <= 0);
    el.querySelector('.timer').textContent = left > 0 ? (left >= 10 ? r0(left) : r1(left)) : '';
  }
}

// ---- rendering ----
function renderAbility(p, sl, ranks) {
  return sl.forms.map((f, fi) => {
    const cd = f.cooldown;
    const key = `${p.id}|${sl.slot}|${fi}`;
    const pips = fi === 0 && sl.slot !== 'P'
      ? `<span class="pips">${Array.from({ length: sl.maxRank }, (_, i) =>
        `<button class="pip ${i < sl.rank ? 'on' : ''}" data-action="rank" data-player="${esc(p.id)}" data-slot="${sl.slot}" data-rank="${i + 1}" title="Set rank ${i + 1}"></button>`).join('')}</span>`
      : '';
    const cdNow = cd && cd.now != null
      ? `<span class="cd">${r1(cd.now)}s${cd.affectedByCdr && cd.base !== cd.now ? ` <small>(${r1(cd.base)})</small>` : ''}</span>`
      : `<span class="cd"><small>${sl.rank === 0 && sl.slot !== 'P' ? 'not learned' : ''}</small></span>`;
    const perRank = cd && cd.perRank.length > 1 && cd.perRank.length < 18
      ? `<div class="ranks">CD by rank: ${cd.perRank.map((v, i) => `<span class="${i === cd.currentIndex ? 'cur' : ''}">${r1(v)}</span>`).join(' / ')}</div>`
      : '';
    const lines = f.lines.map(l => `<div class="line ${l.type}">
        <span class="attr">${esc(l.attribute)}</span>
        <b>${r0(l.raw)}${l.partial ? '+' : ''}</b>
        ${l.vsYou != null ? `<span class="you">→ ${r0(l.vsYou)} to you</span>` : ''}
        <span class="formula">${esc(l.formula)}</span>
      </div>`).join('');
    return `<div class="ab">
      <button class="icon" ${timerAttrs(key, cd && cd.now, `${p.championName} ${sl.slot === 'R' ? 'ult' : sl.slot}`)} title="Tap when used to start a ${cd && cd.now ? r1(cd.now) + 's' : ''} timer">
        ${f.icon ? `<img onerror="this.style.visibility='hidden'" src="${esc(f.icon)}" alt="">` : ''}<span class="key">${sl.slot}</span><span class="timer"></span>
      </button>
      <div class="ab-body">
        <div class="ab-top"><span class="ab-name">${fi > 0 ? '<span class="form-name">alt: </span>' : ''}${esc(f.name)}</span>${pips}${cdNow}</div>
        ${perRank}${lines}
      </div>
    </div>`;
  }).join('');
}

function renderCard(p, me) {
  const champ = staticData.champions[p.championKey];
  const v = staticData.version;
  const champIcon = v ? `${DD}/${v}/img/champion/${p.championKey}.png` : '';
  const sc = p.scores || {};
  let body = '';
  if (!champ) {
    body = `<div class="warn">No data for ${esc(p.championName)} yet (new champion or data download failed).</div>`;
  } else {
    const { ranks, manual, order } = ranksFor(p);
    const target = me && me.stats && me.stats.hp ? me.stats : null;
    const a = LoLCalc.analyze(champ, p, staticData.items, target, ranks);
    const s = a.stats;
    const pen = [];
    if (s.lethality) pen.push(`Leth <b>${r0(s.lethality)}</b>`);
    if (s.armorPenPct) pen.push(`ArPen <b>${r0(s.armorPenPct)}%</b>`);
    if (s.magicPenFlat || s.magicPenPct) pen.push(`MPen <b>${[s.magicPenFlat ? r0(s.magicPenFlat) : '', s.magicPenPct ? r0(s.magicPenPct) + '%' : ''].filter(Boolean).join(' + ')}</b>`);
    const pct = target && target.currentHp ? Math.round(100 * a.combo / target.currentHp) : null;
    body = `
      <div class="stats">
        <span>AD <b>${r0(s.ad)}</b>${s.bonusAd ? ` (+${r0(s.bonusAd)})` : ''}</span>
        <span>AP <b>${r0(s.ap)}</b></span>
        <span>Haste <b>${r0(s.ah)}</b></span>
        <span>HP <b>${r0(s.hp)}</b></span>
        <span>Armor <b>${r0(s.armor)}</b></span>
        <span>MR <b>${r0(s.mr)}</b></span>
        ${pen.map(x => `<span>${x}</span>`).join('')}
      </div>
      ${s.unknownItems.length ? `<div class="warn">Unknown items (not counted): ${esc(s.unknownItems.join(', '))}</div>` : ''}
      ${!champ.hasDamageData ? '<div class="warn">Damage data unavailable for this champion — cooldowns only.</div>' : ''}
      ${a.combo > 0 ? `<div class="combo">Full rotation ≈ <b>${r0(a.combo)}</b>${target ? ' to you' : ''}${pct != null ? ` (${pct}% of your current HP)` : ''}</div>` : ''}
      ${a.slots.map(sl => renderAbility(p, sl, ranks)).join('')}
      <div class="foot">
        Max order <button data-action="order" data-champ="${esc(p.championKey)}">${order.join(' › ')}</button>
        ${manual ? `<button data-action="reset" data-player="${esc(p.id)}">Ranks: manual — reset</button>` : '<span>Ranks: estimated</span>'}
      </div>`;
  }
  const summs = p.summoners.map((sp, i) => {
    return `<div class="summ"><button class="icon" ${timerAttrs(`${p.id}|S${i}`, sp.cooldown, `${p.championName} ${sp.name}`)} title="${esc(sp.name)}">
      ${sp.icon ? `<img onerror="this.style.visibility='hidden'" src="${esc(sp.icon)}" alt="">` : ''}<span class="timer"></span></button>
      ${esc(sp.name)}${sp.cooldown ? ` ${sp.cooldown}s` : ''}</div>`;
  }).join('');
  const num = enemyList().findIndex(e => e.id === p.id) + 1;
  return `<div class="card ${p.side} ${p.isDead ? 'dead' : ''} ${p.id === selectedId ? 'selected' : ''}">
    <div class="head">
      ${champIcon ? `<img onerror="this.style.visibility='hidden'" src="${champIcon}" alt="">` : ''}
      ${num ? `<kbd class="num">${num}</kbd>` : ''}
      <div><div class="champ">${esc(p.championName)}<span class="lvl">Lv ${p.level}</span></div>
      <div class="sub">${esc(p.name)}${p.position ? ' · ' + esc(p.position) : ''} · ${sc.kills || 0}/${sc.deaths || 0}/${sc.assists || 0}</div></div>
      ${p.isDead ? `<div class="dead-badge">DEAD ${r0(p.respawnTimer)}s</div>` : ''}
    </div>
    <div class="items">${p.items.map(i => v ? `<img onerror="this.style.visibility='hidden'" src="${DD}/${v}/img/item/${i.id}.png" title="${esc(i.name)}" alt="">` : '').join('')}</div>
    ${body}
    <div class="summs">${summs}</div>
  </div>`;
}

let lastHtml = '';
function setGrid(html) {
  if (html !== lastHtml) { grid.innerHTML = html; lastHtml = html; }
  updateTimers();
}

function render() {
  if (live.status !== 'ingame') {
    statusEl.textContent = live.status === 'loading' ? 'Game loading…' : 'Waiting for a game on the PC…';
    statusEl.className = 'status';
    meEl.textContent = '';
    setGrid('<div class="empty">No active game detected.<br>Start a match on your PC; this page updates automatically.</div>');
    return;
  }
  statusEl.textContent = `● Live  ${fmtTime(live.gameTime)}`;
  statusEl.className = 'status live';
  const me = live.me;
  meEl.textContent = me.stats && me.stats.hp
    ? `You: ${r0(me.stats.currentHp)}/${r0(me.stats.hp)} HP · ${r0(me.stats.armor)} armor · ${r0(me.stats.mr)} MR`
    : '';
  const players = live.players.filter(p => !p.isMe && (p.side === 'enemy' || prefs.showAllies));
  players.sort((a, b) => (a.side === b.side ? 0 : a.side === 'enemy' ? -1 : 1));
  setGrid(players.map(p => renderCard(p, me)).join('') ||
    '<div class="empty">No enemy players found.</div>');
}

function enemyList() {
  return live.status === 'ingame' ? live.players.filter(p => p.side === 'enemy' && !p.isMe) : [];
}

function select(id) {
  selectedId = id;
  selectedAt = Date.now();
  render();
}

// ---- interaction ----
grid.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const d = el.dataset;
  if (d.action === 'timer') {
    startTimer(d.key, { toggle: true });
  } else if (d.action === 'rank') {
    const p = live.players.find(x => x.id === d.player);
    if (!p) return;
    const cur = Object.assign({}, ranksFor(p).ranks);
    const n = +d.rank;
    cur[d.slot] = cur[d.slot] === n ? n - 1 : n; // tapping the current rank lowers it by one
    prefs.ranks[d.player] = cur;
  } else if (d.action === 'reset') {
    delete prefs.ranks[d.player];
  } else if (d.action === 'order') {
    const cur = prefs.order[d.champ] || 'QWE';
    prefs.order[d.champ] = ORDERS[(ORDERS.indexOf(cur) + 1) % ORDERS.length];
  }
  savePrefs();
  render();
});

// Tick countdowns; clear timers that finished more than 5s ago; drop a stale selection.
setInterval(() => {
  const now = Date.now();
  for (const [k, t] of Object.entries(timers)) if (now - t.end > 5000) delete timers[k];
  if (selectedId && now - selectedAt > 4000) select(null);
  updateTimers();
}, 250);

// ---- commands (keyboard + voice) ----
const heardEl = document.getElementById('heard');
function runCommands(commands, source) {
  const done = commands.map(c => {
    const p = enemyList().find(e => e.id === c.playerId);
    const key = c.slot.startsWith('S') ? `${c.playerId}|${c.slot}` : `${c.playerId}|${c.slot}|0`;
    const result = startTimer(key, { cancel: c.cancel, lateBy: source === 'voice' ? +prefs.voiceDelay || 0 : 0 });
    const el = iconFor(key);
    return `${el ? el.dataset.label : p ? p.championName + ' ' + c.slot : c.slot} → ${result}`;
  });
  updateTimers();
  return done;
}

// 1–5 picks an enemy, then Q/W/E/R or D/F (summoners). Shift+key cancels that timer.
const KEY_SLOTS = { q: 'Q', w: 'W', e: 'E', r: 'R', d: 'S0', f: 'S1' };
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === 'escape') return select(null);
  if (/^[1-5]$/.test(k)) {
    const p = enemyList()[+k - 1];
    if (p) select(p.id);
    return;
  }
  if (KEY_SLOTS[k] && selectedId) {
    heardEl.textContent = runCommands([{ playerId: selectedId, slot: KEY_SLOTS[k], cancel: e.shiftKey }], 'key').join(', ');
    voiceContext = selectedId; // a following bare "ult" by voice means this champion
    select(null);
  }
});

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const micBtn = document.getElementById('mic');
let recognizer = null;
let alwaysOn = false;   // mic button toggled on
let pttHeld = false;    // push-to-talk key held (on the PC or the Mac)
let pttKey = null;      // PC push-to-talk key name, from the server
let running = false;    // recognizer currently capturing
let stopTimer = null;
const listening = () => alwaysOn || pttHeld;

function handleTranscript(alternatives) {
  // our own "Ahri flash ready" announcements must not be heard as commands
  if (window.speechSynthesis && speechSynthesis.speaking) return;
  const enemies = enemyList().map(p => ({ id: p.id, championName: p.championName, championKey: p.championKey,
    position: p.position, summoners: p.summoners.map(s => s.name) }));
  const ctx = selectedId || voiceContext;
  let parsed = null;
  for (const text of alternatives) {
    parsed = LoLVoice.parse(text, enemies, ctx);
    if (parsed.commands.length) break;
  }
  voiceContext = parsed.contextId;
  const results = runCommands(parsed.commands, 'voice');
  heardEl.textContent = `“${alternatives[0]}”${results.length ? ' → ' + results.join(', ') : ' (no command)'}`;
}

function updateMicButton() {
  const on = listening();
  micBtn.classList.toggle('on', on);
  const hint = pttKey ? `hold ${pttKey} on PC or here` : 'hold ` or Space';
  micBtn.textContent = on ? (alwaysOn ? '🎙 Listening' : '🎙 Talk now…') : `🎙 Voice off · ${hint}`;
}

// Starts/stops recognition to match alwaysOn / pttHeld.
function syncMic() {
  updateMicButton();
  if (!recognizer) return;
  clearTimeout(stopTimer);
  if (listening()) {
    if (!running) { try { recognizer.start(); running = true; } catch {} }
  } else if (running) {
    // keep listening briefly after the key is released so the last word isn't cut off
    stopTimer = setTimeout(() => recognizer.stop(), 600);
  }
}

function setPtt(down) {
  if (pttHeld === down) return;
  pttHeld = down;
  syncMic();
}

// Hold ` or Space on the Mac as push-to-talk too.
const PTT_CODES = ['Backquote', 'Space'];
document.addEventListener('keydown', e => {
  if (!PTT_CODES.includes(e.code) || /INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target.tagName)) return;
  e.preventDefault();
  if (!e.repeat) setPtt(true);
});
document.addEventListener('keyup', e => { if (PTT_CODES.includes(e.code)) setPtt(false); });
window.addEventListener('blur', () => setPtt(false));

if (!Recognition) {
  micBtn.disabled = true;
  micBtn.title = 'Voice needs Chrome or Safari';
} else {
  recognizer = new Recognition();
  recognizer.lang = 'en-US';
  recognizer.continuous = true;
  recognizer.interimResults = false;
  recognizer.maxAlternatives = 5;
  recognizer.onresult = e => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (!e.results[i].isFinal) continue;
      handleTranscript(Array.from(e.results[i]).map(a => a.transcript));
    }
  };
  recognizer.onerror = e => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      heardEl.textContent = window.isSecureContext
        ? 'Microphone blocked — allow it in the browser’s site settings.'
        : 'Mic blocked: this page isn’t a secure origin. See README → Voice commands.';
      alwaysOn = false;
      pttHeld = false;
      updateMicButton();
    }
  };
  // Chrome ends recognition after silence; restart it while we still want to listen.
  recognizer.onend = () => {
    running = false;
    if (listening()) setTimeout(syncMic, 150);
  };
  micBtn.onclick = () => { alwaysOn = !alwaysOn; micBtn.blur(); syncMic(); };
  updateMicButton();
}

const alertsBox = document.getElementById('alerts');
alertsBox.checked = prefs.alerts;
alertsBox.onchange = () => { prefs.alerts = alertsBox.checked; savePrefs(); alertsBox.blur(); };

// ---- server connection ----
function connect() {
  const es = new EventSource('events');
  es.addEventListener('config', e => { pttKey = JSON.parse(e.data).pttKey; updateMicButton(); });
  es.addEventListener('ptt', e => setPtt(JSON.parse(e.data).down));
  es.addEventListener('static', e => { staticData = JSON.parse(e.data); render(); });
  es.addEventListener('live', e => {
    const next = JSON.parse(e.data);
    // new game: forget manual ranks and timers from the previous one
    if (next.status === 'ingame' && live.status === 'ingame' && next.gameTime + 5 < live.gameTime) {
      prefs.ranks = {};
      savePrefs();
      for (const k of Object.keys(timers)) delete timers[k];
    }
    live = next;
    render();
  });
  es.onerror = () => { statusEl.textContent = 'Lost connection to PC — retrying…'; statusEl.className = 'status'; };
}
connect();
render();
