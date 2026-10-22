// 仮グラフィックによる描画。見た目の差し替えはこのファイルだけで完結させる。
(function () {
  const GA = window.GA;
  const C = GA.CONFIG;
  const DIRS = GA.DIRS;

  const COL = {
    junkDark: '#3b3430',
    junk: ['#6b5a4c', '#7d6e5f', '#55606a', '#8a5a3c', '#6f7a72', '#9a8b6a', '#4c4f57'],
    floor: '#b9ae97',
    floorAlt: '#b2a68e',
    grid: 'rgba(60,48,40,0.18)',
    metal: '#5f6b72',
    metalDark: '#3c454b',
    metalLight: '#8c9aa1',
    rust: '#9b5a35',
    cloth: '#3f7f8c',
    clothAlt: '#e7dcc3',
    ruby: '#c3123f',
    rubyLight: '#ff5a7a',
    ink: '#241e1b',
    paper: '#f2ead8',
    gomi: '#6d6a61',
    dango: '#8a6b45',
  };
  GA.COLORS = COL;

  // 再現性のある乱数（ガラクタ山の配置用）
  function seeded(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  class Renderer {
    constructor(canvas, world) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.world = world;
      this.bg = document.createElement('canvas');
      this.cs = 32;
      this.ox = 0; this.oy = 0;
    }

    resize(cssW, cssH) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.dpr = dpr;
      this.cssW = cssW; this.cssH = cssH;
      this.canvas.width = Math.round(cssW * dpr);
      this.canvas.height = Math.round(cssH * dpr);
      const B = C.border;
      const cols = this.world.w + B * 2, rows = this.world.h + B * 2;
      this.cs = Math.max(16, Math.floor(Math.min(cssW / cols, cssH / rows)));
      this.ox = Math.floor((cssW - this.cs * this.world.w) / 2);
      this.oy = Math.floor((cssH - this.cs * this.world.h) / 2);
      this.buildBackground();
    }

    // ワールド座標（マス単位）→ 画面座標
    sx(x) { return this.ox + x * this.cs; }
    sy(y) { return this.oy + y * this.cs; }
    toCell(px, py) {
      return { x: Math.floor((px - this.ox) / this.cs), y: Math.floor((py - this.oy) / this.cs) };
    }
    toWorld(px, py) { return { x: (px - this.ox) / this.cs, y: (py - this.oy) / this.cs }; }

    princessPos() { return { x: -1.05, y: this.world.h / 2 }; }
    hitPrincess(px, py) {
      const p = this.princessPos();
      const w = this.toWorld(px, py);
      return Math.abs(w.x - p.x) < 0.75 && w.y > p.y - 1.1 && w.y < p.y + 0.7;
    }

    buildBackground() {
      const bg = this.bg, dpr = this.dpr;
      bg.width = this.canvas.width; bg.height = this.canvas.height;
      const g = bg.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = COL.junkDark;
      g.fillRect(0, 0, this.cssW, this.cssH);
      const rnd = seeded(7);
      const cs = this.cs;
      const count = Math.ceil((this.cssW * this.cssH) / (cs * cs) * 3.2);
      for (let i = 0; i < count; i++) {
        const x = rnd() * this.cssW, y = rnd() * this.cssH;
        const s = cs * (0.25 + rnd() * 0.7);
        g.fillStyle = COL.junk[Math.floor(rnd() * COL.junk.length)];
        g.save();
        g.translate(x, y);
        g.rotate(rnd() * Math.PI);
        const shape = rnd();
        if (shape < 0.4) g.fillRect(-s / 2, -s / 3, s, s * 0.66);
        else if (shape < 0.7) { g.beginPath(); g.arc(0, 0, s / 2.4, 0, Math.PI * 2); g.fill(); }
        else {
          g.beginPath(); g.moveTo(-s / 2, s / 3); g.lineTo(0, -s / 2); g.lineTo(s / 2, s / 3); g.closePath(); g.fill();
        }
        g.globalAlpha = 0.25; g.fillStyle = '#000';
        g.fillRect(-s / 2, s / 4, s, s * 0.08);
        g.restore();
      }
      // 片付けられたスペース
      const W = this.world.w, H = this.world.h;
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(this.sx(0) - 3, this.sy(0) + 4, W * cs + 6, H * cs + 2);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        g.fillStyle = (x + y) % 2 ? COL.floor : COL.floorAlt;
        g.fillRect(this.sx(x), this.sy(y), cs, cs);
      }
      g.strokeStyle = COL.grid; g.lineWidth = 1;
      g.beginPath();
      for (let x = 0; x <= W; x++) { g.moveTo(this.sx(x) + 0.5, this.sy(0)); g.lineTo(this.sx(x) + 0.5, this.sy(H)); }
      for (let y = 0; y <= H; y++) { g.moveTo(this.sx(0), this.sy(y) + 0.5); g.lineTo(this.sx(W), this.sy(y) + 0.5); }
      g.stroke();
    }

    // 隣接設備のうち、このマスに向けて出力しているものの方向
    feeders(x, y) {
      if (this.iconMode) return [];
      return this.world.inputsOf(x, y);
    }

    draw(ui) {
      const g = this.ctx, w = this.world, cs = this.cs;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(this.bg, 0, 0);
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      // 設備（下層）
      w.forEachCell((c, x, y) => { if (c.equip) this.drawEquip(g, c.equip, x, y, w.time, c); });

      // オブジェクト
      w.forEachCell((c, x, y) => { if (c.obj) this.drawObjOnCell(g, c, w.time); });

      // 設備（上層: 加工所のふたなど）
      w.forEachCell((c, x, y) => { if (c.equip) this.drawEquipTop(g, c.equip, x, y, c); });

      // ガラクタ姫
      this.drawPrincess(g, w.time, ui.hoverPrincess);

      // つかんでいるオブジェクトの元のマスと、落とす先
      if (ui.grab && ui.grab.active) {
        const o = ui.grab.obj;
        g.strokeStyle = 'rgba(242,234,216,0.8)'; g.lineWidth = 2; g.setLineDash([4, 3]);
        g.strokeRect(this.sx(o.x) + 3.5, this.sy(o.y) + 3.5, cs - 7, cs - 7);
        g.setLineDash([]);
        const t = this.toCell(ui.grab.px, ui.grab.py);
        if (w.inBounds(t.x, t.y)) {
          g.strokeStyle = w.canDropAt(o, t.x, t.y) ? '#9fe3a0' : COL.rubyLight;
          g.lineWidth = 3;
          g.strokeRect(this.sx(t.x) + 1.5, this.sy(t.y) + 1.5, cs - 3, cs - 3);
        }
      }

      // 客ロボット（y順）
      const cus = [...w.customers].sort((a, b) => a.y - b.y);
      for (const cu of cus) this.drawCustomer(g, cu);

      // つかんでいるオブジェクトは指の位置に描く（ロボットより手前）
      if (ui.grab && ui.grab.active) {
        const o = ui.grab.obj;
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.beginPath(); g.ellipse(ui.grab.px, ui.grab.py + cs * 0.35, cs * 0.3, cs * 0.1, 0, 0, Math.PI * 2); g.fill();
        this.drawObj(g, o.type, ui.grab.px, ui.grab.py - cs * 0.08, cs * 0.36, o.id);
      }

      // エフェクト
      for (const fx of w.effects) {
        const k = fx.t / fx.life;
        g.globalAlpha = 1 - k;
        this.drawTonicDrop(g, this.sx(fx.x) - cs * 0.22, this.sy(fx.y) - k * cs * 0.8, cs * 0.18);
        g.fillStyle = COL.paper;
        g.font = `700 ${Math.round(cs * 0.38)}px "DotGothic16", sans-serif`;
        g.textAlign = 'left'; g.textBaseline = 'middle';
        g.strokeStyle = COL.ink; g.lineWidth = 3;
        g.strokeText(fx.text, this.sx(fx.x) - cs * 0.05, this.sy(fx.y) - k * cs * 0.8);
        g.fillText(fx.text, this.sx(fx.x) - cs * 0.05, this.sy(fx.y) - k * cs * 0.8);
        g.globalAlpha = 1;
      }

      // ホバー・ゴースト
      if (ui.hover && w.inBounds(ui.hover.x, ui.hover.y)) {
        const { x, y } = ui.hover;
        if (ui.tool.kind === 'place') {
          g.globalAlpha = 0.55;
          const ghost = { type: ui.tool.type, dir: ui.dir, mirror: ui.mirror, timer: 0 };
          this.drawEquip(g, ghost, x, y, w.time, null);
          this.drawEquipTop(g, ghost, x, y, null);
          g.globalAlpha = 1;
        }
        const colors = { place: COL.paper, recall: '#f0b44c', reset: COL.rubyLight, inspect: 'rgba(255,255,255,0.7)' };
        g.strokeStyle = colors[ui.tool.kind] || COL.paper;
        g.lineWidth = 2;
        g.setLineDash(ui.tool.kind === 'inspect' ? [4, 3] : []);
        g.strokeRect(this.sx(x) + 1.5, this.sy(y) + 1.5, cs - 3, cs - 3);
        g.setLineDash([]);
      }
    }

    // ---- 設備 ----

    drawEquip(g, e, x, y, time, cell) {
      const def = GA.EQUIPMENT[e.type];
      const cs = this.cs, px = this.sx(x), py = this.sy(y);
      const cx = px + cs / 2, cy = py + cs / 2;
      const d = DIRS[e.dir];
      switch (def.kind) {
        case 'conveyor': this.drawConveyor(g, e, x, y, time, !!cell); break;
        case 'generator': {
          g.fillStyle = COL.metalDark; this.rr(g, px + cs * 0.08, py + cs * 0.12, cs * 0.84, cs * 0.8, cs * 0.08); g.fill();
          g.fillStyle = '#5f7a5a'; this.rr(g, px + cs * 0.12, py + cs * 0.08, cs * 0.76, cs * 0.76, cs * 0.08); g.fill();
          g.fillStyle = 'rgba(0,0,0,0.25)';
          for (let i = 0; i < 3; i++) g.fillRect(px + cs * (0.24 + i * 0.2), py + cs * 0.2, cs * 0.06, cs * 0.52);
          // 生成までのゲージ
          const k = Math.min(1, e.timer / def.interval);
          g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(px + cs * 0.18, py + cs * 0.74, cs * 0.64, cs * 0.06);
          g.fillStyle = '#e8d27a'; g.fillRect(px + cs * 0.18, py + cs * 0.74, cs * 0.64 * k, cs * 0.06);
          this.drawOutArrow(g, cx, cy, d, '#e8d27a');
          break;
        }
        case 'processor': {
          g.fillStyle = COL.metalDark; this.rr(g, px + cs * 0.06, py + cs * 0.1, cs * 0.88, cs * 0.84, cs * 0.14); g.fill();
          g.fillStyle = COL.metal; this.rr(g, px + cs * 0.08, py + cs * 0.06, cs * 0.84, cs * 0.8, cs * 0.14); g.fill();
          g.fillStyle = COL.metalDark; g.beginPath(); g.arc(cx, cy - cs * 0.02, cs * 0.28, 0, Math.PI * 2); g.fill();
          break;
        }
        case 'storage': {
          if (e.type === 'basket') { this.drawBasket(g, px, py); break; }
          g.fillStyle = COL.cloth; g.fillRect(px + cs * 0.06, py + cs * 0.06, cs * 0.88, cs * 0.88);
          g.fillStyle = COL.clothAlt;
          const n = 4, s = cs * 0.88 / n;
          for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if ((i + j) % 2 === 0) g.fillRect(px + cs * 0.06 + i * s, py + cs * 0.06 + j * s, s, s);
          break;
        }
        case 'disposal': {
          g.fillStyle = '#2b2f33'; this.rr(g, px + cs * 0.08, py + cs * 0.08, cs * 0.84, cs * 0.84, cs * 0.06); g.fill();
          g.fillStyle = '#16181a'; g.fillRect(px + cs * 0.18, py + cs * 0.38, cs * 0.64, cs * 0.24);
          g.strokeStyle = '#c9a43a'; g.lineWidth = Math.max(1, cs * 0.05);
          for (let i = 0; i < 4; i++) {
            const xx = px + cs * (0.14 + i * 0.22);
            g.beginPath(); g.moveTo(xx, py + cs * 0.12); g.lineTo(xx + cs * 0.1, py + cs * 0.24); g.stroke();
            g.beginPath(); g.moveTo(xx, py + cs * 0.76); g.lineTo(xx + cs * 0.1, py + cs * 0.88); g.stroke();
          }
          break;
        }
        case 'interior': {
          if (def.effect === 'closed') { this.drawClosedSign(g, px, py); break; }
          if (def.effect !== 'attract') break;
          g.fillStyle = COL.rust; g.fillRect(cx - cs * 0.04, py + cs * 0.45, cs * 0.08, cs * 0.5);
          g.fillStyle = COL.ink; this.rr(g, px + cs * 0.02, py + cs * 0.12, cs * 0.96, cs * 0.44, cs * 0.06); g.fill();
          g.fillStyle = COL.paper; this.rr(g, px + cs * 0.06, py + cs * 0.15, cs * 0.88, cs * 0.38, cs * 0.04); g.fill();
          g.fillStyle = COL.ruby;
          g.font = `700 ${Math.round(cs * 0.17)}px "DotGothic16", sans-serif`;
          g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText('レストラン', cx, py + cs * 0.27);
          g.fillText('OPEN', cx, py + cs * 0.43);
          break;
        }
      }
    }

    drawEquipTop(g, e, x, y, cell) {
      const def = GA.EQUIPMENT[e.type];
      const cs = this.cs, px = this.sx(x), py = this.sy(y);
      const cx = px + cs / 2, cy = py + cs / 2;
      if (def.mode === 'sorter' && !this.iconMode) this.drawSorterRef(g, e, x, y);
      if (def.kind === 'processor') {
        const o = cell && cell.obj;
        // 作業中は進捗リング
        if (o && o.t >= 1 && !o.done) {
          const k = o.work / def.workTime;
          g.strokeStyle = '#e8d27a'; g.lineWidth = Math.max(2, cs * 0.07);
          g.beginPath(); g.arc(cx, cy - cs * 0.02, cs * 0.32, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); g.stroke();
        }
        g.fillStyle = COL.paper;
        g.font = `700 ${Math.round(cs * 0.2)}px "DotGothic16", sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(GA.PROCESSES[def.process].name, cx, py + cs * 0.2);
        this.drawOutArrow(g, cx, cy, DIRS[e.dir], COL.paper);
      }
      if (def.kind === 'disposal' && cell && cell.obj) {
        const k = Math.min(1, cell.obj.work / def.workTime);
        g.fillStyle = 'rgba(195,18,63,0.6)';
        g.fillRect(px + cs * 0.18, py + cs * 0.38, cs * 0.64 * k, cs * 0.24);
      }
    }

    drawOutArrow(g, cx, cy, d, color) {
      const cs = this.cs;
      const tx = cx + d.x * cs * 0.47, ty = cy + d.y * cs * 0.47;
      const s = cs * 0.12;
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(tx, ty);
      g.lineTo(tx - d.x * s * 1.3 - d.y * s, ty - d.y * s * 1.3 + d.x * s);
      g.lineTo(tx - d.x * s * 1.3 + d.y * s, ty - d.y * s * 1.3 - d.x * s);
      g.closePath(); g.fill();
    }

    // live=false はゴーストやアイコン（盤面の接続を見ない）
    drawConveyor(g, e, x, y, time, live) {
      const def = GA.EQUIPMENT[e.type];
      if (def.mode === 'junction') return this.drawTire(g, e, x, y, time, live);
      if (def.mode === 'sorter') return this.drawSorter(g, e, x, y, time, live);
      const cs = this.cs, px = this.sx(x), py = this.sy(y);
      const cx = px + cs / 2, cy = py + cs / 2;
      const out = e.dir, back = (out + 2) % 4;
      const feeds = (live ? this.feeders(x, y) : []).filter(k => k !== out);
      const curveFrom = (feeds.length === 1 && feeds[0] !== back) ? feeds[0] : null;
      const from = curveFrom === null ? back : curveFrom;
      this.drawBand(g, cx, cy, from, out, time, def.moveTime, ['#3c454b', '#7a6a55', '#a89470'], [0.62, 0.5, 0.4]);
      // 横からの追加入力を短く描く
      for (const k of feeds) {
        if (k === from) continue;
        g.strokeStyle = COL.metalDark; g.lineWidth = cs * 0.3;
        g.beginPath(); g.moveTo(cx + DIRS[k].x * cs / 2, cy + DIRS[k].y * cs / 2); g.lineTo(cx + DIRS[k].x * cs * 0.2, cy + DIRS[k].y * cs * 0.2); g.stroke();
      }
      this.drawOutArrow(g, cx, cy, DIRS[out], 'rgba(36,30,27,0.75)');
    }

    // from 側の辺から to 側の辺へ（to が null なら中心まで、from が null なら中心から）流れる帯
    drawBand(g, cx, cy, from, to, time, moveTime, colors, widths) {
      const cs = this.cs;
      const pt = k => k === null ? { x: cx, y: cy } : { x: cx + DIRS[k].x * cs / 2, y: cy + DIRS[k].y * cs / 2 };
      const a = pt(from), b = pt(to);
      const path = () => { g.beginPath(); g.moveTo(a.x, a.y); g.quadraticCurveTo(cx, cy, b.x, b.y); };
      g.lineCap = 'butt';
      g.strokeStyle = colors[0]; g.lineWidth = cs * widths[0]; path(); g.stroke();
      g.strokeStyle = colors[1]; g.lineWidth = cs * widths[1]; path(); g.stroke();
      g.strokeStyle = colors[2]; g.lineWidth = cs * widths[2];
      const period = cs * 0.25;
      g.setLineDash([cs * 0.16, cs * 0.09]);
      g.lineDashOffset = -((time / moveTime) * cs) % period;
      path(); g.stroke();
      g.setLineDash([]); g.lineDashOffset = 0;
    }

    drawTire(g, e, x, y, time, live) {
      const cs = this.cs, px = this.sx(x), py = this.sy(y);
      const cx = px + cs / 2, cy = py + cs / 2;
      const def = GA.EQUIPMENT[e.type];
      const TIRE = ['#1f2022', '#3a3c3f', '#5d6064'];
      const W = [0.64, 0.52, 0.4];
      const outs = live ? this.world.outputsOf(x, y) : [e.dir];
      let ins = live ? this.world.inputsOf(x, y).filter(k => !outs.includes(k)) : [];
      if (!ins.length && !outs.includes((e.dir + 2) % 4)) ins = [(e.dir + 2) % 4]; // 入口が無ければ後ろを入口として描く
      if (ins.length === 1 && outs.length === 1) {
        this.drawBand(g, cx, cy, ins[0], outs[0], time, def.moveTime, TIRE, W);
      } else {
        for (const k of ins) this.drawBand(g, cx, cy, k, null, time, def.moveTime, TIRE, W);
        for (const k of outs) this.drawBand(g, cx, cy, null, k, time, def.moveTime, TIRE, W);
        g.fillStyle = TIRE[1];
        g.beginPath(); g.arc(cx, cy, cs * 0.3, 0, Math.PI * 2); g.fill();
        g.strokeStyle = TIRE[2]; g.lineWidth = Math.max(1, cs * 0.05);
        g.beginPath(); g.arc(cx, cy, cs * 0.18, 0, Math.PI * 2); g.stroke();
      }
      for (const k of outs) this.drawOutArrow(g, cx, cy, DIRS[k], k === e.dir ? COL.paper : '#e8d27a');
      if (live && this.world.junctionError(x, y)) {
        g.fillStyle = 'rgba(195,18,63,0.35)';
        g.fillRect(px, py, cs, cs);
        g.fillStyle = COL.ruby;
        g.beginPath(); g.arc(cx, cy, cs * 0.22, 0, Math.PI * 2); g.fill();
        g.fillStyle = COL.paper;
        g.font = `700 ${Math.round(cs * 0.32)}px "DotGothic16", sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('!', cx, cy + 1);
      }
    }

    drawSorter(g, e, x, y, time, live) {
      const cs = this.cs, px = this.sx(x), py = this.sy(y);
      const cx = px + cs / 2, cy = py + cs / 2;
      const def = GA.EQUIPMENT[e.type];
      const sides = this.world.sorterSides(e);
      const TIRE = ['#1f2022', '#3a3c3f', '#5d6064'];
      const SORT = ['#1f2022', '#6b5a2a', '#c9a43a'];
      this.drawBand(g, cx, cy, null, sides.out, time, def.moveTime, SORT, [0.5, 0.4, 0.3]);
      this.drawBand(g, cx, cy, (e.dir + 2) % 4, e.dir, time, def.moveTime, TIRE, [0.64, 0.52, 0.4]);
      // 比較マス側の「目」
      const r = DIRS[sides.ref];
      const ex = cx + r.x * cs * 0.36, ey = cy + r.y * cs * 0.36;
      g.fillStyle = '#c9a43a';
      g.beginPath(); g.arc(ex, ey, cs * 0.12, 0, Math.PI * 2); g.fill();
      g.fillStyle = COL.ink;
      g.beginPath(); g.arc(ex + r.x * cs * 0.03, ey + r.y * cs * 0.03, cs * 0.05, 0, Math.PI * 2); g.fill();
      this.drawOutArrow(g, cx, cy, DIRS[e.dir], COL.paper);
      this.drawOutArrow(g, cx, cy, DIRS[sides.out], '#e8d27a');
    }

    // 仕分けコンベアの比較マスを点線で示す
    drawSorterRef(g, e, x, y) {
      const cs = this.cs;
      const r = DIRS[this.world.sorterSides(e).ref];
      const rx = x + r.x, ry = y + r.y;
      if (!this.world.inBounds(rx, ry)) return;
      g.strokeStyle = 'rgba(201,164,58,0.9)';
      g.lineWidth = Math.max(1, cs * 0.04);
      g.setLineDash([cs * 0.1, cs * 0.08]);
      g.strokeRect(this.sx(rx) + cs * 0.12, this.sy(ry) + cs * 0.12, cs * 0.76, cs * 0.76);
      g.setLineDash([]);
    }

    // ---- オブジェクト ----

    drawObjOnCell(g, c, time) {
      const o = c.obj;
      if (o.held) return;
      const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const k = ease(o.t);
      const x = o.fx + (o.x - o.fx) * k + 0.5;
      const y = o.fy + (o.y - o.fy) * k + 0.5;
      let scale = 1;
      const kind = c.equip ? GA.EQUIPMENT[c.equip.type].kind : null;
      if (kind === 'processor' && o.t >= 1) scale = 0.55;
      if (kind === 'disposal') scale = Math.max(0.1, 1 - o.work / GA.EQUIPMENT[c.equip.type].workTime);
      this.drawObj(g, o.type, this.sx(x), this.sy(y), this.cs * 0.3 * scale, o.id);
    }

    drawObj(g, type, x, y, r, seed) {
      const rnd = seeded(seed || 1);
      if (type === 'gomi') {
        g.fillStyle = COL.gomi;
        g.beginPath();
        const n = 7;
        for (let i = 0; i < n; i++) {
          const a = i / n * Math.PI * 2;
          const rr = r * (0.7 + rnd() * 0.4);
          const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr * 0.85;
          i ? g.lineTo(px, py) : g.moveTo(px, py);
        }
        g.closePath(); g.fill();
        g.fillStyle = '#8f8b7e'; g.fillRect(x - r * 0.4, y - r * 0.3, r * 0.35, r * 0.25);
        g.fillStyle = '#4b4a44'; g.fillRect(x + r * 0.05, y + r * 0.05, r * 0.4, r * 0.18);
      } else if (type === 'gomidango') {
        g.fillStyle = 'rgba(0,0,0,0.25)';
        g.beginPath(); g.ellipse(x, y + r * 0.75, r * 0.9, r * 0.3, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = COL.dango;
        g.beginPath(); g.arc(x, y, r * 0.9, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#6a5034';
        for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(x + (rnd() - 0.5) * r, y + (rnd() - 0.5) * r, r * 0.12, 0, Math.PI * 2); g.fill(); }
        g.fillStyle = 'rgba(255,240,210,0.45)';
        g.beginPath(); g.arc(x - r * 0.3, y - r * 0.35, r * 0.22, 0, Math.PI * 2); g.fill();
      } else {
        g.fillStyle = '#ccc'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
    }

    drawTonicDrop(g, x, y, r) {
      g.fillStyle = COL.ruby;
      g.beginPath();
      g.moveTo(x, y - r * 1.5);
      g.bezierCurveTo(x + r * 1.1, y - r * 0.3, x + r, y + r, x, y + r);
      g.bezierCurveTo(x - r, y + r, x - r * 1.1, y - r * 0.3, x, y - r * 1.5);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.beginPath(); g.arc(x - r * 0.35, y, r * 0.25, 0, Math.PI * 2); g.fill();
    }

    // ---- キャラクター（仮） ----

    drawCustomer(g, cu) {
      const cs = this.cs;
      const x = this.sx(cu.x), y = this.sy(cu.y);
      const moving = cu.state === 'enter' || cu.state === 'leave' || cu.state === 'toTable';
      const bob = moving ? Math.abs(Math.sin(cu.bob * 8)) * cs * 0.06 : 0;
      const s = cs * 0.5;
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.beginPath(); g.ellipse(x, y + s * 0.15, s * 0.45, s * 0.14, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = `hsl(${cu.hue} 22% 58%)`;
      this.rr(g, x - s * 0.4, y - s * 0.9 - bob, s * 0.8, s * 0.95, s * 0.14); g.fill();
      g.fillStyle = `hsl(${cu.hue} 25% 40%)`;
      g.fillRect(x - s * 0.4, y - s * 0.2 - bob, s * 0.8, s * 0.12);
      g.fillStyle = '#1d2226';
      this.rr(g, x - s * 0.28, y - s * 0.75 - bob, s * 0.56, s * 0.3, s * 0.06); g.fill();
      const eye = cu.state === 'eat' ? '#ffd36b' : '#9fe3e0';
      g.fillStyle = eye;
      g.fillRect(x - s * 0.18, y - s * 0.66 - bob, s * 0.1, s * 0.1);
      g.fillRect(x + s * 0.08, y - s * 0.66 - bob, s * 0.1, s * 0.1);
      g.strokeStyle = '#2a2a2a'; g.lineWidth = Math.max(1, s * 0.06);
      g.beginPath(); g.moveTo(x, y - s * 0.9 - bob); g.lineTo(x, y - s * 1.15 - bob); g.stroke();
      g.fillStyle = cu.state === 'leave' && !cu.hungry ? COL.ruby : '#d9c46a';
      g.beginPath(); g.arc(x, y - s * 1.18 - bob, s * 0.08, 0, Math.PI * 2); g.fill();

      // 吹き出し
      let mark = null;
      if (cu.state === 'browse') mark = '?';
      if (cu.state === 'eat') mark = '…';
      if (cu.state === 'leave' && cu.hungry) mark = '×';
      if (mark) {
        g.fillStyle = COL.paper;
        g.beginPath(); g.arc(x + s * 0.55, y - s * 1.2 - bob, s * 0.26, 0, Math.PI * 2); g.fill();
        g.fillStyle = COL.ink;
        g.font = `700 ${Math.round(s * 0.36)}px "DotGothic16", sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(mark, x + s * 0.55, y - s * 1.18 - bob);
      }
      if (cu.state === 'leave' && !cu.hungry) this.drawTonicDrop(g, x + s * 0.55, y - s * 1.2 - bob, s * 0.14);
    }

    drawPrincess(g, time, hover) {
      const cs = this.cs;
      const p = this.princessPos();
      const x = this.sx(p.x), y = this.sy(p.y);
      const s = cs * 0.9;
      const bob = Math.sin(time * 2) * cs * 0.03;
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath(); g.ellipse(x, y + s * 0.5, s * 0.5, s * 0.14, 0, 0, Math.PI * 2); g.fill();
      if (hover) {
        g.strokeStyle = COL.paper; g.lineWidth = 2; g.setLineDash([4, 3]);
        g.beginPath(); g.ellipse(x, y + s * 0.5, s * 0.62, s * 0.2, 0, 0, Math.PI * 2); g.stroke();
        g.setLineDash([]);
      }
      // ドレス
      g.fillStyle = '#7a2033';
      g.beginPath();
      g.moveTo(x - s * 0.45, y + s * 0.5); g.lineTo(x - s * 0.2, y - s * 0.2 + bob);
      g.lineTo(x + s * 0.2, y - s * 0.2 + bob); g.lineTo(x + s * 0.45, y + s * 0.5); g.closePath(); g.fill();
      // 頭
      g.fillStyle = '#b8b2a6';
      this.rr(g, x - s * 0.26, y - s * 0.72 + bob, s * 0.52, s * 0.48, s * 0.12); g.fill();
      g.fillStyle = '#1d2226';
      this.rr(g, x - s * 0.18, y - s * 0.6 + bob, s * 0.36, s * 0.2, s * 0.05); g.fill();
      g.fillStyle = COL.rubyLight;
      g.fillRect(x - s * 0.12, y - s * 0.54 + bob, s * 0.07, s * 0.07);
      g.fillRect(x + s * 0.05, y - s * 0.54 + bob, s * 0.07, s * 0.07);
      // 冠
      g.fillStyle = '#d6b44a';
      g.beginPath();
      g.moveTo(x - s * 0.22, y - s * 0.72 + bob);
      g.lineTo(x - s * 0.22, y - s * 0.92 + bob); g.lineTo(x - s * 0.1, y - s * 0.8 + bob);
      g.lineTo(x, y - s * 0.96 + bob); g.lineTo(x + s * 0.1, y - s * 0.8 + bob);
      g.lineTo(x + s * 0.22, y - s * 0.92 + bob); g.lineTo(x + s * 0.22, y - s * 0.72 + bob);
      g.closePath(); g.fill();
      this.drawTonicDrop(g, x, y - s * 0.83 + bob, s * 0.05);
      // 名札
      g.font = `700 ${Math.round(cs * 0.22)}px "DotGothic16", sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const label = 'ガラクタ姫';
      const tw = g.measureText(label).width + cs * 0.2;
      g.fillStyle = 'rgba(36,30,27,0.85)';
      this.rr(g, x - tw / 2, y + s * 0.62, tw, cs * 0.32, cs * 0.08); g.fill();
      g.fillStyle = COL.paper;
      g.fillText(label, x, y + s * 0.62 + cs * 0.16);
    }

    drawBasket(g, px, py) {
      const cs = this.cs;
      const x = px + cs * 0.1, y = py + cs * 0.22, w = cs * 0.8, h = cs * 0.66;
      g.fillStyle = '#5a3a1e';
      this.rr(g, x, y + cs * 0.04, w, h, cs * 0.16); g.fill();
      g.fillStyle = '#a8743f';
      this.rr(g, x, y, w, h, cs * 0.16); g.fill();
      // 編み目
      g.save();
      this.rr(g, x, y, w, h, cs * 0.16); g.clip();
      g.strokeStyle = '#7d5129'; g.lineWidth = Math.max(1, cs * 0.04);
      const step = cs * 0.13;
      for (let i = 0; i * step < h; i++) {
        g.beginPath(); g.moveTo(x, y + i * step + step / 2); g.lineTo(x + w, y + i * step + step / 2); g.stroke();
      }
      g.strokeStyle = '#c8935a';
      for (let i = 0; i * step < w; i++) {
        for (let j = 0; j * step < h; j++) {
          if ((i + j) % 2) continue;
          g.beginPath(); g.moveTo(x + i * step + step / 2, y + j * step); g.lineTo(x + i * step + step / 2, y + j * step + step); g.stroke();
        }
      }
      g.restore();
      // 縁
      g.strokeStyle = '#6b4423'; g.lineWidth = Math.max(2, cs * 0.07);
      this.rr(g, x, y, w, h, cs * 0.16); g.stroke();
      g.fillStyle = 'rgba(40,24,10,0.35)';
      this.rr(g, x + cs * 0.1, y + cs * 0.1, w - cs * 0.2, h - cs * 0.2, cs * 0.1); g.fill();
    }

    drawClosedSign(g, px, py) {
      const cs = this.cs;
      // 脚
      g.strokeStyle = '#3a3a3a'; g.lineWidth = Math.max(2, cs * 0.06);
      g.beginPath();
      g.moveTo(px + cs * 0.22, py + cs * 0.92); g.lineTo(px + cs * 0.3, py + cs * 0.3);
      g.moveTo(px + cs * 0.78, py + cs * 0.92); g.lineTo(px + cs * 0.7, py + cs * 0.3);
      g.stroke();
      // 縞の板
      const bx = px + cs * 0.06, by = py + cs * 0.16, bw = cs * 0.88, bh = cs * 0.3;
      g.save();
      g.beginPath(); g.rect(bx, by, bw, bh); g.clip();
      g.fillStyle = '#e8c22e'; g.fillRect(bx, by, bw, bh);
      g.fillStyle = '#1f1f1f';
      for (let i = -2; i < 8; i++) {
        g.beginPath();
        g.moveTo(bx + i * cs * 0.2, by + bh); g.lineTo(bx + i * cs * 0.2 + cs * 0.1, by + bh);
        g.lineTo(bx + i * cs * 0.2 + cs * 0.1 + bh, by); g.lineTo(bx + i * cs * 0.2 + bh, by);
        g.closePath(); g.fill();
      }
      g.restore();
      // 文字の札
      g.fillStyle = COL.paper; this.rr(g, px + cs * 0.14, py + cs * 0.5, cs * 0.72, cs * 0.26, cs * 0.04); g.fill();
      g.fillStyle = COL.ink;
      g.font = `700 ${Math.round(cs * 0.18)}px "DotGothic16", sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('工事中', px + cs / 2, py + cs * 0.63);
    }

    rr(g, x, y, w, h, r) {
      g.beginPath();
      g.moveTo(x + r, y);
      g.arcTo(x + w, y, x + w, y + h, r);
      g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r);
      g.arcTo(x, y, x + w, y, r);
      g.closePath();
    }
  }

  GA.Renderer = Renderer;
})();
