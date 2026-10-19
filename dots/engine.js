// The dot engine: turns pictures into fields of dots, and draws thousands of
// dots a frame into two light buffers (Cloud and Horizon) that are mixed onto
// Space with a little film grain. Everything is a function of time, so any
// frame can be drawn on its own (that is what lets record.mjs render MP4s).

(function () {
  const E = (window.DOTS = {});

  E.clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  E.lerp = (a, b, k) => a + (b - a) * k;
  E.prog = (t, a, b) => E.clamp((t - a) / (b - a));
  E.smooth = (k) => k * k * (3 - 2 * k);
  E.ease = {
    out: (k) => 1 - Math.pow(1 - k, 3),
    in: (k) => k * k * k,
    io: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
    expo: (k) => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k)),
  };
  // A fixed random number for particle i, stream s (the same every frame)
  E.hash = (i, s = 0) => {
    const x = Math.sin(i * 12.9898 + s * 78.233 + s * s * 3.17) * 43758.5453;
    return x - Math.floor(x);
  };
  E.rng = (seed) => {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  };

  E.COLORS = { space: [13, 13, 13], deep: [10, 38, 56], current: [41, 87, 102], horizon: [176, 222, 245], cloud: [242, 242, 242] };

  E.loadImage = (src) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });

  function boxBlur(src, w, h, r) {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h), d = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += src[y * w + E.clamp(x, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = acc / d;
        acc += src[y * w + Math.min(x + r + 1, w - 1)] - src[y * w + Math.max(x - r, 0)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[E.clamp(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / d;
        acc += tmp[Math.min(y + r + 1, h - 1) * w + x] - tmp[Math.max(y - r, 0) * w + x];
      }
    }
    return out;
  }

  // A brightness field (0..1 per pixel) from a picture with transparency.
  //   base   how bright the inside of the shape is at its darkest
  //   gamma  contrast of the picture's own light and shade
  //   rim    extra light along the outline, so silhouettes read as solid
  //   channel 'max' uses the brightest channel (for blue-lit photos)
  E.field = function (img, w, h, o = {}) {
    w = Math.round(w); h = Math.round(h);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (o.draw) o.draw(g, w, h); else g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const n = w * h, lum = new Float32Array(n), al = new Float32Array(n), v = new Float32Array(n);
    const samples = [];
    for (let i = 0; i < n; i++) {
      const r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2];
      al[i] = d[i * 4 + 3] / 255;
      lum[i] = (o.channel === 'max' ? Math.max(r, gg, b) : 0.3 * r + 0.59 * gg + 0.11 * b) / 255;
      if (al[i] > 0.5 && i % 5 === 0) samples.push(lum[i]);
    }
    samples.sort((a, b) => a - b);
    const lo = samples[Math.floor(samples.length * (o.lo ?? 0.03))] || 0;
    const hi = samples[Math.floor(samples.length * (o.hi ?? 0.995))] || 1;
    const base = o.base ?? 0, gamma = o.gamma ?? 1;
    for (let i = 0; i < n; i++) {
      const s = Math.pow(E.clamp((lum[i] - lo) / (hi - lo || 1)), gamma);
      v[i] = al[i] * (base + (1 - base) * s);
    }
    if (o.rim) {
      const ab = boxBlur(al, w, h, o.rimSize || 6);
      for (let i = 0; i < n; i++) v[i] = E.clamp(v[i] + o.rim * al[i] * E.clamp((1 - ab[i]) * 2.4));
    }
    return { w, h, v, al };
  };

  function pack(arr, stride) {
    const n = arr.length / stride, P = { n, x: new Float32Array(n), y: new Float32Array(n), v: new Float32Array(n) };
    for (let i = 0; i < n; i++) { P.x[i] = arr[i * stride]; P.y[i] = arr[i * stride + 1]; P.v[i] = arr[i * stride + 2]; }
    return P;
  }

  // Organic dots: a jittered grid, each dot kept with the chance of its brightness
  E.stipple = function (f, step, seed = 1, o = {}) {
    const rnd = E.rng(seed), pts = [], g = o.gamma ?? 1, keep = o.keep ?? 1, ox = o.x || 0, oy = o.y || 0;
    for (let y = 0; y < f.h; y += step) for (let x = 0; x < f.w; x += step) {
      const jx = x + rnd() * step, jy = y + rnd() * step, ix = jx | 0, iy = jy | 0;
      if (ix >= f.w || iy >= f.h) continue;
      const v = f.v[iy * f.w + ix];
      if (v > 0.01 && rnd() < Math.pow(v, g) * keep) pts.push(jx + ox, jy + oy, v);
    }
    return pack(pts, 3);
  };

  // Digital dots: a strict grid, one dot per cell sized by the cell's brightness
  E.grid = function (f, step, o = {}) {
    const pts = [], thr = o.threshold ?? 0.08, ox = o.x || 0, oy = o.y || 0;
    for (let cy = step / 2; cy < f.h; cy += step) for (let cx = step / 2; cx < f.w; cx += step) {
      let s = 0, c = 0;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const ix = Math.round(cx + a * step * 0.3), iy = Math.round(cy + b * step * 0.3);
        if (ix >= 0 && iy >= 0 && ix < f.w && iy < f.h) { s += f.v[iy * f.w + ix]; c++; }
      }
      const v = c ? s / c : 0;
      if (v > thr) pts.push(cx + ox, cy + oy, v);
    }
    return pack(pts, 3);
  };

  // The SafeShake mark as a Path2D, and a field of it for sampling dots
  E.markPath = () => new Path2D(window.LOGO.mark.d.join(' '));
  E.drawMark = function (ctx, cx, cy, h, color, alpha = 1) {
    if (alpha <= 0) return;
    const [bx, by, bw, bh] = window.LOGO.mark.box, s = h / bh;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.translate(cx - (bx + bw / 2) * s, cy - (by + bh / 2) * s);
    ctx.scale(s, s);
    ctx.fill(E.markPath());
    ctx.restore();
  };
  E.markField = function (h) {
    const [, , bw, bh] = window.LOGO.mark.box, w = Math.ceil(h * bw / bh) + 2;
    return E.field(null, w, h + 2, { base: 1, draw: (g) => E.drawMark(g, w / 2, (h + 2) / 2, h, '#fff') });
  };

  // The frame: two float light buffers, mixed onto Space with grain
  E.Frame = class {
    // W, H are the stage size scenes lay out in; sc renders the dots at a lower resolution (0.5 = half) for speed
    constructor(canvas, W, H, sc = 1) {
      this.W = W; this.H = H; this.sc = sc;
      const PW = (this.PW = Math.round(W * sc)), PH = (this.PH = Math.round(H * sc));
      canvas.width = PW; canvas.height = PH;
      this.ctx = canvas.getContext('2d');
      this.img = this.ctx.createImageData(PW, PH);
      this.u32 = new Uint32Array(this.img.data.buffer);
      this.A = new Float32Array(PW * PH); // Cloud light
      this.B = new Float32Array(PW * PH); // Horizon light
      this.glowA = null; this.glowB = null; // optional fixed glows, added with a strength
      const rnd = E.rng(7);
      this.grain = new Float32Array(512 * 512);
      for (let i = 0; i < this.grain.length; i++) this.grain[i] = (rnd() + rnd() - 1) * 7 * (E.GRAIN || 1);
    }
    clear() { this.A.fill(0); this.B.fill(0); }

    // A square dot of side s centred on (x, y), anti-aliased by pixel coverage
    dot(buf, x, y, v, s) {
      const W = this.PW, H = this.PH, sc = this.sc;
      if (sc !== 1) { x *= sc; y *= sc; s *= sc; }
      const h = s * 0.5;
      const x0 = x - h, x1 = x + h, y0 = y - h, y1 = y + h;
      let ix0 = Math.floor(x0), ix1 = Math.ceil(x1) - 1, iy0 = Math.floor(y0), iy1 = Math.ceil(y1) - 1;
      if (ix1 < 0 || iy1 < 0 || ix0 >= W || iy0 >= H) return;
      if (ix0 < 0) ix0 = 0; if (iy0 < 0) iy0 = 0; if (ix1 >= W) ix1 = W - 1; if (iy1 >= H) iy1 = H - 1;
      for (let iy = iy0; iy <= iy1; iy++) {
        const wy = Math.min(y1, iy + 1) - Math.max(y0, iy);
        if (wy <= 0) continue;
        const row = iy * W, vy = v * wy;
        for (let ix = ix0; ix <= ix1; ix++) {
          const wx = Math.min(x1, ix + 1) - Math.max(x0, ix);
          if (wx > 0) buf[row + ix] += vy * wx;
        }
      }
    }

    // A soft round glow baked into an array, for halos; fn takes stage coordinates
    glowArray(fn) {
      const { PW, PH, sc } = this, g = new Float32Array(PW * PH);
      for (let y = 0; y < PH; y++) for (let x = 0; x < PW; x++) g[y * PW + x] = fn(x / sc, y / sc);
      return g;
    }

    // The palette. Brand: dim dots are Current, brighter ones Horizon, the brightest Cloud,
    // on Space warmed towards Deep around a focus. Mono: Cloud and Horizon on flat Space.
    setPalette(brand = true, focus = null) {
      const { PW: W, PH: H, sc } = this, N = 512;
      if (focus) focus = { x: focus.x * sc, y: focus.y * sc, r: focus.r * sc, ry: focus.ry && focus.ry * sc };
      this.brand = brand;
      const ramp = (stops, a) => {
        if (a <= stops[0][0]) return stops[0][1];
        for (let k = 1; k < stops.length; k++) if (a <= stops[k][0]) {
          const [a0, c0] = stops[k - 1], [a1, c1] = stops[k], m = (a - a0) / (a1 - a0);
          return [0, 1, 2].map((j) => c0[j] + (c1[j] - c0[j]) * m);
        }
        return stops[stops.length - 1][1];
      };
      const SA = brand ? [[0, [62, 112, 130]], [0.35, [122, 182, 206]], [0.6, [176, 222, 245]], [0.95, [242, 242, 242]]] : [[0, E.COLORS.cloud]];
      const SB = brand ? [[0, [46, 96, 113]], [0.5, [118, 178, 204]], [1.0, [176, 222, 245]], [1.6, [214, 238, 250]]] : [[0, E.COLORS.horizon]];
      this.lutA = new Float32Array(N * 3); this.lutB = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const a = (i / N) * 2, ca = ramp(SA, a), cb = ramp(SB, a);
        for (let j = 0; j < 3; j++) { this.lutA[i * 3 + j] = ca[j]; this.lutB[i * 3 + j] = cb[j]; }
      }
      this.bgR = new Float32Array(W * H); this.bgG = new Float32Array(W * H); this.bgB = new Float32Array(W * H);
      const [sr, sg, sb] = E.COLORS.space, [dr, dg, db] = E.COLORS.deep;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        let w = 0;
        if (brand && focus) {
          const dx = (x - focus.x) / focus.r, dy = (y - focus.y) / (focus.ry || focus.r);
          w = 0.78 * Math.exp(-(dx * dx + dy * dy) / 2) + 0.1 * (y / H);
        } else if (brand) w = 0.2 + 0.2 * (y / H);
        w = Math.min(1, w * (E.WARM == null ? 1 : E.WARM));
        this.bgR[i] = sr + (dr - sr) * w; this.bgG[i] = sg + (dg - sg) * w; this.bgB[i] = sb + (db - sb) * w;
      }
    }

    // Light at a pixel, as [r, g, b] over the background
    mix(i, a, b, n) {
      const { lutA, lutB } = this;
      let r = this.bgR[i] + n, g = this.bgG[i] + n, bl = this.bgB[i] + n;
      if (a > 0.004) {
        const k = Math.min(511, (a * 256) | 0) * 3, c = a > 1 ? 1 : a;
        r += (lutA[k] - r) * c; g += (lutA[k + 1] - g) * c; bl += (lutA[k + 2] - bl) * c;
      }
      if (b > 0.004) {
        const k = Math.min(511, (b * 256) | 0) * 3, c = b > 1 ? 1 : b;
        r += (lutB[k] - r) * c; g += (lutB[k + 1] - g) * c; bl += (lutB[k + 2] - bl) * c;
      }
      return (0xff000000 | ((bl < 0 ? 0 : bl > 255 ? 255 : bl) << 16) | ((g < 0 ? 0 : g > 255 ? 255 : g) << 8) | (r < 0 ? 0 : r > 255 ? 255 : r)) >>> 0;
    }

    compose(t, ga = 0, gb = 0) {
      if (!this.lutA) this.setPalette(true);
      const { PW: W, PH: H, A, B, u32, grain } = this, gA = this.glowA, gB = this.glowB;
      const f = Math.floor(t * 24), ox = (f * 97) & 511, oy = (f * 61) & 511;
      for (let y = 0; y < H; y++) {
        const grow = ((y + oy) & 511) << 9, row = y * W;
        for (let x = 0; x < W; x++) {
          const i = row + x;
          let a = A[i] * (E.BOOST || 1), b = B[i] * (E.BOOST || 1);
          if (gA && ga) a += gA[i] * ga;
          if (gB && gb) b += gB[i] * gb;
          u32[i] = this.mix(i, a, b, grain[grow + ((x + ox) & 511)]);
        }
      }
      this.ctx.putImageData(this.img, 0, 0);
    }

    // The same light as a pixel grid: one square per cell, dithered in the shadows
    composeGrid(t, ga = 0, gb = 0, cell = 6) {
      if (!this.lutA) this.setPalette(true);
      const { PW: W, PH: H, A, B, u32 } = this, gA = this.glowA, gB = this.glowB;
      const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
      for (let i = 0; i < W * H; i++) u32[i] = this.mix(i, 0, 0, 0);
      const sq = cell - 1;
      for (let cy = 0; cy * cell < H; cy++) for (let cx = 0; cx * cell < W; cx++) {
        let sa = 0, sb = 0, n = 0;
        const x0 = cx * cell, y0 = cy * cell, x1 = Math.min(W, x0 + cell), y1 = Math.min(H, y0 + cell);
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const i = y * W + x;
          sa += A[i] + (gA && ga ? gA[i] * ga : 0);
          sb += B[i] + (gB && gb ? gB[i] * gb : 0);
          n++;
        }
        sa = (sa / n) * 1.25; sb = (sb / n) * 1.25;
        const v = sa + sb;
        if (v < 0.07) continue;
        if (v < 0.5) {
          if (v * 2 * 16 <= BAYER[(cx & 3) + (cy & 3) * 4]) continue;
          const k = 0.5 / v; sa *= k; sb *= k;
        }
        const ci = Math.min(H - 1, y0 + 2) * W + Math.min(W - 1, x0 + 2), col = this.mix(ci, sa, sb, 0);
        for (let y = y0; y < Math.min(H, y0 + sq); y++) for (let x = x0; x < Math.min(W, x0 + sq); x++) u32[y * W + x] = col;
      }
      this.ctx.putImageData(this.img, 0, 0);
    }

    // The same light, drawn as type: each cell becomes a character by brightness
    composeAscii(t, ga = 0, gb = 0, cell = 12) {
      const { PW: W, PH: H, A, B, ctx } = this, gA = this.glowA, gB = this.glowB;
      const cw = cell, ch = Math.round(cell * 1.6), cols = Math.ceil(W / cw), rows = Math.ceil(H / ch);
      const RAMP = ' .·:-=+*o#%@';
      if (!this.lutA) this.setPalette(true);
      for (let i = 0; i < W * H; i++) this.u32[i] = this.mix(i, 0, 0, 0);
      ctx.putImageData(this.img, 0, 0);
      ctx.font = `500 ${Math.round(ch * 0.82)}px Satoshi, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const buckets = new Map();
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        let sa = 0, sb = 0, n = 0;
        for (let y = r * ch; y < Math.min(H, (r + 1) * ch); y += 2) for (let x = c * cw; x < Math.min(W, (c + 1) * cw); x += 2) {
          const i = y * W + x;
          sa += A[i] + (gA && ga ? gA[i] * ga : 0);
          sb += B[i] + (gB && gb ? gB[i] * gb : 0);
          n++;
        }
        sa /= n; sb /= n;
        const v = Math.min(1, (sa + sb) * 2.2);
        if (v < 0.04) continue;
        const k = Math.min(RAMP.length - 1, 1 + Math.floor(v * (RAMP.length - 1)));
        const hue = sb > sa ? 1 : 0, lv = Math.min(5, Math.floor(v * 6));
        const key = hue * 10 + lv;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(RAMP[k], c * cw + cw / 2, r * ch + ch / 2);
      }
      for (const [key, list] of buckets) {
        const lv = ((key % 10) + 1) / 6, lut = key >= 10 ? this.lutB : this.lutA, k = Math.min(511, (lv * 1.3 * 256) | 0) * 3;
        const [r, g, b] = [lut[k], lut[k + 1], lut[k + 2]].map(Math.round), a = 0.45 + 0.55 * lv;
        ctx.fillStyle = `rgba(${r},${g},${b},${a.toFixed(3)})`;
        for (let i = 0; i < list.length; i += 3) ctx.fillText(list[i], list[i + 1], list[i + 2]);
      }
    }
  };
})();
