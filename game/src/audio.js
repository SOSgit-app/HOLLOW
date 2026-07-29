/* HOLLOW — audio.js : fully procedural WebAudio (no samples). GDD §9. */
(function (NS) {
  'use strict';

  var ctx = null, master = null, noiseBuf = null;
  var drone = null, droneGain = null;
  var breathGain = null, breathPan = null, breathSrc = null;
  var stingNodes = null;
  var stingStopTimer = null;
  var transientNodes = [];   // one-shots that must be hard-stopped on restart
  var volume = 0.7;

  function track(node) {
    if (node) transientNodes.push(node);
    return node;
  }

  function stopNode(n) {
    if (!n) return;
    try { if (n.stop) n.stop(0); } catch (e) { void e; }
    try { if (n.disconnect) n.disconnect(); } catch (e2) { void e2; }
  }

  function stopAllTransient() {
    if (!ctx) return;
    if (stingStopTimer) { clearTimeout(stingStopTimer); stingStopTimer = null; }
    if (stingNodes) {
      stingNodes.forEach(stopNode);
      stingNodes = null;
    }
    transientNodes.forEach(stopNode);
    transientNodes = [];
    chopperStop();
    if (breathSrc) { stopNode(breathSrc); breathSrc = null; }
    if (breathGain) { try { breathGain.disconnect(); } catch (e3) { void e3; } breathGain = null; }
    breathPan = null;
  }

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);

    // 2s of white noise, reused everywhere
    var len = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  function getContext() { ensure(); return ctx; }

  function setVolume(v) {
    volume = v;
    if (master) master.gain.value = v;
  }

  function panner(pan) {
    if (ctx.createStereoPanner) {
      var p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan || 0));
      return p;
    }
    return ctx.createGain(); // mono fallback
  }

  function noiseSource() {
    var s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    return s;
  }

  // ---- continuous layers -------------------------------------------------
  // No looping bed on start. Proximity breath is created only when needed.
  function startAmbient() {
    if (!ensure()) return;
    drone = {}; // mark audio session live
    droneGain = null;
  }

  function ensureBreath() {
    if (breathGain || !ctx) return;
    breathSrc = noiseSource();
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 420;
    breathGain = ctx.createGain();
    breathGain.gain.value = 0;
    breathPan = panner(0);
    breathSrc.connect(lp);
    lp.connect(breathGain);
    breathGain.connect(breathPan);
    breathPan.connect(master);
    breathSrc.start();
  }

  function setAgitation(a) {
    void a;
  }

  function setBreath(gain, pan) {      // proximity breathing, <14 m
    var g = Math.min(0.20, Math.max(0, gain || 0));
    if (g <= 0.001) {
      if (breathGain) breathGain.gain.value = 0;
      return;
    }
    ensureBreath();
    if (!breathGain) return;
    breathGain.gain.value = g;
    if (breathPan && breathPan.pan) breathPan.pan.value = Math.max(-1, Math.min(1, pan || 0));
  }

  // ---- one-shots ---------------------------------------------------------
  function blipAt(freq, dur, gain, pan, type, when) {
    if (!ctx) return;
    var t = (when || ctx.currentTime);
    var o = ctx.createOscillator();
    o.type = type || 'square';
    o.frequency.value = freq;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    var p = panner(pan || 0);
    o.connect(g); g.connect(p); p.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function thump(freq, dur, gain, pan, lpf) {
    if (!ctx) return;
    var t = ctx.currentTime;
    var s = noiseSource();
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = lpf || 240;
    var g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    var o = ctx.createOscillator();
    o.type = 'sine'; o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.5), t + dur);
    var og = ctx.createGain();
    og.gain.setValueAtTime(gain * 0.8, t);
    og.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    var p = panner(pan || 0);
    s.connect(f); f.connect(g); g.connect(p);
    o.connect(og); og.connect(p);
    p.connect(master);
    s.start(t); s.stop(t + dur + 0.05);
    o.start(t); o.stop(t + dur + 0.05);
  }

  var lastTick = 0;
  function scanTick() {                          // trickle scan: ~28 ticks/s
    if (!ctx) return;
    var t = ctx.currentTime;
    if (t - lastTick < 0.035) return;
    lastTick = t;
    blipAt(1050 + Math.random() * 140, 0.025, 0.018, (Math.random() - 0.5) * 0.4, 'square');
  }

  function footstep(loud) {                      // player's own steps
    thump(95, 0.09, 0.03 + loud * 0.05, 0, 300 + loud * 500);
  }
  function enemyStep(pan, gain) {
    thump(60, 0.16, gain, pan, 180);
  }

  function click(pan, gain) {                    // custodian double-click signature
    if (!ctx) return;
    var t = ctx.currentTime;
    blipAt(2300, 0.018, gain, pan, 'square', t);
    blipAt(1900, 0.018, gain * 0.8, pan, 'square', t + 0.07);
  }

  function heartbeat(intensity) {
    thump(55, 0.10, 0.05 * intensity, 0, 140);
    setTimeout(function () { thump(50, 0.09, 0.038 * intensity, 0, 130); }, 140);
  }

  function sting(on) {                           // chase enter/exit
    if (!ctx) return;
    if (on && !stingNodes) {
      if (stingStopTimer) { clearTimeout(stingStopTimer); stingStopTimer = null; }
      stingNodes = [];
      var g = ctx.createGain();
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.4);
      g.connect(master);
      [110, 116.5, 220, 233].forEach(function (f) {
        var o = ctx.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = f;
        o.connect(g); o.start();
        stingNodes.push(o);
      });
      stingNodes.push(g);
    } else if (!on && stingNodes) {
      var gg = stingNodes[stingNodes.length - 1];
      var t = ctx.currentTime;
      try { gg.gain.cancelScheduledValues(t); gg.gain.setValueAtTime(gg.gain.value, t); gg.gain.linearRampToValueAtTime(0.0001, t + 0.35); } catch (e) { void e; }
      var nodes = stingNodes;
      stingNodes = null;
      if (stingStopTimer) clearTimeout(stingStopTimer);
      stingStopTimer = setTimeout(function () {
        stingStopTimer = null;
        nodes.forEach(stopNode);
      }, 400);
    }
  }

  function scareImpact() {
    if (!ctx) return;
    sting(false);
    var t = ctx.currentTime;

    // frame-0: custodian double-click — it found you
    click(0, 0.22);
    blipAt(2300, 0.018, 0.18, 0, 'square', t + 0.07);
    blipAt(1900, 0.018, 0.14, 0, 'square', t + 0.14);

    // impact thump + body-hit noise burst
    thump(38, 0.22, 0.55, 0, 90);
    var hit = track(noiseSource());
    var hf = ctx.createBiquadFilter();
    hf.type = 'highpass'; hf.frequency.value = 800;
    var hg = ctx.createGain();
    hg.gain.setValueAtTime(0.45, t);
    hg.gain.exponentialRampToValueAtTime(0.0005, t + 0.18);
    hit.connect(hf); hf.connect(hg); hg.connect(master);
    hit.start(t); hit.stop(t + 0.2);

    // inhuman screech — descending saw through a resonant band
    var sc = track(ctx.createOscillator());
    sc.type = 'sawtooth';
    sc.frequency.setValueAtTime(1400, t);
    sc.frequency.exponentialRampToValueAtTime(180, t + 0.55);
    var sf = ctx.createBiquadFilter();
    sf.type = 'bandpass'; sf.Q.value = 6;
    sf.frequency.setValueAtTime(2200, t);
    sf.frequency.exponentialRampToValueAtTime(400, t + 0.5);
    var sg = ctx.createGain();
    sg.gain.setValueAtTime(0.28, t);
    sg.gain.exponentialRampToValueAtTime(0.0005, t + 0.6);
    sc.connect(sf); sf.connect(sg); sg.connect(master);
    sc.start(t); sc.stop(t + 0.65);
  }

  function death() {
    if (!ctx) return;
    sting(false);
    var t = ctx.currentTime;
    // carrier tearing — ~4 s hard cap, then silence
    var s = track(noiseSource());
    var f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 1.4;
    f.frequency.setValueAtTime(2600, t);
    f.frequency.exponentialRampToValueAtTime(90, t + 3.2);
    var g = track(ctx.createGain());
    g.gain.setValueAtTime(0.30, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 1.0);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 3.8);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t);
    try { s.stop(t + 4.0); } catch (e) { void e; }

    var tone = track(ctx.createOscillator());
    tone.type = 'sine';
    tone.frequency.setValueAtTime(220, t + 0.6);
    tone.frequency.exponentialRampToValueAtTime(55, t + 3.5);
    var tg = track(ctx.createGain());
    tg.gain.setValueAtTime(0, t);
    tg.gain.linearRampToValueAtTime(0.06, t + 0.9);
    tg.gain.exponentialRampToValueAtTime(0.0005, t + 3.8);
    tone.connect(tg); tg.connect(master);
    tone.start(t + 0.6);
    try { tone.stop(t + 4.0); } catch (e2) { void e2; }
  }

  function securityAlarm() {
    if (!ctx) return;
    var t = ctx.currentTime;
    for (var i = 0; i < 8; i++) {
      var o = track(ctx.createOscillator());
      o.type = 'square';
      o.frequency.value = i % 2 ? 1800 : 1400;
      var g = track(ctx.createGain());
      var start = t + i * 0.22;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.07, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0005, start + 0.18);
      o.connect(g); g.connect(master);
      o.start(start);
      try { o.stop(start + 0.22); } catch (e) { void e; }
    }
  }

  var chopperGain = null, chopperNodes = [];
  function chopperStop() {
    chopperNodes.forEach(stopNode);
    chopperNodes = [];
    chopperGain = null;
  }

  function uplinkSurge() {
    generatorRoar();
    blipAt(880, 0.3, 0.05, 0, 'sine');
    blipAt(1320, 0.4, 0.04, 0, 'sine');
  }

  function chopperInbound() {
    if (!ctx) return;
    chopperStop();
    var t = ctx.currentTime;
    chopperGain = track(ctx.createGain());
    chopperGain.gain.setValueAtTime(0.0, t);
    chopperGain.gain.linearRampToValueAtTime(0.04, t + 2.0);
    chopperGain.connect(master);
    var n = track(noiseSource());
    var f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 90; f.Q.value = 0.8;
    n.connect(f); f.connect(chopperGain);
    n.start(t);
    chopperNodes.push(n, chopperGain);
    blipAt(600, 0.15, 0.03, 0, 'square');
  }

  function chopperOnStation() {
    if (!ctx) return;
    var t = ctx.currentTime;
    if (chopperGain) {
      chopperGain.gain.cancelScheduledValues(t);
      chopperGain.gain.setValueAtTime(0.06, t);
      chopperGain.gain.linearRampToValueAtTime(0.11, t + 0.8);
    } else {
      chopperInbound();
    }
    for (var i = 0; i < 3; i++) blipAt(1200 + i * 200, 0.08, 0.04, 0, 'square', t + i * 0.12);
  }

  function fuseChime() {                         // major 6th dyad, amber-tinted
    blipAt(880, 0.5, 0.04, 0, 'sine');
    blipAt(1480, 0.6, 0.03, 0, 'sine');
  }

  function tutorialCue() {                       // soft ascending ping on coach step change
    if (!ctx) return;
    var t = ctx.currentTime;
    blipAt(620, 0.09, 0.032, 0, 'sine', t);
    blipAt(930, 0.11, 0.026, 0, 'sine', t + 0.06);
    blipAt(1240, 0.14, 0.02, 0, 'triangle', t + 0.12);
  }

  function clunk(pan) {
    thump(140, 0.18, 0.10, pan || 0, 500);
  }

  function generatorRoar() {
    if (!ctx) return;
    var t = ctx.currentTime;
    var s = noiseSource();
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(80, t);
    f.frequency.linearRampToValueAtTime(320, t + 2.0);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0, t);
    g.gain.linearRampToValueAtTime(0.22, t + 1.4);
    g.gain.linearRampToValueAtTime(0.06, t + 4.0);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + 4.2);
    var o = ctx.createOscillator();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(30, t);
    o.frequency.linearRampToValueAtTime(55, t + 2.0);
    var og = ctx.createGain();
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(0.10, t + 1.5);
    og.gain.linearRampToValueAtTime(0.03, t + 4.0);
    o.connect(og); og.connect(master);
    o.start(t); o.stop(t + 4.2);
  }

  function doorGrind() {
    if (!ctx) return;
    var t = ctx.currentTime;
    var s = noiseSource();
    var f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 300; f.Q.value = 2;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.linearRampToValueAtTime(0.0, t + 0.85);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t); s.stop(t + 0.9);
  }

  function teletype() { blipAt(1800, 0.015, 0.008, 0, 'square'); }

  NS.audio = {
    ensure: ensure, getContext: getContext, setVolume: setVolume,
    startAmbient: startAmbient, setAgitation: setAgitation, setBreath: setBreath,
    scanTick: scanTick,
    footstep: footstep, enemyStep: enemyStep, click: click, heartbeat: heartbeat,
    sting: sting, scareImpact: scareImpact, death: death, fuseChime: fuseChime, clunk: clunk,
    tutorialCue: tutorialCue,
    generatorRoar: generatorRoar, doorGrind: doorGrind, teletype: teletype,
    securityAlarm: securityAlarm, stopAllTransient: stopAllTransient,
    uplinkSurge: uplinkSurge, chopperInbound: chopperInbound,
    chopperOnStation: chopperOnStation, chopperStop: chopperStop
  };
})(typeof window !== 'undefined' ? (window.HOLLOW = window.HOLLOW || {})
                                 : (global.HOLLOW = global.HOLLOW || {}));
