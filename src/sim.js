// シミュレーション本体。DOM や描画には触れない。
(function () {
  const GA = window.GA;
  const C = GA.CONFIG;
  const DIRS = GA.DIRS;

  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));

  class World {
    constructor() {
      this.listeners = [];
      this.reset();
    }

    on(fn) { this.listeners.push(fn); }
    emit(type, data) { for (const fn of this.listeners) fn(type, data); }

    reset() {
      this.w = C.gridW;
      this.h = C.gridH;
      this.cells = Array.from({ length: this.w * this.h }, () => ({ equip: null, obj: null }));
      this.tonic = C.startTonic;
      this.inv = { ...C.starterKit };
      this.customers = [];
      this.effects = [];
      this.nextId = 1;
      this.time = 0;
      this.spawnTimer = 1.5;
      this.stats = { served: 0, hungry: 0, earned: 0 };
      const s = this.centerPos();
      this.cell(s.x, s.y).equip = this.makeEquip('kyakuyose_kanban', 2);
    }

    centerPos() { return { x: Math.floor(this.w / 2), y: Math.floor(this.h / 2) }; }
    inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
    cell(x, y) { return this.inBounds(x, y) ? this.cells[y * this.w + x] : null; }
    forEachCell(fn) {
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) fn(this.cells[y * this.w + x], x, y);
    }

    makeEquip(type, dir) { return { type, dir, timer: 0 }; }

    // オブジェクトを載せられない設備（生成所・インテリア）
    holdsNoObjects(type) {
      const kind = GA.EQUIPMENT[type].kind;
      return kind === 'generator' || kind === 'interior';
    }

    countPlaced(type) {
      let n = 0;
      this.forEachCell(c => { if (c.equip && c.equip.type === type) n++; });
      return n;
    }

    // 指定した効果を持つインテリアの位置
    interiorsWith(effect) {
      const res = [];
      this.forEachCell((c, x, y) => {
        if (c.equip && GA.EQUIPMENT[c.equip.type].effect === effect) res.push({ x, y });
      });
      return res;
    }
    makeObj(type, x, y) {
      return { id: this.nextId++, type, x, y, fx: x, fy: y, t: 1, dur: 0, work: 0, done: false, claimedBy: 0 };
    }

    // ---- 受け入れ判定・移動 ----

    canAccept(x, y) {
      const c = this.cell(x, y);
      if (!c || c.obj) return false;
      if (!c.equip) return true; // 何も無い地面にはそのまま置かれる
      return !this.holdsNoObjects(c.equip.type);
    }

    moveObj(obj, tx, ty, dur) {
      this.cell(obj.x, obj.y).obj = null;
      obj.fx = obj.x; obj.fy = obj.y;
      obj.x = tx; obj.y = ty;
      obj.t = 0; obj.dur = dur;
      obj.work = 0; obj.done = false;
      this.cell(tx, ty).obj = obj;
    }

    tryPush(x, y, dir, dur) {
      const c = this.cell(x, y);
      const d = DIRS[dir];
      const tx = x + d.x, ty = y + d.y;
      if (!this.canAccept(tx, ty)) return false;
      this.moveObj(c.obj, tx, ty, dur);
      return true;
    }

    // ---- プレイヤー操作 ----

    place(type, x, y, dir) {
      const c = this.cell(x, y);
      if (!c) return { ok: false };
      const def = GA.EQUIPMENT[type];
      if (c.equip && c.equip.type === type) {
        // 同じ設備でタップしたら回転（在庫が無くてもよい）
        if (!def.directional) return { ok: false };
        c.equip.dir = dir === c.equip.dir ? (dir + 1) % 4 : dir;
        return { ok: true, rotated: true };
      }
      if ((this.inv[type] || 0) <= 0) return { ok: false, msg: `${def.name}の在庫がありません` };
      if (def.maxPlaced && this.countPlaced(type) >= def.maxPlaced) {
        return { ok: false, msg: `${def.name}は${def.maxPlaced}つまでしか置けません` };
      }
      if (this.holdsNoObjects(type) && c.obj) return { ok: false, msg: 'オブジェクトがあるマスには置けません' };
      if (c.equip) this.recall(x, y);
      c.equip = this.makeEquip(type, dir);
      this.inv[type]--;
      if (c.obj) { c.obj.work = 0; c.obj.done = false; }
      return { ok: true };
    }

    setDir(x, y, dir) {
      const c = this.cell(x, y);
      if (c && c.equip && GA.EQUIPMENT[c.equip.type].directional) c.equip.dir = dir;
    }

    rotateAt(x, y) {
      const c = this.cell(x, y);
      if (!c || !c.equip || !GA.EQUIPMENT[c.equip.type].directional) return false;
      c.equip.dir = (c.equip.dir + 1) % 4;
      return true;
    }

    recall(x, y) {
      const c = this.cell(x, y);
      if (!c || !c.equip) return { ok: false };
      const def = GA.EQUIPMENT[c.equip.type];
      this.inv[c.equip.type] = (this.inv[c.equip.type] || 0) + 1;
      c.equip = null;
      if (c.obj) { c.obj.work = 0; c.obj.done = false; } // 中身は地面に残る
      return { ok: true, type: def.name };
    }

    removeObjAt(x, y) {
      const c = this.cell(x, y);
      if (!c || !c.obj) return false;
      c.obj = null;
      return true;
    }

    resetAllObjects() {
      let n = 0;
      this.forEachCell(c => { if (c.obj) { c.obj = null; n++; } });
      return n;
    }

    sellPrice(type) { return Math.floor(GA.EQUIPMENT[type].price * C.sellRate); }

    // 設置上限のある設備は、所持数（設置済み＋在庫）が上限に達したら買えない
    atOwnLimit(type) {
      const def = GA.EQUIPMENT[type];
      return !!def.maxPlaced && this.countPlaced(type) + (this.inv[type] || 0) >= def.maxPlaced;
    }

    buy(type) {
      const def = GA.EQUIPMENT[type];
      if (!def || def.notForSale) return false;
      if (this.tonic < def.price || this.atOwnLimit(type)) return false;
      this.tonic -= def.price;
      this.inv[type] = (this.inv[type] || 0) + 1;
      return true;
    }

    sell(type) {
      if ((this.inv[type] || 0) <= 0) return false;
      this.inv[type]--;
      this.tonic += this.sellPrice(type);
      return true;
    }

    // ---- 更新 ----

    update(dt) {
      this.time += dt;

      // オブジェクトの移動アニメーション
      this.forEachCell(c => {
        const o = c.obj;
        if (o && o.t < 1) o.t = o.dur > 0 ? Math.min(1, o.t + dt / o.dur) : 1;
      });

      // 設備の処理（固定順）
      this.forEachCell((c, x, y) => {
        if (!c.equip) return;
        const e = c.equip;
        const def = GA.EQUIPMENT[e.type];
        const o = c.obj;
        const arrived = o && o.t >= 1;
        switch (def.kind) {
          case 'generator': {
            e.timer = Math.min(def.interval, e.timer + dt);
            if (e.timer >= def.interval) {
              const d = DIRS[e.dir];
              const tx = x + d.x, ty = y + d.y;
              if (this.canAccept(tx, ty)) {
                const obj = this.makeObj(def.produces, tx, ty);
                obj.fx = x; obj.fy = y; obj.t = 0; obj.dur = 0.4;
                this.cell(tx, ty).obj = obj;
                e.timer = 0;
              }
            }
            break;
          }
          case 'conveyor':
            if (arrived) this.tryPush(x, y, e.dir, def.moveTime);
            break;
          case 'processor':
            if (!arrived) break;
            if (!o.done) {
              o.work += dt;
              if (o.work >= def.workTime) {
                const recipes = GA.PROCESSES[def.process].recipes;
                o.type = recipes[o.type] || GA.FALLBACK_OBJECT;
                o.done = true;
              }
            } else {
              this.tryPush(x, y, e.dir, def.outTime);
            }
            break;
          case 'disposal':
            if (!arrived) break;
            o.work += dt;
            if (o.work >= def.workTime) c.obj = null;
            break;
        }
      });

      this.updateCustomers(dt);

      for (const fx of this.effects) fx.t += dt;
      this.effects = this.effects.filter(fx => fx.t < fx.life);
    }

    // ---- 客ロボット ----

    availableDishes() {
      const res = [];
      this.forEachCell((c, x, y) => {
        if (!c.equip || !c.obj) return;
        if (!GA.EQUIPMENT[c.equip.type].table) return;
        const o = c.obj;
        if (o.t < 1 || o.claimedBy) return;
        if (GA.OBJECTS[o.type].category !== 'dish') return;
        res.push({ x, y, obj: o });
      });
      return res;
    }

    // 待っている客を、立ち止まった位置から近いシートへ割り当てる。
    // 取り合いになったら、そのシートにより近い客が勝つ（距離の短い組から順に確定）
    assignDishes() {
      const waiting = this.customers.filter(cu => cu.state === 'browse');
      if (!waiting.length) return;
      const dishes = this.availableDishes();
      if (!dishes.length) return;
      const pairs = [];
      for (const cu of waiting) for (const d of dishes) {
        pairs.push({ cu, d, dist: Math.hypot(d.x + 0.5 - cu.x, d.y + 0.5 - cu.y) });
      }
      pairs.sort((a, b) => a.dist - b.dist);
      for (const { cu, d } of pairs) {
        if (cu.state !== 'browse' || d.obj.claimedBy) continue;
        d.obj.claimedBy = cu.id;
        cu.target = { x: d.x, y: d.y, objId: d.obj.id };
        cu.tx = d.x + 0.5; cu.ty = d.y + 0.85;
        cu.state = 'toTable';
      }
    }

    // 外周上の出現位置。客寄せ看板があればその看板に近い辺・近い場所から出やすい
    spawnPoint(sign) {
      const B = C.border;
      const clampX = v => Math.max(-B, Math.min(this.w + B, v));
      const clampY = v => Math.max(-B, Math.min(this.h + B, v));
      let side;
      if (sign) {
        const sx = sign.x + 0.5, sy = sign.y + 0.5;
        const dist = [sy + B, this.w + B - sx, this.h + B - sy, sx + B]; // 上・右・下・左の辺までの距離
        const weights = dist.map(d => 1 / (d * d));
        let r = Math.random() * weights.reduce((a, b) => a + b, 0);
        side = 0;
        while (side < 3 && r > weights[side]) { r -= weights[side]; side++; }
        const along = (side === 0 || side === 2) ? clampX(sx + rand(-3, 3)) : clampY(sy + rand(-3, 3));
        if (side === 0) return { x: along, y: -B };
        if (side === 1) return { x: this.w + B, y: along };
        if (side === 2) return { x: along, y: this.h + B };
        return { x: -B, y: along };
      }
      side = randInt(0, 3);
      if (side === 0) return { x: rand(-B, this.w + B), y: -B };
      if (side === 1) return { x: this.w + B, y: rand(-B, this.h + B) };
      if (side === 2) return { x: rand(-B, this.w + B), y: this.h + B };
      return { x: -B, y: rand(-B, this.h + B) };
    }

    spawnCustomer(signs) {
      const sign = signs.length ? signs[randInt(0, signs.length - 1)] : null;
      const p = this.spawnPoint(sign);
      let tx, ty;
      if (sign) {
        // 看板の周りに集まる
        const ang = rand(0, Math.PI * 2);
        const r = rand(0.9, 1.6);
        tx = sign.x + 0.5 + Math.cos(ang) * r;
        ty = sign.y + 0.5 + Math.sin(ang) * r;
      } else {
        // 看板が無いと集まらず、盤面のどこかで立ち止まる
        tx = rand(0.3, this.w - 0.3);
        ty = rand(0.3, this.h - 0.3);
      }
      this.customers.push({
        id: this.nextId++, x: p.x, y: p.y, tx, ty,
        homeX: p.x, homeY: p.y,
        state: 'enter', wait: 0, target: null,
        hue: randInt(0, 359), bob: rand(0, 6),
      });
    }

    walk(cu, dt) {
      const dx = cu.tx - cu.x, dy = cu.ty - cu.y;
      const dist = Math.hypot(dx, dy);
      const step = C.customer.walkSpeed * dt;
      if (dist <= step) { cu.x = cu.tx; cu.y = cu.ty; return true; }
      cu.x += dx / dist * step; cu.y += dy / dist * step;
      return false;
    }

    targetStillValid(cu) {
      const t = cu.target;
      const c = this.cell(t.x, t.y);
      return c && c.obj && c.obj.id === t.objId && c.equip && GA.EQUIPMENT[c.equip.type].table;
    }

    leave(cu, hungry) {
      cu.state = 'leave';
      cu.tx = cu.homeX; cu.ty = cu.homeY;
      cu.hungry = hungry;
      if (hungry) this.stats.hungry++;
    }

    updateCustomers(dt) {
      const CC = C.customer;
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        // 客寄せ看板の数だけ来店ペースと同時上限が倍になる（0枚でも1枚分は来る）
        const signs = this.interiorsWith('attract');
        const mult = Math.max(1, signs.length);
        this.spawnTimer = rand(CC.spawnInterval[0], CC.spawnInterval[1]) / mult;
        const n = randInt(CC.groupSize[0], CC.groupSize[1]);
        for (let i = 0; i < n && this.customers.length < CC.maxActive * mult; i++) this.spawnCustomer(signs);
      }
      this.assignDishes();

      for (const cu of this.customers) {
        cu.bob += dt;
        switch (cu.state) {
          case 'enter':
            if (this.walk(cu, dt)) { cu.state = 'browse'; cu.wait = 0; }
            break;
          case 'browse': {
            cu.wait += dt;
            if (cu.wait >= CC.patience) this.leave(cu, true);
            break;
          }
          case 'toTable':
            if (!this.targetStillValid(cu)) { cu.state = 'browse'; cu.target = null; break; }
            if (this.walk(cu, dt)) { cu.state = 'eat'; cu.wait = 0; }
            break;
          case 'eat': {
            if (!this.targetStillValid(cu)) { cu.state = 'browse'; cu.target = null; break; }
            cu.wait += dt;
            if (cu.wait >= CC.eatTime) {
              const c = this.cell(cu.target.x, cu.target.y);
              const odef = GA.OBJECTS[c.obj.type];
              const pay = GA.RARITIES[odef.rarity].tonic;
              c.obj = null;
              this.tonic += pay;
              this.stats.served++;
              this.stats.earned += pay;
              this.effects.push({ x: cu.target.x + 0.5, y: cu.target.y + 0.3, text: `+${pay}`, t: 0, life: 1.4 });
              this.emit('pay', { amount: pay, dish: odef.name });
              this.leave(cu, false);
            }
            break;
          }
          case 'leave':
            if (this.walk(cu, dt)) cu.gone = true;
            break;
        }
      }
      this.customers = this.customers.filter(c => !c.gone);
      // 席に向かっていない客の予約は外す（料理が移動・リセットされた場合など）
      const claims = new Set(this.customers.filter(c => c.target && (c.state === 'toTable' || c.state === 'eat')).map(c => c.id));
      this.forEachCell(c => { if (c.obj && c.obj.claimedBy && !claims.has(c.obj.claimedBy)) c.obj.claimedBy = 0; });
    }

    // ---- 保存 ----

    serialize() {
      const cells = [], objects = [];
      this.forEachCell((c, x, y) => {
        if (c.equip) cells.push({ x, y, type: c.equip.type, dir: c.equip.dir });
        if (c.obj) objects.push({ x, y, type: c.obj.type, done: c.obj.done });
      });
      return { v: 1, tonic: this.tonic, inv: { ...this.inv }, cells, objects, stats: { ...this.stats } };
    }

    load(data) {
      if (!data || data.v !== 1) return false;
      this.reset();
      this.cells.forEach(c => { c.equip = null; c.obj = null; });
      this.tonic = data.tonic;
      this.inv = { ...data.inv };
      this.stats = { ...this.stats, ...data.stats };
      for (const e of data.cells) {
        const type = GA.LEGACY_TYPES[e.type] || e.type;
        if (GA.EQUIPMENT[type] && this.inBounds(e.x, e.y)) this.cell(e.x, e.y).equip = this.makeEquip(type, e.dir);
      }
      for (const o of data.objects) {
        if (GA.OBJECTS[o.type] && this.inBounds(o.x, o.y)) {
          const obj = this.makeObj(o.type, o.x, o.y);
          obj.done = !!o.done;
          this.cell(o.x, o.y).obj = obj;
        }
      }
      return true;
    }
  }

  GA.World = World;
})();
