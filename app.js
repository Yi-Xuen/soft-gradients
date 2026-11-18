(function () {
  const $ = id => document.getElementById(id);
  const GW = 6, GH = 8;

  // ---- color math (sRGB <-> OKLab) ----
  const toLin = c => (c /= 255) <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4);
  const toSrgb = c => { c = Math.min(1, Math.max(0, c)); return 255 * (c <= .0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - .055); };
  function rgb2lab(r, g, b) {
    r = toLin(r); g = toLin(g); b = toLin(b);
    const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
    const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
    const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
    return [.2104542553 * l + .793617785 * m - .0040720468 * s,
            1.9779984951 * l - 2.428592205 * m + .4505937099 * s,
            .0259040371 * l + .7827717662 * m - .808675766 * s];
  }
  function lab2rgb([L, a, b]) {
    const l = Math.pow(L + .3963377774 * a + .2158037573 * b, 3);
    const m = Math.pow(L - .1055613458 * a - .0638541728 * b, 3);
    const s = Math.pow(L - .0894841775 * a - 1.291485548 * b, 3);
    return [toSrgb(4.0767416621 * l - 3.3077115913 * m + .2309699292 * s),
            toSrgb(-1.2684380046 * l + 2.6097574011 * m - .3413193965 * s),
            toSrgb(-.0041960863 * l - .7034186147 * m + 1.707614701 * s)];
  }
  const hex = lab => '#' + lab2rgb(lab).map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
  const unhex = h => rgb2lab(parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16));
  const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;

  // ---- state ----
  const state = { palette: [], cells: [], assign: [], seed: Math.random() * 100, hasImage: false };
  const canvas = $('gl'), ctx = canvas.getContext('2d');
  const glCanvas = document.createElement('canvas');
  let renderer;
  try { renderer = new GradientRenderer(glCanvas); } catch (e) { $('dropHint').textContent = e.message; return; }

  // ---- image analysis ----
  function analyze(img) {
    // small copy for k-means
    const sc = document.createElement('canvas'), W = 64, H = Math.max(8, Math.round(64 * img.height / img.width));
    sc.width = W; sc.height = H;
    const sctx = sc.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(img, 0, 0, W, H);
    const px = sctx.getImageData(0, 0, W, H).data, pts = [];
    for (let i = 0; i < px.length; i += 4) pts.push(rgb2lab(px[i], px[i + 1], px[i + 2]));
    state.pts = pts;

    // grid of area-averaged cells (draw to GW*8 x GH*8 then average)
    const gc = document.createElement('canvas'); gc.width = GW * 8; gc.height = GH * 8;
    const gctx = gc.getContext('2d', { willReadFrequently: true });
    gctx.drawImage(img, 0, 0, gc.width, gc.height);
    const gd = gctx.getImageData(0, 0, gc.width, gc.height).data;
    state.cells = [];
    for (let cy = 0; cy < GH; cy++) for (let cx = 0; cx < GW; cx++) {
      let acc = [0, 0, 0], n = 0;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const i = ((cy * 8 + y) * gc.width + cx * 8 + x) * 4, l = rgb2lab(gd[i], gd[i + 1], gd[i + 2]);
        acc[0] += l[0]; acc[1] += l[1]; acc[2] += l[2]; n++;
      }
      state.cells.push(acc.map(v => v / n));
    }
    recomputePalette();
  }

  function kmeans(pts, k) {
    // deterministic init: spread by lightness
    const sorted = pts.slice().sort((a, b) => a[0] - b[0]);
    let cent = Array.from({ length: k }, (_, i) => sorted[Math.floor((i + .5) / k * sorted.length)].slice());
    for (let it = 0; it < 20; it++) {
      const sum = cent.map(() => [0, 0, 0, 0]);
      for (const p of pts) {
        let bi = 0, bd = Infinity;
        cent.forEach((c, i) => { const d = d2(p, c); if (d < bd) { bd = d; bi = i; } });
        sum[bi][0] += p[0]; sum[bi][1] += p[1]; sum[bi][2] += p[2]; sum[bi][3]++;
      }
      cent = cent.map((c, i) => sum[i][3] ? [sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]] : c);
    }
    return cent.sort((a, b) => b[0] - a[0]); // light -> dark
  }

  function assignCells() {
    state.assign = state.cells.map(c => {
      let bi = 0, bd = Infinity;
      state.palette.forEach((p, i) => { const d = d2(c, p); if (d < bd) { bd = d; bi = i; } });
      return bi;
    });
  }

  function recomputePalette() {
    state.palette = kmeans(state.pts, +$('colors').value);
    assignCells();
    buildSwatches();
    draw();
  }

  function buildSwatches() {
    closePicker();
    const box = $('swatches'); box.innerHTML = '';
    state.palette.forEach((lab, i) => {
      const h = hex(lab), d = document.createElement('div');
      d.className = 'sw'; d.style.background = h; d.tabIndex = 0; d.setAttribute('role', 'button'); d.setAttribute('aria-label', 'Edit colour ' + h);
      d.innerHTML = `<span>${h}</span>`;
      d.addEventListener('click', () => (pk.i === i && !$('picker').hidden) ? closePicker() : openPicker(i, d));
      d.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); d.click(); } });
      box.appendChild(d);
    });
  }

  // ---- colour picker: saturation/brightness square, hue bar, HEX / RGB / HSL value, copy, eyedropper ----
  const pk = { i: -1, h: 0, s: 0, v: 0, fmt: 0 }, FMTS = ['HEX', 'RGB', 'HSL'];
  const clamp01 = x => Math.min(1, Math.max(0, x));
  function rgb2hsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0;
    if (d) { h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
    return [h, mx ? d / mx : 0, mx];
  }
  function hsv2rgb(h, s, v) {
    const f = n => { const k = (n + h / 60) % 6; return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255; };
    return [f(5), f(3), f(1)];
  }
  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0, h = rgb2hsv(r * 255, g * 255, b * 255)[0];
    return [h, s, l];
  }
  function hsl2rgb(h, s, l) {
    const a = s * Math.min(l, 1 - l), f = n => { const k = (n + h / 30) % 12; return (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255; };
    return [f(0), f(8), f(4)];
  }
  const rgbHex = rgb => '#' + rgb.map(x => Math.round(x).toString(16).padStart(2, '0')).join('').toUpperCase();
  const pkRGB = () => hsv2rgb(pk.h, pk.s, pk.v).map(Math.round);
  function pkText() {
    const rgb = pkRGB();
    if (pk.fmt === 0) return rgbHex(rgb);
    if (pk.fmt === 1) return rgb.join(', ');
    const [h, s, l] = rgb2hsl(...rgb); return `${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%`;
  }
  function pkParse(t) { // text in the current format -> [r,g,b] or null
    t = t.trim();
    if (pk.fmt === 0) {
      const m = t.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i); if (!m) return null;
      let x = m[1]; if (x.length === 3) x = [...x].map(c => c + c).join('');
      return [0, 2, 4].map(i => parseInt(x.slice(i, i + 2), 16));
    }
    const n = t.replace(/[a-z()%]/gi, ' ').split(/[\s,]+/).filter(Boolean).map(Number);
    if (n.length !== 3 || n.some(isNaN)) return null;
    if (pk.fmt === 1) return n.every(v => v >= 0 && v <= 255) ? n : null;
    return n[0] >= 0 && n[0] <= 360 && n[1] >= 0 && n[1] <= 100 && n[2] >= 0 && n[2] <= 100 ? hsl2rgb(n[0], n[1] / 100, n[2] / 100) : null;
  }
  let pkDrawRaf = 0;
  function pkRender(skipInput) {
    const el = $('picker'), rgb = pkRGB(), h = rgbHex(rgb);
    el.style.setProperty('--h', Math.round(pk.h));
    $('pkSVh').style.left = pk.s * 100 + '%'; $('pkSVh').style.top = (1 - pk.v) * 100 + '%';
    $('pkHueh').style.left = pk.h / 360 * 100 + '%';
    $('pkPrev').style.background = h;
    if (!skipInput) $('pkVal').value = pkText();
    // push the colour into the palette + swatch, and redraw the gradient
    if (pk.i >= 0 && state.palette[pk.i]) {
      state.palette[pk.i] = rgb2lab(...rgb);
      const sw = $('swatches').children[pk.i];
      if (sw) { sw.style.background = h; sw.querySelector('span').textContent = h; }
      cancelAnimationFrame(pkDrawRaf); pkDrawRaf = requestAnimationFrame(draw);
    }
  }
  function pkSetRGB(rgb, keepHue) {
    const [h, s, v] = rgb2hsv(...rgb);
    pk.h = keepHue && (s === 0 || v === 0) ? pk.h : h; pk.s = s; pk.v = v; pkRender();
  }
  function placePicker() {
    const el = $('picker'), sw = $('swatches').children[pk.i]; if (!sw || el.hidden) return;
    const r = sw.getBoundingClientRect(), w = el.offsetWidth, hh = el.offsetHeight;
    let top = r.bottom + 10; if (top + hh > innerHeight - 8) top = Math.max(8, r.top - hh - 10);
    el.style.left = Math.min(Math.max(8, r.left), innerWidth - w - 8) + 'px'; el.style.top = top + 'px';
  }
  function openPicker(i, swEl) {
    closePicker(); pk.i = i;
    const [h, s, v] = rgb2hsv(...lab2rgb(state.palette[i]).map(x => Math.min(255, Math.max(0, Math.round(x)))));
    pk.h = h; pk.s = s; pk.v = v;
    $('picker').hidden = false; swEl.classList.add('on');
    $('pkRow').classList.toggle('noeye', !window.EyeDropper); $('pkEye').style.display = window.EyeDropper ? '' : 'none';
    $('pkFmtL').textContent = FMTS[pk.fmt];
    pk.i = -1; pkRender(); pk.i = i; // fill the UI without rewriting the palette on open
    placePicker();
  }
  function closePicker() {
    const el = $('picker'); if (!el || el.hidden) { pk.i = -1; return; }
    el.hidden = true; pk.i = -1; document.querySelectorAll('.sw.on').forEach(x => x.classList.remove('on'));
  }
  function drag(el, fn) {
    el.addEventListener('pointerdown', e => {
      e.preventDefault(); el.setPointerCapture(e.pointerId); fn(e);
      const mv = ev => fn(ev), up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
    });
  }
  drag($('pkSV'), e => { const r = $('pkSV').getBoundingClientRect(); pk.s = clamp01((e.clientX - r.left) / r.width); pk.v = 1 - clamp01((e.clientY - r.top) / r.height); pkRender(); });
  drag($('pkHue'), e => { const r = $('pkHue').getBoundingClientRect(); pk.h = clamp01((e.clientX - r.left) / r.width) * 360; pkRender(); });
  $('pkFmt').addEventListener('click', () => { pk.fmt = (pk.fmt + 1) % 3; $('pkFmtL').textContent = FMTS[pk.fmt]; $('pkVal').value = pkText(); });
  $('pkVal').addEventListener('input', () => { const rgb = pkParse($('pkVal').value); if (rgb) { const [h, s, v] = rgb2hsv(...rgb); pk.h = (s === 0 || v === 0) ? pk.h : h; pk.s = s; pk.v = v; pkRender(true); } });
  $('pkVal').addEventListener('blur', () => { $('pkVal').value = pkText(); });
  $('pkVal').addEventListener('keydown', e => { if (e.key === 'Enter') $('pkVal').blur(); });
  $('pkCopy').addEventListener('click', () => {
    navigator.clipboard.writeText($('pkVal').value);
    const b = $('pkCopy'), old = b.innerHTML; b.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
    setTimeout(() => b.innerHTML = old, 1100);
  });
  $('pkEye').addEventListener('click', async () => {
    try { const x = (await new window.EyeDropper().open()).sRGBHex; pkSetRGB([1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16)), false); } catch {}
  });
  document.addEventListener('pointerdown', e => { if (!$('picker').hidden && !e.target.closest('#picker, .sw')) closePicker(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePicker(); });
  window.addEventListener('resize', placePicker); window.addEventListener('scroll', placePicker, true);

  // ---- drawing ----
  function render(w, h, target) {
    const data = new Float32Array(GW * GH * 3);
    state.cells.forEach((c, i) => {
      const p = state.palette[state.assign[i]], k = .85;
      for (let j = 0; j < 3; j++) data[i * 3 + j] = c[j] * (1 - k) + p[j] * k;
    });
    renderer.setGrid(data, GW, GH);
    renderer.render({ width: w, height: h, warp: $('warp').value / 100, smooth: $('smooth').value / 100,
                      grain: $('grain').value / 100, seed: state.seed });
    target.width = w; target.height = h;
    const t = target.getContext('2d');
    t.drawImage(glCanvas, 0, 0);
    if ($('showTitle').checked || $('showHex').checked) drawLabels(t, w, h, data);
  }


  // ---- palette naming: "Dune Ember", "Misty Fern Pine" ... (lightest + darkest colour, optional mood word) ----
  const HUE_NAMES = [ // [from-hue, dark, mid, light] nouns (OKLab hue, degrees)
    [345, ['Garnet', 'Claret', 'Rosewood'], ['Clay', 'Rust', 'Terracotta'], ['Blush', 'Petal', 'Rosewater']],
    [20,  ['Ember', 'Umber', 'Cedar'], ['Ember', 'Copper', 'Russet'], ['Peach', 'Apricot', 'Sunrise']],
    [45,  ['Umber', 'Walnut', 'Hearth'], ['Amber', 'Ochre', 'Caramel'], ['Dune', 'Honey', 'Sand']],
    [80,  ['Olive', 'Bronze', 'Tobacco'], ['Ochre', 'Wheat', 'Straw'], ['Linen', 'Butter', 'Sunlit']],
    [115, ['Pine', 'Forest', 'Moss'], ['Fern', 'Moss', 'Meadow'], ['Sage', 'Lichen', 'Willow']],
    [160, ['Spruce', 'Kelp', 'Abyss'], ['Lagoon', 'Tide', 'Verdigris'], ['Seafoam', 'Mist', 'Glacier']],
    [200, ['Fjord', 'Deepsea', 'Midnight'], ['Harbor', 'Cove', 'Tide'], ['Sky', 'Haze', 'Breeze']],
    [245, ['Midnight', 'Indigo', 'Nightfall'], ['Dusk', 'Slate', 'Cobalt'], ['Mist', 'Cloud', 'Skyline']],
    [290, ['Plum', 'Aubergine', 'Twilight'], ['Heather', 'Lilac', 'Mauve'], ['Lavender', 'Orchid', 'Petal']],
  ];
  const NEUTRAL = [['Ink', 'Charcoal', 'Shadow'], ['Stone', 'Ash', 'Smoke'], ['Fog', 'Pearl', 'Bone']];
  const MOODS = { // mood nouns, so every word in the name is a noun
    softLight: ['Haze', 'Hush', 'Veil', 'Drift'], vividLight: ['Glow', 'Bloom', 'Daybreak'],
    dark: ['Nocturne', 'Shade', 'Eclipse', 'Hollow'], softMid: ['Dust', 'Echo', 'Patina', 'Drift'], vividMid: ['Bloom', 'Blaze', 'Canopy'],
  };
  const hash = str => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  function noun(lab, key) {
    const C = Math.hypot(lab[1], lab[2]), tier = lab[0] < .45 ? 0 : lab[0] < .75 ? 1 : 2;
    let list;
    if (C < .016) list = NEUTRAL[tier];
    else {
      const h = (Math.atan2(lab[2], lab[1]) * 180 / Math.PI + 360) % 360;
      let band = HUE_NAMES[0];
      for (const b of HUE_NAMES) if (h >= b[0]) band = b;
      list = band[1 + tier];
    }
    return list[hash(key) % list.length];
  }
  function paletteName(pal) {
    if (!pal.length) return 'Gradient';
    const key = pal.map(hex).join('');
    const byL = pal.slice().sort((a, b) => b[0] - a[0]), light = byL[0], dark = byL[byL.length - 1];
    const a = noun(light, key + 'l'); let b = noun(dark, key + 'd');
    const avgL = pal.reduce((s, c) => s + c[0], 0) / pal.length, avgC = pal.reduce((s, c) => s + Math.hypot(c[1], c[2]), 0) / pal.length;
    const pool = avgL > .72 ? (avgC < .06 ? MOODS.softLight : MOODS.vividLight) : avgL < .42 ? MOODS.dark : (avgC < .06 ? MOODS.softMid : MOODS.vividMid);
    const mood = pool[hash(key + 'm') % pool.length];
    if (a === b) return `${a} ${mood}`;                                 // same family: noun + mood noun
    return hash(key + 'w') % 2 ? `${a} ${b}` : `${a} ${b} ${mood}`;    // 2 or 3 nouns, e.g. "Dune Ember", "Sage Pine Haze"
  }

  function drawLabels(t, w, h, data) {
    const dark = data[(GH - 1) * GW * 3] < .6; // lightness behind the labels (bottom-left)
    t.fillStyle = dark ? 'rgba(255,255,255,.85)' : 'rgba(30,20,10,.8)';
    const f = Math.round(w * .014), pad = w * .07, hf = Math.round(f * 1.3);
    t.textBaseline = 'top';
    const showHex = $('showHex').checked, showTitle = $('showTitle').checked;
    if (showTitle) {
      t.font = `400 ${f * 2}px "Sorts Mill Goudy", Georgia, serif`;
      t.fillText(paletteName(state.palette), pad, showHex ? h - pad - hf - f * 3.4 : h - pad - f * 2);
    }
    if (showHex) {
      // hex codes spread edge to edge inside the margins, equal space between them
      t.font = `500 ${hf}px "Open Sans", sans-serif`;
      const codes = state.palette.map(hex), widths = codes.map(c => t.measureText(c).width);
      const free = w - pad * 2 - widths.reduce((a, b) => a + b, 0), gap = codes.length > 1 ? free / (codes.length - 1) : 0;
      let x = pad;
      codes.forEach((c, i) => { t.fillText(c, x, h - pad - hf); x += widths[i] + gap; });
    }
  }

  function draw() {
    if (!state.hasImage) return;
    const ratio = +$('ratio').value, st = document.querySelector('.stage');
    const narrow = window.innerWidth <= 640;
    // wide ratios (16:9) stack the photo above the gradient instead of side by side
    const stacked = !narrow && ratio > 1.2;
    st.classList.toggle('stacked', stacked);
    let w, h;
    if (stacked) { h = Math.min(st.clientWidth / ratio, 360); w = h * ratio; }
    else {
      const availW = narrow ? st.clientWidth : st.clientWidth / 2;
      const availH = narrow ? window.innerHeight * .5 : Math.min(window.innerHeight * .7, 640);
      h = Math.min(availH, availW / ratio); w = h * ratio;
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    render(Math.round(w * dpr), Math.round(h * dpr), canvas);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    // photo panel and gradient panel share the exact same size; stage hugs them
    st.style.height = narrow ? 'auto' : (stacked ? h * 2 : h) + 'px';
    for (const el of [$('drop'), canvas.parentElement]) {
      el.style.flex = 'none'; el.style.width = w + 'px'; el.style.height = h + 'px';
    }
  }

  // ---- loading ----
  const showEditor = img => { state.hasImage = true; document.body.classList.remove('empty'); document.body.classList.add('has'); analyze(img); };
  function loadUrl(url, cors, fly) {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.onload = () => {
      $('orig').style.backgroundImage = `url("${url}")`; $('orig').hidden = false; state.url = url;
      if (fly) fly(img); else showEditor(img);
    };
    img.onerror = () => {
      $('dropHint').textContent = 'Could not load that image';
      if (fly) fly(null);
    };
    img.src = url;
  }

  // ---- editor -> wall transition: photo shrinks back to its tile (or the wall's centre), controls fade out ----
  function leaveEditor() {
    if (busy) return; busy = true; closePicker();
    const from = $('drop').getBoundingClientRect(), fl = document.createElement('div');
    fl.className = 'flyer back';
    Object.assign(fl.style, { left: from.left + 'px', top: from.top + 'px', width: from.width + 'px', height: from.height + 'px',
                              backgroundImage: `url("${state.url}")` });
    document.body.appendChild(fl);
    document.body.classList.add('entering', 'flying'); // gradient + controls fade out, photo panel handed to the flyer
    const FLY = REDUCED ? 0 : 920;
    setTimeout(() => {
      board.classList.add('fade');
      document.body.classList.add('empty');
      const tile = [...worldEl.children].find(t => t.dataset.full === state.url);
      if (tile) { // pan the wall so the photo's own tile sits in the middle
        px = board.clientWidth / 2 - (parseFloat(tile.style.left) + tile.offsetWidth / 2);
        py = board.clientHeight / 2 - (parseFloat(tile.style.top) + tile.offsetHeight / 2);
      }
      place();
      let to;
      if (tile) to = tile.getBoundingClientRect();
      else { const b = board.getBoundingClientRect(); to = { left: b.left + (b.width - 230) / 2, top: b.top + (b.height - 288) / 2, width: 230, height: 288 }; }
      fl.offsetWidth; // commit start frame
      fl.classList.add('goback');
      Object.assign(fl.style, { left: to.left + 'px', top: to.top + 'px', width: to.width + 'px', height: to.height + 'px' });
      if (!tile) fl.style.opacity = 0; // no tile to land on: dissolve into the wall
      board.classList.remove('fade'); // wall fades in around it
      setTimeout(() => {
        fl.remove(); document.body.classList.remove('entering', 'flying'); busy = false;
      }, FLY);
    }, REDUCED ? 0 : 450);
  }

  // ---- wall -> editor transition: picked photo grows into the preview panel, then the rest fades in ----
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let busy = false;
  function pick(p, tile) {
    busy = true;
    const r = tile.getBoundingClientRect(), fl = document.createElement('div');
    fl.className = 'flyer';
    Object.assign(fl.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px',
                              backgroundImage: `url("${p.board || p.thumb}")` });
    document.body.appendChild(fl);
    board.classList.add('fade'); // rest of the wall fades out
    const t0 = performance.now(), FADE = REDUCED ? 0 : 300, FLY = REDUCED ? 0 : 920;
    loadUrl(p.full, true, img => {
      const abort = !img;
      setTimeout(() => {
        if (abort) { fl.remove(); board.classList.remove('fade'); busy = false; return; }
        document.body.classList.add('entering', 'flying'); // controls + gradient start hidden
        showEditor(img);
        const to = $('drop').getBoundingClientRect();
        fl.style.backgroundImage = `url("${p.full}")`;
        fl.offsetWidth; // commit start frame
        fl.classList.add('go');
        Object.assign(fl.style, { left: to.left + 'px', top: to.top + 'px', width: to.width + 'px', height: to.height + 'px' });
        setTimeout(() => {
          document.body.classList.remove('flying'); fl.remove(); board.classList.remove('fade');
          document.body.classList.remove('entering'); // fade in gradient + controls
          busy = false;
        }, FLY);
      }, Math.max(0, FADE - (performance.now() - t0)));
    });
  }
  function load(file) {
    if (!file || !file.type.startsWith('image/')) return;
    document.querySelectorAll('.thumbs .on').forEach(b => b.classList.remove('on'));
    usePhoto(null);
    loadUrl(URL.createObjectURL(file), false);
  }

  // ---- Unsplash gallery ----
  // Curated landscape/scenery shots (no close-ups): [image id, n = nature / w = wallpaper, photographer, profile, download endpoint].
  const CURATED = [
    ["1506744038136-46273834b3fb", "n", "Bailey Zindel", "https://unsplash.com/@baileyzindel", "https://api.unsplash.com/photos/NRQV-hBF10M/download?ixid=M3wxMTM3MzM2fDB8MXxzZWFyY2h8MTJ8fG5hdHVyZSUyMHdhbGxwYXBlcnxlbnwxfDB8fHwxNzk0OTc5NDQxfDA"],
    ["1469474968028-56623f02e42e", "n", "Urban Vintage", "https://unsplash.com/@urban_vintage", "https://api.unsplash.com/photos/78A265wPiO4/download?ixid=M3wxMTM3MzM2fDB8MXxzZWFyY2h8MTN8fGxhbmRzY2FwZXxlbnwxfDB8fHwxNzk0OTc5NDMwfDA"],
    ["1441974231531-c6227db76b6e", "n", "Lukasz Szmigiel", "https://unsplash.com/@szmigieldesign", "https://api.unsplash.com/photos/jFCViYFYcus/download?ixid=M3wxMTM3MzM2fDB8MXxzZWFyY2h8Mjd8fG5hdHVyZSUyMHdhbGxwYXBlcnxlbnwxfDB8fHwxNzk0OTc5NDQxfDA"],
    ["1507525428034-b723cf961d3e", "n", "Sean Oulashin", "https://unsplash.com/@oulashin", "https://api.unsplash.com/photos/KMn4VEeEPR8/download?ixid=M3wxMTM3MzM2fDB8MXxzZWFyY2h8MXx8b2NlYW4lMjBiZWFjaHxlbnwxfDB8fHwxNzk0OTc5NDM4fDA"],
    ["1500382017468-9049fed747ef", "n", "Federico Respini", "https://unsplash.com/@federicorespini", "https://api.unsplash.com/photos/sYffw0LNr7s/download?ixid=M3wxMTM3MzM2fDB8MXxzZWFyY2h8Njh8fHN1bnNldHxlbnwxfDB8fHwxNzk0OTc5NDM1fDA"],
    ["1470071459604-3b5ec3a7fe05", "n", "v2osk", "https://unsplash.com/@v2osk", "https://api.unsplash.com/photos/1Z2niiBPg5A/download?ixid=M3wxMTM3MzM2fDB8MXxzZWFyY2h8MjN8fG5hdHVyZSUyMHdhbGxwYXBlcnxlbnwxfDB8fHwxNzk0OTc5NDQxfDA"],
    ["1464822759023-fed622ff2c3b", "w", "Kalen Emsley", "https://unsplash.com/@kalenemsley", "https://api.unsplash.com/photos/Bkci_8qcdvQ/download?ixid=M3wxMTM3MzM2fDB8MXxzZWFyY2h8M3x8bmF0dXJlJTIwd2FsbHBhcGVyfGVufDF8MHx8fDE3OTQ5Nzk0NDF8MA"],
    ["1472214103451-9374bd1c798e", "n", "Robert Lukeman", "https://unsplash.com/@robertlukeman", "https://api.unsplash.com/photos/_RBcxo9AU-U/download?ixid=M3wxMTM3MzM2fDB8MXxzZWFyY2h8MTN8fG5hdHVyZSUyMHdhbGxwYXBlcnxlbnwxfDB8fHwxNzk0OTc5NDQxfDA"],
    ["1501785888041-af3ef285b470", "n", "Pietro De Grandi", "https://unsplash.com/@peter_mc_greats", "https://api.unsplash.com/photos/T7K4aEPoGGk/download?ixid=M3wxMTM3MzM2fDB8MXxzZWFyY2h8MXx8bmF0dXJlJTIwd2FsbHBhcGVyfGVufDF8MHx8fDE3OTQ5Nzk0NDF8MA"],
    ["1519681393784-d120267933ba", "w", "Benjamin Voros", "https://unsplash.com/@vorosbenisop", "https://api.unsplash.com/photos/phIFdC6lA4E/download?ixid=M3wxMTM3MzM2fDB8MXxzZWFyY2h8MjR8fHNreXxlbnwxfDB8fHwxNzk0OTc5NDQ5fDA"],
    ["1426604966848-d7adac402bff", "n", "Adam Kool", "https://unsplash.com/@adamkool", "https://api.unsplash.com/photos/ndN00KmbJ1c/download?ixid=M3wxMTM3MzM2fDB8MXxzZWFyY2h8MzJ8fG5hdHVyZSUyMHdhbGxwYXBlcnxlbnwxfDB8fHwxNzk0OTc5NDQxfDA"],
    ["1454496522488-7a8e488e8606", "w", "Rohit Tandon", "https://unsplash.com/@sepoys", "https://api.unsplash.com/photos/9wg5jCEPBsw/download?ixid=M3wxMTM3MzM2fDB8MXxzZWFyY2h8Mnx8bW91bnRhaW5zfGVufDF8MHx8fDE3OTQ5Nzk0MzF8MA"],
    ["1442120108414-42e7ea50d0b5", "n", "Eutah Mizushima", "https://unsplash.com/@eutahm", "https://api.unsplash.com/photos/OWwK_0_EnxY/download?ixid=M3wxMTM3MzM2fDB8MXxzZWFyY2h8MTJ8fHNjZW5pYyUyMGxhbmRzY2FwZSUyMHZpZXd8ZW58MXwwfHx8MTc5NDk3OTQ2Nnww"],
    ["1438786657495-640937046d18", "n", "Claudel Rheault", "https://unsplash.com/@claudelrheault", "https://api.unsplash.com/photos/ZVbv1akA-l4/download?ixid=M3wxMTM3MzM2fDB8MXxzZWFyY2h8MXx8c2NlbmljJTIwbGFuZHNjYXBlJTIwdmlld3xlbnwxfDB8fHwxNzk0OTc5NDY2fDA"],
    ["1477346611705-65d1883cee1e", "w", "JOHN TOWNER", "https://unsplash.com/@heytowner", "https://api.unsplash.com/photos/JgOeRuGD_Y4/download?ixid=M3wxMTM3MzM2fDB8MXxzZWFyY2h8MTd8fG1vdW50YWluc3xlbnwxfDB8fHwxNzk0OTc5NDMxfDA"],
    ["1470252649378-9c29740c9fa8", "w", "Dawid Zawiła", "https://unsplash.com/@davealmine", "https://api.unsplash.com/photos/-G3rw6Y02D0/download?ixid=M3wxMTM3MzM2fDB8MXxzZWFyY2h8Nnx8c3Vuc2V0fGVufDF8MHx8fDE3OTQ5Nzk0MzR8MA"],
    ["1473580044384-7ba9967e16a0", "w", "Giorgio Parravicini", "https://unsplash.com/@parradesign", "https://api.unsplash.com/photos/12IHVEFRacQ/download?ixid=M3wxMTM3MzM2fDB8MXxzZWFyY2h8NHx8ZGVzZXJ0fGVufDF8MHx8fDE3OTQ5Nzk0Mzl8MA"],
    ["1483921020237-2ff51e8e4b22", "w", "Erol Ahmed", "https://unsplash.com/@erol", "https://api.unsplash.com/photos/d3pTF3r_hwY/download?ixid=M3wxMTM3MzM2fDB8MXxzZWFyY2h8MXx8c25vd3klMjBtb3VudGFpbnN8ZW58MXwwfHx8MTc5NDk3OTQ2N3ww"],
    ["1475924156734-496f6cac6ec1", "w", "Quino Al", "https://unsplash.com/@quinoal", "https://api.unsplash.com/photos/mBQIfKlvowM/download?ixid=M3wxMTM3MzM2fDB8MXxzZWFyY2h8M3x8c3Vuc2V0fGVufDF8MHx8fDE3OTQ5Nzk0MzR8MA"],
    ["1439066615861-d1af74d74000", "n", "Aaron Burden", "https://unsplash.com/@aaronburden", "https://api.unsplash.com/photos/aRya3uMiNIA/download?ixid=M3wxMTM3MzM2fDB8MXxzZWFyY2h8OXx8bGFrZXxlbnwxfDB8fHwxNzk0OTc5NDM2fDA"],
    ["1507371341162-763b5e419408", "n", "Ricardo Gomez Angel", "https://unsplash.com/@rgaleriacom", "https://api.unsplash.com/photos/4hhP-Ud4e84/download?ixid=M3wxMTM3MzM2fDB8MXxzZWFyY2h8OHx8YXV0dW1uJTIwZm9yZXN0fGVufDF8MHx8fDE3OTQ5Nzk0Njh8MA"],
    ["1494500764479-0c8f2919a3d8", "n", "Ken Cheung", "https://unsplash.com/@kencheungphoto", "https://api.unsplash.com/photos/KonWFWUaAuk/download?ixid=M3wxMTM3MzM2fDB8MXxzZWFyY2h8MTB8fGxha2V8ZW58MXwwfHx8MTc5NDk3OTQzNnww"],
    ["1535025075092-5a1cf795130b", "n", "Tobias Tullius", "https://unsplash.com/@tobiastu", "https://api.unsplash.com/photos/RhjVGxILcqE/download?ixid=M3wxMTM3MzM2fDB8MXxzZWFyY2h8MjN8fGhpbGxzJTIwYXQlMjBzdW5yaXNlfGVufDF8MHx8fDE3OTQ5Nzk0Njd8MA"],
    ["1504386106331-3e4e71712b38", "w", "Andrey Grinkevich", "https://unsplash.com/@grin", "https://api.unsplash.com/photos/0x6RTts1jRU/download?ixid=M3wxMTM3MzM2fDB8MXxzZWFyY2h8MXx8aGlsbHMlMjBhdCUyMHN1bnJpc2V8ZW58MXwwfHx8MTc5NDk3OTQ2N3ww"],
    ["1500885168199-dc1fde1d8177", "n", "Niklas Tidbury", "https://unsplash.com/@ntidbury", "https://api.unsplash.com/photos/r2vxqvKXng8/download?ixid=M3wxMTM3MzM2fDB8MXxzZWFyY2h8OHx8c2NlbmljJTIwbGFuZHNjYXBlJTIwdmlld3xlbnwxfDB8fHwxNzk0OTc5NDY2fDA"],
    ["1477468572316-36979010099d", "w", "Paul Pastourmatzis", "https://unsplash.com/@paulpastourmatzis", "https://api.unsplash.com/photos/r0J9sGBWFOc/download?ixid=M3wxMTM3MzM2fDB8MXxzZWFyY2h8N3x8c25vd3klMjBtb3VudGFpbnN8ZW58MXwwfHx8MTc5NDk3OTQ2N3ww"],
  ].map(([id, c, name, profile, dl]) => ({ thumb: `https://images.unsplash.com/photo-${id}?w=240&q=60&auto=format&fit=crop`,
                        board: `https://images.unsplash.com/photo-${id}?w=560&q=65&auto=format&fit=crop`,
                        full: `https://images.unsplash.com/photo-${id}?w=900&q=75&auto=format&fit=crop`, cat: c, name, profile, dl }));



  // ---- Unsplash API guidelines: attribution + download tracking ----
  // Base URL of the proxy Worker in /worker (it keeps the Unsplash key off the page). Empty = search is hidden.
  const PROXY = '';
  const UTM = 'utm_source=soft_gradients&utm_medium=referral';
  const withUtm = u => u + (u.includes('?') ? '&' : '?') + UTM;
  const link = (href, text) => { const x = document.createElement('a'); x.href = withUtm(href); x.target = '_blank'; x.rel = 'noopener'; x.textContent = text; return x; };
  // "Photo by <name> on Unsplash" (or "Photo from Unsplash" for the curated set, whose photographers we don't have)
  function fillCredit(el, p) {
    el.replaceChildren();
    if (p.name) el.append('Photo by ', link(p.profile, p.name), ' on ', link('https://unsplash.com/', 'Unsplash'));
    else el.append('Photo from ', link('https://unsplash.com/', 'Unsplash'));
  }
  const counted = new Set();
  function usePhoto(p) {
    const el = $('photoCredit');
    if (p) { fillCredit(el, p); el.hidden = false; } else el.hidden = true;
    if (PROXY && p && p.dl && !counted.has(p.dl)) { // tell Unsplash the photo was used (the proxy holds the API key)
      counted.add(p.dl);
      fetch(`${PROXY}/download?loc=${encodeURIComponent(p.dl)}`).catch(() => {});
    }
  }

  let cat = 'all', items = CURATED;
  function renderThumbs() {
    const box = $('thumbs'), world = $('world'); box.innerHTML = ''; world.innerHTML = '';
    const list = items.filter(p => cat === 'all' || !p.cat || (cat === 'nature') === (p.cat === 'n'));
    const mark = url => box.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.full === url));
    const L = layoutCircle(list.length);
    list.forEach((p, i) => {
      // strip thumbnail (used once a photo is chosen)
      const b = document.createElement('button'); b.type = 'button'; b.dataset.full = p.full;
      b.innerHTML = `<img loading="lazy" alt="" src="${p.thumb}">`;
      b.addEventListener('click', () => { mark(p.full); usePhoto(p); loadUrl(p.full, true); });
      box.appendChild(b);
      // wall tile (empty state), staggered columns
      const t = document.createElement('div'); t.className = 'tile'; t.tabIndex = 0; t.setAttribute('role', 'button');
      const r = L.rects[i];
      t.style.left = r.x + 'px'; t.style.top = r.y + 'px';
      t.style.width = r.w + 'px'; t.style.height = r.h + 'px';
      t.dataset.full = p.full;
      t.innerHTML = `<img alt="" draggable="false" src="${p.board || p.thumb}">`;
      if (p.name) { const c = document.createElement('div'); c.className = 'tileCredit'; fillCredit(c, p); t.appendChild(c); }
      const go = () => { if (panMoved > 6 || busy) return; mark(p.full); usePhoto(p); pick(p, t); };
      t.addEventListener('click', e => { if (e.target.closest('a')) return; go(); });
      t.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('a')) { e.preventDefault(); panMoved = 0; go(); } });
      world.appendChild(t);
    });
    world.style.width = L.w + 'px'; world.style.height = L.h + 'px';
    centerWorld();
  }

  // ---- draggable photo wall ----
  const GAP = 28, PAD = 80;
  const RATIOS = [0.75, 1, 1.333, 0.667, 1.25]; // 3:4, 1:1, 4:3, 2:3, 5:4 (width/height)
  const WIDTHS = [140, 180, 220, 270];          // mixed sizes so the wall doesn't read as a grid
  // Tiles spiral outward from the centre: biggest first in the middle, each one dropped at the first
  // free spot along the spiral, so the whole wall grows into a rough circle.
  function layoutCircle(n) {
    const rnd = i => ((Math.imul(i + 1, 2654435761) >>> 0) % 1000) / 1000;
    const sizes = Array.from({ length: n }, (_, i) => {
      const w = WIDTHS[Math.floor(rnd(i * 3 + 1) * WIDTHS.length)];
      const ar = RATIOS[Math.floor(rnd(i * 3 + 2) * RATIOS.length)];
      return { i, w, h: Math.round(w / ar) };
    });
    const order = [...sizes].sort((a, b) => b.w * b.h - a.w * a.h);
    const rects = new Array(n), placed = [];
    const free = (x, y, w, h) => placed.every(q => x + w + GAP <= q.x || q.x + q.w + GAP <= x || y + h + GAP <= q.y || q.y + q.h + GAP <= y);
    order.forEach((s, k) => {
      let pos = null;
      if (!k) pos = { x: -s.w / 2, y: -s.h / 2 };
      for (let r = 20, a0 = k * 2.399963; !pos; r += 10) { // golden-angle start so tiles fan around the ring
        const steps = Math.max(8, Math.round(2 * Math.PI * r / 36));
        for (let j = 0; j < steps && !pos; j++) {
          const th = a0 + (j / steps) * 2 * Math.PI, x = Math.cos(th) * r * 1.15 - s.w / 2, y = Math.sin(th) * r - s.h / 2;
          if (free(x, y, s.w, s.h)) pos = { x, y };
        }
      }
      const rect = { x: pos.x, y: pos.y, w: s.w, h: s.h };
      placed.push(rect); rects[s.i] = rect;
    });
    const x0 = Math.min(...placed.map(q => q.x)), y0 = Math.min(...placed.map(q => q.y));
    const x1 = Math.max(...placed.map(q => q.x + q.w)), y1 = Math.max(...placed.map(q => q.y + q.h));
    for (const q of placed) { q.x = Math.round(q.x - x0 + PAD); q.y = Math.round(q.y - y0 + PAD); }
    return { rects, w: Math.round(x1 - x0 + PAD * 2), h: Math.round(y1 - y0 + PAD * 2) };
  }
  const board = $('board'), worldEl = $('world');
  let px = 0, py = 0, panMoved = 0, vx = 0, vy = 0, raf = 0, down = null;
  $('change').addEventListener('click', () => leaveEditor());
  $('back').addEventListener('click', e => { e.stopPropagation(); document.body.classList.remove('empty'); draw(); });
  function place() {
    if (!board.clientWidth) return; // hidden
    const vw = board.clientWidth, vh = board.clientHeight, ww = worldEl.offsetWidth, wh = worldEl.offsetHeight;
    px = ww <= vw ? (vw - ww) / 2 : Math.min(0, Math.max(vw - ww, px));
    py = wh <= vh ? (vh - wh) / 2 : Math.min(0, Math.max(vh - wh, py));
    worldEl.style.transform = `translate(${px}px,${py}px)`;
  }
  function centerWorld() {
    px = (board.clientWidth - worldEl.offsetWidth) / 2; py = (board.clientHeight - worldEl.offsetHeight) / 2; place();
  }
  function glide() {
    vx *= .94; vy *= .94; px += vx; py += vy; place();
    raf = Math.abs(vx) + Math.abs(vy) > .3 ? requestAnimationFrame(glide) : 0;
  }
  board.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('.boardUpload, .boardBack')) return;
    cancelAnimationFrame(raf); down = { x: e.clientX, y: e.clientY }; panMoved = 0; vx = vy = 0;
  });
  window.addEventListener('pointermove', e => {
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y; down = { x: e.clientX, y: e.clientY };
    panMoved += Math.abs(dx) + Math.abs(dy); vx = dx; vy = dy; px += dx; py += dy;
    if (panMoved > 6) board.classList.add('drag');
    place();
  });
  window.addEventListener('pointerup', () => {
    if (!down) return; down = null; board.classList.remove('drag');
    if (panMoved > 6) raf = requestAnimationFrame(glide);
  });
  board.addEventListener('wheel', e => { e.preventDefault(); px -= e.deltaX; py -= e.deltaY; place(); }, { passive: false });
  window.addEventListener('resize', place);
  $('tabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    cat = b.dataset.cat; items = CURATED;
    $('tabs').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    renderThumbs();
  });
  // live search goes through the proxy, so visitors never need their own Unsplash key
  $('searchForm').hidden = !PROXY;
  $('searchForm').addEventListener('submit', async e => {
    e.preventDefault();
    const q = $('q').value.trim();
    // bias results toward wide scenery, away from subject close-ups
    const query = `${q || (cat === 'wallpaper' ? 'scenery' : 'landscape')} landscape scenery`;
    try {
      const r = await fetch(`${PROXY}/search?q=${encodeURIComponent(query)}`);
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      items = j.results.map(p => ({ thumb: p.urls.thumb, board: p.urls.small, full: p.urls.regular, cat: null,
        name: p.user.name, profile: p.user.links.html, dl: p.links.download_location }));
      cat = 'all'; $('tabs').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.cat === 'all'));
      renderThumbs();
    } catch (err) { alert('Search failed (' + err.message + '). Try again in a moment.'); }
  });
  renderThumbs();
  $('file').addEventListener('change', e => load(e.target.files[0]));
  for (const drop of [$('drop'), $('board')]) {
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => load(e.dataTransfer.files[0]));
  }
  window.addEventListener('paste', e => { const f = [...e.clipboardData.files][0]; if (f) load(f); });
  window.addEventListener('resize', draw);
  // redraw once the web fonts are ready so canvas labels use them
  if (document.fonts) Promise.all([document.fonts.load('400 20px "Sorts Mill Goudy"'), document.fonts.load('500 12px "Open Sans"')]).then(draw).catch(() => {});

  // ---- controls ----
  const fillTrack = el => el.style.setProperty('--p', (el.value - el.min) / (el.max - el.min) * 100 + '%');
  document.querySelectorAll('.controls input[type=range]').forEach(fillTrack);
  for (const [id, o] of [['colors', 'oColors'], ['smooth', 'oSmooth'], ['warp', 'oWarp'], ['grain', 'oGrain']])
    $(id).addEventListener('input', () => { $(o).textContent = $(id).value; fillTrack($(id)); if (id === 'colors' && state.hasImage) recomputePalette(); else draw(); });
  $('ratio').addEventListener('change', draw);
  $('reset').addEventListener('click', () => {
    for (const [id, o] of [['colors', 'oColors'], ['smooth', 'oSmooth'], ['warp', 'oWarp'], ['grain', 'oGrain']]) {
      $(id).value = $(id).defaultValue; $(o).textContent = $(id).value; fillTrack($(id));
    }
    $('showTitle').checked = $('showTitle').defaultChecked; $('showHex').checked = $('showHex').defaultChecked;
    $('ratio').selectedIndex = 0; $('size').selectedIndex = 0;
    if (state.hasImage) recomputePalette(); // also restores any swatch colours you edited
  });
  $('showTitle').addEventListener('change', draw);
  $('showHex').addEventListener('change', draw);
  $('reroll').addEventListener('click', () => { state.seed = Math.random() * 100; draw(); });
  $('copy').addEventListener('click', () => {
    navigator.clipboard.writeText(state.palette.map(hex).join(' ')); $('copy').querySelector('span').textContent = 'Copied';
    setTimeout(() => $('copy').querySelector('span').textContent = 'Copy hex', 1200);
  });
  $('save').addEventListener('click', () => {
    if (!state.hasImage) return;
    const ratio = +$('ratio').value, long = +$('size').value;
    const w = ratio >= 1 ? long : Math.round(long * ratio), h = ratio >= 1 ? Math.round(long / ratio) : long;
    const out = document.createElement('canvas'); render(w, h, out);
    out.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `Gradient - ${paletteName(state.palette).replace(/[\\/:*?"<>|]/g, '')}.png`; a.click(); });
    draw();
  });
})();
