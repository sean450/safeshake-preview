// The scenes. Each has a duration, an init (sample its pictures into dots)
// and a render(t) that draws one frame at time t, in seconds.
//   reach      the brand's human and agent hands reach; light passes between the fingertips and becomes the mark
//   envelope   the agent's hand holds a glowing sphere: its envelope
//   mark       dust gathers into the mark, it turns solid, then blows away

(function () {
  const E = window.DOTS, { clamp, lerp, prog, ease, hash, smooth } = E;
  const S = (window.SCENES = {});

  function stars(F, n, seed, yMax = 1) {
    const P = { n, x: new Float32Array(n), y: new Float32Array(n), v: new Float32Array(n), s: new Float32Array(n) };
    for (let i = 0; i < n; i++) {
      P.x[i] = hash(i, seed) * F.W;
      P.y[i] = hash(i, seed + 1) * F.H * yMax;
      const b = hash(i, seed + 2);
      P.v[i] = 0.15 + 0.85 * Math.pow(b, 6);
      P.s[i] = b > 0.985 ? 2.2 : b > 0.9 ? 1.5 : 1;
    }
    return P;
  }
  function drawStars(F, P, t, fade = 1) {
    for (let i = 0; i < P.n; i++) {
      const tw = 0.65 + 0.35 * Math.sin(t * (0.6 + hash(i, 40) * 2.2) + hash(i, 41) * 30);
      F.dot(F.A, P.x[i], P.y[i], P.v[i] * tw * fade, P.s[i]);
    }
  }

  // Overlay text, positioned on the stage in pixels
  function text(F, html, css) {
    const e = document.createElement('div');
    e.className = 'txt';
    e.innerHTML = html;
    Object.assign(e.style, css);
    F.overlay.appendChild(e);
    return e;
  }
  function show(e, t, t0, d = 0.9, dy = 16) {
    const k = ease.out(prog(t, t0, t0 + d));
    e.style.opacity = k;
    e.style.transform = `translateY(${(1 - k) * dy}px)`;
  }

  // The gather-in from Reach, used by every scene: each dot drifts in as dust from one side,
  // swirls a little and settles, the edge nearest the dust first.
  //   dir  where the dust comes from, in radians: -0.6 is up and to the right
  //   t0   when the first dots start to settle
  function gatherer(xs, ys, n, dir, t0) {
    const c = Math.cos(dir), sn = Math.sin(dir);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) { const pr = xs[i] * c + ys[i] * sn; if (pr < lo) lo = pr; if (pr > hi) hi = pr; }
    return { c, sn, lo, hi, dir, t0, out: { x: 0, y: 0, p: 0 } };
  }
  function gather(G, i, hx, hy, t) {
    const near = (hx * G.c + hy * G.sn - G.lo) / (G.hi - G.lo || 1);
    const d0 = G.t0 + 1.2 * (1 - near) + 0.7 * hash(i, 1);
    const p = ease.out(prog(t, d0, d0 + 2.4));
    const a = G.dir + (hash(i, 2) - 0.5) * 2.2, dist = 260 + 700 * hash(i, 3);
    const sx = hx + Math.cos(a) * dist + (G.c >= 0 ? 120 : -120), sy = hy + Math.sin(a) * dist;
    const swirl = Math.sin(p * Math.PI) * 60 * (hash(i, 4) - 0.5);
    G.out.x = lerp(sx, hx, p) + swirl; G.out.y = lerp(sy, hy, p) - swirl * 0.5; G.out.p = p;
    return G.out;
  }
  // How strongly the mark's shape shows behind its dots (it never goes solid)
  const MARK_FILL = 0.24;
  const FROM_RIGHT = -0.6;

  /* ---------------------------------------------------------------------- */
  S.reach = {
    title: 'Reach',
    duration: 12,
    async init(F) {
      const { W, H } = F, wide = W >= H;
      // Geometry of the brand photo (2304 x 1296): the cut-outs and the point between the fingertips
      const k = wide ? W / 2304 : 1.0, M = wide ? { x: 1134.4 * k, y: 648.3 * k } : { x: W * 0.5, y: H * 0.44 };
      const at = (bx, by) => ({ x: M.x + (bx - 1134.4) * k, y: M.y + (by - 648.3) * k });
      this.M = M;
      this.bg = { x: M.x, y: M.y, r: W * 0.38 };
      this.markH = wide ? 92 : 104;
      const [human, robot] = await Promise.all([E.loadImage('img/human.png'), E.loadImage('img/robot.png')]);

      const ho = at(1238, 0);
      // The cut-out keeps a scrap of the photo's bright backdrop above the sleeve, top right; trim it off
      const trim = (g, w, h) => {
        g.drawImage(human, 0, 0, w, h);
        const sx = w / 1066, sy = h / 780;
        g.globalCompositeOperation = 'destination-out';
        g.beginPath(); g.moveTo(690 * sx, 0); g.lineTo(1066 * sx, 0); g.lineTo(1066 * sx, 76 * sy); g.lineTo(789 * sx, 106 * sy); g.lineTo(690 * sx, 117 * sy); g.closePath(); g.fill();
        g.globalCompositeOperation = 'source-over';
      };
      const fh = E.field(human, 1066 * k, 780 * k, { channel: 'max', base: 0.24, gamma: 1.2, rim: 0.9, rimSize: 5, draw: trim });
      this.h = E.stipple(fh, 1.6, 11, { x: ho.x, y: ho.y, gamma: 1.05 });
      this.gH = gatherer(this.h.x, this.h.y, this.h.n, FROM_RIGHT, 0.3);

      const ro = at(74, 639);
      const fr = E.field(robot, 948 * k, 657 * k, { channel: 'max', base: 0.24, gamma: 1.2, rim: 0.9, rimSize: 5 });
      this.r = E.stipple(fr, 1.6, 13, { x: ro.x, y: ro.y, gamma: 1.05 });
      this.gR = gatherer(this.r.x, this.r.y, this.r.n, FROM_RIGHT, 0.6);

      this.tipH = at(1240, 606);
      this.tipR = at(1008, 660);

      // The mark, as dots, waiting between the fingertips
      const fm = E.markField(this.markH);
      this.m = E.grid(fm, 4.2, { x: M.x - fm.w / 2, y: M.y - fm.h / 2, threshold: 0.4 });

      this.stars = stars(F, wide ? 520 : 600, 3);
      F.glowA = F.glowArray((x, y) => {
        const d = Math.hypot(x - M.x, y - M.y);
        return 0.22 * Math.exp(-(d * d) / (2 * 70 * 70));
      });

      const line1 = 'Empower the agent.', line2 = '<em>Bound the action.</em>';
      this.t1 = text(F, line1, wide ? { right: '120px', bottom: '170px', fontSize: '54px', textAlign: 'right' } : { left: '0', right: '0', bottom: '260px', fontSize: '64px', textAlign: 'center' });
      this.t2 = text(F, line2, wide ? { right: '120px', bottom: '104px', fontSize: '54px', textAlign: 'right' } : { left: '0', right: '0', bottom: '180px', fontSize: '64px', textAlign: 'center' });
    },
    render(t, F) {
      const { h, r, m, M } = this;
      drawStars(F, this.stars, t, prog(t, 0, 1.2));
      const reach = ease.io(prog(t, 3, 12)) * 8;

      // The human hand gathers out of drifting dust, wrist first, fingertips last
      for (let i = 0; i < h.n; i++) {
        const g = gather(this.gH, i, h.x[i], h.y[i], t), p = g.p;
        const z = (h.v[i] - 0.5) * 50;
        let x = g.x - reach + z * 0.04 * Math.sin(t * 0.45);
        let y = g.y + reach * 0.35;
        x += 0.45 * Math.sin(t * 1.7 + hash(i, 5) * 40);
        y += 0.45 * Math.cos(t * 1.3 + hash(i, 6) * 40);
        const v = (0.6 + 0.7 * h.v[i]) * (0.15 + 0.85 * p) * clamp(t * 2);
        F.dot(F.A, x, y, v, 1.2);
      }

      // The agent hand gathers the same way, its dust drifting in across the frame
      for (let i = 0; i < r.n; i++) {
        const g = gather(this.gR, i + 90000, r.x[i], r.y[i], t), p = g.p;
        const z = (r.v[i] - 0.5) * 50;
        let x = g.x + reach + z * 0.04 * Math.sin(t * 0.45), y = g.y - reach * 0.3;
        x += 0.45 * Math.sin(t * 1.7 + hash(i, 5) * 40);
        y += 0.45 * Math.cos(t * 1.3 + hash(i, 6) * 40);
        F.dot(F.B, x, y, (0.6 + 0.7 * r.v[i]) * (0.15 + 0.85 * p) * clamp(t * 2), 1.2);
      }

      // Light passes from both fingertips to the point between them and forms the mark
      const tipH = { x: this.tipH.x - reach, y: this.tipH.y + reach * 0.35 }, tipR = { x: this.tipR.x + reach, y: this.tipR.y - reach * 0.3 };
      const solid = MARK_FILL * ease.io(prog(t, 7.4, 8.3));
      if (t > 4.2) {
        for (let j = 0; j < m.n; j++) {
          const fromH = hash(j, 20) < 0.55, src = fromH ? tipH : tipR;
          const t0 = 4.4 + 1.8 * hash(j, 21), p = ease.io(prog(t, t0, t0 + 1.25));
          if (p <= 0) continue;
          const sx = src.x + (hash(j, 22) - 0.5) * 10, sy = src.y + (hash(j, 23) - 0.5) * 10;
          const cx = (sx + m.x[j]) / 2 + (hash(j, 24) - 0.5) * 120, cy = (sy + m.y[j]) / 2 + (hash(j, 25) - 0.5) * 120;
          const u = 1 - p;
          const x = u * u * sx + 2 * u * p * cx + p * p * m.x[j], y = u * u * sy + 2 * u * p * cy + p * p * m.y[j];
          const v = p < 1 ? 0.9 : 0.75 + 0.25 * Math.sin(t * 4 + j);
          F.dot(fromH ? F.A : F.B, x, y, v, p < 1 ? 1.4 : 2.2);
        }
      }
      this.solid = solid;
      this.glow = 0.4 * prog(t, 4.0, 5.2) + 0.6 * (solid / MARK_FILL);
      show(this.t1, t, 8.4);
      show(this.t2, t, 8.9);
    },
    post(ctx, t) {
      E.drawMark(ctx, this.M.x, this.M.y, this.markH, '#f2f2f2', this.solid);
    },
  };

  /* ---------------------------------------------------------------------- */
  // Reference 2: the agent's hand holds a glowing sphere: its envelope, the signed limits it carries.
  S.envelope = {
    title: 'Envelope',
    duration: 12,
    async init(F) {
      const { W, H } = F, wide = W > H, sq = W === H;
      const robot = await E.loadImage('img/robot.png');
      // The sphere rests on the tips of the thumb and middle finger (cut-out coordinates 585, -75)
      const k = wide ? 1.25 : sq ? 0.75 : 1.1;
      this.o = wide ? { x: W * 0.36, y: H * 0.31 } : { x: W * 0.52, y: H * (sq ? 0.27 : 0.27) };
      const hx = this.o.x - 585 * k, hy = this.o.y + 75 * k;
      const fr = E.field(robot, 948 * k, 657 * k, { channel: 'max', base: 0.24, gamma: 1.2, rim: 0.9, rimSize: 5 });
      this.fr = fr; this.hx = hx; this.hy = hy;
      this.h = E.stipple(fr, 1.6, 17, { x: hx, y: hy, gamma: 1.05 });
      this.gH = gatherer(this.h.x, this.h.y, this.h.n, FROM_RIGHT, 0.3);
      this.R = 100 * k;
      // The sphere: soft dots on its skin, and a dimmer cloud of dots inside it
      const n = 9000, ni = 2600;
      this.sp = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const y = 1 - 2 * hash(i, 120), r = Math.sqrt(1 - y * y), th = hash(i, 121) * Math.PI * 2;
        this.sp[i * 3] = r * Math.cos(th); this.sp[i * 3 + 1] = y; this.sp[i * 3 + 2] = r * Math.sin(th);
      }
      this.core = new Float32Array(ni * 3);
      for (let i = 0; i < ni; i++) {
        const y = 1 - 2 * hash(i, 130), r = Math.sqrt(1 - y * y), th = hash(i, 131) * Math.PI * 2, d = Math.cbrt(hash(i, 132)) * 0.92;
        this.core[i * 3] = r * Math.cos(th) * d; this.core[i * 3 + 1] = y * d; this.core[i * 3 + 2] = r * Math.sin(th) * d;
      }
      this.stars = stars(F, 380, 41);
      this.bg = { x: this.o.x, y: this.o.y, r: W * 0.34 };
      const o = this.o, R = this.R;
      F.glowA = F.glowArray((x, y) => {
        const d = Math.hypot(x - o.x, y - o.y);
        return 0.32 * Math.exp(-(d * d) / (2 * (R * 1.25) ** 2));
      });
      const css = wide
        ? [{ left: '1240px', top: '430px', fontSize: '64px' }, { left: '1240px', top: '504px', fontSize: '64px' }, { x: 1240 + 22, y: 690 }]
        : sq ? [{ left: 0, right: 0, top: '870px', fontSize: '50px', textAlign: 'center' }, { left: 0, right: 0, top: '926px', fontSize: '50px', textAlign: 'center' }, { x: W / 2, y: 1030 }]
          : [{ left: 0, right: 0, top: '1440px', fontSize: '68px', textAlign: 'center' }, { left: 0, right: 0, top: '1518px', fontSize: '68px', textAlign: 'center' }, { x: W / 2, y: 1730 }];
      this.t1 = text(F, 'Every agent gets', css[0]);
      this.t2 = text(F, '<em>an envelope.</em>', css[1]);
      this.markAt = css[2];
      // The small mark is dots too, never solid
      const fm = E.markField(48);
      this.sm = E.grid(fm, 2.4, { x: this.markAt.x - fm.w / 2, y: this.markAt.y - fm.h / 2, threshold: 0.4 });
      this.gS = null;
    },
    // Is this point of the screen covered by the hand? (fingers sit in front of the sphere)
    covered(x, y) {
      const f = this.fr, ix = Math.round(x - this.hx), iy = Math.round(y - this.hy);
      return ix >= 0 && iy >= 0 && ix < f.w && iy < f.h && f.al[iy * f.w + ix] > 0.5;
    },
    render(t, F) {
      const { h, o, R } = this;
      drawStars(F, this.stars, t, prog(t, 0, 1.2) * 0.8);
      const ig = ease.out(prog(t, 3.6, 5.0));

      // The hand gathers in like the hands in Reach, lit from above by the sphere
      for (let i = 0; i < h.n; i++) {
        const g = gather(this.gH, i + 90000, h.x[i], h.y[i], t);
        const dx = h.x[i] - o.x, dy = h.y[i] - o.y;
        const lightUp = ig * 0.7 * Math.exp(-(dx * dx + dy * dy) / (2 * (R * 2.4) ** 2));
        const v = (0.6 + 0.7 * h.v[i]) * (1 + lightUp) * (0.15 + 0.85 * g.p) * clamp(t * 2);
        F.dot(F.B, g.x + 0.45 * Math.sin(t * 1.7 + hash(i, 5) * 40), g.y + 0.45 * Math.cos(t * 1.3 + hash(i, 6) * 40), v, 1.2);
      }

      if (t > 1.2) {
        const rot = t * 0.3, cr = Math.cos(rot), sr = Math.sin(rot), tl = 0.35, ct = Math.cos(tl), st = Math.sin(tl);
        const turn = (a, j, out) => {
          let x = a[j] * cr + a[j + 2] * sr, z = -a[j] * sr + a[j + 2] * cr, y = a[j + 1];
          const y1 = y * ct - z * st; z = y * st + z * ct; y = y1;
          out[0] = x; out[1] = y; out[2] = z;
        };
        if (!this.gS) {
          const n = this.sp.length / 3, xs = new Float32Array(n), ys = new Float32Array(n);
          for (let i = 0; i < n; i++) { xs[i] = o.x + this.sp[i * 3] * R; ys[i] = o.y + this.sp[i * 3 + 1] * R; }
          this.gS = gatherer(xs, ys, n, FROM_RIGHT, 1.4);
        }
        const q = [0, 0, 0];
        // Its skin: lit from the upper left, with a bright rim
        for (let i = 0; i < this.sp.length / 3; i++) {
          turn(this.sp, i * 3, q);
          const [x, y, z] = q, front = z > 0;
          const lit = 0.12 + 1.05 * Math.max(0, -0.5 * x - 0.55 * y + 0.67 * z) + 0.8 * Math.pow(1 - Math.abs(z), 3);
          const g = gather(this.gS, i + 40000, o.x + x * R, o.y + y * R, t);
          if (g.p > 0.98 && this.covered(g.x, g.y) && !(front && y < 0.2)) continue;
          F.dot(front ? F.A : F.B, g.x, g.y, (front ? 1 : 0.25) * lit * (0.15 + 0.85 * g.p) * (0.8 + 0.4 * ig), 1.2);
        }
        // Its core: a dimmer cloud of dots that brightens as it wakes
        for (let i = 0; i < this.core.length / 3; i++) {
          turn(this.core, i * 3, q);
          const x = o.x + q[0] * R, y = o.y + q[1] * R;
          if (this.covered(x, y)) continue;
          F.dot(F.B, x, y, ig * (0.25 + 0.35 * (1 - Math.hypot(q[0], q[1]))), 1.1);
        }
        // Motes of light drift up off the sphere and fade
        for (let j = 0; j < 1600; j++) {
          const c = (hash(j, 140) + t * (0.07 + 0.06 * hash(j, 141))) % 1;
          const a = -Math.PI / 2 + (hash(j, 142) - 0.5) * 2.2;
          const x0 = o.x + Math.cos(a) * R * 0.95, y0 = o.y + Math.sin(a) * R * 0.95;
          const x = x0 + Math.cos(a) * c * 60 + Math.sin(c * 5 + j) * 24 * c + c * c * 90;
          const y = y0 - c * (180 + 260 * hash(j, 143));
          F.dot(hash(j, 144) < 0.5 ? F.A : F.B, x, y, ig * (1 - c) * (1 - c) * (0.5 + 0.6 * hash(j, 145)), 1.2);
        }
      }
      this.glow = ig * (0.85 + 0.15 * Math.sin(t * 2.1));
      show(this.t1, t, 5.2);
      show(this.t2, t, 5.7);
      this.markA = ease.out(prog(t, 6.4, 7.4));
      for (let i = 0; i < this.sm.n; i++) F.dot(F.A, this.sm.x[i], this.sm.y[i], 0.95 * this.markA, 1.3);
    },
    post(ctx) {
      E.drawMark(ctx, this.markAt.x, this.markAt.y, 48, '#f2f2f2', MARK_FILL * this.markA);
    },
  };

  /* ---------------------------------------------------------------------- */
  S.mark = {
    title: 'Mark',
    duration: 10,
    async init(F) {
      const { W, H } = F, wide = W >= H;
      this.h = wide ? 420 : 520;
      this.c = { x: W / 2, y: wide ? H * 0.46 : H * 0.44 };
      this.bg = { x: this.c.x, y: this.c.y, r: W * 0.4 };
      const fm = E.markField(this.h);
      this.m = E.grid(fm, wide ? 6 : 7, { x: this.c.x - fm.w / 2, y: this.c.y - fm.h / 2, threshold: 0.5 });
      this.g = gatherer(this.m.x, this.m.y, this.m.n, FROM_RIGHT, 0.2);
      this.stars = stars(F, 400, 21);
      const c = this.c;
      F.glowA = F.glowArray((x, y) => {
        const d = Math.hypot(x - c.x, y - c.y);
        return 0.16 * Math.exp(-(d * d) / (2 * 260 * 260));
      });
      this.t1 = text(F, 'Empower the agent. <em>Bound the action.</em>', { left: 0, right: 0, top: (wide ? 860 : 1420) + 'px', fontSize: wide ? '44px' : '52px', textAlign: 'center' });
    },
    render(t, F) {
      const { m, c } = this;
      drawStars(F, this.stars, t, prog(t, 0, 1.2) * 0.7);
      // The mark never turns solid: it stays as dots, over a faint fill that keeps its edges crisp
      const solid = MARK_FILL * ease.io(prog(t, 4.2, 5.0)) * (1 - ease.io(prog(t, 7.0, 7.5)));
      for (let i = 0; i < m.n; i++) {
        // Gather in like the hands in Reach
        const g = gather(this.g, i, m.x[i], m.y[i], t), p = g.p;
        let x = g.x, y = g.y;
        // Blow away to the right, in a wave from left to right
        const xn = (m.x[i] - (c.x - this.h / 2)) / this.h;
        const b = ease.in(prog(t, 7.2 + xn * 0.8 + hash(i, 4) * 0.4, 9.5 + xn * 0.4));
        x += b * (500 + 900 * hash(i, 5));
        y += b * (-160 - 320 * hash(i, 6)) + Math.sin(b * 6 + hash(i, 7) * 6) * 40 * b;
        const sparkle = 0.8 + 0.2 * Math.sin(t * 5 + i * 1.7);
        const v = (0.15 + 0.85 * p) * sparkle * (1 - b * 0.9) * clamp(t * 2);
        F.dot(hash(i, 8) < 0.3 ? F.B : F.A, x, y, v, p < 1 ? 1.6 : 2.6);
      }
      this.solid = solid;
      this.glow = solid / MARK_FILL;
      const tk = prog(t, 5.0, 5.9) * (1 - prog(t, 7.0, 7.6));
      this.t1.style.opacity = ease.out(tk);
      this.t1.style.transform = `translateY(${(1 - ease.out(prog(t, 5.0, 5.9))) * 16}px)`;
    },
    post(ctx) {
      E.drawMark(ctx, this.c.x, this.c.y, this.h, '#f2f2f2', this.solid);
    },
  };
})();
