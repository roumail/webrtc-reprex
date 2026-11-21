// An audio call between two devices on the same Wi-Fi. The call setup
// (offer, answer) is carried by copy-paste; in the messenger the relay will
// carry it as call_offer / call_answer envelopes. Text only, no HTML insertion.
'use strict';

const $ = (id) => document.getElementById(id);
const main = document.querySelector('main');

const STATUS = {
  idle: 'Ready',
  preparing: 'Preparing…',
  'waiting-for-answer': 'Copy box 3 to the other device; then paste its answer in box 2 and tap Use',
  connecting: 'Copy box 3 back to the caller, then wait',
  connected: 'Connected',
  ended: 'Call ended',
  failed: 'Call failed',
};

let pc = null;          // RTCPeerConnection
let mic = null;         // our MediaStream
let control = null;     // data channel for "hang up"
let statsTimer = null;
let lastBytes = 0;

// ---------------------------------------------------------------------------
// State, log, errors

function setState(state) {
  main.dataset.state = state;
  $('status').textContent = STATUS[state];
  const inCall = ['preparing', 'waiting-for-answer', 'connecting', 'connected'].includes(state);
  $('call').disabled = state !== 'idle';
  $('hangup').disabled = !inCall;
  log(`state: ${state}`);
}

// The log is kept in this device's storage, so it survives iOS reloading a
// home-screen app that was in the background. Last 500 lines.
const LOG_KEY = 'callcheck.log';
const LOG_MAX = 500;
let logLines = [];

function loadLog() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOG_KEY) ?? '[]');
    if (Array.isArray(saved)) logLines = saved.filter((line) => typeof line === 'string');
  } catch {
    logLines = [];
  }
  for (const line of logLines) showLogLine(line);
}

function showLogLine(line) {
  const item = document.createElement('li');
  item.textContent = line;
  $('log').append(item);
  $('log').scrollTop = $('log').scrollHeight;
}

function log(text) {
  const now = new Date();
  const line = `${now.toTimeString().slice(0, 8)} ${text}`;
  logLines.push(line);
  if (logLines.length > LOG_MAX) {
    logLines = logLines.slice(-LOG_MAX);
    $('log').firstElementChild?.remove();
  }
  showLogLine(line);
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(logLines));
  } catch {
    // storage unavailable: the log still shows on screen
  }
}

function showError(text) {
  $('error').textContent = text;
}

function showOutgoing(description) {
  $('outgoing').value = JSON.stringify({ callCheck: description.type, sdp: description.sdp });
  $('copy').disabled = false;
  $('copy').textContent = 'Copy';
}

// ---------------------------------------------------------------------------
// The call

async function openMicrophone() {
  mic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  for (const track of mic.getTracks()) {
    log('microphone on');
    track.addEventListener('mute', () => log('microphone muted (by the system)'));
    track.addEventListener('unmute', () => log('microphone unmuted'));
    track.addEventListener('ended', () => log('microphone ended'));
  }
}

function newConnection() {
  // No STUN/TURN: only addresses on the local network, so same Wi-Fi only.
  pc = new RTCPeerConnection({ iceServers: [] });
  for (const track of mic.getTracks()) pc.addTrack(track, mic);

  pc.addEventListener('connectionstatechange', () => {
    log(`connection: ${pc.connectionState}`);
    if (pc.connectionState === 'connected') {
      setState('connected');
      startStats();
    } else if (pc.connectionState === 'failed') {
      finish('failed');
    }
  });
  pc.addEventListener('iceconnectionstatechange', () => log(`network path: ${pc.iceConnectionState}`));
  pc.addEventListener('track', (event) => {
    const track = event.track;
    log('their audio arrived');
    track.addEventListener('mute', () => log('their audio paused'));
    track.addEventListener('unmute', () => log('their audio resumed'));
    const audio = $('remote');
    audio.srcObject = event.streams[0] ?? new MediaStream([track]);
    audio.play().catch((error) => log(`audio playback blocked: ${error.name}`));
  });
  pc.addEventListener('datachannel', (event) => useControl(event.channel));
}

function useControl(channel) {
  control = channel;
  channel.addEventListener('message', (event) => {
    if (event.data === 'bye') {
      log('the other device hung up');
      finish('ended');
    }
  });
}

// Waits until every local address is in the description, so one copy
// carries everything (no trickling candidates over a slow clipboard).
function allAddressesGathered() {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') resolve();
    });
  });
}

async function startCall() {
  showError('');
  setState('preparing');
  try {
    await openMicrophone();
    newConnection();
    useControl(pc.createDataChannel('control'));
    await pc.setLocalDescription(await pc.createOffer());
    await allAddressesGathered();
    showOutgoing(pc.localDescription);
    setState('waiting-for-answer');
  } catch (error) {
    showError(`Couldn't start: ${error.message}`);
    finish('failed');
  }
}

async function answerCall(offer) {
  setState('preparing');
  try {
    await openMicrophone();
    newConnection();
    await pc.setRemoteDescription(offer);
    await pc.setLocalDescription(await pc.createAnswer());
    await allAddressesGathered();
    showOutgoing(pc.localDescription);
    if (main.dataset.state === 'preparing') setState('connecting');
  } catch (error) {
    showError(`Couldn't answer: ${error.message}`);
    finish('failed');
  }
}

async function useAnswer(answer) {
  try {
    await pc.setRemoteDescription(answer);
    if (main.dataset.state === 'waiting-for-answer') setState('connecting');
  } catch (error) {
    showError(`Couldn't use the answer: ${error.message}`);
  }
}

function hangUp() {
  if (control && control.readyState === 'open') control.send('bye');
  log('hung up');
  finish('ended');
}

function finish(state) {
  clearInterval(statsTimer);
  if (pc) pc.close();
  if (mic) for (const track of mic.getTracks()) track.stop();
  pc = null;
  mic = null;
  control = null;
  setState(state);
}

// Back to ready without reloading (an installed web app has no reload button).
function startOver() {
  if (control && control.readyState === 'open') control.send('bye');
  finish('idle');
  lastBytes = 0;
  $('incoming').value = '';
  $('outgoing').value = '';
  $('copy').disabled = true;
  $('copy').textContent = 'Copy';
  $('stats').dataset.bytesReceived = '0';
  $('stats').textContent = 'No audio yet';
  showError('');
  log('started over');
}

// ---------------------------------------------------------------------------
// Audio statistics, once a second

function startStats() {
  clearInterval(statsTimer);
  statsTimer = setInterval(async () => {
    if (!pc) return;
    let received = 0;
    const report = await pc.getStats();
    report.forEach((entry) => {
      if (entry.type === 'inbound-rtp' && entry.kind === 'audio') received += entry.bytesReceived ?? 0;
    });
    const perSecond = Math.max(0, received - lastBytes);
    lastBytes = received;
    $('stats').dataset.bytesReceived = String(received);
    $('stats').textContent = `Receiving audio: ${Math.round(received / 1024)} KB (${(perSecond / 1024).toFixed(1)} KB/s)`;
  }, 1000);
}

// ---------------------------------------------------------------------------
// Reading pasted text

function parseCallText(text) {
  try {
    const value = JSON.parse(text);
    if ((value.callCheck === 'offer' || value.callCheck === 'answer') && typeof value.sdp === 'string') {
      return { type: value.callCheck, sdp: value.sdp };
    }
  } catch {
    // not JSON
  }
  return null;
}

async function useIncoming() {
  showError('');
  const description = parseCallText($('incoming').value.trim());
  const state = main.dataset.state;
  if (!description) {
    showError("That isn't a call text.");
  } else if (description.type === 'offer' && state === 'idle') {
    await answerCall(description);
  } else if (description.type === 'answer' && state === 'waiting-for-answer') {
    await useAnswer(description);
  } else if (description.type === 'offer' && state === 'waiting-for-answer') {
    showError("Both devices tapped Call. On this one, tap Start over, then paste the other device's text and tap Use.");
  } else {
    showError(`That's ${description.type === 'offer' ? 'a call' : 'an answer'} text, but this device is "${STATUS[state]}".`);
  }
}

// ---------------------------------------------------------------------------
// Buttons and the app's life

$('call').addEventListener('click', startCall);
$('use').addEventListener('click', useIncoming);
$('hangup').addEventListener('click', hangUp);
$('start-over').addEventListener('click', startOver);
$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('outgoing').value);
    $('copy').textContent = 'Copied';
  } catch (error) {
    showError(`Couldn't copy: ${error.message}`);
  }
});
$('paste').addEventListener('click', async () => {
  try {
    $('incoming').value = await navigator.clipboard.readText();
  } catch (error) {
    showError(`Couldn't paste (long-press the box instead): ${error.message}`);
  }
});

// Locking the phone or switching apps: what did the call do meanwhile?
document.addEventListener('visibilitychange', () => log(`app ${document.visibilityState}`));
window.addEventListener('pagehide', () => log('page hidden by the system'));
window.addEventListener('pageshow', (event) => { if (event.persisted) log('page restored'); });

$('copy-log').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(logLines.join('\n'));
    $('copy-log').textContent = 'Log copied';
  } catch (error) {
    showError(`Couldn't copy the log: ${error.message}`);
  }
});

const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
loadLog();
log(`page loaded, ${standalone ? 'running from the home screen' : 'running in the browser'}`);
setState('idle');
