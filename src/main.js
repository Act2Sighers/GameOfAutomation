// 入力・UI・ゲームループ・保存
(function () {
  const GA = window.GA;
  const C = GA.CONFIG;
  const DIRS = GA.DIRS;
  const SAVE_KEY = 'garakuta-restaurant-save-v1';
  const $ = id => document.getElementById(id);

  const world = new GA.World();
  const canvas = $('game');
  const renderer = new GA.Renderer(canvas, world);

  const ui = {
    tool: { kind: 'inspect' },
    dir: 1,
    mirror: 0,
    speed: 1,
    hover: null,
    hoverPrincess: false,
    drag: null,
  };

  // ---- 保存 ----

  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(world.serialize())); } catch (e) { /* 保存できない環境では何もしない */ }
  }
  function loadSaved() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  // ---- 表示ヘルパー ----

  let toastTimer = 0;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }

  function setInfo(html) { $('info').innerHTML = html; }

  const sideName = k => DIRS[k].name;

  function sorterText(dir, mirror) {
    const s = world.sorterSides({ dir, mirror });
    return `本流の先 ${sideName(dir)}／仕分け先 ${sideName(s.out)}／比較マス ${sideName(s.ref)}`;
  }

  function placingMirrorable() {
    return ui.tool.kind === 'place' && GA.EQUIPMENT[ui.tool.type].mirrorable;
  }

  // 回転ボタンの表示。仕分けコンベアは「本流の向き＋仕分け先の向き」
  function updateRotateBtn() {
    let label = DIRS[ui.dir].arrow;
    if (placingMirrorable()) label += `<small>${DIRS[world.sorterSides({ dir: ui.dir, mirror: ui.mirror }).out].arrow}</small>`;
    $('rotate').innerHTML = label;
  }

  function toolHint() {
    const t = ui.tool;
    if (t.kind === 'place') {
      const def = GA.EQUIPMENT[t.type];
      const dir = def.mirrorable ? sorterText(ui.dir, ui.mirror) : `向き ${DIRS[ui.dir].arrow}`;
      return `<b>${def.name}</b>を置く（${dir}）。ドラッグで連続配置、置いてある設備をタップで回転。`;
    }
    if (t.kind === 'recall') return '<b>回収</b>：タップした設備をインベントリに戻す。上に乗っていたものはその場に残る。';
    if (t.kind === 'reset') return '<b>リセット</b>：タップしたマスのオブジェクトを消す。詰まったときに。';
    return '<b>見る・回す</b>：マスをタップすると中身を確認し、向きのある設備なら回転する。<b>ガラクタ姫</b>をタップするとショップが開く。';
  }

  function describeCell(x, y) {
    const c = world.cell(x, y);
    const parts = [];
    if (c.equip) {
      const def = GA.EQUIPMENT[c.equip.type];
      let dir = def.directional ? `（向き ${DIRS[c.equip.dir].arrow}）` : '';
      const limit = def.maxPlaced ? `（設置 ${world.countPlaced(c.equip.type)}/${def.maxPlaced}）` : '';
      if (def.mode === 'junction') {
        const outs = world.outputsOf(x, y);
        const ins = world.inputsOf(x, y).filter(k => !outs.includes(k));
        const list = ks => ks.length ? ks.map(sideName).join('・') : 'なし';
        dir = `（入口 ${list(ins)}／出口 ${list(outs)}）`;
      }
      if (def.mode === 'sorter') {
        const ref = world.sorterSides(c.equip).ref;
        const rc = world.cell(x + DIRS[ref].x, y + DIRS[ref].y);
        const refObj = rc && rc.obj ? GA.OBJECTS[rc.obj.type].name : '空';
        dir = `（${sorterText(c.equip.dir, c.equip.mirror)}・今は${refObj}）`;
      }
      parts.push(`<b>${def.name}</b>${dir}${limit}：${def.desc}`);
      if (world.junctionError(x, y)) parts.push('<b>エラー</b>：4方向すべてが入口、またはすべてが出口になっているため止まっている。周りのタイヤコンベアの向きを変えてほしい。');
    }
    if (c.obj) {
      const od = GA.OBJECTS[c.obj.type];
      const rare = od.rarity ? `／${GA.RARITIES[od.rarity].name}・${GA.RARITIES[od.rarity].tonic}トニック` : '';
      parts.push(`<b>${od.name}</b>${rare}：${od.desc}`);
    }
    if (!parts.length) parts.push('何も無い地面。');
    return parts.join('<br>');
  }

  function refreshHud() {
    $('tonic').textContent = world.tonic;
    $('served').textContent = world.stats.served;
    $('hungry').textContent = world.stats.hungry;
    $('shop-tonic').textContent = world.tonic;
  }

  // 設備アイコン（レンダラーの描画をそのまま縮小して使う）
  function drawIcon(cv, type) {
    const size = 36, dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = size * dpr; cv.height = size * dpr;
    cv.style.width = size + 'px'; cv.style.height = size + 'px';
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const saved = { cs: renderer.cs, ox: renderer.ox, oy: renderer.oy, icon: renderer.iconMode };
    renderer.cs = size; renderer.ox = 0; renderer.oy = 0; renderer.iconMode = true;
    renderer.drawEquip(g, { type, dir: 1, timer: 0 }, 0, 0, 0, null);
    renderer.drawEquipTop(g, { type, dir: 1 }, 0, 0, null);
    Object.assign(renderer, { cs: saved.cs, ox: saved.ox, oy: saved.oy, iconMode: saved.icon });
  }

  // ---- ツールバー ----

  function buildToolbar() {
    const bar = $('tools');
    bar.innerHTML = '';
    const mk = (label, kind, type, count) => {
      const b = document.createElement('button');
      b.className = 'tool';
      b.type = 'button';
      b.dataset.kind = kind;
      if (type) b.dataset.type = type;
      const active = ui.tool.kind === kind && (!type || ui.tool.type === type);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
      if (type) {
        const cv = document.createElement('canvas');
        drawIcon(cv, type);
        b.appendChild(cv);
        if (!count) b.disabled = true;
      } else {
        const g = document.createElement('span');
        g.className = 'glyph';
        g.textContent = { inspect: '◎', recall: '↩', reset: '✕' }[kind];
        b.appendChild(g);
      }
      const l = document.createElement('span');
      l.className = 'tool-label';
      l.textContent = label;
      b.appendChild(l);
      if (type) {
        const n = document.createElement('span');
        n.className = 'count';
        n.textContent = count;
        b.appendChild(n);
      }
      b.addEventListener('click', () => {
        ui.tool = type ? { kind, type } : { kind };
        if (!placingMirrorable()) ui.mirror = 0;
        buildToolbar();
        setInfo(toolHint());
      });
      bar.appendChild(b);
    };
    mk('見る・回す', 'inspect');
    mk('回収', 'recall');
    mk('リセット', 'reset');
    const sep = document.createElement('span'); sep.className = 'sep'; bar.appendChild(sep);
    for (const type of GA.SHOP_ORDER) mk(GA.EQUIPMENT[type].name, 'place', type, world.inv[type] || 0);
    updateRotateBtn();
  }

  function invChanged() {
    // 在庫切れになったら「見る」に戻す
    if (ui.tool.kind === 'place' && !(world.inv[ui.tool.type] > 0)) ui.tool = { kind: 'inspect' };
    buildToolbar();
    refreshHud();
  }

  // 仕分けコンベアを置くときは「左右反転」を挟んで8段階で一周
  function rotate(step) {
    if (placingMirrorable()) {
      const i = (ui.dir * 2 + ui.mirror + step + 8) % 8;
      ui.dir = i >> 1; ui.mirror = i & 1;
    } else {
      ui.dir = (ui.dir + step + 4) % 4;
    }
    updateRotateBtn();
    setInfo(toolHint());
  }

  // ---- ショップ ----

  function buildShop() {
    const list = $('shop-list');
    list.innerHTML = '';
    for (const type of GA.SHOP_ORDER) {
      const def = GA.EQUIPMENT[type];
      const row = document.createElement('div');
      row.className = 'shop-row';
      const cv = document.createElement('canvas');
      drawIcon(cv, type);
      const text = document.createElement('div');
      text.className = 'shop-text';
      const limit = def.maxPlaced ? `<span class="owned">設置上限 ${def.maxPlaced}</span>` : '';
      text.innerHTML = `<div class="shop-name">${def.name}<span class="owned">在庫 ${world.inv[type] || 0}</span>${limit}</div><div class="shop-desc">${def.desc}</div>`;
      const btns = document.createElement('div');
      btns.className = 'shop-btns';
      const buy = document.createElement('button');
      buy.type = 'button';
      buy.className = 'btn primary';
      buy.innerHTML = `買う <span class="price">${def.price}</span>`;
      const atLimit = world.atOwnLimit(type);
      buy.disabled = world.tonic < def.price || atLimit;
      if (atLimit) buy.innerHTML = '上限';
      buy.addEventListener('click', () => { if (world.buy(type)) { invChanged(); buildShop(); } });
      const sell = document.createElement('button');
      sell.type = 'button';
      sell.className = 'btn';
      sell.innerHTML = `売る <span class="price">+${world.sellPrice(type)}</span>`;
      sell.disabled = !(world.inv[type] > 0);
      sell.addEventListener('click', () => { if (world.sell(type)) { invChanged(); buildShop(); } });
      btns.append(buy, sell);
      row.append(cv, text, btns);
      list.appendChild(row);
    }
  }

  function openShop() {
    buildShop();
    refreshHud();
    $('shop').hidden = false;
  }

  // ---- 盤面への操作 ----

  function applyAt(x, y, first) {
    if (!world.inBounds(x, y)) return false;
    const t = ui.tool;
    let res = null;
    if (t.kind === 'place') {
      const c = world.cell(x, y);
      if (c.equip && !first) return false; // ドラッグ中は空きマスだけに置く
      res = world.place(t.type, x, y, ui.dir, ui.mirror);
      if (res.ok) invChanged();
    } else if (t.kind === 'recall') {
      res = world.recall(x, y);
      if (res.ok) invChanged();
    } else if (t.kind === 'reset') {
      world.removeObjAt(x, y);
      res = { ok: true };
    } else {
      if (first) world.rotateAt(x, y);
      setInfo(describeCell(x, y));
      return false;
    }
    if (res && !res.ok && res.msg && first) toast(res.msg);
    return res && res.ok;
  }

  function dirBetween(a, b) {
    for (let k = 0; k < 4; k++) if (a.x + DIRS[k].x === b.x && a.y + DIRS[k].y === b.y) return k;
    return null;
  }

  function pointerPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener('pointerdown', e => {
    if (e.button !== undefined && e.button > 0) return;
    const p = pointerPos(e);
    if (renderer.hitPrincess(p.x, p.y)) { openShop(); return; }
    const cell = renderer.toCell(p.x, p.y);
    ui.hover = cell;
    canvas.setPointerCapture(e.pointerId);
    const occupied = world.inBounds(cell.x, cell.y) && world.cell(cell.x, cell.y).equip;
    ui.drag = { last: cell, start: cell, moved: false, placedLast: false, deferred: false };
    if (ui.tool.kind === 'place' && occupied) {
      ui.drag.deferred = true; // タップかドラッグかは指を離すまで決めない
    } else {
      ui.drag.placedLast = applyAt(cell.x, cell.y, true);
    }
  });

  canvas.addEventListener('pointermove', e => {
    const p = pointerPos(e);
    const cell = renderer.toCell(p.x, p.y);
    ui.hover = cell;
    ui.hoverPrincess = renderer.hitPrincess(p.x, p.y);
    canvas.style.cursor = ui.hoverPrincess ? 'pointer' : 'crosshair';
    const d = ui.drag;
    if (!d) return;
    // 飛び越したマスも1マスずつたどる
    while (d.last.x !== cell.x || d.last.y !== cell.y) {
      const next = { x: d.last.x, y: d.last.y };
      if (next.x !== cell.x) next.x += Math.sign(cell.x - next.x);
      else next.y += Math.sign(cell.y - next.y);
      d.moved = true;
      if (ui.tool.kind === 'place') {
        const k = dirBetween(d.last, next);
        const lastCell = world.cell(d.last.x, d.last.y);
        // 置いてある列の「端」からドラッグしたときだけ、その端の向きを付け替える（途中から分岐させるときは変えない）
        const front = lastCell && lastCell.equip ? world.cell(d.last.x + DIRS[lastCell.equip.dir].x, d.last.y + DIRS[lastCell.equip.dir].y) : null;
        const isLineEnd = lastCell && lastCell.equip && lastCell.equip.type === ui.tool.type && !(front && front.equip);
        if (d.placedLast || (d.deferred && isLineEnd && d.last === d.start)) world.setDir(d.last.x, d.last.y, k);
        if (ui.dir !== k) { ui.dir = k; updateRotateBtn(); }
      }
      d.placedLast = applyAt(next.x, next.y, false);
      d.last = next;
    }
  });

  function endDrag() {
    const d = ui.drag;
    if (d && d.deferred && !d.moved) applyAt(d.start.x, d.start.y, true);
    if (d && ui.tool.kind === 'place') setInfo(toolHint());
    ui.drag = null;
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', () => { ui.drag = null; });
  canvas.addEventListener('pointerleave', () => { if (!ui.drag) { ui.hover = null; ui.hoverPrincess = false; } });
  canvas.addEventListener('contextmenu', e => { e.preventDefault(); rotate(1); });
  canvas.addEventListener('wheel', e => {
    if (ui.tool.kind !== 'place') return;
    e.preventDefault();
    rotate(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });

  window.addEventListener('keydown', e => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'r' || e.key === 'R') rotate(e.shiftKey ? -1 : 1);
    else if (e.key === 'Escape') {
      if (!$('shop').hidden) $('shop').hidden = true;
      else if (!$('menu').hidden) $('menu').hidden = true;
      else { ui.tool = { kind: 'inspect' }; buildToolbar(); setInfo(toolHint()); }
    } else if (e.key === ' ') { e.preventDefault(); setSpeed(ui.speed === 0 ? 1 : 0); }
    else if (/^[1-9]$/.test(e.key)) {
      const btn = $('tools').querySelectorAll('.tool')[Number(e.key) - 1];
      if (btn && !btn.disabled) btn.click();
    }
  });

  // ---- ヘッダー・メニュー ----

  function setSpeed(s) {
    ui.speed = s;
    document.querySelectorAll('[data-speed]').forEach(b => b.setAttribute('aria-pressed', Number(b.dataset.speed) === s ? 'true' : 'false'));
  }
  document.querySelectorAll('[data-speed]').forEach(b => b.addEventListener('click', () => setSpeed(Number(b.dataset.speed))));

  $('rotate').addEventListener('click', () => rotate(1));
  $('open-shop').addEventListener('click', openShop);
  $('shop-close').addEventListener('click', () => { $('shop').hidden = true; });
  $('shop').addEventListener('click', e => { if (e.target === $('shop')) $('shop').hidden = true; });
  $('open-menu').addEventListener('click', () => { $('menu').hidden = false; });
  $('menu-close').addEventListener('click', () => { $('menu').hidden = true; });
  $('menu').addEventListener('click', e => { if (e.target === $('menu')) $('menu').hidden = true; });

  // 取り消せない操作は2回押しで確定
  function twoStep(btn, label, confirmLabel, action) {
    let armed = false, timer = 0;
    btn.addEventListener('click', () => {
      if (!armed) {
        armed = true; btn.textContent = confirmLabel; btn.classList.add('armed');
        timer = setTimeout(() => { armed = false; btn.textContent = label; btn.classList.remove('armed'); }, 3000);
        return;
      }
      clearTimeout(timer); armed = false; btn.textContent = label; btn.classList.remove('armed');
      action();
    });
  }
  twoStep($('reset-objects'), '画面上のオブジェクトをすべてリセット', 'もう一度押すとリセット', () => {
    const n = world.resetAllObjects();
    toast(`オブジェクトを${n}個リセットしました`);
    $('menu').hidden = true;
  });
  if (C.testMode) {
    $('test-tonic').hidden = false;
    $('test-tonic').addEventListener('click', () => {
      world.tonic += C.testTonic;
      refreshHud();
      toast(`テスト用：ローズ・トニックを${C.testTonic}追加しました`);
    });
  }
  twoStep($('new-game'), '最初からやり直す', 'もう一度押すと最初から', () => {
    world.reset();
    invChanged();
    save();
    toast('最初からやり直しました');
    $('menu').hidden = true;
  });

  // ---- ループ ----

  function fit() {
    const wrap = $('stage');
    const r = wrap.getBoundingClientRect();
    canvas.style.width = r.width + 'px';
    canvas.style.height = r.height + 'px';
    renderer.resize(r.width, r.height);
  }
  new ResizeObserver(fit).observe($('stage'));

  let last = performance.now(), acc = 0, saveTimer = 0, lastTonic = -1;
  function frame(now) {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    acc += dt * ui.speed;
    while (acc >= C.simStep) { world.update(C.simStep); acc -= C.simStep; }
    renderer.draw(ui);
    if (world.tonic !== lastTonic) {
      lastTonic = world.tonic;
      refreshHud();
      if (!$('shop').hidden) buildShop();
    }
    saveTimer += dt;
    if (saveTimer > 5) { saveTimer = 0; save(); }
    requestAnimationFrame(frame);
  }

  world.on(type => { if (type === 'pay') refreshHud(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  window.addEventListener('pagehide', save);

  function start(hotData) {
    const data = (hotData && hotData.save) || loadSaved();
    if (data) world.load(data);
    if (hotData && hotData.ui) { ui.dir = hotData.ui.dir; ui.mirror = hotData.ui.mirror || 0; setSpeed(hotData.ui.speed); }
    fit();
    buildToolbar();
    refreshHud();
    setInfo(data ? toolHint() : '左にいる<b>ガラクタ姫</b>から設備一式を預かった。下の設備を選んで、ゴミコンテナ → 練り機 → レジャーシートとつなげてみよう。ロボットたちは中央の客寄せ看板に集まってくる。');
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { renderer.buildBackground(); buildToolbar(); });
    requestAnimationFrame(t => { last = t; frame(t); });
  }

  GA.debug = { world, renderer, ui }; // 開発用（コンソールから状態を覗く）

  window.claude?.hot?.snapshot?.(() => ({ save: world.serialize(), ui: { dir: ui.dir, mirror: ui.mirror, speed: ui.speed } }));
  window.claude?.hot?.ready ? window.claude.hot.ready(start) : start(window.claude?.hot?.data ?? {});
})();
