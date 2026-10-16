'use strict';
const assert = require('assert');
const { parse } = require('../public/voice');

const enemies = [
  { id: 'a', championName: 'Ahri', championKey: 'Ahri', position: 'MIDDLE', summoners: ['Flash', 'Ignite'] },
  { id: 'z', championName: 'Zed', championKey: 'Zed', position: 'JUNGLE', summoners: ['Flash', 'Smite'] },
  { id: 'm', championName: 'Miss Fortune', championKey: 'MissFortune', position: 'BOTTOM', summoners: ['Heal', 'Flash'] },
  { id: 'l', championName: 'Lee Sin', championKey: 'LeeSin', position: 'TOP', summoners: ['Teleport', 'Flash'] },
  { id: 'k', championName: "Kai'Sa", championKey: 'Kaisa', position: 'UTILITY', summoners: ['Exhaust', 'Flash'] },
];
const cmds = (text, ctx) => parse(text, enemies, ctx).commands.map(c => `${c.cancel ? '-' : ''}${c.playerId}:${c.slot}`).join(' ');
const cases = [
  ['Ahri flash', 'a:S0'],
  ['ari flash', 'a:S0'],
  ['Zed ult', 'z:R'],
  ['said are', 'z:R'],
  ['Ahri queue', 'a:Q'],
  ['Ahri double you', 'a:W'],
  ['ahri flash and zed ult', 'a:S0 z:R'],
  ['flash ahri', 'a:S0'],
  ['miss fortune heal', 'm:S0'],
  ['MF flash', 'm:S1'],
  ['lee sin teleport', 'l:S0'],
  ['Lee TP', 'l:S0'],
  ['kaisa exhaust', 'k:S0'],
  ['Kai Sa ult', 'k:R'],
  ['mid flash', 'a:S0'],
  ['jungle smite', 'z:S1'],
  ['support flash', 'k:S1'],
  ['cancel Ahri flash', '-a:S0'],
  ['Ahri teleport', ''],            // she doesn't have teleport
  ['Ahri flash ready', ''],         // our own announcement
  ['the weather is nice', ''],
  ['ahri flashed', 'a:S0'],
];
for (const [text, want] of cases) assert.strictEqual(cmds(text), want, `"${text}"`);
// context: a bare ability uses the last champion
assert.strictEqual(cmds('ult', 'z'), 'z:R');
assert.strictEqual(cmds('flash', null), '');
assert.strictEqual(parse('zed', enemies, null).contextId, 'z');
console.log(`Voice parser: ${cases.length + 3} cases passed.`);
