# LoL CD Tracker

A second-screen dashboard that shows each enemy's **actual ability cooldowns** (after their ability haste) and
**damage per ability** (with their AD/AP and, if you want, after your armor/MR), updating live from the game.

```
 Gaming PC                                   MacBook / phone / tablet
 ┌───────────────────────────────┐           ┌──────────────────────┐
 │ League client                 │           │ Browser              │
 │   └ Live Client Data API :2999│  ──LAN──► │ http://<pc-ip>:7777  │
 │ node server.js  (:7777)       │  or cable │                      │
 └───────────────────────────────┘           └──────────────────────┘
```

## How it works

1. **Database**: on startup the PC downloads and caches (`./cache`)
   - [Meraki Analytics](https://github.com/meraki-analytics/lolstaticdata) champion data: per-rank cooldowns, damage values and AP/AD/health ratios for every ability
   - Riot **Data Dragon** (current patch): champion base stats and growth, item stats, summoner spells, icons

   It updates itself automatically (re-checked daily, new Data Dragon files each patch).
2. **Live data**: you don't need to click on anyone or hold Tab. League runs an official local API
   (`https://127.0.0.1:2999/liveclientdata/allgamedata`) during every game, and it reports every player's champion, level,
   items and summoner spells (the same info as the Tab scoreboard). The server reads it every second, which is Riot's
   supported way to do this, so there's no screen reading, memory reading or input hooks for Vanguard to object to.
3. **Math** (`public/calc.js`):
   - stats = base + growth × (lvl−1) × (0.7025 + 0.0175 × (lvl−1)) + items (Rabadon's amp, multiplicative % pen)
   - cooldown = base × 100 / (100 + ability haste)
   - damage = flat + Σ ratio × stat; "to you" = × 100/(100 + your armor or MR after their % pen, then lethality / flat pen)
   - "Full rotation" = the first damage line of Q+W+E+R combined. Treat it as a rough threat estimate.

## Setup (Windows gaming PC)

One-time:
1. Install **Node.js 18 or newer** from https://nodejs.org (LTS) and **Git** from https://git-scm.com/download/win (defaults are fine).
2. Open a Command Prompt and run:
   ```
   cd %USERPROFILE%
   git clone https://github.com/nlee27994-cpu/lol-cd-tracker.git
   ```
   (If the repo is private, a GitHub sign-in window pops up once.)
3. Right-click `lol-cd-tracker\start.bat` → Send to → Desktop (create shortcut).

Every time: double-click the shortcut. `start.bat` **updates itself to the latest version**, then starts the server.
When Windows Firewall asks the first time, allow access on **Private networks**. The console prints the address for your
Mac, e.g. `From your Mac: http://192.168.1.23:7777`.

**On the Mac**, open that address in Chrome, then ⋮ → Cast, save, and share → **Install page as app**. You get a Dock icon
that always shows the latest version. There's nothing to download on the Mac.

Want to check the setup before a game? Run `node server.js --mock`. It serves a fake game you can open from the Mac.

## Connecting the Mac

**Easiest: same Wi-Fi/router.** Open the printed `http://<pc-ip>:7777` in Safari or Chrome on the Mac. It also works on a phone or iPad.

**Over a USB-C cable.** A plain USB-C cable between two computers does *not* make a network connection. It works only if both
machines have **Thunderbolt 3/4/USB4** ports and you use a Thunderbolt cable:
1. Mac: System Settings → Network → **Thunderbolt Bridge** should appear once the cable is connected.
2. PC: install your motherboard's Thunderbolt networking driver. A new "Thunderbolt Networking" adapter will appear.
3. Give both ends static IPs on the same subnet. For example, PC `10.0.0.1` and Mac `10.0.0.2`, both with mask `255.255.255.0`.
4. On the Mac, open `http://10.0.0.1:7777`.

If your PC has no Thunderbolt, use Wi-Fi, an Ethernet cable through your router, or a USB-C ↔ Ethernet adapter on the Mac.

## Using it

- Cards show each enemy's level, items, computed AD/AP/haste/HP/resists/penetration, then P/Q/W/E/R:
  current cooldown (base in brackets), cooldown at every rank, and each damage/heal/shield line with its formula.
- **Rank pips**: the game doesn't report enemy skill levels, so ranks are estimated from level (R at 6/11/16, then max order).
  Change the max order with the `Q › W › E` button (remembered per champion), or tap pips to set ranks by hand.
- **Timers**: tap an ability or summoner icon when you see it used. It counts down using their current cooldown.
- **Voice and keyboard**: see below.
- `+` after a number means part of the formula couldn't be turned into a number (e.g. "% of damage dealt", stack-based scaling).

## Voice commands and keyboard shortcuts

**Push-to-talk (recommended):** hold **` (backquote, left of 1) on your gaming PC**, say what you saw, let go. The PC tells the Mac to listen
while the key is held, so you never have to leave the game. On the Mac itself you can hold **`** or **Space** instead, or click
**🎙** to leave the mic on all the time.

Change the PC key by starting the server with e.g. `node server.js --ptt=Mouse4` (also: `` ` ``, `F8`, `Mouse5`, `F6`–`F11`, `CapsLock`,
`Numpad0`–`9`, letters; `--ptt=off` disables it). To make it permanent, create `my-settings.bat` next to `start.bat`
containing e.g. `set PTT_KEY=Mouse4`. That file is yours and updates won't overwrite it. The key still reaches League, so pick
one League doesn't use. A mouse side button is ideal. The key is read with a tiny PowerShell loop (`GetAsyncKeyState`): no keyboard
hook, nothing touches the game process.

Then say what you saw:

| Say | Does |
|---|---|
| "Ahri flash", "Zed ult", "Lux E", "MF heal" | starts that timer |
| "mid flash", "jungle smite", "support exhaust" | picks the enemy by role |
| "Ahri flash and Zed ult" | several timers in one phrase |
| "ult" (on its own) | applies to the last champion you named |
| "cancel Ahri flash" | clears a timer you started by mistake |

- Voice timers start 1 second early to make up for speech-recognition delay.
- Champion names are matched loosely ("Ari", "said" → Zed, "Kai Sa", "MF", "J4").
- **Say when ready**: the Mac speaks "Ahri Flash ready" when a timer ends. Use headphones on the Mac, or turn this off, so the mic doesn't hear it.
- **Keyboard** (Mac): `1`–`5` picks an enemy (numbered on the cards), then `Q` `W` `E` `R`, or `D` / `F` for their first/second summoner. Hold `Shift` to cancel.

**One-time setup for the mic.** Browsers only allow the microphone on secure pages, and `http://<pc-ip>:7777` doesn't count. Use **Chrome** on the Mac:
1. Go to `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
2. Enter your page address, e.g. `http://192.168.1.23:7777`, set it to **Enabled**, and click **Relaunch**.
3. Open the page, click 🎙, and allow the microphone.

Chrome's speech recognition runs on Google's servers, so the Mac needs internet access. Nothing runs on the gaming PC except the server, which doesn't use the mic.

## Known limitations

- Hidden from the API: enemy skill ranks, minor runes and stat shards, stacks (Mejai's, Veigar/Nasus/Senna, etc.), item passives
  and buffs (Baron, elixirs). Summoner spell haste (Cosmic Insight, etc.) isn't applied.
- Item stats are read from Data Dragon item descriptions with Meraki as a fallback. If Riot changes the format, unknown items are listed in red rather than silently ignored.
- Meraki is community data and can lag a day or two behind a balance patch.
- **Riot policy**: Riot's developer rules don't allow *published* apps to give live enemy cooldown/summoner timers.
  The data source (the official local API) is safe. You start every timer yourself (tap, key or voice) on a separate device, and nothing detects enemy casts automatically. This is for your own use; don't distribute it as an app.

## Development

```
npm test          # offline tests against fixtures in test/fixtures
npm run mock      # fake game at http://localhost:7777
```
