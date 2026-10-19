// Runs a scene live in the browser, or frame by frame for record.mjs.
//   ?scene=reach|envelope|mark           which scene (default reach)
//   ?f=wide|tall|square                   1920x1080, 1080x1920 or 1080x1080
//   ?look=dots|grid|ascii                 dots (the house look), or a pixel grid or characters to try
//   ?palette=brand|mono                   SafeShake colours (default), or plain white and blue on black
//   ?embed                                no controls, fills the window (for the website)
//   ?scrub                                with embed: no autoplay; the page drives it by scroll (see README)
//   ?q=0.6                                render the dots at a lower resolution, for speed on the web
//   ?record                               no playback; record.mjs calls FILM.seek(t)

(async function () {
  const q = new URLSearchParams(location.search);
  const name = window.SCENES[q.get('scene')] ? q.get('scene') : 'reach';
  const fmt = q.get('f') || 'wide';
  const record = q.has('record'), embed = q.has('embed'), scrub = q.has('scrub');
  const quality = Math.min(1, Math.max(0.3, Number(q.get('q')) || 1));
  const [W, H] = fmt === 'tall' ? [1080, 1920] : fmt === 'square' ? [1080, 1080] : [1920, 1080];
  const scene = window.SCENES[name];
  const look = q.get('look') || scene.look || 'dots', brand = q.get('palette') !== 'mono';

  const stage = document.getElementById('stage'), canvas = document.getElementById('c');
  stage.style.width = W + 'px';
  stage.style.height = H + 'px';
  const fit = () => {
    const s = embed ? Math.max(innerWidth / W, innerHeight / H) : Math.min(innerWidth / W, (innerHeight - (record ? 0 : 56)) / H);
    stage.style.transform = `translate(${(innerWidth - W * s) / 2}px, ${(innerHeight - H * s) / 2 + (record || embed ? 0 : 20)}px) scale(${s})`;
  };
  if (!record) { fit(); addEventListener('resize', fit); }
  if (record || embed) document.body.classList.add('bare');

  const F = new window.DOTS.Frame(canvas, W, H, record ? 1 : quality);
  F.overlay = document.getElementById('overlay');
  // website copy: ?notext hides the scene's own words, the page sets its own
  if (q.has('notext')) F.overlay.style.display = 'none';

  const draw = (t) => {
    F.clear();
    scene.render(t, F);
    if (look === 'ascii') F.composeAscii(t, scene.glow || 0, scene.glowB || 0);
    else if (look === 'grid') F.composeGrid(t, scene.glow || 0, scene.glowB || 0);
    else F.compose(t, scene.glow || 0, scene.glowB || 0);
    if (scene.post) { F.ctx.setTransform(F.sc, 0, 0, F.sc, 0, 0); scene.post(F.ctx, t, F); F.ctx.setTransform(1, 0, 0, 1, 0, 0); }
  };

  const ready = (async () => {
    await Promise.all(['300 40px Satoshi', '500 40px Satoshi', 'italic 300 40px Erode'].map((f) => document.fonts.load(f)));
    await scene.init(F);
    F.setPalette(brand, scene.bg);
    draw(0);
  })();
  window.FILM = { ready, DURATION: scene.duration, seek: (t) => draw(t) };

  if (!record && !embed) {
    const link = (key, val, label) => {
      const p = new URLSearchParams(location.search);
      p.set(key, val);
      const on = (q.get(key) || { scene: 'reach', f: 'wide', look: scene.look || 'dots', palette: 'brand' }[key]) === val;
      return `<a href="?${p}" class="${on ? 'on' : ''}">${label}</a>`;
    };
    document.getElementById('ui').innerHTML =
      `<span>${Object.keys(window.SCENES).map((k) => link('scene', k, window.SCENES[k].title)).join('')}</span>` +
      `<span>${link('palette', 'brand', 'Brand colours')}${link('palette', 'mono', 'Mono')}</span>` +
      `<span>${link('f', 'wide', 'Wide')}${link('f', 'tall', 'Tall')}${link('f', 'square', 'Square')}</span>` +
      `<span><a href="#" id="replay">Replay</a></span>`;
  }

  if (record) return;
  await ready;

  // Scroll mode: the page sends how far through the scene to be, from 0 to 1, and the scene
  // eases towards it, so scrolling down plays it forwards and scrolling up plays it back.
  //   iframe.contentWindow.postMessage({ dots: progress }, '*')
  if (scrub) {
    let target = 0, cur = 0, clock = 0, last = performance.now(), paused = false;
    addEventListener('message', (e) => {
      if (!e.data) return;
      if (typeof e.data.dots === 'number') target = Math.min(1, Math.max(0, e.data.dots)) * scene.duration;
      if (typeof e.data.pause === 'boolean') paused = e.data.pause;
    });
    const tick = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000); last = now; clock += dt;
      cur += (target - cur) * Math.min(1, dt * 6);
      // The scene's own time follows the scroll; idle shimmer keeps running underneath
      if (!paused) draw(cur + (scene.loop === 'continuous' ? clock : 0));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return;
  }

  let t0 = performance.now();
  const replay = document.getElementById('replay');
  if (replay) replay.onclick = (e) => { e.preventDefault(); t0 = performance.now(); };
  const tick = (now) => {
    let t = (now - t0) / 1000;
    if (scene.loop !== 'continuous' && t > scene.duration + 1.5) { t0 = now; t = 0; }
    draw(t);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();
