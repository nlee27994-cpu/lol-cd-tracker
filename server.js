#!/usr/bin/env node
'use strict';
// Runs on the gaming PC. Polls League's official Live Client Data API (localhost:2999),
// which exposes every player's champion, level, items and summoner spells (the same info as
// the Tab scoreboard), and serves a web dashboard you can open from your Mac or phone.

const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadData } = require('./data');
const { watchKey } = require('./hotkey');

const PORT = +process.env.PORT || 7777;
const MOCK = process.argv.includes('--mock');
const argValue = name => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').split('=')[1];
// Push-to-talk key on this PC: --ptt=Mouse4, or --ptt=off to disable.
const PTT_KEY = argValue('ptt') || process.env.PTT_KEY || '`';
const POLL_MS = 1000;
const PUBLIC = path.join(__dirname, 'public');
const STATIC = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/calc.js': 'calc.js', '/voice.js': 'voice.js', '/style.css': 'style.css' };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

// The game client serves the API with a Riot self-signed certificate; this agent is only used for 127.0.0.1.
const liveAgent = new https.Agent({ rejectUnauthorized: false });

function fetchLive() {
  if (MOCK) {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'mock', 'allgamedata.json'), 'utf8'));
    raw.gameData.gameTime += (Date.now() - startedAt) / 1000;
    return Promise.resolve(raw);
  }
  return new Promise((resolve, reject) => {
    const req = https.get({ host: '127.0.0.1', port: 2999, path: '/liveclientdata/allgamedata', agent: liveAgent, timeout: 900 }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => (body += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

const playerId = p => p.riotId || p.summonerName;

function championKey(p, data) {
  const raw = (p.rawChampionName || '').replace('game_character_displayname_', '');
  if (data.champions[raw]) return raw;
  return data.championKeyByName[(p.championName || '').toLowerCase()] || raw || p.championName;
}

function summonerSpell(s, data) {
  if (!s) return null;
  const m = /SummonerSpell_(\w+?)_DisplayName/.exec(s.rawDisplayName || '');
  const found = (m && data.summoners[m[1]]) ||
    Object.values(data.summoners).find(x => x.name === s.displayName);
  return found || { key: s.displayName, name: s.displayName, cooldown: null, icon: null };
}

function buildState(raw, data) {
  if (!raw || !raw.allPlayers || !raw.activePlayer) return { status: 'loading' };
  const ap = raw.activePlayer;
  const meRaw = raw.allPlayers.find(p => [ap.riotId, ap.summonerName].includes(playerId(p)));
  const cs = ap.championStats || {};
  const me = {
    id: meRaw ? playerId(meRaw) : ap.riotId || ap.summonerName,
    team: meRaw && meRaw.team,
    championKey: meRaw ? championKey(meRaw, data) : null,
    level: ap.level,
    stats: {
      hp: cs.maxHealth, currentHp: cs.currentHealth, armor: cs.armor, mr: cs.magicResist,
      ad: cs.attackDamage, ap: cs.abilityPower, ah: cs.abilityHaste,
    },
  };
  const players = raw.allPlayers.map(p => ({
    id: playerId(p),
    name: p.riotIdGameName || (p.summonerName || '').split('#')[0],
    side: !me.team ? 'enemy' : p.team === me.team ? 'ally' : 'enemy',
    isMe: playerId(p) === me.id,
    championKey: championKey(p, data),
    championName: p.championName,
    level: p.level,
    position: p.position || '',
    isDead: !!p.isDead,
    respawnTimer: p.respawnTimer || 0,
    scores: p.scores || {},
    items: (p.items || []).map(i => ({ id: i.itemID, name: i.displayName, count: i.count })),
    summoners: [
      summonerSpell(p.summonerSpells && p.summonerSpells.summonerSpellOne, data),
      summonerSpell(p.summonerSpells && p.summonerSpells.summonerSpellTwo, data),
    ].filter(Boolean),
    keystone: p.runes && p.runes.keystone ? p.runes.keystone.displayName : null,
  }));
  return {
    status: 'ingame',
    gameTime: (raw.gameData && raw.gameData.gameTime) || 0,
    gameMode: raw.gameData && raw.gameData.gameMode,
    me,
    players,
  };
}

// Static data (champion/item database) needed for the champions and items currently in the game.
function staticFor(state, data) {
  const champions = {};
  const items = {};
  for (const p of state.players || []) {
    if (data.champions[p.championKey]) champions[p.championKey] = data.champions[p.championKey];
    for (const i of p.items) if (data.items[i.id]) items[i.id] = data.items[i.id];
  }
  return { version: data.version, champions, items };
}

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a.address);
}

const startedAt = Date.now();

async function main() {
  const data = await loadData();
  const clients = new Set();
  let live = { status: 'waiting' };
  let staticJson = JSON.stringify({ version: data.version, champions: {}, items: {} });

  const send = (res, event, json) => res.write(`event: ${event}\ndata: ${json}\n\n`);

  const pttOn = PTT_KEY.toLowerCase() !== 'off' && watchKey(PTT_KEY, down => setPtt(down));
  const config = () => JSON.stringify({ pttKey: pttOn ? PTT_KEY : null });
  function setPtt(down) {
    for (const c of clients) send(c, 'ptt', JSON.stringify({ down }));
  }

  async function poll() {
    try {
      live = buildState(await fetchLive(), data);
    } catch (e) {
      live = { status: 'waiting', detail: e.message };
    }
    if (live.status === 'ingame') {
      const s = JSON.stringify(staticFor(live, data));
      if (s !== staticJson) {
        staticJson = s;
        for (const c of clients) send(c, 'static', staticJson);
      }
    }
    const liveJson = JSON.stringify(live);
    for (const c of clients) send(c, 'live', liveJson);
  }
  setInterval(poll, POLL_MS);
  poll();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      clients.add(res);
      send(res, 'static', staticJson);
      send(res, 'live', JSON.stringify(live));
      send(res, 'config', config());
      req.on('close', () => clients.delete(res));
      return;
    }
    // Lets other tools (AutoHotkey, Stream Deck...) drive push-to-talk: /api/ptt?down=1 or ?down=0
    if (url.pathname === '/api/ptt') {
      setPtt(url.searchParams.get('down') === '1');
      res.writeHead(204);
      return res.end();
    }
    if (url.pathname === '/api/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ static: JSON.parse(staticJson), live }));
    }
    const file = STATIC[url.pathname];
    if (!file) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] + '; charset=utf-8', 'Cache-Control': 'no-cache' });
    fs.createReadStream(path.join(PUBLIC, file)).pipe(res);
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\nLoL CD Tracker running${MOCK ? ' (MOCK GAME)' : ''}`);
    console.log(`  On this PC:      http://localhost:${PORT}`);
    for (const ip of lanAddresses()) console.log(`  From your Mac:   http://${ip}:${PORT}`);
    if (pttOn) console.log(`  Push-to-talk:    hold ${PTT_KEY} on this PC to talk to the Mac (change with --ptt=Mouse4)`);
    console.log('\nWaiting for a game... (leave this window open)\n');
  });
}

process.on('SIGINT', () => process.exit()); // runs exit handlers (stops the push-to-talk watcher)
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { buildState };
