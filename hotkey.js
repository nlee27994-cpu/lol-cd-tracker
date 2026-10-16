'use strict';
// Push-to-talk key on the gaming PC (Windows). A small PowerShell loop polls the key state with
// GetAsyncKeyState, which only reads whether a key is held: no keyboard hook, nothing injected
// into the game, and the key still reaches League as normal (so pick one League doesn't use).

const { spawn } = require('child_process');

const VK = {
  mouse4: 0x05, xbutton1: 0x05, mouse5: 0x06, xbutton2: 0x06, middlemouse: 0x04, mbutton: 0x04,
  tab: 0x09, capslock: 0x14, space: 0x20, pageup: 0x21, pagedown: 0x22, end: 0x23, home: 0x24,
  insert: 0x2d, delete: 0x2e, lshift: 0xa0, rshift: 0xa1, lctrl: 0xa2, rctrl: 0xa3, lalt: 0xa4, ralt: 0xa5,
  backquote: 0xc0, grave: 0xc0, tilde: 0xc0, '`': 0xc0, '~': 0xc0,
};
for (let i = 1; i <= 24; i++) VK[`f${i}`] = 0x6f + i;
for (let i = 0; i <= 9; i++) { VK[String(i)] = 0x30 + i; VK[`numpad${i}`] = 0x60 + i; }
for (let c = 65; c <= 90; c++) VK[String.fromCharCode(c).toLowerCase()] = c;

function vkFor(name) {
  return VK[String(name || '').toLowerCase().replace(/[\s_-]/g, '')];
}

const PS_SCRIPT = vk => `
$sig = '[DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);'
$k = Add-Type -MemberDefinition $sig -Name Keys -Namespace LolCd -PassThru
$down = $false
while ($true) {
  $now = (([int]$k::GetAsyncKeyState(${vk})) -band 0x8000) -ne 0
  if ($now -ne $down) {
    $down = $now
    if ($down) { [Console]::Out.WriteLine('down') } else { [Console]::Out.WriteLine('up') }
    [Console]::Out.Flush()
  }
  Start-Sleep -Milliseconds 20
}`;

/** Calls onChange(true/false) as the key is pressed/released. Returns false if unavailable. */
function watchKey(name, onChange) {
  if (process.platform !== 'win32') return false;
  const vk = vkFor(name);
  if (!vk) {
    console.warn(`  ! Unknown push-to-talk key "${name}". Try F8, Mouse4, Mouse5, CapsLock, Numpad0...`);
    return false;
  }
  const encoded = Buffer.from(PS_SCRIPT(vk), 'utf16le').toString('base64');
  let ps = null;
  process.on('exit', () => ps && ps.kill());
  const start = () => {
    ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    ps.stdout.setEncoding('utf8');
    ps.stdout.on('data', chunk => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line === 'down' || line === 'up') onChange(line === 'down');
      }
    });
    ps.on('error', e => console.warn(`  ! push-to-talk unavailable: ${e.message}`));
    ps.stderr.on('data', d => console.warn(`  ! push-to-talk: ${String(d).trim()}`));
    ps.on('exit', code => {
      console.warn(`  ! push-to-talk watcher stopped (code ${code}); restarting in 5s`);
      setTimeout(start, 5000);
    });
  };
  start();
  return true;
}

module.exports = { watchKey, vkFor };
