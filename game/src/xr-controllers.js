/* HOLLOW — xr-controllers.js
 * Official WebXR Input Profile GLBs (same source as Three.js XRControllerModelFactory)
 * posed on gripSpace. Target-ray stays for lasers / input. Hands hide the mesh. */
(function (NS) {
  'use strict';

  var PROFILES_PATH = 'https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles';
  var DEFAULT_PROFILE = 'generic-trigger';

  var gl = null;
  var prog = null;
  var attrs = {};
  var unis = {};
  var session = null;
  var profilesList = null;
  var assetCache = {}; // url -> parsed gpu asset
  var assetPending = {};
  var slots = {}; // handedness -> slot
  var eyeX = 0, eyeY = 1.6, eyeZ = 0;
  var lastPlayer = null;
  var lastBodyYaw = 0;

  var VS = [
    'attribute vec3 aPos;',
    'attribute vec3 aNrm;',
    'attribute vec2 aUv;',
    'uniform mat4 uProj;',
    'uniform mat4 uView;',
    'uniform mat4 uModel;',
    'varying vec3 vNrm;',
    'varying vec3 vPos;',
    'varying vec2 vUv;',
    'void main(){',
    '  vec4 w = uModel * vec4(aPos, 1.0);',
    '  vPos = w.xyz;',
    '  vNrm = (uModel * vec4(aNrm, 0.0)).xyz;',
    '  vUv = aUv;',
    '  gl_Position = uProj * uView * w;',
    '}'
  ].join('\n');

  var FS = [
    'precision mediump float;',
    'varying vec3 vNrm;',
    'varying vec3 vPos;',
    'varying vec2 vUv;',
    'uniform sampler2D uTex;',
    'uniform vec3 uColor;',
    'uniform float uHasTex;',
    'uniform vec3 uEye;',
    'void main(){',
    '  vec3 albedo = mix(uColor, texture2D(uTex, vUv).rgb, uHasTex);',
    '  vec3 n = normalize(vNrm);',
    '  vec3 toE = normalize(uEye - vPos);',
    '  float ndl = 0.40 + 0.60 * abs(dot(n, toE));',
    '  gl_FragColor = vec4(albedo * ndl, 1.0);',
    '}'
  ].join('\n');

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error('xr-controller shader: ' + gl.getShaderInfoLog(s));
    }
    return s;
  }

  function init(context) {
    gl = context;
    if (!gl) return;
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.warn('HOLLOW controller program failed', gl.getProgramInfoLog(p));
      return;
    }
    prog = p;
    attrs.aPos = gl.getAttribLocation(p, 'aPos');
    attrs.aNrm = gl.getAttribLocation(p, 'aNrm');
    attrs.aUv = gl.getAttribLocation(p, 'aUv');
    unis.uProj = gl.getUniformLocation(p, 'uProj');
    unis.uView = gl.getUniformLocation(p, 'uView');
    unis.uModel = gl.getUniformLocation(p, 'uModel');
    unis.uTex = gl.getUniformLocation(p, 'uTex');
    unis.uColor = gl.getUniformLocation(p, 'uColor');
    unis.uHasTex = gl.getUniformLocation(p, 'uHasTex');
    unis.uEye = gl.getUniformLocation(p, 'uEye');
  }

  function mat4Identity() {
    var m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  }

  function mat4Mul(a, b) {
    return NS.math.mat4Multiply(a, b);
  }

  function mat4FromTRS(t, r, s) {
    var m = mat4Identity();
    var x = r[0], y = r[1], z = r[2], w = r[3];
    var x2 = x + x, y2 = y + y, z2 = z + z;
    var xx = x * x2, xy = x * y2, xz = x * z2;
    var yy = y * y2, yz = y * z2, zz = z * z2;
    var wx = w * x2, wy = w * y2, wz = w * z2;
    var sx = s[0], sy = s[1], sz = s[2];
    m[0] = (1 - (yy + zz)) * sx;
    m[1] = (xy + wz) * sx;
    m[2] = (xz - wy) * sx;
    m[4] = (xy - wz) * sy;
    m[5] = (1 - (xx + zz)) * sy;
    m[6] = (yz + wx) * sy;
    m[8] = (xz + wy) * sz;
    m[9] = (yz - wx) * sz;
    m[10] = (1 - (xx + yy)) * sz;
    m[12] = t[0]; m[13] = t[1]; m[14] = t[2];
    return m;
  }

  function quatSlerp(a, b, t) {
    var ax = a[0], ay = a[1], az = a[2], aw = a[3];
    var bx = b[0], by = b[1], bz = b[2], bw = b[3];
    var dot = ax * bx + ay * by + az * bz + aw * bw;
    if (dot < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; dot = -dot; }
    if (dot > 0.9995) {
      return [ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t, aw + (bw - aw) * t];
    }
    var th = Math.acos(Math.min(1, dot));
    var s = Math.sin(th);
    var w1 = Math.sin((1 - t) * th) / s;
    var w2 = Math.sin(t * th) / s;
    return [ax * w1 + bx * w2, ay * w1 + by * w2, az * w1 + bz * w2, aw * w1 + bw * w2];
  }

  function lerp3(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  function nodeLocal(n) {
    if (n.matrix) return n.matrix;
    return mat4FromTRS(
      n.translation || [0, 0, 0],
      n.rotation || [0, 0, 0, 1],
      n.scale || [1, 1, 1]
    );
  }

  function xrToWorld(player, bodyYaw) {
    var c = Math.cos(bodyYaw || 0), s = Math.sin(bodyYaw || 0);
    var m = mat4Identity();
    m[0] = c; m[2] = s;
    m[8] = -s; m[10] = c;
    m[12] = player.x;
    m[13] = (NS.vr && NS.vr.worldYFromXR) ? NS.vr.worldYFromXR(0) : 0.28;
    m[14] = player.z;
    return m;
  }

  function readAccessor(gltf, bin, index) {
    var acc = gltf.accessors[index];
    var view = gltf.bufferViews[acc.bufferView];
    var comp = acc.componentType;
    var size = acc.type === 'SCALAR' ? 1 : acc.type === 'VEC2' ? 2 : acc.type === 'VEC3' ? 3 : 4;
    var bytes = comp === 5126 ? 4 : (comp === 5125 ? 4 : (comp === 5123 || comp === 5122 ? 2 : 1));
    var offset = (view.byteOffset || 0) + (acc.byteOffset || 0);
    var stride = view.byteStride || (size * bytes);
    var count = acc.count;
    var out = new Float32Array(count * size);
    var dv = new DataView(bin);
    var i, j, o, packed = stride === size * bytes;
    if (comp === 5126 && packed) {
      return new Float32Array(bin, offset, count * size);
    }
    if (comp === 5123 && packed && size === 1) {
      return new Uint16Array(bin, offset, count);
    }
    for (i = 0; i < count; i++) {
      o = offset + i * stride;
      for (j = 0; j < size; j++) {
        if (comp === 5126) out[i * size + j] = dv.getFloat32(o + j * 4, true);
        else if (comp === 5123) out[i * size + j] = dv.getUint16(o + j * 2, true);
        else if (comp === 5125) out[i * size + j] = dv.getUint32(o + j * 4, true);
        else if (comp === 5121) out[i * size + j] = dv.getUint8(o + j);
      }
    }
    if (comp === 5123 && size === 1) {
      var u16 = new Uint16Array(count);
      for (i = 0; i < count; i++) u16[i] = out[i];
      return u16;
    }
    return out;
  }

  function parseGLB(buffer) {
    var dv = new DataView(buffer);
    if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('not glb');
    var offset = 12, json = null, bin = null, len, type;
    while (offset + 8 <= buffer.byteLength) {
      len = dv.getUint32(offset, true);
      type = dv.getUint32(offset + 4, true);
      offset += 8;
      if (type === 0x4E4F534A) {
        json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, offset, len)));
      } else if (type === 0x004E4942) {
        bin = buffer.slice(offset, offset + len);
      }
      offset += len;
    }
    return { json: json, bin: bin };
  }

  function loadImageFromView(gltf, bin, imageIndex) {
    return new Promise(function (resolve) {
      var img = gltf.images[imageIndex];
      if (!img) { resolve(null); return; }
      var blob, url, el;
      if (img.bufferView != null) {
        var view = gltf.bufferViews[img.bufferView];
        blob = new Blob(
          [bin.slice(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength)],
          { type: img.mimeType || 'image/png' }
        );
        url = URL.createObjectURL(blob);
      } else {
        resolve(null); return;
      }
      el = new Image();
      el.onload = function () {
        URL.revokeObjectURL(url);
        resolve(el);
      };
      el.onerror = function () {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      el.src = url;
    });
  }

  function makeTexture(image) {
    if (!image) return null;
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    return tex;
  }

  function interleave(pos, nrm, uv, count) {
    var data = new Float32Array(count * 8);
    var i, o;
    for (i = 0; i < count; i++) {
      o = i * 8;
      data[o] = pos[i * 3]; data[o + 1] = pos[i * 3 + 1]; data[o + 2] = pos[i * 3 + 2];
      if (nrm) {
        data[o + 3] = nrm[i * 3]; data[o + 4] = nrm[i * 3 + 1]; data[o + 5] = nrm[i * 3 + 2];
      } else {
        data[o + 3] = 0; data[o + 4] = 1; data[o + 5] = 0;
      }
      if (uv) { data[o + 6] = uv[i * 2]; data[o + 7] = uv[i * 2 + 1]; }
    }
    return data;
  }

  function gpuifyPrimitive(gltf, bin, prim, textures) {
    var pos = readAccessor(gltf, bin, prim.attributes.POSITION);
    var nrm = prim.attributes.NORMAL != null ? readAccessor(gltf, bin, prim.attributes.NORMAL) : null;
    var uv = prim.attributes.TEXCOORD_0 != null ? readAccessor(gltf, bin, prim.attributes.TEXCOORD_0) : null;
    var count = gltf.accessors[prim.attributes.POSITION].count;
    var vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, interleave(pos, nrm, uv, count), gl.STATIC_DRAW);
    var ibo = null, icount = 0, itype = gl.UNSIGNED_SHORT;
    if (prim.indices != null) {
      var idxAcc = gltf.accessors[prim.indices];
      var idx = readAccessor(gltf, bin, prim.indices);
      icount = idxAcc.count;
      ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      if (idx instanceof Uint16Array) {
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      } else {
        var u16 = new Uint16Array(icount);
        for (var i = 0; i < icount; i++) u16[i] = idx[i];
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, u16, gl.STATIC_DRAW);
      }
    }
    var color = [0.72, 0.74, 0.78];
    var tex = null;
    var mat = prim.material != null ? gltf.materials[prim.material] : null;
    if (mat && mat.pbrMetallicRoughness) {
      var pbr = mat.pbrMetallicRoughness;
      if (pbr.baseColorFactor) color = pbr.baseColorFactor.slice(0, 3);
      if (pbr.baseColorTexture && textures[pbr.baseColorTexture.index]) {
        tex = textures[pbr.baseColorTexture.index];
      }
    }
    return { vbo: vbo, ibo: ibo, count: icount || count, indexed: !!ibo, itype: itype, tex: tex, color: color };
  }

  function buildAsset(gltf, bin, textures) {
    var meshes = [];
    var m, p, prims, i, j;
    for (i = 0; i < (gltf.meshes || []).length; i++) {
      prims = [];
      for (j = 0; j < gltf.meshes[i].primitives.length; j++) {
        p = gltf.meshes[i].primitives[j];
        if (p.mode != null && p.mode !== 4) continue;
        prims.push(gpuifyPrimitive(gltf, bin, p, textures));
      }
      meshes.push(prims);
    }
    var nodes = [];
    for (i = 0; i < (gltf.nodes || []).length; i++) {
      m = gltf.nodes[i];
      nodes.push({
        name: m.name || '',
        mesh: m.mesh,
        children: m.children ? m.children.slice() : [],
        translation: m.translation ? m.translation.slice() : [0, 0, 0],
        rotation: m.rotation ? m.rotation.slice() : [0, 0, 0, 1],
        scale: m.scale ? m.scale.slice() : [1, 1, 1],
        matrix: m.matrix ? new Float32Array(m.matrix) : null,
        world: mat4Identity()
      });
    }
    var byName = {};
    for (i = 0; i < nodes.length; i++) {
      if (nodes[i].name) byName[nodes[i].name] = nodes[i];
    }
    var roots = (gltf.scenes && gltf.scenes[gltf.scene || 0] && gltf.scenes[gltf.scene || 0].nodes) || [0];
    return { meshes: meshes, nodes: nodes, byName: byName, roots: roots };
  }

  function updateWorld(asset) {
    function walk(idx, parent) {
      var n = asset.nodes[idx];
      var local = n.matrix ? n.matrix : mat4FromTRS(n.translation, n.rotation, n.scale);
      n.world = parent ? mat4Mul(parent, local) : local;
      for (var c = 0; c < n.children.length; c++) walk(n.children[c], n.world);
    }
    for (var i = 0; i < asset.roots.length; i++) walk(asset.roots[i], null);
  }

  function loadGLB(url) {
    if (assetCache[url]) return Promise.resolve(assetCache[url]);
    if (assetCache[url] === false) return Promise.reject(new Error('missing'));
    if (assetPending[url]) return assetPending[url];
    assetPending[url] = fetch(url).then(function (res) {
      if (!res.ok) throw new Error('asset ' + url);
      return res.arrayBuffer();
    }).then(function (buf) {
      var glb = parseGLB(buf);
      var imgs = glb.json.images || [];
      var jobs = [];
      for (var i = 0; i < imgs.length; i++) jobs.push(loadImageFromView(glb.json, glb.bin, i));
      return Promise.all(jobs).then(function (images) {
        var textures = [];
        for (var t = 0; t < images.length; t++) textures[t] = makeTexture(images[t]);
        var asset = buildAsset(glb.json, glb.bin, textures);
        updateWorld(asset);
        assetCache[url] = asset;
        delete assetPending[url];
        return asset;
      });
    }).catch(function (err) {
      console.warn('HOLLOW controller asset failed', url, err);
      assetCache[url] = false;
      delete assetPending[url];
      throw err;
    });
    return assetPending[url];
  }

  function fetchJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(r.statusText);
      return r.json();
    });
  }

  function fetchProfile(source) {
    var ready = profilesList
      ? Promise.resolve(profilesList)
      : fetchJson(PROFILES_PATH + '/profilesList.json').then(function (list) {
        profilesList = list;
        return list;
      });
    return ready.then(function (list) {
      var match = null, i, id, supported;
      var ids = source.profiles || [];
      for (i = 0; i < ids.length; i++) {
        id = ids[i];
        supported = list[id];
        if (supported) {
          match = { profileId: id, profilePath: PROFILES_PATH + '/' + supported.path };
          break;
        }
      }
      if (!match) {
        supported = list[DEFAULT_PROFILE];
        if (!supported) throw new Error('no controller profile');
        match = { profileId: DEFAULT_PROFILE, profilePath: PROFILES_PATH + '/' + supported.path };
      }
      return fetchJson(match.profilePath).then(function (profile) {
        var layout = profile.layouts[source.handedness] || profile.layouts.none ||
          profile.layouts[Object.keys(profile.layouts)[0]];
        if (!layout || !layout.assetPath) throw new Error('no layout asset');
        return {
          profile: profile,
          layout: layout,
          assetUrl: match.profilePath.replace('profile.json', layout.assetPath)
        };
      });
    });
  }

  function cloneAsset(src) {
    // GPU buffers are shared; node TRS is copied so button animation is per-hand.
    var nodes = [];
    var i, n;
    for (i = 0; i < src.nodes.length; i++) {
      n = src.nodes[i];
      nodes.push({
        name: n.name,
        mesh: n.mesh,
        children: n.children.slice(),
        translation: n.translation.slice(),
        rotation: n.rotation.slice(),
        scale: n.scale.slice(),
        matrix: n.matrix ? new Float32Array(n.matrix) : null,
        world: new Float32Array(n.world)
      });
    }
    var byName = {};
    for (i = 0; i < nodes.length; i++) {
      if (nodes[i].name) byName[nodes[i].name] = nodes[i];
    }
    return { meshes: src.meshes, nodes: nodes, byName: byName, roots: src.roots.slice() };
  }

  function applyVisuals(slot) {
    if (!slot.asset || !slot.layout || !slot.source || !slot.source.gamepad) {
      if (slot.asset) updateWorld(slot.asset);
      return;
    }
    var gp = slot.source.gamepad;
    var comps = slot.layout.components || {};
    var id, comp, vrName, vr, valueNode, minNode, maxNode, t, prop, btn, ax, ay, state;
    var TOUCH_BTN = 0.05, TOUCH_AXIS = 0.05;

    function axisNorm(x, y) {
      var h = Math.sqrt(x * x + y * y);
      if (h > 1) { x /= h; y /= h; }
      return { x: x * 0.5 + 0.5, y: y * 0.5 + 0.5 };
    }

    for (id in comps) {
      if (!Object.prototype.hasOwnProperty.call(comps, id)) continue;
      comp = comps[id];
      btn = 0; ax = 0; ay = 0; state = 'default';
      if (comp.gamepadIndices) {
        if (comp.gamepadIndices.button != null && gp.buttons[comp.gamepadIndices.button]) {
          btn = gp.buttons[comp.gamepadIndices.button].value;
          if (btn < 0) btn = 0; if (btn > 1) btn = 1;
          if (gp.buttons[comp.gamepadIndices.button].pressed || btn === 1) state = 'pressed';
          else if (gp.buttons[comp.gamepadIndices.button].touched || btn > TOUCH_BTN) state = 'touched';
        }
        if (comp.gamepadIndices.xAxis != null && gp.axes.length > comp.gamepadIndices.xAxis) {
          ax = gp.axes[comp.gamepadIndices.xAxis];
        }
        if (comp.gamepadIndices.yAxis != null && gp.axes.length > comp.gamepadIndices.yAxis) {
          ay = gp.axes[comp.gamepadIndices.yAxis];
        }
        if (state === 'default' && (Math.abs(ax) > TOUCH_AXIS || Math.abs(ay) > TOUCH_AXIS)) state = 'touched';
      }
      var nrm = axisNorm(ax, ay);
      for (vrName in (comp.visualResponses || {})) {
        if (!Object.prototype.hasOwnProperty.call(comp.visualResponses, vrName)) continue;
        vr = comp.visualResponses[vrName];
        if (vr.valueNodeProperty !== 'transform') continue;
        valueNode = slot.asset.byName[vr.valueNodeName];
        minNode = slot.asset.byName[vr.minNodeName];
        maxNode = slot.asset.byName[vr.maxNodeName];
        if (!valueNode || !minNode || !maxNode) continue;
        prop = vr.componentProperty;
        t = 0;
        if (vr.states && vr.states.indexOf(state) < 0) {
          t = (prop === 'xAxis' || prop === 'yAxis') ? 0.5 : 0;
        } else if (prop === 'button') t = btn;
        else if (prop === 'xAxis') t = nrm.x;
        else if (prop === 'yAxis') t = nrm.y;
        else t = 1;
        valueNode.translation = lerp3(minNode.translation, maxNode.translation, t);
        valueNode.rotation = quatSlerp(minNode.rotation, maxNode.rotation, t);
      }
    }
    updateWorld(slot.asset);
  }

  function emptySlot(handedness) {
    return {
      handedness: handedness,
      source: null,
      gen: 0,
      asset: null,
      layout: null,
      gripXR: null,
      visible: false,
      isHand: false
    };
  }

  function getSlot(hand) {
    if (!slots[hand]) slots[hand] = emptySlot(hand);
    return slots[hand];
  }

  function bindSource(source) {
    var hand = source.handedness || 'none';
    var slot = getSlot(hand);
    slot.source = source;
    slot.isHand = !!source.hand;
    slot.gen += 1;
    if (slot.isHand || source.targetRayMode !== 'tracked-pointer' || !source.gripSpace) {
      slot.visible = false;
      slot.gripXR = null;
      return;
    }
    var gen = slot.gen;
    fetchProfile(source).then(function (info) {
      if (!slots[hand] || slots[hand].gen !== gen) return;
      slot.layout = info.layout;
      return loadGLB(info.assetUrl).then(function (asset) {
        if (!slots[hand] || slots[hand].gen !== gen) return;
        slot.asset = cloneAsset(asset);
        slot.visible = !slot.isHand;
        updateWorld(slot.asset);
      });
    }).catch(function (err) {
      console.warn('HOLLOW controller profile failed', err);
    });
  }

  function onSourcesChanged() {
    if (!session) return;
    var seen = {};
    var i, src, hand, slot;
    for (i = 0; i < session.inputSources.length; i++) {
      src = session.inputSources[i];
      hand = src.handedness || 'none';
      seen[hand] = true;
      slot = getSlot(hand);
      if (slot.source !== src) bindSource(src);
      else {
        slot.isHand = !!src.hand;
        slot.visible = !!(slot.asset && !slot.isHand && src.gripSpace);
      }
    }
    for (hand in slots) {
      if (!Object.prototype.hasOwnProperty.call(slots, hand)) continue;
      if (!seen[hand]) {
        slots[hand].source = null;
        slots[hand].visible = false;
        slots[hand].gripXR = null;
        slots[hand].isHand = false;
      }
    }
  }

  function attach(xrSession) {
    detach();
    session = xrSession;
    if (!session) return;
    session.addEventListener('inputsourceschange', onSourcesChanged);
    onSourcesChanged();
  }

  function detach() {
    if (session) {
      try { session.removeEventListener('inputsourceschange', onSourcesChanged); } catch (e) { void e; }
    }
    session = null;
    var hand;
    for (hand in slots) {
      if (!Object.prototype.hasOwnProperty.call(slots, hand)) continue;
      slots[hand].source = null;
      slots[hand].visible = false;
      slots[hand].gripXR = null;
    }
  }

  function sync(frame, refSpace, player, bodyYaw) {
    lastPlayer = player;
    lastBodyYaw = bodyYaw || 0;
    if (player) {
      eyeX = player.x;
      eyeY = player.eye != null ? player.eye : 1.6;
      eyeZ = player.z;
    }
    if (!frame || !refSpace || !session) return;
    var hand, slot, pose;
    for (hand in slots) {
      if (!Object.prototype.hasOwnProperty.call(slots, hand)) continue;
      slot = slots[hand];
      if (!slot.source) { slot.gripXR = null; continue; }
      slot.isHand = !!slot.source.hand;
      if (slot.isHand || !slot.source.gripSpace) {
        slot.visible = false;
        slot.gripXR = null;
        continue;
      }
      pose = frame.getPose(slot.source.gripSpace, refSpace);
      if (!pose) { slot.visible = false; continue; }
      slot.gripXR = pose.transform.matrix;
      slot.visible = !!slot.asset;
      applyVisuals(slot);
    }
  }

  function draw(proj, view) {
    if (!prog || !lastPlayer) return;
    var hand, slot, i, n, prims, p, model, xrWorld;
    xrWorld = xrToWorld(lastPlayer, lastBodyYaw);
    gl.useProgram(prog);
    gl.uniformMatrix4fv(unis.uProj, false, proj);
    gl.uniformMatrix4fv(unis.uView, false, view);
    gl.uniform3f(unis.uEye, eyeX, eyeY, eyeZ);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);
    for (hand in slots) {
      if (!Object.prototype.hasOwnProperty.call(slots, hand)) continue;
      slot = slots[hand];
      if (!slot.visible || !slot.asset || !slot.gripXR) continue;
      var gripWorld = mat4Mul(xrWorld, slot.gripXR);
      for (i = 0; i < slot.asset.nodes.length; i++) {
        n = slot.asset.nodes[i];
        if (n.mesh == null) continue;
        prims = slot.asset.meshes[n.mesh];
        if (!prims) continue;
        model = mat4Mul(gripWorld, n.world);
        gl.uniformMatrix4fv(unis.uModel, false, model);
        for (p = 0; p < prims.length; p++) {
          drawPrim(prims[p]);
        }
      }
    }
  }

  function drawPrim(prim) {
    gl.uniform3f(unis.uColor, prim.color[0], prim.color[1], prim.color[2]);
    gl.uniform1f(unis.uHasTex, prim.tex ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, prim.tex || null);
    gl.uniform1i(unis.uTex, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, prim.vbo);
    gl.enableVertexAttribArray(attrs.aPos);
    gl.enableVertexAttribArray(attrs.aNrm);
    gl.enableVertexAttribArray(attrs.aUv);
    gl.vertexAttribPointer(attrs.aPos, 3, gl.FLOAT, false, 32, 0);
    gl.vertexAttribPointer(attrs.aNrm, 3, gl.FLOAT, false, 32, 12);
    gl.vertexAttribPointer(attrs.aUv, 2, gl.FLOAT, false, 32, 24);
    if (prim.indexed) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, prim.ibo);
      gl.drawElements(gl.TRIANGLES, prim.count, prim.itype, 0);
    } else {
      gl.drawArrays(gl.TRIANGLES, 0, prim.count);
    }
    gl.disableVertexAttribArray(attrs.aPos);
    gl.disableVertexAttribArray(attrs.aNrm);
    gl.disableVertexAttribArray(attrs.aUv);
  }

  NS.xrControllers = {
    init: init,
    attach: attach,
    detach: detach,
    sync: sync,
    draw: draw
  };
})(typeof window !== 'undefined' ? (window.HOLLOW = window.HOLLOW || {})
                                 : (global.HOLLOW = global.HOLLOW || {}));
