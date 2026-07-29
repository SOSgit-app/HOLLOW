/* HOLLOW — mic.js : headset/browser mic RMS → noise events (SOS EMCON). */
(function (NS) {
  'use strict';

  var stream = null, analyser = null, data = null, source = null;
  var enabled = false;
  var emitAcc = 0;
  var starting = false;
  var profile = 'low'; // 'off' | 'low' | 'high'

  function setProfile(p) {
    profile = p || 'low';
    if (profile === 'off') stop();
  }

  function start() {
    if (profile === 'off') return Promise.resolve(false);
    if (enabled || starting) return Promise.resolve(enabled);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.resolve(false);
    }
    starting = true;
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true }
    }).then(function (s) {
      stream = s;
      NS.audio.ensure();
      var AC = NS.audio.getContext();
      if (!AC) { starting = false; return false; }
      analyser = AC.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.7;
      data = new Uint8Array(analyser.fftSize);
      source = AC.createMediaStreamSource(stream);
      source.connect(analyser);
      enabled = true;
      starting = false;
      return true;
    }).catch(function () {
      starting = false;
      enabled = false;
      return false;
    });
  }

  function stop() {
    enabled = false;
    if (source) { try { source.disconnect(); } catch (e) { void e; } source = null; }
    analyser = null; data = null;
    if (stream) {
      stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { void e; } });
      stream = null;
    }
  }

  function rms() {
    if (!analyser || !data) return 0;
    analyser.getByteTimeDomainData(data);
    var sum = 0;
    for (var i = 0; i < data.length; i++) {
      var v = (data[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / data.length);
  }

  function loudnessFromRms(r) {
    if (profile === 'off') return 0;
    if (profile === 'high') {
      if (r < 0.02) return 0;
      if (r < 0.05) return 12 + (r - 0.02) * 100;
      if (r < 0.10) return 18 + (r - 0.05) * 100;
      return Math.min(34, 24 + (r - 0.10) * 100);
    }
    // 'low' (medium difficulty)
    if (r < 0.045) return 0;
    if (r < 0.08) return 8 + (r - 0.045) * 80;
    if (r < 0.14) return 12 + (r - 0.08) * 70;
    return Math.min(28, 18 + (r - 0.14) * 80);
  }

  function tick(dt, isPlaying, emitNoiseFn) {
    if (!enabled || !isPlaying || !emitNoiseFn) return;
    emitAcc += dt;
    if (emitAcc < 0.22) return;
    emitAcc = 0;
    var loud = loudnessFromRms(rms());
    if (loud > 0.5) emitNoiseFn(loud);
  }

  NS.mic = {
    start: start, stop: stop, tick: tick, setProfile: setProfile,
    active: function () { return enabled; },
    level: function () {
      if (!enabled) return 0;
      return Math.min(1, rms() / 0.18);
    }
  };
})(typeof window !== 'undefined' ? (window.HOLLOW = window.HOLLOW || {})
                                 : (global.HOLLOW = global.HOLLOW || {}));
