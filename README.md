# Reprex: a Wi-Fi call between an iPhone web app and a Mac

The smallest working example of an **audio call** between an installed web app
on an iPhone (added to the home screen) and a browser on a Mac, on the same
Wi-Fi. No server, no Apple developer account, no app store.

It answers two questions:
1. Does a WebRTC call work from an iPhone home-screen web app?
2. **What happens to the call when the phone locks or you switch apps?**
   The page keeps a timed log so the answer is visible afterwards.

Tests come first; the page is written to pass them.

## How a call is set up, and why there's copy-paste

```
 Mac (caller)                                  iPhone (callee)
 ────────────                                  ───────────────
 1. Call: mic on, makes an OFFER  ── copy ──►  2. Use: mic on, makes an ANSWER
                                                  (how to reach me + my keys)
 3. Use: applies the answer       ◄── copy ──
 4. ════════ audio, directly over the Wi-Fi, encrypted (DTLS-SRTP) ════════
```

The two "copy" arrows are the **call setup messages**. In the real messenger
they travel through the relay as `call_offer` and `call_answer` envelopes;
here the person carries them (Universal Clipboard: copy on one device, paste
on the other). Everything else is what the real call will do.

- **No STUN/TURN servers** are configured: each device offers only its
  addresses on the local network, so this works on the same Wi-Fi only, on
  purpose. Calls across the internet are a later step.
- The setup text contains each side's encryption fingerprint, so whoever
  carries it (here the clipboard, later the relay) must be trusted not to
  swap it.
- A small data channel inside the call carries "hang up", so the other side
  ends at once.

## Layout: who plays whom

```
webrtc-reprex/
├── README.md
├── package.json, package-lock.json   Playwright, pinned (1.65.1)
├── playwright.config.js              Chromium with a fake microphone (beeps)
├── tests/                            AUTOMATED
│   ├── call.spec.js                  THE SPEC: one test per scenario
│   └── serve.mjs                     serves docs/ on localhost:4173
└── docs/                             THE CODE UNDER TEST, served by GitHub Pages
    ├── index.html                    the call page
    ├── app.js                        WebRTC: offer/answer, stats, log, hang up
    └── manifest.json                 makes it installable to the home screen
```

| In the tests | Plays |
|---|---|
| two browser contexts | two devices ("Mac" calls, "iPhone" answers), each fresh and separate |
| the test itself | the person copying the setup text, i.e. the future relay |
| Chromium's fake microphone | someone talking: a steady beep, so audio really flows |
| an init script hiding the page | locking the phone / switching apps |

**The app ↔ test contract:** `data-state` on `<main>` (`idle`, `preparing`,
`waiting-for-answer`, `connecting`, `connected`, `ended`, `failed`); test ids
`call`, `incoming`, `use`, `outgoing`, `hangup`, `start-over`, `stats`, `log`, `copy-log`, `error`;
`data-bytes-received` on the stats line; the log is kept in `localStorage`
(`callcheck.log`, last 500 lines). Tests wait on these, never on time.

## The scenarios (`tests/call.spec.js`)

| Scenario | Proves |
|---|---|
| an audio call connects by copy-paste | offer → answer → connected; audio bytes keep arriving on both sides |
| hanging up ends the call on both sides | "hang up" reaches the other side at once |
| a text that is not a call text is refused | pasting anything else gives a clear error, nothing starts |
| when both devices tap Call, the one that uses the other's text is told what to do | the mistake made on the first real try is explained, and Start over recovers |
| Start over returns a device to ready | an installed web app has no reload button; Start over ends any call and clears both boxes |
| the log survives the app being reloaded | iOS may reload a home-screen app that was in the background; the log (the evidence) is kept and the reload is marked |
| Copy log puts the whole log on the clipboard | the log can be sent off the phone |
| the log records the app going to the background and back | hidden/visible are logged with times, and the call itself survives in a desktop browser |

## Running the tests

```sh
npm ci
npx playwright install chromium   # once, if not cached
npm test
```

Report: `npx playwright show-report` (traces of failures included).

## Manual check: a real call, iPhone ↔ Mac

Page: https://www.rohailtaimour.com/webrtc-reprex/ (both devices on the same Wi-Fi)

1. **iPhone:** open the page in Safari → Share → Add to Home Screen → open
   **Call check** from the home screen.
   Only the Mac taps **Call**; the iPhone never does, it answers.
2. **Mac:** open the page in Safari or Chrome → **Call** → allow the
   microphone → **Copy** (box 3).
3. **iPhone:** **Paste** (box 2) → **Use** → allow the microphone →
   **Copy** (box 3).
4. **Mac:** **Paste** (box 2) → **Use**. Both should say *Connected*; talk.

   Copying between the devices is Universal Clipboard: same Apple ID,
   Wi-Fi and Bluetooth on, Handoff on. Mixed up? **Start over** on both.
5. **The real question**, with the call running, one at a time:
   - lock the iPhone for ~30 s, unlock, come back to the app;
   - switch to another app for ~30 s, come back;
   - meanwhile, keep talking on the Mac: is the iPhone's audio heard? Does
     the Mac still hear the iPhone?
6. On the iPhone, tap **Copy log** and send it (it lists page loads,
   hidden/visible, microphone muted/unmuted, connection changes, with
   times). It's kept across reloads until the 500-line limit. Note the
   results below.

Turn off any VPN on both devices first: on the first try a VPN on the Mac
blocked the direct Wi-Fi path, and with no TURN server there is no way
around it.

### Results

| Date | iPhone / iOS | Locked 30 s | Other app 30 s | Notes |
|---|---|---|---|---|
| 2026-11-21 | iPhone (model/iOS to add), home-screen app ↔ Mac browser | **Call kept going**; iPhone → Mac direction to confirm | **Mac → iPhone audio kept going** (Mac keyboard heard); iPhone → Mac to confirm | Connected only after the VPN on the Mac (NordVPN) was turned off: it blocked the direct Wi-Fi path. The iPhone's log was lost afterwards (kept only in memory); it now survives reloads and has Copy log. Echo and delay were from both devices in one room. iOS refused the **Paste** button in the home-screen app; tap-and-hold → Paste works. |
