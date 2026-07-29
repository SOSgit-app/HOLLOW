/* HOLLOW — game.js : states, player, scanner, items, finale, HUD, main loop. */
(function (NS) {
  'use strict';

  var M, R, A, EN, VR, math;

  // ---- tuning constants (GDD §3) ----
  var EYE_STAND = 1.85, EYE_CROUCH = 1.15;
  var SPEED_WALK = 3.2, SPEED_SPRINT = 7.4, SPEED_SPRINT_COMFORT = 4.2, SPEED_CROUCH = 1.6;
  var PLAYER_RADIUS = 0.35;
  var NOISE_CROUCH = 2, NOISE_WALK = 7, NOISE_SPRINT = 22;
  var STAMINA_MAX = 1, STAMINA_DRAIN = 0.32, STAMINA_RECOVER = 0.24, STAMINA_MIN_SPRINT = 0.12;
  var NOISE_TRICKLE = 9, NOISE_BURST = 34, NOISE_INTERACT = 12;
  var TRICKLE_RAYS = 220, TRICKLE_CONE = 14 * Math.PI / 180;
  var POINT_LIFE = 90, ENEMY_POINT_LIFE = 2.5;
  var SCAN_RANGE = 60;
  var INTERACT_RANGE = 2.4;
  var INTERACT_RANGE_VR = 4.2;
  var VR_AIM_MAX = 5.5;
  var VR_AIM_DOT = 0.72;
  var gfxQuality = 'medium';

  var GFX = {
    low: {
      trickleRays: 90,
      pointLife: 40, xrMaxPoints: 120000, fboScale: 0.55, vrScale: 0.55
    },
    medium: {
      trickleRays: 220,
      pointLife: 90, xrMaxPoints: 300000, fboScale: 0.85, vrScale: 0.8
    },
    high: {
      trickleRays: 360,
      pointLife: 140, xrMaxPoints: 520000, fboScale: 1.0, vrScale: 1.0
    }
  };

  function applyGraphics(level) {
    var g = GFX[level] || GFX.medium;
    gfxQuality = GFX[level] ? level : 'medium';
    TRICKLE_RAYS = g.trickleRays;
    POINT_LIFE = g.pointLife;
    if (R && R.setQuality) R.setQuality({ xrMaxPoints: g.xrMaxPoints, fboScale: g.fboScale });
    if (VR && VR.setFramebufferScale) VR.setFramebufferScale(g.vrScale);
    try { localStorage.setItem('hollow_gfx', gfxQuality); } catch (err) { void err; }
  }

  function applyComfort() {
    if (R && R.setComfort) {
      R.setComfort({
        vignette: comfortVignette ? moveVignette : 0
      });
    }
  }

  function loadComfortSettings() {
    try {
      comfortVignette = localStorage.getItem('hollow_comfort_vignette') === '1';
      comfortSlowSprint = localStorage.getItem('hollow_comfort_sprint') === '1';
    } catch (e) { void e; }
    var v = $('opt-comfort-vignette');
    var s = $('opt-comfort-sprint');
    if (v) v.checked = comfortVignette;
    if (s) s.checked = comfortSlowSprint;
    applyComfort();
  }

  function saveComfortFlag(key, on) {
    try { localStorage.setItem(key, on ? '1' : '0'); } catch (e) { void e; }
  }

  var currentDifficulty = 'medium';
  function applyDifficulty(diff) {
    currentDifficulty = diff || 'medium';
    try { localStorage.setItem('hollow_difficulty', currentDifficulty); } catch (e) { void e; }
    if (NS.mic && NS.mic.setProfile) {
      if (currentDifficulty === 'easy') NS.mic.setProfile('off');
      else if (currentDifficulty === 'medium') NS.mic.setProfile('low');
      else NS.mic.setProfile('high');
    }
    var buttons = document.querySelectorAll('.diff-btn');
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      if (b.getAttribute('data-diff') === currentDifficulty) b.classList.add('active');
      else b.classList.remove('active');
    }
  }

  // ---- palette (GDD §3.2) — wall tones kept mid so additive LiDAR does not blow out ----
  var C_WALL = [0.32, 0.72, 0.42];
  var C_FLOOR = [0.12, 0.38, 0.34];
  var C_CEIL = [0.20, 0.50, 0.30];
  var C_HARBOR = [0.12, 0.78, 0.28];   // safe-zone LiDAR returns
  var C_LZ = [1.0, 0.92, 0.12];        // landing zone pad (yellow)
  var C_YELLOW = [1.0, 0.92, 0.12];   // laser alarm beams
  var C_AMBER = [1.0, 0.70, 0.28];
  var C_CYAN = [0.43, 0.91, 0.91];
  var C_RED = [1.0, 0.27, 0.27];
  var C_POW = [0.08, 0.45, 0.18];   // rescued POW — dark green LiDAR
  var C_DOOR = [0.12, 0.28, 0.72];   // locked blast doors — dark blue
  var NOISE_LASER = 32;
  var LASER_COOLDOWN = 10;

  var CHOPPER_INBOUND_S = 40;
  var CHOPPER_LINGER_S = 90; // on-station wait before left-behind
  var MISSION_TIME_S = 10 * 60; // power returns — hard fail
  var LZ_RADIUS = 3.5;
  var NOISE_UPLINK = 40;
  var NOISE_VIRUS = 28;
  var JACKIN_RETRY_S = 10; // lockout cool-down before another jack-in attempt
  var CLONE_DURATION_S = 4.5;
  var VIRUS_DURATION_S = 11;
  var POW_FOLLOW_SPEED = 2.55;
  var POW_STOP_DIST = 1.25;
  var POW_RADIUS = 0.4;

  var BOOT_LINES = [
    "RD-9 RANGING PACKAGE — CYBER INFILTRATION LOADOUT",
    "BUILD 0.9.3 / BLACKOUT OPERATIONS OVERLAY",
    "",
    "SELF TEST ............. OK",
    "LiDAR GOGGLES ......... OK",
    "MOTION TRACKER ........ OK",
    "COMMS BAFFLE .......... DEGRADED",
    "",
    "SITUATION: HOSTILE SITE HOUSES A HIGH-RISK AI MODEL.",
    "PRE-RAID EMP HAS CUT POWER. FACILITY IS DARK.",
    "",
    "MISSION: INFILTRATE. REACH THE AI CORE. CLONE THE MODEL.",
    "         EXFIL BEFORE POWER RETURNS (10:00 BLACKOUT WINDOW).",
    "",
    "TOOLS: LiDAR MAPS THE DARK. WRIST RADAR TRACKS SECURITY.",
    "EMCON: MINIMIZE EMISSIONS. THEY HEAR WHAT YOU LIGHT."
  ];

  var WIN_LINES_RESCUE = [
    "UPLINK CONFIRMED. MODEL CLONE RECEIVED.",
    "POW EXTRACTED VIA LZ. CHOPPER AWAY.",
    "",
    "MISSION SUCCESS — ASSET RECOVERED.",
    "",
    "THE VIRUS WAS NEVER PLANTED.",
    "THEIR MAINFRAME WILL WAKE UNTOUCHED.",
    "",
    "DEBRIEF: YOU CHOSE THE LIVING OVER THE GRID.",
    "",
    "( END TRANSMISSION )"
  ];

  var WIN_LINES_VIRUS = [
    "UPLINK CONFIRMED. MODEL CLONE RECEIVED.",
    "VIRUS SEEDED IN LOCAL INSTANCE.",
    "OPERATOR EXTRACTED VIA LZ. CHOPPER AWAY.",
    "",
    "MISSION SUCCESS — HOSTILE TECH COMPROMISED.",
    "",
    "WHEN THEIR MAINFRAME RETURNS ONLINE,",
    "YOU WILL HOLD THE KEYS.",
    "",
    "DEBRIEF: THE POW WAS LEFT IN THE DARK.",
    "",
    "( END TRANSMISSION )"
  ];

  var CLONE_INTEL =
    "CLONE COMPLETE.\n\n" +
    "FLASH TRAFFIC: POSSIBLE POW ON-SITE.\n" +
    "MAP GUIDE HAS EXTERNAL COORDINATES — ASK THEM.\n" +
    "SCAN WITH LiDAR — THE POW PAINTS GREEN.\n" +
    "Free them, then escort to the LZ.\n\n" +
    "ALTERNATE: REMAIN AT CONSOLE. PLANT VIRUS.\n" +
    "WHEN THEIR MAINFRAME WAKES, YOU OWN THE STACK.\n\n" +
    "ONE PATH ONLY. CHOPPER CLOCK STARTS ON CONFIRM.";

  var FAIL_LEFT_LINES = [
    "CHOPPER DEPARTED. LZ COLD.",
    "OPERATOR NOT ON BOARD.",
    "",
    "MISSION FAILURE — LEFT BEHIND.",
    "",
    "THE UPLINK MAY HAVE HELD.",
    "THE EXTRACT DID NOT."
  ];

  // ---- state ----
  var state = 'BOOT'; // BOOT | CONTROLS | PLAY | DYING | DEAD | WIN | LEFT
  var player = { x: 0, z: 0, yaw: 0, pitch: 0, eye: EYE_STAND };
  var keys = {};
  var trickleOn = false;
  var vrScanOrigin = null, vrScanDirection = null;
  var trickleNoiseTimer = 0;
  var accessKeys = [];
  var keysCollected = 0, doorsOpen = 0;
  var vrHudHint = '';
  var vrHudObj = '';
  var uplinkDone = false;
  var jackInCooldownUntil = 0;
  var exfilPhase = 'NONE'; // NONE | INBOUND | ON_STATION | GONE
  var exfilTimer = 0;
  var missionBranch = 'NONE'; // NONE | RESCUE | VIRUS
  var clonePhase = 'NONE'; // NONE | CLONING | CHOICE | DONE
  var cloneTimer = 0;
  var clonePct = 0;
  var cloneChoiceIdx = 0; // 0 rescue, 1 virus (VR highlight)
  var virusProgress = 0;
  var virusDone = false;
  var virusNoiseTimer = 0;
  var virusHolding = false;
  var virusWristActive = false; // show upload UI on wrist while at console on virus path
  var pow = null; // { x, z, freed, path, pathIdx, repath }
  var cloneCanvas = null;
  var cloneCtx = null;
  var auxLoud = 0, recentLoud = 0;
  var stamina = STAMINA_MAX, staminaExhausted = false;
  var tearTimer = 0, floodLevel = 0, dieTimer = 0;
  var glitchLevel = 0, glitchPop = 0, popTimer = 5;
  var runTime = 0;
  var now = 0, lastFrame = 0;
  var sens = 0.0022, reducedFlash = false;
  var comfortVignette = false, comfortSlowSprint = false;
  var moveVignette = 0;
  var deathCause = 'quiet';
  var clickTickFade = 0;
  var laserCooldown = {};
  var CIR = null;
  var missionWarnAt = { m2: false, m1: false, s30: false };
  var circuitPanelModel = null; // last VR panel matrix for laser pick

  // typewriter event line
  var msgQueue = [], curMsg = null, msgChars = 0, msgHold = 0;

  var el = {};

  // ------------------------------------------------------------------
  function $(id) { return document.getElementById(id); }

  function init() {
    M = NS.map; R = NS.render; A = NS.audio; EN = NS.enemy; VR = NS.vr; math = NS.math;
    CIR = NS.circuit;

    el.canvas = $('glcanvas');
    el.hud = $('hud');
    el.timer = $('hud-timer'); el.pts = $('hud-pts'); el.obj = $('hud-obj');
    el.auxFill = $('aux-fill'); el.auxTick = $('aux-tick');
    el.staFill = $('sta-fill');
    el.vcrClock = $('vcr-clock');
    el.eventline = $('eventline');
    el.boot = $('boot-screen'); el.bootText = $('boot-text'); el.bootCont = $('boot-continue');
    el.controls = $('controls-screen');
    el.settings = $('settings-screen');
    el.death = $('death-screen'); el.epitaph = $('death-epitaph');
    el.win = $('win-screen'); el.winText = $('win-text');
    el.clone = $('clone-screen');
    el.cloneStatus = $('clone-status');
    el.cloneFill = $('clone-fill');
    el.clonePct = $('clone-pct');
    el.cloneChoice = $('clone-choice');
    el.cloneIntel = $('clone-intel');
    el.btnRescue = $('btn-rescue');
    el.btnVirus = $('btn-virus');
    el.postTutorial = $('post-tutorial-screen');

    R.init(el.canvas);
    VR.init($('enter-vr'));
    bindInput();
    startBootType();
    lastFrame = performance.now();
    requestAnimationFrame(frame);
  }

  function syncGfxButtons() {
    var buttons = document.querySelectorAll('.gfx-btn');
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      if (b.getAttribute('data-gfx') === gfxQuality) b.classList.add('active');
      else b.classList.remove('active');
    }
  }

  function isMenuControl(el) {
    if (!el || !el.closest) return false;
    return !!(el.closest('input, select, textarea, button, label, a, .gfx-row, .diff-row, .opt-row, .menu-actions'));
  }

  function startDesktop() {
    A.ensure();
    A.startAmbient();
    if (NS.mic) NS.mic.start();
    el.canvas.requestPointerLock();
  }

  // ------------------------------------------------------------------
  // input
  // ------------------------------------------------------------------
  function bindInput() {
    window.addEventListener('keydown', function (e) {
      keys[e.code] = true;
      if (e.code === 'Enter') {
        if (state === 'BOOT') { finishBoot(); }
        else if (state === 'SETTINGS') {
          if (settingsReturn === 'boot') {
            state = 'BOOT'; showScreen('boot');
            if (el.bootCont) el.bootCont.style.display = 'block';
          } else {
            state = 'CONTROLS'; showScreen('controls');
          }
        }
        else if (state === 'CONTROLS') { startDesktop(); }
        else if (state === 'POST_TUTORIAL') { startEasyRaid(); }
        else if (state === 'DEAD' || state === 'LEFT') { showScreen('controls'); state = 'CONTROLS'; }
        else if (state === 'WIN') { state = 'BOOT'; startBootType(); }
        else if (clonePhase === 'CHOICE' && !inVR()) {
          confirmCloneChoice(cloneChoiceIdx === 0 ? 'RESCUE' : 'VIRUS');
        }
      }
      if (clonePhase === 'CHOICE' && !inVR()) {
        if (e.code === 'Digit1' || e.code === 'Numpad1' || e.code === 'ArrowUp') {
          cloneChoiceIdx = 0; updateCloneDesktopChoice();
        }
        if (e.code === 'Digit2' || e.code === 'Numpad2' || e.code === 'ArrowDown') {
          cloneChoiceIdx = 1; updateCloneDesktopChoice();
        }
      }
      if (e.code === 'KeyE' && state === 'PLAY') {
        if (e.repeat) return;
        if (CIR && CIR.isActive()) CIR.rotateSelected();
        else if (!cloneUiActive()) {
          // Virus plant uses hold-E; don't spam interact while uploading
          if (missionBranch === 'VIRUS' && !virusDone &&
              near(M.markers.G.x, M.markers.G.z, interactRange() + 0.8)) {
            return;
          }
          interact();
        }
      }
    });
    window.addEventListener('keyup', function (e) { keys[e.code] = false; });

    el.canvas.addEventListener('mousedown', function (e) {
      if (state !== 'PLAY') return;
      if (e.button === 0) trickleOn = true;
    });
    window.addEventListener('mouseup', function (e) {
      if (e.button === 0) trickleOn = false;
    });
    window.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    window.addEventListener('mousemove', function (e) {
      if (state !== 'PLAY' || document.pointerLockElement !== el.canvas) return;
      player.yaw += e.movementX * sens;
      player.pitch -= e.movementY * sens;
      player.pitch = math.clamp(player.pitch, -1.45, 1.45);
    });

    // Controls screen: only explicit buttons start — never click-anywhere
    el.controls.addEventListener('click', function (e) {
      if (isMenuControl(e.target)) return;
    });
    var btnDesktop = $('btn-start-desktop');
    if (btnDesktop) {
      btnDesktop.addEventListener('click', function (e) {
        e.stopPropagation();
        pendingTutorial = false;
        startDesktop();
      });
    }
    var btnTutorial = $('btn-tutorial');
    if (btnTutorial) {
      btnTutorial.addEventListener('click', function (e) {
        e.stopPropagation();
        startTutorial();
      });
    }
    var btnStartEasy = $('btn-start-easy');
    if (btnStartEasy) {
      btnStartEasy.addEventListener('click', function (e) {
        e.stopPropagation();
        if (state === 'POST_TUTORIAL') startEasyRaid();
      });
    }
    var btnPostTutMenu = $('btn-post-tut-menu');
    if (btnPostTutMenu) {
      btnPostTutMenu.addEventListener('click', function (e) {
        e.stopPropagation();
        state = 'CONTROLS';
        showScreen('controls');
      });
    }

    // Boot screen: ignore option controls; CONTINUE / Enter advances
    el.boot.addEventListener('click', function (e) {
      if (isMenuControl(e.target)) return;
    });
    var btnBoot = $('btn-boot-continue');
    if (btnBoot) {
      btnBoot.addEventListener('click', function (e) {
        e.stopPropagation();
        if (state === 'BOOT') finishBoot();
      });
    }

    el.death.addEventListener('click', function () {
      if (state === 'DEAD' || state === 'LEFT') {
        $('death-screen').querySelector('h1').textContent = 'CARRIER LOST';
        showScreen('controls'); state = 'CONTROLS';
      }
    });
    el.win.addEventListener('click', function () {
      if (state === 'WIN') { state = 'BOOT'; startBootType(); }
    });

    if (el.btnRescue) {
      el.btnRescue.addEventListener('click', function (e) {
        e.stopPropagation();
        if (clonePhase === 'CHOICE') confirmCloneChoice('RESCUE');
      });
    }
    if (el.btnVirus) {
      el.btnVirus.addEventListener('click', function (e) {
        e.stopPropagation();
        if (clonePhase === 'CHOICE') confirmCloneChoice('VIRUS');
      });
    }

    document.addEventListener('pointerlockchange', function () {
      var locked = document.pointerLockElement === el.canvas;
      if (locked && state === 'CONTROLS') {
        if (!runActive) startRun();
        state = 'PLAY';
        showScreen(null);
      } else if (!locked && state === 'PLAY') {
        if (cloneUiActive()) return; // choosing path — stay in PLAY
        if (tutorialMode) {
          endTutorial(false);
          return;
        }
        state = 'CONTROLS';
        trickleOn = false;
        showScreen('controls');
      }
    });

    window.addEventListener('resize', function () { R.resize(); });

    $('opt-sens').addEventListener('input', function (e) { sens = e.target.value * 0.000275; });
    $('opt-vol').addEventListener('input', function (e) { A.setVolume(e.target.value / 100); });
    $('opt-flash').addEventListener('change', function (e) { reducedFlash = e.target.checked; });

    function syncSmoothTurnUI(on) {
      var a = $('opt-smooth');
      if (a) a.checked = !!on;
    }
    function applySmoothTurn(on) {
      if (VR && VR.setSmoothTurn) VR.setSmoothTurn(on);
      syncSmoothTurnUI(on);
    }
    var smoothBoot = $('opt-smooth');
    if (smoothBoot) {
      smoothBoot.addEventListener('change', function (e) { applySmoothTurn(e.target.checked); });
    }
    applySmoothTurn(VR && VR.getSmoothTurn ? VR.getSmoothTurn() : false);

    var optVig = $('opt-comfort-vignette');
    var optSprint = $('opt-comfort-sprint');
    if (optVig) {
      optVig.addEventListener('change', function (e) {
        comfortVignette = e.target.checked;
        saveComfortFlag('hollow_comfort_vignette', comfortVignette);
        if (!comfortVignette) moveVignette = 0;
        applyComfort();
      });
    }
    if (optSprint) {
      optSprint.addEventListener('change', function (e) {
        comfortSlowSprint = e.target.checked;
        saveComfortFlag('hollow_comfort_sprint', comfortSlowSprint);
      });
    }

    function openSettings(from) {
      settingsReturn = from || 'controls';
      state = 'SETTINGS';
      showScreen('settings');
    }
    var btnSettingsBoot = $('btn-settings-boot');
    var btnSettingsCtrl = $('btn-settings-controls');
    var btnSettingsBack = $('btn-settings-back');
    if (btnSettingsBoot) {
      btnSettingsBoot.addEventListener('click', function (e) {
        e.stopPropagation();
        openSettings('boot');
      });
    }
    if (btnSettingsCtrl) {
      btnSettingsCtrl.addEventListener('click', function (e) {
        e.stopPropagation();
        openSettings('controls');
      });
    }
    if (btnSettingsBack) {
      btnSettingsBack.addEventListener('click', function (e) {
        e.stopPropagation();
        if (settingsReturn === 'boot') {
          state = 'BOOT';
          showScreen('boot');
          if (el.bootCont) el.bootCont.style.display = 'block';
        } else {
          state = 'CONTROLS';
          showScreen('controls');
        }
      });
    }
    if (el.settings) {
      el.settings.addEventListener('click', function (e) {
        if (isMenuControl(e.target)) return;
      });
    }

    var saved = 'medium';
    try { saved = localStorage.getItem('hollow_gfx') || 'medium'; } catch (err) { void err; }
    if (!GFX[saved]) saved = 'medium';
    applyGraphics(saved);
    syncGfxButtons();

    var savedDiff = 'medium';
    try { savedDiff = localStorage.getItem('hollow_difficulty') || 'medium'; } catch (err) { void err; }
    applyDifficulty(savedDiff);
    loadComfortSettings();

    var gfxButtons = document.querySelectorAll('.gfx-btn');
    for (var gi = 0; gi < gfxButtons.length; gi++) {
      gfxButtons[gi].addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var level = e.currentTarget.getAttribute('data-gfx');
        applyGraphics(level);
        syncGfxButtons();
      });
    }

    var diffButtons = document.querySelectorAll('.diff-btn');
    for (var di = 0; diffButtons && di < diffButtons.length; di++) {
      diffButtons[di].addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        applyDifficulty(e.currentTarget.getAttribute('data-diff'));
      });
    }
  }

  var settingsReturn = 'controls';

  function showScreen(name) {
    [el.boot, el.controls, el.settings, el.death, el.win, el.clone, el.postTutorial].forEach(function (s) {
      if (s) s.classList.remove('visible');
    });
    el.hud.style.display = (name === null) ? 'block' : 'none';
    if (name === 'boot') el.boot.classList.add('visible');
    if (name === 'controls') el.controls.classList.add('visible');
    if (name === 'settings' && el.settings) el.settings.classList.add('visible');
    if (name === 'death') el.death.classList.add('visible');
    if (name === 'win') el.win.classList.add('visible');
    if (name === 'clone' && el.clone) el.clone.classList.add('visible');
    if (name === 'post-tutorial' && el.postTutorial) el.postTutorial.classList.add('visible');
  }

  // ------------------------------------------------------------------
  // boot / screens
  // ------------------------------------------------------------------
  var bootInterval = null;
  function startBootType() {
    state = 'BOOT';
    showScreen('boot');
    el.bootCont.style.display = 'none';
    el.bootText.textContent = '';
    var li = 0, ci = 0;
    clearInterval(bootInterval);
    bootInterval = setInterval(function () {
      if (li >= BOOT_LINES.length) { finishBoot(); return; }
      var line = BOOT_LINES[li];
      if (ci <= line.length) {
        el.bootText.textContent =
          BOOT_LINES.slice(0, li).join('\n') + (li ? '\n' : '') + line.slice(0, ci);
        ci += 2;
        if (A && Math.random() < 0.3) A.teletype();
      } else { li++; ci = 0; }
    }, 16);
  }
  function finishBoot() {
    clearInterval(bootInterval);
    el.bootText.textContent = BOOT_LINES.join('\n');
    if (el.bootCont.style.display === 'none') {
      el.bootCont.style.display = 'block';
      return;
    }
    state = 'CONTROLS';
    showScreen('controls');
  }

  // ------------------------------------------------------------------
  // run lifecycle
  // ------------------------------------------------------------------
  var tutorialMode = false;
  var tutorialStation = 0; // 0 move, 1 key, 2 door, 3 circuit, 4 virus, 5 tripwire, 6 exfil
  var tutorialMoveDist = 0;
  var tutorialTripHit = false;
  var tutorialSecTimer = 0;
  var pendingTutorial = false;
  var pendingEasyRaid = false;
  var pendingPostTutorial = false; // show offer after VR session fully ends

  var TUTORIAL_STEPS = [
    {
      title: 'LEARN TO MOVE',
      lines: ['Walk the green harbor.', 'Hold left grip to sprint.', 'Hold trigger to scan the dark.'],
      buttons: ['LEFT STICK — move', 'LEFT GRIP — sprint', 'RIGHT TRIGGER — LiDAR scan'],
      msg: 'TUTORIAL: MOVE · SPRINT (GRIP) · SCAN (TRIGGER)'
    },
    {
      title: 'PICK UP THE KEY',
      lines: ['Leave the harbor into the next room.', 'Scan for the amber key orb.', 'Press A / X to pick it up.'],
      buttons: ['RIGHT TRIGGER — scan', 'A / X — interact / pick up', 'LEFT STICK — move'],
      msg: 'TUTORIAL: SCAN AMBER KEY · A/X TO PICK UP'
    },
    {
      title: 'OPEN THE BLAST DOOR',
      lines: ['Find the dark-blue blast door.', 'You need the key you just took.', 'Press A / X to unlock and open it.'],
      buttons: ['A / X — open door', 'RIGHT TRIGGER — scan door', 'WALK THROUGH — enter console room'],
      msg: 'TUTORIAL: A/X ON BLAST DOOR — ENTER CONSOLE ROOM'
    },
    {
      title: 'JACK INTO THE CONSOLE',
      lines: ['Stand at the amber console pyramid.', 'Press A / X to jack in.', 'Point laser + A/X to rotate tiles.'],
      buttons: ['A / X — jack in / rotate tile', 'POINT CONTROLLER — aim laser', 'CLEAR 1 BOARD TO CONTINUE'],
      msg: 'TUTORIAL: JACK IN · SOLVE 1 CIRCUIT BOARD'
    },
    {
      title: 'UPLOAD THE VIRUS',
      lines: ['Puzzle clear — return to the console.', 'Hold X to upload the virus.', 'Tripwire is armed at the entrance.'],
      buttons: ['HOLD X — upload virus', 'RIGHT TRIGGER — scan console', 'STAY QUIET — no sprint if close'],
      msg: 'TUTORIAL: HOLD X AT CONSOLE — UPLOAD VIRUS'
    },
    {
      title: 'TRIP THE YELLOW WIRE',
      lines: ['Cross the yellow tripwire on purpose.', 'Security will spawn in the harbor.', 'Then head for the yellow LZ.'],
      buttons: ['WALK THROUGH — yellow beam', 'RIGHT TRIGGER — scan beam', 'LEFT GRIP — sprint if needed'],
      msg: 'TUTORIAL: CROSS YELLOW TRIPWIRE — SECURITY SPAWNS'
    },
    {
      title: 'BOARD THE LZ',
      lines: ['Chopper is inbound.', 'Find the yellow floor pad south.', 'Stand on it when the bird arrives.'],
      buttons: ['FOLLOW YELLOW FLOOR — LZ', 'STAND ON PAD — extract', 'A / X — board if prompted'],
      msg: 'TUTORIAL: STAND ON YELLOW LZ — BOARD CHOPPER'
    }
  ];

  function doorKeysNeeded(door) {
    if (!door) return 1;
    if (door.keysRequired != null) return door.keysRequired;
    return door.console ? 3 : 1;
  }

  function clearCoachPanel() {
    if (R.setCoachPanel) R.setCoachPanel(null, null);
  }

  var lastVrBodyYaw = 0;
  var coachAnchor = null; // world-locked panel pose
  var coachReanchorAt = 0;
  var COACH_REANCHOR_S = 10;

  function panelYaw() {
    return inVR() ? lastVrBodyYaw : player.yaw;
  }

  function placeCoachAnchor() {
    var yaw = panelYaw();
    var sy = Math.sin(yaw), cy = Math.cos(yaw);
    var dist = 1.55;
    coachAnchor = {
      x: player.x + sy * dist,
      y: player.eye + 0.12,
      z: player.z - cy * dist,
      yaw: yaw,
      station: tutorialStation,
      px: player.x,
      pz: player.z
    };
    coachReanchorAt = now + COACH_REANCHOR_S;
  }

  function buildCoachModel() {
    if (!coachAnchor || coachAnchor.station !== tutorialStation) placeCoachAnchor();
    // Reappear at the player every 10s (and if they walk far away)
    var adx = player.x - coachAnchor.px, adz = player.z - coachAnchor.pz;
    if (now >= coachReanchorAt || adx * adx + adz * adz > 3.5 * 3.5) placeCoachAnchor();

    var yaw = coachAnchor.yaw;
    var sy = Math.sin(yaw), cy = Math.cos(yaw);
    var nx = -sy, ny = 0, nz = cy;
    var right = math.vnorm(math.vcross([0, 1, 0], [nx, ny, nz]));
    var up = math.vnorm(math.vcross([nx, ny, nz], right));
    var sx = 1.05, sy2 = 0.66;
    var m = new Float32Array(16);
    m[0] = right[0] * sx; m[1] = right[1] * sx; m[2] = right[2] * sx; m[3] = 0;
    m[4] = up[0] * sy2; m[5] = up[1] * sy2; m[6] = up[2] * sy2; m[7] = 0;
    m[8] = nx; m[9] = ny; m[10] = nz; m[11] = 0;
    m[12] = coachAnchor.x; m[13] = coachAnchor.y; m[14] = coachAnchor.z; m[15] = 1;
    return m;
  }

  function syncCoachPanel() {
    if (!R.setCoachPanel) return;
    if (!tutorialMode || state !== 'PLAY' || !inVR()) {
      clearCoachPanel();
      return;
    }
    if (CIR && CIR.isActive()) {
      clearCoachPanel();
      return;
    }
    var step = TUTORIAL_STEPS[tutorialStation];
    if (!step) {
      clearCoachPanel();
      return;
    }
    R.setCoachPanel({
      title: step.title,
      lines: step.lines,
      buttons: step.buttons,
      step: tutorialStation + 1,
      total: TUTORIAL_STEPS.length
    }, buildCoachModel());
  }

  function finishEndTutorial(success) {
    M.loadLayout('mission');
    if (success) {
      state = 'POST_TUTORIAL';
      showScreen('post-tutorial');
      queueMsg('TUTORIAL COMPLETE — START EASY RAID?', 'amber', 8);
    } else {
      state = 'CONTROLS';
      showScreen('controls');
    }
  }

  function endTutorial(success) {
    tutorialMode = false;
    pendingTutorial = false;
    runActive = false;
    clearCoachPanel();
    coachAnchor = null;
    if (CIR) CIR.close();
    if (R.setCircuitPanel) R.setCircuitPanel(null, null);
    if (A.sting) A.sting(false);
    if (A.chopperStop) A.chopperStop();
    document.exitPointerLock();
    // Immersive VR hides DOM — wait for session end before showing the offer
    if (VR && VR.active()) {
      pendingPostTutorial = !!success;
      VR.end();
      return;
    }
    finishEndTutorial(!!success);
  }

  function startEasyRaid() {
    applyDifficulty('easy');
    pendingTutorial = false;
    tutorialMode = false;
    pendingEasyRaid = true;
    A.ensure();
    A.startAmbient();
    if (VR && VR.enter && VR.supported && VR.supported()) {
      VR.enter().then(function (ok) {
        if (!ok) {
          pendingEasyRaid = false;
          startDesktop();
        }
      });
      return;
    }
    pendingEasyRaid = false;
    startDesktop();
  }

  function advanceTutorial(next) {
    tutorialStation = next;
    coachAnchor = null; // re-place coach for the new step
    if (tutorialStation >= TUTORIAL_STEPS.length) {
      endTutorial(true);
      return;
    }
    var step = TUTORIAL_STEPS[tutorialStation];
    queueMsg(step.msg || step.title, 'amber', 7);
    syncCoachPanel();
  }

  function updateTutorial(dt) {
    if (!tutorialMode || state !== 'PLAY') return;
    if (tutorialStation === 0) {
      if (tutorialMoveDist > 8) advanceTutorial(1);
    } else if (tutorialStation === 1) {
      if (keysCollected >= 1) advanceTutorial(2);
    } else if (tutorialStation === 2) {
      var d1 = M.markers.doors[0];
      if (d1 && !d1.locked) advanceTutorial(3);
    } else if (tutorialStation === 4) {
      if (virusDone) {
        advanceTutorial(5);
        startExfil();
      }
    } else if (tutorialStation === 5) {
      if (tutorialTripHit) advanceTutorial(6);
    }
  }

  function startTutorial() {
    pendingTutorial = true;
    A.ensure();
    A.startAmbient();
    if (NS.mic && NS.mic.setProfile) NS.mic.setProfile('off');
    // Prefer immersive VR when the headset path is available
    if (VR && VR.enter && VR.supported && VR.supported()) {
      VR.enter().then(function (ok) {
        if (!ok) el.canvas.requestPointerLock();
      });
      return;
    }
    el.canvas.requestPointerLock();
  }

  var runActive = false;
  function startRun() {
    runActive = true;
    if (A.stopAllTransient) A.stopAllTransient();
    if (CIR) CIR.close();
    R.clearPoints();

    if (pendingTutorial || tutorialMode) {
      tutorialMode = true;
      pendingTutorial = false;
      pendingEasyRaid = false;
      M.loadLayout('tutorial');
      EN.reset('tutorial');
      if (EN.setSuppressed) EN.setSuppressed(true);
    } else {
      tutorialMode = false;
      pendingEasyRaid = false;
      M.loadLayout('mission');
      EN.reset(currentDifficulty);
      if (NS.mic && NS.mic.setProfile) {
        if (currentDifficulty === 'easy') NS.mic.setProfile('off');
        else if (currentDifficulty === 'medium') NS.mic.setProfile('low');
        else NS.mic.setProfile('high');
      }
    }

    M.resetDoors();
    math.srand(0x1988 ^ (Date.now() & 0xffff));
    player.x = M.markers.P.x; player.z = M.markers.P.z;
    player.yaw = 0; player.pitch = 0; player.eye = EYE_STAND;
    accessKeys = M.markers.fuses.filter(Boolean).map(function (f) {
      return { x: f.x, z: f.z, taken: false };
    });
    keysCollected = 0; doorsOpen = 0;
    uplinkDone = false;
    jackInCooldownUntil = 0;
    exfilPhase = 'NONE'; exfilTimer = 0;
    missionBranch = 'NONE';
    clonePhase = 'NONE'; cloneTimer = 0; clonePct = 0; cloneChoiceIdx = 0;
    virusProgress = 0; virusDone = false; virusNoiseTimer = 0;
    virusHolding = false; virusWristActive = false;
    pow = null;
    trickleOn = false; auxLoud = 0; recentLoud = 0;
    stamina = STAMINA_MAX; staminaExhausted = false;
    floodLevel = 0; runTime = 0; deathCause = 'quiet';
    glitchLevel = 0; glitchPop = 0; popTimer = 5;
    laserCooldown = {};
    missionWarnAt = { m2: false, m1: false, s30: false };
    circuitPanelModel = null;
    msgQueue = []; curMsg = null;
    moveVignette = 0;
    tutorialMoveDist = 0;
    tutorialTripHit = false;
    tutorialSecTimer = 0;
    tutorialStation = 0;
    coachAnchor = null;
    applyComfort();
    if (tutorialMode) {
      var s0 = TUTORIAL_STEPS[0];
      queueMsg(s0.msg || s0.title, 'amber', 7);
      syncCoachPanel();
    } else {
      queueMsg('RD-9 RAID OVERLAY ACTIVE. BLACKOUT WINDOW: 10:00.', '');
    }
  }

  function onKill() {
    if (state !== 'PLAY') return;
    if (tutorialMode) {
      // Soft fail — respawn in harbor with a tip
      if (A.stopAllTransient) A.stopAllTransient();
      player.x = M.markers.P.x; player.z = M.markers.P.z;
      player.yaw = 0; player.pitch = 0;
      EN.reset('tutorial');
      // Respawn security in harbor if the tripwire already fired
      if (tutorialTripHit) spawnTutorialSecurityInHarbor();
      queueMsg('CAUGHT — RESPAWNED IN HARBOR. QUIETER NEXT TIME.', 'red', 4);
      return;
    }
    state = 'DYING';
    dieTimer = 0;
    A.death();
    // epitaph by how loud you were (GDD §2.2)
    if (recentLoud > 12) deathCause = 'loud';
    else if (recentLoud > 4) deathCause = 'steps';
    else deathCause = 'quiet';
  }

  function finishDeath() {
    runActive = false;
    state = 'DEAD';
    if (CIR) CIR.close();
    if (A.sting) A.sting(false);
    document.exitPointerLock();
    if (VR.active()) VR.end();
    if (tutorialMode) {
      tutorialMode = false;
      M.loadLayout('mission');
    }
    setTimeout(function () {
      if (state === 'DEAD' || state === 'CONTROLS' || state === 'BOOT' || state === 'LEFT') {
        if (A.stopAllTransient) A.stopAllTransient();
      }
    }, 4200);
    var lines = {
      loud: 'YOU LIT THE DARK. THE GRID ANSWERED.',
      steps: 'FOOTSTEPS GAVE YOU AWAY THREE HALLS OUT.',
      quiet: 'YOU WERE QUIET. IT STILL HEARD YOUR HEART.'
    };
    el.epitaph.textContent = lines[deathCause];
    showScreen('death');
  }

  function failLeftBehind() {
    if (tutorialMode) {
      // Soft retry — call another bird
      startExfil();
      queueMsg('CHOPPER LEFT — ANOTHER INBOUND. STAND ON THE YELLOW LZ.', 'red', 5);
      return;
    }
    runActive = false;
    state = 'LEFT';
    exfilPhase = 'GONE';
    if (CIR) CIR.close();
    if (A.sting) A.sting(false);
    if (A.chopperStop) A.chopperStop();
    document.exitPointerLock();
    if (VR.active()) VR.end();
    el.epitaph.textContent = 'CHOPPER DEPARTED. YOU WERE NOT ON THE PAD.';
    $('death-screen').querySelector('h1').textContent = 'LEFT BEHIND';
    showScreen('death');
    if (A.stopAllTransient) {
      setTimeout(function () { if (A.stopAllTransient) A.stopAllTransient(); }, 2500);
    }
  }

  function failPowerReturn() {
    if (state !== 'PLAY') return;
    runActive = false;
    state = 'LEFT';
    exfilPhase = 'GONE';
    clonePhase = 'DONE';
    if (CIR) CIR.close();
    if (A.sting) A.sting(false);
    if (A.chopperStop) A.chopperStop();
    if (A.securityAlarm) A.securityAlarm();
    document.exitPointerLock();
    if (VR.active()) VR.end();
    el.epitaph.textContent = 'SITE POWER RESTORED. BLACKOUT ENDED. YOU ARE EXPOSED.';
    $('death-screen').querySelector('h1').textContent = 'POWER ONLINE';
    showScreen('death');
    if (A.stopAllTransient) {
      setTimeout(function () { if (A.stopAllTransient) A.stopAllTransient(); }, 2500);
    }
  }

  function missionTimeLeft() {
    return Math.max(0, MISSION_TIME_S - runTime);
  }

  function updateMissionClock(dt) {
    if (tutorialMode) return;
    if (state !== 'PLAY' || !runActive) return;
    var left = missionTimeLeft();
    if (left <= 0) {
      failPowerReturn();
      return;
    }
    if (!missionWarnAt.m2 && left <= 120) {
      missionWarnAt.m2 = true;
      queueMsg('POWER RETURN T-2:00 — MOVE', 'amber', 4);
    } else if (!missionWarnAt.m1 && left <= 60) {
      missionWarnAt.m1 = true;
      queueMsg('POWER RETURN T-1:00', 'red', 4);
    } else if (!missionWarnAt.s30 && left <= 30) {
      missionWarnAt.s30 = true;
      queueMsg('POWER RETURN T-0:30 — FINAL', 'red', 3);
    }
  }

  function winGame(ending) {
    runActive = false;
    state = 'WIN';
    clonePhase = 'DONE';
    if (CIR) CIR.close();
    if (R.setCircuitPanel) R.setCircuitPanel(null, null);
    if (A.chopperStop) A.chopperStop();
    document.exitPointerLock();
    if (VR.active()) VR.end();
    var lines = ending === 'VIRUS' ? WIN_LINES_VIRUS : WIN_LINES_RESCUE;
    el.winText.textContent = lines.join('\n');
    showScreen('win');
    A.sting(false);
  }

  function cloneUiActive() {
    return clonePhase === 'CLONING' || clonePhase === 'CHOICE';
  }

  function ensureCloneCanvas() {
    if (cloneCanvas) return;
    cloneCanvas = document.createElement('canvas');
    cloneCanvas.width = 640;
    cloneCanvas.height = 420;
    cloneCtx = cloneCanvas.getContext('2d');
  }

  function drawClonePanel() {
    ensureCloneCanvas();
    var ctx = cloneCtx;
    var w = cloneCanvas.width, h = cloneCanvas.height;
    ctx.fillStyle = 'rgba(0,10,6,0.96)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#7cff9b';
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.fillStyle = '#7cff9b';
    ctx.font = '16px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('CORE UPLINK', w / 2, 42);
    if (clonePhase === 'CLONING') {
      ctx.fillStyle = '#cfe';
      ctx.font = '18px monospace';
      ctx.fillText('CLONING AI ONTO HARD DRIVE…', w / 2, 120);
      var barW = 420, barH = 18, bx = (w - barW) / 2, by = 160;
      ctx.strokeStyle = '#7cff9b';
      ctx.strokeRect(bx, by, barW, barH);
      ctx.fillStyle = '#3dff8a';
      ctx.fillRect(bx + 2, by + 2, Math.max(0, (barW - 4) * (clonePct / 100)), barH - 4);
      ctx.fillStyle = '#7cff9b';
      ctx.font = '22px monospace';
      ctx.fillText(Math.floor(clonePct) + '%', w / 2, 220);
    } else if (clonePhase === 'CHOICE') {
      ctx.fillStyle = '#b8e0c8';
      ctx.font = '13px monospace';
      ctx.textAlign = 'left';
      var lines = CLONE_INTEL.split('\n');
      var y = 70;
      for (var i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], 36, y);
        y += 18;
      }
      var opts = ['RESCUE POW — ESCORT TO LZ', 'PLANT VIRUS — CORRUPT LOCAL AI'];
      for (i = 0; i < opts.length; i++) {
        var selected = cloneChoiceIdx === i;
        ctx.fillStyle = selected ? 'rgba(124,255,155,0.25)' : 'rgba(0,0,0,0.35)';
        ctx.fillRect(40, 290 + i * 48, w - 80, 40);
        ctx.strokeStyle = selected ? '#7cff9b' : '#355';
        ctx.strokeRect(40, 290 + i * 48, w - 80, 40);
        ctx.fillStyle = selected ? '#7cff9b' : '#8aa';
        ctx.font = '15px monospace';
        ctx.textAlign = 'center';
        ctx.fillText((selected ? '> ' : '  ') + opts[i], w / 2, 316 + i * 48);
      }
      ctx.fillStyle = '#6a8';
      ctx.font = '12px monospace';
      ctx.fillText('STICK SELECT · A / X CONFIRM', w / 2, 400);
    }
  }

  function syncClonePanel() {
    if (!R.setCircuitPanel) return;
    if (cloneUiActive() && inVR()) {
      drawClonePanel();
      R.setCircuitPanel(cloneCanvas, buildCircuitModel());
    } else if (!(CIR && CIR.isActive() && inVR())) {
      // leave circuit panel alone when circuit owns it
      if (!CIR || !CIR.isActive()) R.setCircuitPanel(null, null);
    }
  }

  function updateCloneDesktopChoice() {
    if (!el.btnRescue || !el.btnVirus) return;
    if (cloneChoiceIdx === 0) {
      el.btnRescue.classList.add('primary');
      el.btnVirus.classList.remove('primary');
    } else {
      el.btnVirus.classList.add('primary');
      el.btnRescue.classList.remove('primary');
    }
  }

  function beginCloneSequence() {
    uplinkDone = true;
    clonePhase = 'CLONING';
    cloneTimer = 0;
    clonePct = 0;
    cloneChoiceIdx = 0;
    if (A.uplinkSurge) A.uplinkSurge();
    else if (A.generatorRoar) A.generatorRoar();
    queueMsg('CLONE SEQUENCE — WRITING MODEL TO DRIVE', 'amber', 3);
    if (!inVR()) {
      document.exitPointerLock();
      if (el.cloneChoice) el.cloneChoice.style.display = 'none';
      if (el.cloneStatus) el.cloneStatus.textContent = 'CLONING AI ONTO HARD DRIVE…';
      if (el.cloneFill) el.cloneFill.style.width = '0%';
      if (el.clonePct) el.clonePct.textContent = '0%';
      showScreen('clone');
    }
  }

  function enterCloneChoice() {
    clonePhase = 'CHOICE';
    clonePct = 100;
    if (!inVR()) {
      if (el.cloneStatus) el.cloneStatus.textContent = 'CLONE COMPLETE';
      if (el.cloneFill) el.cloneFill.style.width = '100%';
      if (el.clonePct) el.clonePct.textContent = '100%';
      if (el.cloneIntel) el.cloneIntel.textContent = CLONE_INTEL;
      if (el.cloneChoice) el.cloneChoice.style.display = 'block';
      updateCloneDesktopChoice();
      showScreen('clone');
    }
    queueMsg('FLASH TRAFFIC — POW INTEL · CHOOSE PATH', 'amber', 4);
  }

  function confirmCloneChoice(branch) {
    if (clonePhase !== 'CHOICE') return;
    if (branch !== 'RESCUE' && branch !== 'VIRUS') return;
    missionBranch = branch;
    clonePhase = 'DONE';
    if (branch === 'RESCUE') {
      // Spawn at map W — pillar room north of infil (not marked on print sheet)
      if (!M.markers.W) {
        throw new Error('HOLLOW: POW marker W missing from map');
      }
      pow = {
        x: M.markers.W.x,
        z: M.markers.W.z,
        freed: false,
        path: null,
        pathIdx: 0,
        repath: 0
      };
    } else {
      pow = null;
      virusProgress = 0;
      virusDone = false;
    }
    if (el.clone) el.clone.classList.remove('visible');
    showScreen(null);
    if (R.setCircuitPanel) R.setCircuitPanel(null, null);
    startExfil();
    if (!inVR()) {
      try { el.canvas.requestPointerLock(); } catch (err) { void err; }
    }
  }

  function updateCloneSequence(dt, vrInput) {
    if (clonePhase === 'CLONING') {
      cloneTimer += dt;
      clonePct = Math.min(100, (cloneTimer / CLONE_DURATION_S) * 100);
      if (!inVR()) {
        if (el.cloneFill) el.cloneFill.style.width = clonePct + '%';
        if (el.clonePct) el.clonePct.textContent = Math.floor(clonePct) + '%';
      }
      if (cloneTimer >= CLONE_DURATION_S) enterCloneChoice();
    } else if (clonePhase === 'CHOICE' && vrInput) {
      if (vrInput.navY < 0 || vrInput.navX < 0) cloneChoiceIdx = 0;
      if (vrInput.navY > 0 || vrInput.navX > 0) cloneChoiceIdx = 1;
      if (vrInput.interactPressed || vrInput.tricklePressed) {
        confirmCloneChoice(cloneChoiceIdx === 0 ? 'RESCUE' : 'VIRUS');
      }
    }
    if (cloneUiActive() && inVR()) syncClonePanel();
  }

  function startExfil() {
    exfilPhase = 'INBOUND';
    exfilTimer = tutorialMode ? 12 : CHOPPER_INBOUND_S;
    if (A.chopperInbound) A.chopperInbound();
    if (tutorialMode) {
      queueMsg('CHOPPER INBOUND — MOVE TO THE YELLOW LZ', 'amber', 5);
      return;
    }
    if (missionBranch === 'RESCUE') {
      // Rescue path draws heat immediately
      EN.state.agitation = 100;
      EN.hear(M.markers.G.x, M.markers.G.z, NOISE_UPLINK, now, true);
      EN.forceChase(now);
      queueMsg('RESCUE PATH — ASK MAP GUIDE FOR POW COORDS', 'amber', 5);
    } else {
      // Virus path: stay quiet until plant completes — no security surge on choose
      EN.addAgitationFloor(8);
      queueMsg('VIRUS PATH — PLANT AT CONSOLE THEN EXTRACT', 'amber', 5);
    }
  }

  function armTutorialTripwire() {
    var cell = M.CELL || 3;
    var IN = 0.08, TY = 0.22, TH = 0.03;
    // Vertical beam in the hallway entrance into the 3rd room (door at col 15)
    M.markers.lasers = [
      {
        x0: 15.5 * cell, z0: 1 * cell + IN,
        x1: 15.5 * cell, z1: 4 * cell - IN,
        y0: TY - TH, y1: TY + TH,
        id: 'L-TRAIN'
      }
    ];
  }

  function spawnTutorialSecurityInHarbor() {
    var cell = M.CELL || 3;
    // First room (harbor) — west side, clear of the door
    var hx = 2.5 * cell;
    var hz = 2.5 * cell;
    if (EN.spawnTutorial) EN.spawnTutorial(hx, hz);
    else if (EN.setSuppressed) EN.setSuppressed(false);
    EN.forceInvestigate(player.x, player.z, 1);
  }

  function onCircuitStageClear(clearedStage, total) {
    if (tutorialMode) {
      if (CIR) CIR.close();
      if (R.setCircuitPanel) R.setCircuitPanel(null, null);
      // Arm tripwire + unlock virus path — virus is next (not gated on the wire)
      uplinkDone = true;
      missionBranch = 'VIRUS';
      virusProgress = 0;
      virusDone = false;
      virusHolding = false;
      virusWristActive = false;
      tutorialTripHit = false;
      armTutorialTripwire();
      queueMsg('CIRCUIT CLEAR — UPLOAD VIRUS AT CONSOLE', 'amber', 4);
      advanceTutorial(4);
      return;
    }
    queueMsg('MATRIX STAGE ' + clearedStage + '/' + total + ' CLEAR — NEXT BOARD', 'amber', 3);
  }

  function onCircuitTimeout() {
    if (tutorialMode) {
      jackInCooldownUntil = now + JACKIN_RETRY_S;
      queueMsg('LOCKOUT — TRY AGAIN. ROTATE TILES TO MATCH YOUR SOLVER.', 'amber', 4);
      return;
    }
    jackInCooldownUntil = now + JACKIN_RETRY_S;
    queueMsg('ROUTING LOCKOUT — RETRY IN ' + JACKIN_RETRY_S + 's · SECURITY RUSHING', 'red', 4);
    A.securityAlarm();
    // Loud trip at the core — nearest two rush the console room
    EN.hear(M.markers.G.x, M.markers.G.z, NOISE_LASER, now, true);
    EN.forceInvestigate(M.markers.G.x, M.markers.G.z, 2);
    EN.addAgitationFloor(25);
  }

  function onJackInSuccess() {
    if (tutorialMode) {
      if (CIR) CIR.close();
      if (R.setCircuitPanel) R.setCircuitPanel(null, null);
      uplinkDone = true;
      missionBranch = 'VIRUS';
      virusProgress = 0;
      virusDone = false;
      tutorialTripHit = false;
      armTutorialTripwire();
      queueMsg('CIRCUIT CLEAR — UPLOAD VIRUS AT CONSOLE', 'amber', 4);
      advanceTutorial(4);
      return;
    }
    beginCloneSequence();
  }

  // ------------------------------------------------------------------
  // noise
  // ------------------------------------------------------------------
  function emitNoise(loud) {
    EN.hear(player.x, player.z, loud, now, true);
    recentLoud = Math.max(recentLoud, loud);
    auxLoud = Math.max(auxLoud, loud / NOISE_BURST);
  }

  // ------------------------------------------------------------------
  // scanning
  // ------------------------------------------------------------------
  function raySphere(ox, oy, oz, dx, dy, dz, s) {
    var lx = s.x - ox, ly = s.y - oy, lz = s.z - oz;
    var tca = lx * dx + ly * dy + lz * dz;
    if (tca < 0) return -1;
    var d2 = lx * lx + ly * ly + lz * lz - tca * tca;
    var r2 = s.r * s.r;
    if (d2 > r2) return -1;
    return tca - Math.sqrt(r2 - d2);
  }

  // Ray vs triangle (Möller–Trumbore). Returns t or -1.
  function rayTri(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, cx, cy, cz) {
    var e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    var e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    var px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    var det = e1x * px + e1y * py + e1z * pz;
    if (det > -1e-8 && det < 1e-8) return -1;
    var inv = 1 / det;
    var tx = ox - ax, ty = oy - ay, tz = oz - az;
    var u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) return -1;
    var qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    var v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) return -1;
    var t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return t > 1e-4 ? t : -1;
  }

  // Jack-in console as a square pyramid (apex up). Returns hit distance or -1.
  function rayConsolePyramid(ox, oy, oz, dx, dy, dz) {
    var gx = M.markers.G.x, gz = M.markers.G.z;
    var apexY = 1.85, baseY = 0.35, half = 0.62;
    var ax = gx, ay = apexY, az = gz;
    var b0x = gx - half, b0y = baseY, b0z = gz - half;
    var b1x = gx + half, b1y = baseY, b1z = gz - half;
    var b2x = gx + half, b2y = baseY, b2z = gz + half;
    var b3x = gx - half, b3y = baseY, b3z = gz + half;
    var best = -1, t;
    t = rayTri(ox, oy, oz, dx, dy, dz, ax, ay, az, b0x, b0y, b0z, b1x, b1y, b1z);
    if (t > 0 && (best < 0 || t < best)) best = t;
    t = rayTri(ox, oy, oz, dx, dy, dz, ax, ay, az, b1x, b1y, b1z, b2x, b2y, b2z);
    if (t > 0 && (best < 0 || t < best)) best = t;
    t = rayTri(ox, oy, oz, dx, dy, dz, ax, ay, az, b2x, b2y, b2z, b3x, b3y, b3z);
    if (t > 0 && (best < 0 || t < best)) best = t;
    t = rayTri(ox, oy, oz, dx, dy, dz, ax, ay, az, b3x, b3y, b3z, b0x, b0y, b0z);
    if (t > 0 && (best < 0 || t < best)) best = t;
    // base (optional underside)
    t = rayTri(ox, oy, oz, dx, dy, dz, b0x, b0y, b0z, b2x, b2y, b2z, b1x, b1y, b1z);
    if (t > 0 && (best < 0 || t < best)) best = t;
    t = rayTri(ox, oy, oz, dx, dy, dz, b0x, b0y, b0z, b3x, b3y, b3z, b2x, b2y, b2z);
    if (t > 0 && (best < 0 || t < best)) best = t;
    return best;
  }

  function castScanRay(dx, dy, dz) {
    var ox = vrScanOrigin ? vrScanOrigin.x : player.x;
    var oy = vrScanOrigin ? vrScanOrigin.y : player.eye;
    var oz = vrScanOrigin ? vrScanOrigin.z : player.z;
    var hit = M.raycast(ox, oy, oz, dx, dy, dz, SCAN_RANGE);
    var bestT = hit ? hit.t : SCAN_RANGE + 1;
    var color = null, life = POINT_LIFE;
    if (hit) {
      if (hit.type === 'door') color = C_DOOR;
      else if (hit.type === 'floor' && M.isLzAt && M.isLzAt(hit.x, hit.z)) color = C_LZ;
      else if (hit.type === 'floor' && M.isSafeAt(hit.x, hit.z)) color = C_HARBOR;
      else color = hit.type === 'floor' ? C_FLOOR : (hit.type === 'ceil' ? C_CEIL : C_WALL);
    }

    // yellow laser beams
    var lt = M.rayLaser(ox, oy, oz, dx, dy, dz, SCAN_RANGE);
    if (lt > 0 && lt < bestT) {
      bestT = lt; color = C_YELLOW; life = 8;
    }

    // the Custodian — red returns, fast decay (absent until tutorial tripwire)
    var sph = (tutorialMode && !tutorialTripHit) ? [] : EN.spheres();
    for (var i = 0; i < sph.length; i++) {
      var t = raySphere(ox, oy, oz, dx, dy, dz, sph[i]);
      if (t > 0 && t < bestT) { bestT = t; color = C_RED; life = ENEMY_POINT_LIFE; }
    }
    // POW — dark green returns (same treatment as security)
    var ps = powSpheres();
    for (i = 0; i < ps.length; i++) {
      t = raySphere(ox, oy, oz, dx, dy, dz, ps[i]);
      if (t > 0 && t < bestT) { bestT = t; color = C_POW; life = ENEMY_POINT_LIFE; }
    }
    // items — access keys only (no memo/message orbs)
    for (i = 0; i < accessKeys.length; i++) {
      if (accessKeys[i].taken) continue;
      t = raySphere(ox, oy, oz, dx, dy, dz, { x: accessKeys[i].x, y: 0.9, z: accessKeys[i].z, r: 0.45 });
      if (t > 0 && t < bestT) { bestT = t; color = C_AMBER; life = POINT_LIFE; }
    }
    // locked blast doors — dark blue slab (also fills gaps if ray grazes)
    for (i = 0; i < M.markers.doors.length; i++) {
      var door = M.markers.doors[i];
      if (!door.locked) continue;
      t = raySphere(ox, oy, oz, dx, dy, dz, { x: door.x, y: 1.3, z: door.z, r: 1.15 });
      if (t > 0 && t < bestT) { bestT = t; color = C_DOOR; life = POINT_LIFE; }
    }
    // console pyramid visible for jack-in and virus plant
    if (!uplinkDone || (missionBranch === 'VIRUS' && !virusDone)) {
      t = rayConsolePyramid(ox, oy, oz, dx, dy, dz);
      if (t > 0 && t < bestT) { bestT = t; color = C_AMBER; life = POINT_LIFE; }
    }

    if (color === null || bestT > SCAN_RANGE) return;
    var j = 0.02; // sensor jitter (GDD §8.2)
    R.addPoint(
      ox + dx * bestT + (math.rand() - 0.5) * j,
      oy + dy * bestT + (math.rand() - 0.5) * j,
      oz + dz * bestT + (math.rand() - 0.5) * j,
      color[0], color[1], color[2], now, life
    );
  }

  function coneRay(fwd) {
    // random direction inside cone around fwd
    var theta = TRICKLE_CONE * Math.sqrt(math.rand());
    var phi = math.rand() * Math.PI * 2;
    // basis
    var up = Math.abs(fwd[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
    var rt = math.vnorm(math.vcross(fwd, up));
    var u2 = math.vcross(rt, fwd);
    var st = Math.sin(theta), ct = Math.cos(theta);
    var cp = Math.cos(phi), sp = Math.sin(phi);
    return [
      fwd[0] * ct + (rt[0] * cp + u2[0] * sp) * st,
      fwd[1] * ct + (rt[1] * cp + u2[1] * sp) * st,
      fwd[2] * ct + (rt[2] * cp + u2[2] * sp) * st
    ];
  }

  function updateScanner(dt) {
    // trickle
    if (trickleOn) {
      var fwd = vrScanDirection || math.dirFromYawPitch(player.yaw, player.pitch);
      for (var i = 0; i < TRICKLE_RAYS; i++) {
        var d = coneRay(fwd);
        castScanRay(d[0], d[1], d[2]);
      }
      A.scanTick();
      trickleNoiseTimer -= dt;
      if (trickleNoiseTimer <= 0) {
        trickleNoiseTimer = 0.25;
        emitNoise(NOISE_TRICKLE);
      }
    }
  }

  // ------------------------------------------------------------------
  // interaction & objectives
  // ------------------------------------------------------------------
  function inVR() { return VR && VR.active(); }

  function interactRange() { return inVR() ? INTERACT_RANGE_VR : INTERACT_RANGE; }

  function near(x, z, range) {
    var dx = x - player.x, dz = z - player.z;
    return dx * dx + dz * dz < range * range;
  }

  // Rotate vector by quaternion (x,y,z,w)
  function quatMulVec(qx, qy, qz, qw, x, y, z) {
    var ix = qw * x + qy * z - qz * y;
    var iy = qw * y + qz * x - qx * z;
    var iz = qw * z + qx * y - qy * x;
    var iw = -qx * x - qy * y - qz * z;
    return [
      ix * qw + iw * -qx + iy * -qz - iz * -qy,
      iy * qw + iw * -qy + iz * -qx - ix * -qz,
      iz * qw + iw * -qz + ix * -qy - iy * -qx
    ];
  }

  // Pip-Boy panel fixed to left controller orientation (raise wrist to read).
  function buildWristModel(wrist, bodyYaw) {
    var c = Math.cos(bodyYaw || 0), s = Math.sin(bodyYaw || 0);
    var gx, gy, gz, qx, qy, qz, qw;
    if (wrist) {
      gx = player.x + c * wrist.localX - s * wrist.localZ;
      gy = (VR && VR.worldYFromXR) ? VR.worldYFromXR(wrist.y) : wrist.y;
      gz = player.z + s * wrist.localX + c * wrist.localZ;
      qx = wrist.qx; qy = wrist.qy; qz = wrist.qz; qw = wrist.qw;
    } else {
      // Fallback if grip pose drops: left-front torso, upright
      gx = player.x - c * 0.22 - s * 0.18;
      gy = player.eye - 0.25;
      gz = player.z + s * 0.22 - c * 0.18;
      qx = 0; qy = 0; qz = 0; qw = 1;
    }

    function axis(lx, ly, lz) {
      var v = quatMulVec(qx, qy, qz, qw, lx, ly, lz);
      return [c * v[0] - s * v[2], v[1], s * v[0] + c * v[2]];
    }

    var right = math.vnorm(axis(1, 0, 0));
    var up0 = axis(0, 1, 0);
    var fwd = axis(0, 0, -1);
    // tilt panel toward the eyes (~55°)
    var tilt = 0.96;
    var ct = Math.cos(tilt), st = Math.sin(tilt);
    var up = math.vnorm([
      up0[0] * ct + fwd[0] * st,
      up0[1] * ct + fwd[1] * st,
      up0[2] * ct + fwd[2] * st
    ]);
    var normal = math.vnorm(math.vcross(right, up));
    right = math.vnorm(math.vcross(up, normal));

    // sit on top/inner face of left controller
    var off = axis(0.0, 0.045, 0.055);
    var px = gx + off[0], py = gy + off[1], pz = gz + off[2];

    var sx = 0.22, sy = 0.14;
    var m = new Float32Array(16);
    m[0] = right[0] * sx; m[1] = right[1] * sx; m[2] = right[2] * sx; m[3] = 0;
    m[4] = up[0] * sy; m[5] = up[1] * sy; m[6] = up[2] * sy; m[7] = 0;
    m[8] = normal[0]; m[9] = normal[1]; m[10] = normal[2]; m[11] = 0;
    m[12] = px; m[13] = py; m[14] = pz; m[15] = 1;
    return m;
  }

  // Closest key/door in front of the controller ray (VR-friendly pickup)
  function vrAimPick() {
    if (!vrScanDirection) return null;
    var ox = player.x, oz = player.z;
    var dx = vrScanDirection[0], dz = vrScanDirection[2];
    var fl = Math.sqrt(dx * dx + dz * dz);
    if (fl < 0.01) return null;
    dx /= fl; dz /= fl;
    var best = null, bestDot = VR_AIM_DOT;
    var i, tfx, tfz, dist, dot;
    for (i = 0; i < accessKeys.length; i++) {
      if (accessKeys[i].taken) continue;
      tfx = accessKeys[i].x - ox; tfz = accessKeys[i].z - oz;
      dist = Math.sqrt(tfx * tfx + tfz * tfz);
      if (dist > VR_AIM_MAX) continue;
      dot = (tfx * dx + tfz * dz) / dist;
      if (dot >= bestDot) { bestDot = dot; best = { kind: 'key', i: i, dist: dist }; }
    }
    for (i = 0; i < M.markers.doors.length; i++) {
      if (!M.markers.doors[i].locked) continue;
      tfx = M.markers.doors[i].x - ox; tfz = M.markers.doors[i].z - oz;
      dist = Math.sqrt(tfx * tfx + tfz * tfz);
      if (dist > VR_AIM_MAX) continue;
      dot = (tfx * dx + tfz * dz) / dist;
      if (dot >= bestDot) { bestDot = dot; best = { kind: 'door', i: i, dist: dist }; }
    }
    if ((!uplinkDone || (missionBranch === 'VIRUS' && !virusDone)) && M.markers.G) {
      tfx = M.markers.G.x - ox; tfz = M.markers.G.z - oz;
      dist = Math.sqrt(tfx * tfx + tfz * tfz);
      if (dist <= VR_AIM_MAX + 1.5) {
        dot = dist > 0.01 ? (tfx * dx + tfz * dz) / dist : 1;
        if (dot >= bestDot) {
          bestDot = dot;
          best = { kind: 'console', dist: dist };
        }
      }
    }
    if (missionBranch === 'RESCUE' && pow && !pow.freed) {
      tfx = pow.x - ox; tfz = pow.z - oz;
      dist = Math.sqrt(tfx * tfx + tfz * tfz);
      if (dist <= VR_AIM_MAX + 0.5) {
        dot = dist > 0.01 ? (tfx * dx + tfz * dz) / dist : 1;
        if (dot >= bestDot) {
          best = { kind: 'pow', dist: dist };
        }
      }
    }
    return best;
  }

  function takeKey(i) {
    if (accessKeys[i].taken) return;
    accessKeys[i].taken = true;
    keysCollected++;
    EN.addAgitationFloor(15);
    A.fuseChime();
    emitNoise(NOISE_INTERACT);
    if (R.expirePointsNear) R.expirePointsNear(accessKeys[i].x, accessKeys[i].z, 1.6, now);
    queueMsg(tutorialMode
      ? 'ACCESS KEY RECOVERED — OPEN THE NEXT DOOR'
      : 'ACCESS KEY RECOVERED ' + keysCollected + '/3', 'amber');
  }

  function tryJackIn() {
    if (cloneUiActive()) return;
    if (missionBranch === 'VIRUS') {
      if (virusDone) {
        pushMsg('VIRUS ARMED — ASK MAP GUIDE FOR LZ', 'amber');
      } else {
        pushMsg(inVR()
          ? 'HOLD X AT CONSOLE — WRISTLINK UPLOAD'
          : 'HOLD X / E AT CONSOLE — UPLOAD VIRUS', 'amber');
      }
      return;
    }
    if (missionBranch === 'RESCUE') {
      pushMsg(pow && pow.freed
        ? 'PATH LOCKED — ESCORT POW TO LZ'
        : 'PATH LOCKED — FREE THE POW (GREEN ON LiDAR SCAN)', 'amber');
      return;
    }
    if (uplinkDone) {
      pushMsg('CLONE ALREADY ON DRIVE — AWAIT PATH CHOICE', 'amber');
      return;
    }
    if (M.isConsoleSealed()) {
      pushMsg('CONSOLE SEALED — OPEN CONSOLE DOOR (NEEDS 3 KEYS)', 'red');
      return;
    }
    if (CIR && CIR.isActive()) return;
    if (now < jackInCooldownUntil) {
      var wait = Math.ceil(jackInCooldownUntil - now);
      pushMsg('CORE LOCKED OUT — RETRY IN ' + wait + 's', 'amber');
      return;
    }
    pushMsg(inVR()
      ? (tutorialMode
        ? 'PRACTICE JACK-IN — 1 BOARD · POINT LASER / A ROTATE'
        : 'JACK-IN — 3 BOARDS · 60s EACH · POINT LASER / A ROTATE')
      : (tutorialMode
        ? 'PRACTICE JACK-IN — CLEAR ONE BOARD'
        : 'JACK-IN SEQUENCE — THREE ROUTING MATRICES'), 'amber');
    CIR.open(onJackInSuccess, onCircuitTimeout, onCircuitStageClear);
  }

  function powSpheres() {
    if (!pow || missionBranch !== 'RESCUE') return [];
    var bx = pow.x, bz = pow.z;
    var crouch = !pow.freed;
    if (crouch) {
      return [
        { x: bx, y: 0.32, z: bz, r: 0.30 },
        { x: bx, y: 0.72, z: bz, r: 0.24 },
        { x: bx + 0.12, y: 0.95, z: bz, r: 0.16 }
      ];
    }
    return [
      { x: bx, y: 0.45, z: bz, r: 0.28 },
      { x: bx, y: 1.05, z: bz, r: 0.24 },
      { x: bx, y: 1.55, z: bz, r: 0.18 },
      { x: bx, y: 1.85, z: bz, r: 0.14 }
    ];
  }

  function tryFreePow() {
    if (missionBranch !== 'RESCUE' || !pow || pow.freed) return false;
    var range = interactRange();
    if (!near(pow.x, pow.z, range + 0.4)) return false;
    pow.freed = true;
    emitNoise(NOISE_INTERACT * 0.7);
    if (A.fuseChime) A.fuseChime();
    pushMsg('POW FREED — GREEN ON LiDAR SCAN · ESCORT TO LZ', 'amber', 4);
    return true;
  }

  function tryBoardLz(fromInteract) {
    if (exfilPhase !== 'ON_STATION') return false;
    if (!near(M.markers.X.x, M.markers.X.z, LZ_RADIUS)) return false;
    if (tutorialMode) {
      endTutorial(true);
      return true;
    }
    if (missionBranch === 'RESCUE') {
      if (!pow || !pow.freed) {
        if (fromInteract) pushMsg('POW STILL HELD — FREE THEM FIRST', 'red');
        return false;
      }
      var pd = Math.hypot(pow.x - M.markers.X.x, pow.z - M.markers.X.z);
      if (pd > LZ_RADIUS + 0.8) {
        if (fromInteract) pushMsg('POW NOT ON PAD — BRING THEM IN', 'amber');
        return false;
      }
      winGame('RESCUE');
      return true;
    }
    if (missionBranch === 'VIRUS') {
      if (!virusDone) {
        if (fromInteract) pushMsg('VIRUS INCOMPLETE — RETURN TO CONSOLE', 'red');
        return false;
      }
      winGame('VIRUS');
      return true;
    }
    return false;
  }

  function updateVirusPlant(dt, vrInput) {
    virusHolding = false;
    virusWristActive = false;
    if (missionBranch !== 'VIRUS' || virusDone) return;
    var atConsole = near(M.markers.G.x, M.markers.G.z, interactRange() + 0.8);
    if (!atConsole) return;
    virusWristActive = true;
    var holding = vrInput
      ? !!vrInput.holdUpload
      : !!(keys['KeyX'] || keys['KeyE']);
    if (!holding) return;
    virusHolding = true;
    virusProgress = Math.min(1, virusProgress + dt / VIRUS_DURATION_S);
    // Soft plant noise only — no loud uplink surge while uploading
    virusNoiseTimer -= dt;
    if (virusNoiseTimer <= 0) {
      virusNoiseTimer = 0.85;
      emitNoise(NOISE_VIRUS * 0.22);
    }
    if (virusProgress >= 1) {
      virusDone = true;
      virusProgress = 1;
      virusHolding = false;
      virusWristActive = false;
      if (tutorialMode) {
        pushMsg('VIRUS PLANTED — CROSS THE YELLOW WIRE, THEN LZ', 'amber', 4);
        return;
      }
      // Quiet plant — no alarm sting; security drifts toward the LZ
      if (M.markers.X && EN.convergeOn) {
        EN.convergeOn(M.markers.X.x, M.markers.X.z);
      } else {
        EN.addAgitationFloor(15);
      }
      pushMsg('VIRUS PLANTED — MOVE TO LZ', 'amber', 4);
    }
  }

  function updatePow(dt) {
    if (!pow || missionBranch !== 'RESCUE' || !pow.freed) return;
    var dx = player.x - pow.x, dz = player.z - pow.z;
    var dist = Math.sqrt(dx * dx + dz * dz);
    if (dist <= POW_STOP_DIST) {
      pow.path = null;
      return;
    }
    pow.repath -= dt;
    if (!pow.path || pow.pathIdx >= pow.path.length || pow.repath <= 0) {
      pow.path = M.astar(pow.x, pow.z, player.x, player.z);
      pow.pathIdx = 0;
      pow.repath = 0.45;
    }
    if (!pow.path || !pow.path.length) {
      // fallback direct steer
      var inv = dist > 0.001 ? 1 / dist : 0;
      var nx = pow.x + dx * inv * POW_FOLLOW_SPEED * dt;
      var nz = pow.z + dz * inv * POW_FOLLOW_SPEED * dt;
      var moved = M.moveWithCollision(pow.x, pow.z, nx, nz, POW_RADIUS);
      pow.x = moved.x; pow.z = moved.z;
      return;
    }
    var stepBudget = POW_FOLLOW_SPEED * dt;
    while (stepBudget > 0 && pow.path && pow.pathIdx < pow.path.length) {
      var wp = pow.path[pow.pathIdx];
      var wx = wp.x - pow.x, wz = wp.z - pow.z;
      var wl = Math.sqrt(wx * wx + wz * wz);
      if (wl < 0.15) { pow.pathIdx++; continue; }
      var take = Math.min(stepBudget, wl);
      var mx2 = pow.x + (wx / wl) * take;
      var mz2 = pow.z + (wz / wl) * take;
      var mv = M.moveWithCollision(pow.x, pow.z, mx2, mz2, POW_RADIUS);
      pow.x = mv.x; pow.z = mv.z;
      stepBudget -= take;
      if (Math.hypot(pow.x - wp.x, pow.z - wp.z) < 0.2) pow.pathIdx++;
    }
  }

  // Floating jack-in matrix panel — body-yaw locked (not head gaze)
  function buildCircuitModel() {
    var yaw = panelYaw();
    var sy = Math.sin(yaw), cy = Math.cos(yaw);
    var dist = 1.05;
    var px = player.x + sy * dist;
    var py = player.eye - 0.08;
    var pz = player.z - cy * dist;
    var nx = -sy, ny = 0, nz = cy;
    var right = math.vnorm(math.vcross([0, 1, 0], [nx, ny, nz]));
    var up = math.vnorm(math.vcross([nx, ny, nz], right));
    var sx = 0.92, sy2 = 0.98;
    var m = new Float32Array(16);
    m[0] = right[0] * sx; m[1] = right[1] * sx; m[2] = right[2] * sx; m[3] = 0;
    m[4] = up[0] * sy2; m[5] = up[1] * sy2; m[6] = up[2] * sy2; m[7] = 0;
    m[8] = nx; m[9] = ny; m[10] = nz; m[11] = 0;
    m[12] = px; m[13] = py; m[14] = pz; m[15] = 1;
    circuitPanelModel = m;
    return m;
  }

  function worldAimFromVr(vrInput) {
    if (!vrInput || !vrInput.aimOrigin || !vrInput.aimDirection) return null;
    var c = Math.cos(vrInput.bodyYaw), s = Math.sin(vrInput.bodyYaw);
    var o = vrInput.aimOrigin;
    return {
      x: player.x + c * o.localX - s * o.localZ,
      y: VR.worldYFromXR ? VR.worldYFromXR(o.y) : o.y,
      z: player.z + s * o.localX + c * o.localZ,
      dx: vrInput.aimDirection[0],
      dy: vrInput.aimDirection[1],
      dz: vrInput.aimDirection[2]
    };
  }

  // Ray vs circuit panel quad → UV in [0,1]. Returns {u,v,hx,hy,hz,t} or null.
  function rayCircuitPanel(ox, oy, oz, dx, dy, dz, m) {
    if (!m) return null;
    var cx = m[12], cy = m[13], cz = m[14];
    var nx = m[8], ny = m[9], nz = m[10];
    var denom = nx * dx + ny * dy + nz * dz;
    if (Math.abs(denom) < 1e-5) return null;
    var t = ((cx - ox) * nx + (cy - oy) * ny + (cz - oz) * nz) / denom;
    if (t < 0.05 || t > 4.5) return null;
    var hx = ox + dx * t, hy = oy + dy * t, hz = oz + dz * t;
    var rx = m[0], ry = m[1], rz = m[2];
    var ux = m[4], uy = m[5], uz = m[6];
    var sx2 = rx * rx + ry * ry + rz * rz;
    var sy2 = ux * ux + uy * uy + uz * uz;
    if (sx2 < 1e-8 || sy2 < 1e-8) return null;
    var lx = ((hx - cx) * rx + (hy - cy) * ry + (hz - cz) * rz) / sx2; // ~[-0.5,0.5]
    var ly = ((hx - cx) * ux + (hy - cy) * uy + (hz - cz) * uz) / sy2;
    if (lx < -0.52 || lx > 0.52 || ly < -0.52 || ly > 0.52) return null;
    return { u: lx + 0.5, v: 0.5 - ly, hx: hx, hy: hy, hz: hz, t: t };
  }

  function paintControllerLaser(ox, oy, oz, hx, hy, hz, hit) {
    var dx = hx - ox, dy = hy - oy, dz = hz - oz;
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 0.01) return;
    // Slightly short of the panel so the beam isn't buried under the quad
    var pull = hit ? 0.97 : 1;
    var n = Math.max(14, Math.min(56, Math.floor(len * 36)));
    var life = 0.12;
    for (var i = 0; i <= n; i++) {
      var f = (i / n) * pull;
      R.addPoint(
        ox + dx * f, oy + dy * f, oz + dz * f,
        1.0, hit ? 0.08 : 0.4, hit ? 0.08 : 0.4, now, life
      );
    }
    if (!hit) {
      R.addPoint(hx, hy, hz, 1.0, 0.35, 0.35, now, 0.14);
    }
  }

  function handleCircuitLaser(vrInput) {
    var aim = worldAimFromVr(vrInput);
    if (!aim || !circuitPanelModel) {
      if (CIR && CIR.clearPointer) CIR.clearPointer();
      return;
    }
    var hit = rayCircuitPanel(aim.x, aim.y, aim.z, aim.dx, aim.dy, aim.dz, circuitPanelModel);
    var endX = aim.x + aim.dx * 1.6;
    var endY = aim.y + aim.dy * 1.6;
    var endZ = aim.z + aim.dz * 1.6;
    if (hit) {
      endX = hit.hx; endY = hit.hy; endZ = hit.hz;
      if (CIR.setPointer) CIR.setPointer(hit.u, hit.v);
      if (CIR.pickUv) CIR.pickUv(hit.u, hit.v);
    } else if (CIR.clearPointer) {
      CIR.clearPointer();
    }
    paintControllerLaser(aim.x, aim.y, aim.z, endX, endY, endZ, !!hit);
  }

  function syncCircuitPanel() {
    if (!R.setCircuitPanel) return;
    if (CIR && CIR.isActive() && inVR() && CIR.getCanvas) {
      R.setCircuitPanel(CIR.getCanvas(), buildCircuitModel());
    } else {
      circuitPanelModel = null;
      R.setCircuitPanel(null, null);
    }
  }

  function vanishDoor(door) {
    if (!door) return;
    // Wipe old blue door returns so the seal vanishes on LiDAR
    if (R.expirePointsNear) R.expirePointsNear(door.x, door.z, 2.4, now);
    // Brief dissolve spray (dies fast — not a lasting ghost)
    for (var i = 0; i < 48; i++) {
      var ang = math.rand() * Math.PI * 2;
      var rr = math.rand() * 1.1;
      R.addPoint(
        door.x + Math.cos(ang) * rr,
        0.3 + math.rand() * 2.4,
        door.z + Math.sin(ang) * rr,
        C_DOOR[0], C_DOOR[1], C_DOOR[2],
        now, 0.35 + math.rand() * 0.25
      );
    }
    if (A.doorGrind) A.doorGrind();
    else A.clunk(0);
  }

  function onDoorUnlocked(unlocked) {
    doorsOpen = M.doorsOpenCount();
    vanishDoor(unlocked);
    emitNoise(NOISE_INTERACT);
    if (unlocked.console || unlocked.id === 'D3') {
      pushMsg('CONSOLE DOOR OPEN — SEAL GONE · JACK-IN READY', 'amber');
    } else {
      pushMsg('BLAST DOOR ' + unlocked.id + ' OPEN — SEAL GONE', 'amber');
    }
  }

  function interact() {
    if (CIR && CIR.isActive()) { CIR.rotateSelected(); return; }
    if (cloneUiActive()) return;
    var range = interactRange();

    if (tryFreePow()) return;

    if (inVR()) {
      var pick = vrAimPick();
      if (pick && pick.kind === 'pow' && pick.dist <= range + 0.6) {
        tryFreePow();
        return;
      }
      if (pick && pick.kind === 'key' && pick.dist <= range) {
        takeKey(pick.i);
        return;
      }
      if (pick && pick.kind === 'door' && pick.dist <= range + 0.8) {
        // fall through to door unlock using that door via near() — force proximity by using door coords
        var aimed = M.markers.doors[pick.i];
        var needAim = doorKeysNeeded(aimed);
        if (keysCollected < needAim) {
          if (aimed.console || aimed.id === 'D3') {
            pushMsg(tutorialMode
              ? 'CONSOLE DOOR — NEED THE KEY YOU FOUND'
              : 'CONSOLE DOOR — NEED ALL 3 KEYS (' + keysCollected + '/3)', 'amber');
          } else if (needAim <= 0) {
            pushMsg('BLAST DOOR — PRESS E / A TO OPEN', 'amber');
          } else {
            pushMsg('BLAST DOOR LOCKED — NEED ACCESS KEY', 'amber');
          }
          return;
        }
        var unlockedAim = M.unlockDoor(aimed.id);
        if (unlockedAim) {
          onDoorUnlocked(unlockedAim);
        }
        return;
      }
      if (pick && pick.kind === 'console' && pick.dist <= range + 1.2) {
        tryJackIn();
        return;
      }
    }

    for (var i = 0; i < accessKeys.length; i++) {
      if (!accessKeys[i].taken && near(accessKeys[i].x, accessKeys[i].z, range)) {
        takeKey(i);
        return;
      }
    }

    // unlock nearest locked door (D3 needs all 3 keys; D1/D2 optional, 1 key)
    for (i = 0; i < M.markers.doors.length; i++) {
      var door = M.markers.doors[i];
      if (!door.locked) continue;
      if (!near(door.x, door.z, range + 0.8)) continue;
      var need = doorKeysNeeded(door);
      if (keysCollected < need) {
        if (door.console || door.id === 'D3') {
          pushMsg(tutorialMode
            ? 'CONSOLE DOOR — NEED THE KEY YOU FOUND'
            : 'CONSOLE DOOR — NEED ALL 3 KEYS (' + keysCollected + '/3)', 'amber');
        } else {
          pushMsg('BLAST DOOR LOCKED — NEED ACCESS KEY', 'amber');
        }
        return;
      }
      var unlocked = M.unlockDoor(door.id);
      if (unlocked) {
        onDoorUnlocked(unlocked);
      }
      return;
    }

    // jack-in / virus console
    if (near(M.markers.G.x, M.markers.G.z, range + 0.5)) {
      tryJackIn();
      return;
    }

    if (tryBoardLz(true)) return;
    if (exfilPhase === 'INBOUND' && near(M.markers.X.x, M.markers.X.z, LZ_RADIUS)) {
      queueMsg('LZ COLD — CHOPPER STILL INBOUND', '');
      return;
    }
    if (exfilPhase === 'NONE' && near(M.markers.X.x, M.markers.X.z, range + 0.4)) {
      queueMsg('LZ INACTIVE — COMPLETE UPLINK FIRST', '');
      return;
    }
  }

  function updateLasers(dt) {
    var id;
    for (id in laserCooldown) {
      if (laserCooldown[id] > 0) laserCooldown[id] -= dt;
    }
    var hit = M.laserHitPlayer(player.x, player.z, PLAYER_RADIUS + 0.15);
    if (!hit) return;
    if (laserCooldown[hit.id] > 0) return;
    laserCooldown[hit.id] = LASER_COOLDOWN;
    var mx = (hit.x0 + hit.x1) * 0.5, mz = (hit.z0 + hit.z1) * 0.5;
    A.securityAlarm();
    if (tutorialMode && !tutorialTripHit) {
      tutorialTripHit = true;
      spawnTutorialSecurityInHarbor();
      queueMsg('SECURITY ALARM — GUARD SPAWNED IN HARBOR', 'amber', 4);
    } else {
      EN.hear(mx, mz, NOISE_LASER, now, false);
      EN.forceInvestigate(mx, mz, 2);
      queueMsg('SECURITY ALARM — ' + hit.id + (tutorialMode ? ' — TRAINING RESPONSE' : ' — NEAREST UNITS RESPONDING'), 'amber', 4);
    }
    recentLoud = Math.max(recentLoud, NOISE_LASER);
    auxLoud = Math.max(auxLoud, 0.95);
    // brief yellow paint of the single low beam
    var by = (hit.y0 + hit.y1) * 0.5;
    for (var i = 0; i < 48; i++) {
      var t = i / 47;
      R.addPoint(
        hit.x0 + (hit.x1 - hit.x0) * t + (math.rand() - 0.5) * 0.03,
        by + (math.rand() - 0.5) * 0.02,
        hit.z0 + (hit.z1 - hit.z0) * t + (math.rand() - 0.5) * 0.03,
        C_YELLOW[0], C_YELLOW[1], C_YELLOW[2], now, 4
      );
    }
  }

  function updateItems(dt) {
    // LZ has no LiDAR beacon — Mission Director must voice-guide the operator
    // auto-board if standing in LZ during on-station
    if (exfilPhase === 'ON_STATION' && near(M.markers.X.x, M.markers.X.z, LZ_RADIUS)) {
      tryBoardLz(false);
      return;
    }

    // interact hints
    if (!curMsg && !(CIR && CIR.isActive()) && !cloneUiActive()) {
      var hint = '';
      var hintRange = inVR() ? INTERACT_RANGE_VR : INTERACT_RANGE;
      var btn = inVR() ? '[A/X]' : '[E]';
      var i;
      if (missionBranch === 'RESCUE' && pow && !pow.freed && near(pow.x, pow.z, hintRange + 0.5)) {
        hint = btn + ' FREE POW';
      } else if (missionBranch === 'RESCUE' && pow && pow.freed && near(pow.x, pow.z, hintRange)) {
        hint = 'POW FOLLOWING — ESCORT TO LZ';
      } else if (missionBranch === 'VIRUS' && !virusDone && near(M.markers.G.x, M.markers.G.z, hintRange + 0.5)) {
        hint = virusHolding
          ? ('UPLOADING VIRUS ' + Math.floor(virusProgress * 100) + '%')
          : (inVR() ? 'HOLD X — UPLOAD VIRUS' : 'HOLD X / E — UPLOAD VIRUS');
      }
      if (inVR()) {
        var aim = vrAimPick();
        if (aim && aim.kind === 'key' && aim.dist <= hintRange + 0.6) {
          hint = btn + ' RECOVER ACCESS KEY';
        } else if (aim && aim.kind === 'door' && aim.dist <= hintRange + 0.8) {
          var ad = M.markers.doors[aim.i];
          var an = doorKeysNeeded(ad);
          if (keysCollected < an) {
            hint = (ad.console || ad.id === 'D3')
              ? 'CONSOLE DOOR — NEED 3 KEYS (' + keysCollected + '/3)'
              : 'BLAST DOOR — NEED KEY';
          } else {
            hint = (ad.console || ad.id === 'D3')
              ? btn + ' OPEN CONSOLE DOOR'
              : btn + ' UNLOCK BLAST DOOR';
          }
        }
      }
      for (i = 0; i < accessKeys.length; i++) {
        if (!accessKeys[i].taken && near(accessKeys[i].x, accessKeys[i].z, hintRange)) {
          hint = btn + ' RECOVER ACCESS KEY';
        }
      }
      for (i = 0; i < M.markers.doors.length; i++) {
        var hd = M.markers.doors[i];
        if (hd.locked && near(hd.x, hd.z, hintRange + 0.8)) {
          var needH = doorKeysNeeded(hd);
          if (keysCollected < needH) {
            hint = (hd.console || hd.id === 'D3')
              ? 'CONSOLE DOOR — NEED 3 KEYS (' + keysCollected + '/3)'
              : 'BLAST DOOR — NEED KEY';
          } else {
            hint = (hd.console || hd.id === 'D3')
              ? btn + ' OPEN CONSOLE DOOR'
              : btn + ' UNLOCK BLAST DOOR';
          }
        }
      }
      if (near(M.markers.G.x, M.markers.G.z, hintRange + 0.5) && !uplinkDone) {
        if (M.isConsoleSealed()) {
          hint = 'CONSOLE SEALED — OPEN D3 (3 KEYS)';
        } else if (now < jackInCooldownUntil) {
          hint = 'CORE LOCKED OUT — RETRY IN ' + Math.ceil(jackInCooldownUntil - now) + 's';
        } else {
          hint = btn + ' JACK INTO CORE';
        }
      }
      if (missionBranch === 'VIRUS' && virusDone && near(M.markers.G.x, M.markers.G.z, hintRange + 0.5)) {
        hint = 'VIRUS ARMED — EXTRACT TO LZ';
      }
      if (exfilPhase === 'ON_STATION' && near(M.markers.X.x, M.markers.X.z, LZ_RADIUS + 1)) {
        if (missionBranch === 'RESCUE') hint = 'ON THE PAD — POW MUST BOARD WITH YOU';
        else if (missionBranch === 'VIRUS' && !virusDone) hint = 'VIRUS INCOMPLETE — RETURN TO CONSOLE';
        else hint = 'ON THE PAD — HOLD FOR EXTRACT';
      }
      vrHudHint = hint;
      if (hint) { el.eventline.textContent = hint; el.eventline.className = ''; }
      else if (!msgQueue.length) el.eventline.textContent = '';
    } else if (tutorialMode && TUTORIAL_STEPS[tutorialStation]) {
      var ts = TUTORIAL_STEPS[tutorialStation];
      vrHudHint = 'STEP ' + (tutorialStation + 1) + '/' + TUTORIAL_STEPS.length + ' · ' + ts.title;
    } else if (curMsg) {
      vrHudHint = curMsg.text || '';
    } else {
      vrHudHint = '';
    }
  }

  function updateExfil(dt) {
    if (exfilPhase === 'INBOUND') {
      exfilTimer -= dt;
      if (exfilTimer <= 0) {
        exfilPhase = 'ON_STATION';
        exfilTimer = tutorialMode ? 45 : CHOPPER_LINGER_S;
        if (A.chopperOnStation) A.chopperOnStation();
        queueMsg('CHOPPER ON STATION — BOARD THE YELLOW LZ', 'amber', 4);
      }
    } else if (exfilPhase === 'ON_STATION') {
      exfilTimer -= dt;
      if (exfilTimer <= 0) {
        failLeftBehind();
      }
    }
  }

  // ------------------------------------------------------------------
  // player movement
  // ------------------------------------------------------------------
  var strideAcc = 0;
  function updatePlayer(dt, vrInput) {
    if (CIR && CIR.isActive()) return; // locked into jack-in
    if (cloneUiActive()) return; // locked into clone / choice
    var crouch = !vrInput && (keys['ControlLeft'] || keys['ControlRight']);
    var wantSprint = vrInput
      ? (!!vrInput.sprint && !crouch)
      : ((keys['ShiftLeft'] || keys['ShiftRight']) && !crouch);

    var mx = 0, mz = 0;
    if (vrInput) {
      mx = vrInput.moveX;
      mz = vrInput.moveY;
      player.yaw = vrInput.heading;
    } else {
      if (keys['KeyW']) mz += 1;
      if (keys['KeyS']) mz -= 1;
      if (keys['KeyA']) mx -= 1;
      if (keys['KeyD']) mx += 1;
    }
    var moving = (mx !== 0 || mz !== 0);

    if (staminaExhausted && stamina >= 0.35) staminaExhausted = false;
    var sprint = wantSprint && moving && !staminaExhausted && stamina > STAMINA_MIN_SPRINT;
    if (sprint) {
      stamina = Math.max(0, stamina - STAMINA_DRAIN * dt);
      if (stamina <= 0) { stamina = 0; staminaExhausted = true; sprint = false; }
    } else {
      stamina = Math.min(STAMINA_MAX, stamina + STAMINA_RECOVER * dt * (moving ? 0.7 : 1));
    }

    var speed = crouch
      ? SPEED_CROUCH
      : (sprint ? (comfortSlowSprint ? SPEED_SPRINT_COMFORT : SPEED_SPRINT) : SPEED_WALK);

    var targetEye = crouch ? EYE_CROUCH : EYE_STAND;
    player.eye += (targetEye - player.eye) * Math.min(1, dt * 10);

    if (moving) {
      var l = Math.sqrt(mx * mx + mz * mz);
      if (l > 1) { mx /= l; mz /= l; }
      var sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
      // forward = (sin yaw, -cos yaw) in xz
      var dx = (mz * sy + mx * cy) * speed * dt;
      var dz = (-mz * cy + mx * sy) * speed * dt;
      var moved = M.moveWithCollision(player.x, player.z, player.x + dx, player.z + dz, PLAYER_RADIUS);
      var actual = Math.sqrt((moved.x - player.x) * (moved.x - player.x) + (moved.z - player.z) * (moved.z - player.z));
      player.x = moved.x; player.z = moved.z;
      if (tutorialMode) tutorialMoveDist += actual;

      strideAcc += actual;
      var stride = crouch ? 1.6 : (sprint ? 2.4 : 2.2);
      if (strideAcc > stride) {
        strideAcc = 0;
        var loud = crouch ? NOISE_CROUCH : (sprint ? NOISE_SPRINT : NOISE_WALK);
        emitNoise(loud);
        A.footstep(loud / NOISE_SPRINT);
      }
    }

    // Movement comfort vignette: ramp with locomotion / sprint
    if (comfortVignette) {
      var targetVig = 0;
      if (moving) targetVig = sprint ? 0.85 : 0.45;
      var vigRate = moving ? 4.5 : 3.0;
      moveVignette += (targetVig - moveVignette) * Math.min(1, dt * vigRate);
    } else {
      moveVignette = 0;
    }
    applyComfort();
  }

  // ------------------------------------------------------------------
  // event line typewriter
  // ------------------------------------------------------------------
  function queueMsg(text, cls, hold) {
    msgQueue.push({ text: text, cls: cls || '', hold: hold || (1.5 + text.length * 0.03) });
  }

  // Immediate interaction feedback: jump the queue and show right away
  function pushMsg(text, cls, hold) {
    curMsg = null;
    msgQueue.length = 0;
    queueMsg(text, cls, hold);
  }

  function updateMsg(dt) {
    if (!curMsg) {
      if (!msgQueue.length) return;
      curMsg = msgQueue.shift();
      msgChars = 0;
      msgHold = curMsg.hold;
      el.eventline.className = curMsg.cls;
    }
    if (msgChars < curMsg.text.length) {
      msgChars = Math.min(curMsg.text.length, msgChars + dt * 80);
      el.eventline.textContent = curMsg.text.slice(0, Math.floor(msgChars));
      if (Math.random() < 0.5) A.teletype();
    } else {
      msgHold -= dt;
      if (msgHold <= 0) { curMsg = null; el.eventline.textContent = ''; el.eventline.className = ''; }
    }
  }

  // ------------------------------------------------------------------
  // HUD
  // ------------------------------------------------------------------
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }

  function updateHUD(dt) {
    runTime += dt;
    updateMissionClock(0); // warnings use runTime; fail checked below
    var left = missionTimeLeft();
    if (state === 'PLAY' && runActive && left <= 0) {
      failPowerReturn();
      return;
    }
    var totalSec = Math.floor(left);
    var mm = Math.floor(totalSec / 60), ss = totalSec % 60;
    el.timer.textContent = 'PWR T-' + pad(mm, 2) + ':' + pad(ss, 2);
    var elapsed = Math.floor(runTime);
    var eh = Math.floor(elapsed / 3600);
    var em = Math.floor((elapsed % 3600) / 60), es = elapsed % 60;
    el.vcrClock.textContent = 'T+' + pad(eh, 2) + ':' + pad(em, 2) + ':' + pad(es, 2);
    el.pts.textContent = 'PTS ' + pad(R.pointCount(), 6) + ' / ' + R.CAPACITY;

    el.obj.innerHTML = (function () {
      if (clonePhase === 'CLONING') {
        return '<span class="energized">CLONING ' + Math.floor(clonePct) + '%</span>';
      }
      if (clonePhase === 'CHOICE') {
        return '<span class="energized">CHOOSE: RESCUE OR VIRUS</span>';
      }
      if (exfilPhase === 'ON_STATION') {
        return '<span class="energized">LZ ON STATION T-' + pad(Math.max(0, Math.ceil(exfilTimer)), 2) + '</span>';
      }
      if (exfilPhase === 'INBOUND') {
        return '<span class="energized">CHOPPER INBOUND T-' + pad(Math.max(0, Math.ceil(exfilTimer)), 2) + '</span>';
      }
      if (missionBranch === 'VIRUS' && !virusDone) {
        return '<span class="energized">VIRUS ' + Math.floor(virusProgress * 100) + '%</span>';
      }
      if (missionBranch === 'VIRUS' && virusDone) {
        return '<span class="energized">VIRUS ARMED · EXTRACT</span>';
      }
      if (missionBranch === 'RESCUE' && pow && !pow.freed) {
        return '<span class="energized">FREE POW · THEN LZ</span>';
      }
      if (missionBranch === 'RESCUE' && pow && pow.freed) {
        return '<span class="energized">ESCORT POW TO LZ</span>';
      }
      if (uplinkDone) return '<span class="energized">CLONE ON DRIVE</span>';
      if (M.isConsoleSealed()) {
        return 'KEY ' + keysCollected + '/3 · CONSOLE DOOR';
      }
      return 'KEY ' + keysCollected + '/3 · JACK-IN READY';
    })();
    vrHudObj = el.obj.textContent || el.obj.innerText || '';

    // AUX needle: own emission + live mic level
    // Green = safe · Yellow = investigate · Red = 7s chase
    auxLoud = Math.max(0, auxLoud - dt * 1.1);
    recentLoud = Math.max(0, recentLoud - dt * 14);
    var micL = (NS.mic && NS.mic.level) ? NS.mic.level() : 0;
    var shownAux = Math.max(auxLoud, micL);
    var auxBandLoud = shownAux * NOISE_BURST;
    var auxBand = EN.noiseBand ? EN.noiseBand(auxBandLoud) : 'SAFE';
    el.auxFill.style.width = Math.min(100, shownAux * 100) + '%';
    el.auxFill.style.background = auxBand === 'RED'
      ? 'rgba(255,68,68,0.95)'
      : (auxBand === 'YELLOW' ? 'rgba(255,179,71,0.95)' : 'rgba(124,255,155,0.95)');
    el.auxFill.style.boxShadow = auxBand === 'RED'
      ? '0 0 8px rgba(255,68,68,0.7)'
      : (auxBand === 'YELLOW' ? '0 0 8px rgba(255,179,71,0.55)' : '0 0 8px rgba(124,255,155,0.55)');
    if (el.staFill) {
      el.staFill.style.width = Math.min(100, stamina * 100) + '%';
      el.staFill.style.background = staminaExhausted
        ? 'rgba(255,80,80,0.95)'
        : (stamina < 0.3 ? 'rgba(255,179,71,0.95)' : '');
    }

    // MOTION radar contacts: security + POW (rescue path)
    var radarContacts = (tutorialMode && !tutorialTripHit)
      ? []
      : (EN.contacts ? EN.contacts() : [{ x: EN.state.x, z: EN.state.z, state: EN.state.state }]);
    if (missionBranch === 'RESCUE' && pow) {
      radarContacts = radarContacts.concat([{
        id: 'POW',
        x: pow.x,
        z: pow.z,
        state: pow.freed ? 'POW_FREE' : 'POW',
        kind: 'pow'
      }]);
    }

    if (R.setVRHud) {
      R.setVRHud({
        hint: vrHudHint,
        obj: vrHudObj,
        aux: shownAux,
        auxBand: auxBand,
        auxSafe: (EN.NOISE_SAFE_MAX || 5) / NOISE_BURST,
        auxYellow: (EN.NOISE_YELLOW_MAX || 16) / NOISE_BURST,
        stamina: stamina,
        exhausted: staminaExhausted,
        timer: el.timer.textContent,
        contacts: radarContacts,
        yaw: player.yaw,
        px: player.x,
        pz: player.z,
        virusUpload: (virusWristActive || virusHolding) && !virusDone ? virusProgress : null,
        virusHolding: virusHolding
      });
    }

    // click direction tick (accessibility twin, GDD §7.4)
    if (clickTickFade > 0) {
      clickTickFade -= dt * 1.6;
      el.auxTick.style.opacity = Math.max(0, clickTickFade);
    }
  }

  function onEnemyClick(dist, pan) {
    if (dist < 12) {
      clickTickFade = 1;
      el.auxTick.style.left = (50 + math.clamp(pan, -1, 1) * 46) + '%';
      el.auxTick.style.opacity = 1;
    }
  }

  // heartbeat proximity layer
  var heartTimer = 0;
  function updateHeartbeat(dt) {
    var dx = EN.state.x - player.x, dz = EN.state.z - player.z;
    var dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > 10 || EN.state.state === 'DORMANT') return;
    heartTimer -= dt;
    if (heartTimer <= 0) {
      var t = 1 - dist / 10; // 0..1 close
      heartTimer = math.lerp(1.1, 0.42, t);
      A.heartbeat(0.4 + t * 0.6);
    }
  }

  // ------------------------------------------------------------------
  // main loop
  // ------------------------------------------------------------------
  function frame(ts) {
    requestAnimationFrame(frame);
    if (VR && VR.active()) return;
    processFrame(ts, null);
  }

  function processFrame(ts, xrData) {
    var dt = Math.min(0.05, (ts - lastFrame) / 1000);
    lastFrame = ts;
    now = ts / 1000;

    var tear = false;

    if (state === 'PLAY') {
      var vrInput = xrData ? xrData.input : null;
      if (vrInput && typeof vrInput.bodyYaw === 'number') lastVrBodyYaw = vrInput.bodyYaw;

      if (CIR && CIR.isActive()) {
        if (vrInput) {
          syncCircuitPanel();
          handleCircuitLaser(vrInput);
          if (vrInput.navX) CIR.moveSelection(vrInput.navX, 0);
          if (vrInput.navY) CIR.moveSelection(0, vrInput.navY);
          if (vrInput.interactPressed) CIR.rotateSelected();
          else if (vrInput.tricklePressed) CIR.rotateSelected();
          if (vrInput.secondaryPressed && CIR.nextTile) CIR.nextTile();
          if (R.setWristModel) {
            R.setWristModel(buildWristModel(vrInput.wrist, vrInput.bodyYaw));
          }
        } else {
          syncCircuitPanel();
        }
        CIR.update(dt);
        if (inVR()) syncCircuitPanel();
        clearCoachPanel();
        updateExfil(dt);
        updateMsg(dt);
        updateHUD(dt);
        vrHudHint = 'STAGE ' + (CIR.getStage ? CIR.getStage() : 1) + '/' + (CIR.getStageCount ? CIR.getStageCount() : 3) + ' · POINT LASER · A/X OR TRIGGER: ROTATE';
      } else if (cloneUiActive()) {
        if (vrInput && R.setWristModel) {
          R.setWristModel(buildWristModel(vrInput.wrist, vrInput.bodyYaw));
        }
        updateCloneSequence(dt, vrInput);
        // Security keeps moving during clone choice (only circuit freezes them)
        EN.update(dt, player, now, { onKill: onKill, onEnemyClick: onEnemyClick });
        updateMsg(dt);
        updateHUD(dt);
        vrHudHint = clonePhase === 'CLONING'
          ? 'CLONING AI ONTO HARD DRIVE… ' + Math.floor(clonePct) + '%'
          : 'STICK: SELECT · A/X: CONFIRM PATH';
      } else {
        if (R.setCircuitPanel) R.setCircuitPanel(null, null);
        updatePlayer(dt, vrInput);

        if (vrInput) {
          trickleOn = vrInput.trickle;
          vrScanDirection = vrInput.aimDirection;
          if (vrInput.aimOrigin) {
            var c = Math.cos(vrInput.bodyYaw), s = Math.sin(vrInput.bodyYaw);
            vrScanOrigin = {
              x: player.x + c * vrInput.aimOrigin.localX - s * vrInput.aimOrigin.localZ,
              y: VR.worldYFromXR ? VR.worldYFromXR(vrInput.aimOrigin.y) : vrInput.aimOrigin.y,
              z: player.z + s * vrInput.aimOrigin.localX + c * vrInput.aimOrigin.localZ
            };
          } else {
            vrScanOrigin = null;
          }
          if (R.setWristModel) {
            R.setWristModel(buildWristModel(vrInput.wrist, vrInput.bodyYaw));
          }
          if (vrInput.interactPressed) interact();
        } else {
          vrScanOrigin = null;
          vrScanDirection = null;
          if (R.setWristModel) R.setWristModel(null);
        }

        updateScanner(dt);
        updateLasers(dt);
        updateVirusPlant(dt, vrInput);
        updatePow(dt);
        updateItems(dt);
        updateExfil(dt);
        updateTutorial(dt);
        syncCoachPanel();
        if (NS.mic && !tutorialMode) NS.mic.tick(dt, state === 'PLAY', function (loud) { emitNoise(loud); });
        // No security until tutorial tripwire fires
        if (!(tutorialMode && !tutorialTripHit)) {
          EN.update(dt, player, now, { onKill: onKill, onEnemyClick: onEnemyClick });
        }
        updateHeartbeat(dt);
        updateMsg(dt);
        updateHUD(dt);
      }

      if (EN.state.agitation > 70) {
        tearTimer -= dt;
        if (tearTimer <= 0) { tearTimer = 0.7 + math.rand() * 1.5; tear = true; }
      }

      // tape interference: the closer / angrier it is, the worse the signal
      var gdx = EN.state.x - player.x, gdz = EN.state.z - player.z;
      var gdist = Math.sqrt(gdx * gdx + gdz * gdz);
      var prox = EN.state.state === 'DORMANT' ? 0 : math.clamp(1 - gdist / 9, 0, 1);
      var agit = math.clamp((EN.state.agitation - 45) / 55, 0, 1);
      var gTarget = Math.max(prox * prox, agit * 0.45)
                  + (EN.state.state === 'CHASE' ? 0.25 : 0);
      glitchLevel += (Math.min(1, gTarget) - glitchLevel) * Math.min(1, dt * 5);

      // ambient tape damage: occasional pops even when it's far away
      popTimer -= dt;
      if (popTimer <= 0) { popTimer = 5 + math.rand() * 9; glitchPop = 0.45 + math.rand() * 0.4; }
      glitchPop = Math.max(0, glitchPop - dt * 3.5);
    } else if (state === 'DYING') {
      dieTimer += dt;
      var speedF = reducedFlash ? 0.45 : 1.4;
      floodLevel = Math.min(reducedFlash ? 0.4 : 0.85, dieTimer * speedF);
      // red flood of returns around the player
      for (var i = 0; i < (reducedFlash ? 60 : 220); i++) {
        var ang = math.rand() * Math.PI * 2, rr = math.rand() * 2.5;
        R.addPoint(player.x + Math.cos(ang) * rr, math.rand() * 2.4, player.z + Math.sin(ang) * rr,
          C_RED[0], C_RED[1], C_RED[2], now, 1.5);
      }
      if (dieTimer > 1.4) { floodLevel = 0; finishDeath(); }
    }

    if (xrData) {
      R.renderXR(VR.viewsForPose(xrData.pose, player), VR.framebuffer(), now);
    } else {
      var aspect = el.canvas.width / Math.max(1, el.canvas.height);
      var proj = math.mat4Perspective(70 * Math.PI / 180, aspect, 0.05, 220);
      // handheld camcorder drift: tiny, slow, never enough to spoil aim
      var swayYaw = (Math.sin(now * 0.7) + Math.sin(now * 1.13) * 0.5) * 0.0028;
      var swayPitch = (Math.sin(now * 0.9 + 2.0) + Math.sin(now * 1.31) * 0.5) * 0.0022;
      var fwd = math.dirFromYawPitch(player.yaw + swayYaw, player.pitch + swayPitch);
      var eye = [player.x, player.eye, player.z];
      var view = math.mat4LookAt(eye, [eye[0] + fwd[0], eye[1] + fwd[1], eye[2] + fwd[2]], [0, 1, 0]);
      R.render(proj, view, now, { flood: floodLevel });
    }
  }

  NS.game = {
    init: init,
    fusesCollected: function () { return keysCollected; },
    cloneUiActive: cloneUiActive,
    clearTutorialPending: function () { pendingTutorial = false; },
    onVRStart: function () {
      if (A.stopAllTransient) A.stopAllTransient();
      // Easy raid after tutorial — clear pendingEasyRaid into a normal mission start
      if (pendingEasyRaid) {
        pendingEasyRaid = false;
        pendingTutorial = false;
        tutorialMode = false;
      }
      if (!runActive) startRun();
      state = 'PLAY';
      showScreen(null);
      lastFrame = performance.now();
      // Mic follows difficulty; tutorial keeps it off
      if (NS.mic && !tutorialMode) NS.mic.start();
    },
    onVREnd: function () {
      trickleOn = false;
      vrScanOrigin = null;
      vrScanDirection = null;
      if (CIR && CIR.isActive()) CIR.close();
      clonePhase = 'NONE';
      if (R.setCircuitPanel) R.setCircuitPanel(null, null);
      if (R.setWristModel) R.setWristModel(null);
      clearCoachPanel();
      if (NS.mic) NS.mic.stop();
      // Tutorial LZ success — show Easy-raid offer now that DOM is visible again
      if (pendingPostTutorial) {
        var offer = pendingPostTutorial;
        pendingPostTutorial = false;
        finishEndTutorial(offer);
        lastFrame = performance.now();
        return;
      }
      if (tutorialMode) {
        endTutorial(false);
        lastFrame = performance.now();
        return;
      }
      if (state === 'PLAY') {
        state = 'CONTROLS';
        showScreen('controls');
      }
      lastFrame = performance.now();
    },
    onVRError: function (error) {
      $('vr-note').textContent = 'VR START FAILED: ' + (error && error.message ? error.message : error);
    },
    onXRFrame: function (time, xrFrame, pose, input, bodyYaw) {
      void xrFrame; void bodyYaw;
      processFrame(time, { pose: pose, input: input });
    },
    // test instrumentation (headless smoke harness)
    debug: {
      start: function () { startRun(); state = 'PLAY'; showScreen(null); },
      setTrickle: function (v) { trickleOn = v; },
      snapshot: function () {
        return {
          state: state,
          points: R.pointCount(),
          px: player.x, pz: player.z,
          enemy: EN.state.state, agitation: EN.state.agitation
        };
      }
    }
  };

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { NS.game.init(); });
    } else {
      NS.game.init();
    }
  }
})(typeof window !== 'undefined' ? (window.HOLLOW = window.HOLLOW || {})
                                 : (global.HOLLOW = global.HOLLOW || {}));
