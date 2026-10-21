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
      const s = this.signPos();
      this.cell(s.x, s.y).equip = this.makeEquip('sign', 2);
    }

    signPos() { return { x: Math.floor(this.w / 2), y: Math.floor(this.h / 2) }; }
    inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
    cell(x, y) { return this.inBounds(x, y) ? this.cells[y * this.w + x] : null; }
    forEachCell(fn) {
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) fn(this.cells[y * this.w + x], x, y);
    }

    makeEquip(type, dir) { return { type, dir, timer: 0 }; }
    makeObj(type, x, y) {
      return { id: this.nextId++, type, x, y, fx: x, fy: y, t: 1, dur: 0, work: 0, done: false, claimedBy: 0 };
    }

    // ---- 受け入れ判定・移動 ----

    canAccept(x, y) {
      const c = this.cell(x, y);
      if (!c || c.obj) return false;
      if (!c.equip) return true; // 何も無い地面にはそのまま置かれる
      const kind = GA.EQUIPMENT[c.equip.type].kind;
      return kind !== 'generator' && kind !== 'sign';
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
      if ((this.inv[type] || 0) <= 0) return { ok: false, msg: `${GA.EQUIPMENT[type].name}の在庫がありません` };
      const kind = GA.EQUIPMENT[type].kind;
      if (c.equip) {
        const cur = GA.EQUIPMENT[c.equip.type];
        if (cur.fixed) return { ok: false, msg: `${cur.name}は動かせません` };
        if (c.equip.type === type) {
          c.equip.dir = dir === c.equip.dir ? (dir + 1) % 4 : dir;
          return { ok: true, rotated: true };
        }
        if ((kind === 'generator') && c.obj) return { ok: false, msg: 'オブジェクトがあるマスには置けません' };
        this.recall(x, y);
      } else if (kind === 'generator' && c.obj) {
        return { ok: false, msg: 'オブジェクトがあるマスには置けません' };
      }
      c.equip = this.makeEquip(type, dir);
      this.inv[type]--;
      if (c.obj) { c.obj.work = 0; c.obj.done = false; }
      return { ok: true };
    }

    setDir(x, y, dir) {
      const c = this.cell(x, y);
      if (c && c.equip && !GA.EQUIPMENT[c.equip.type].fixed) c.equip.dir = dir;
    }

    recall(x, y) {
      const c = this.cell(x, y);
      if (!c || !c.equip) return { ok: false };
      const def = GA.EQUIPMENT[c.equip.type];
      if (def.fixed) return { ok: false, msg: `${def.name}は動かせません` };
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

    buy(type) {
      const def = GA.EQUIPMENT[type];
      if (!def || def.notForSale) return false;
      if (this.tonic < def.price) return false;
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

    findDish() {
      let found = null;
      this.forEachCell((c, x, y) => {
        if (found || !c.equip || !c.obj) return;
        if (!GA.EQUIPMENT[c.equip.type].table) return;
        const o = c.obj;
        if (o.t < 1 || o.claimedBy) return;
        if (GA.OBJECTS[o.type].category !== 'dish') return;
        found = { x, y, obj: o };
      });
      return found;
    }

    spawnCustomer() {
      const B = C.border;
      const side = randInt(0, 3);
      let x, y;
      if (side === 0) { x = rand(-B, this.w + B); y = -B; }
      else if (side === 1) { x = this.w + B; y = rand(-B, this.h + B); }
      else if (side === 2) { x = rand(-B, this.w + B); y = this.h + B; }
      else { x = -B; y = rand(-B, this.h + B); }
      const s = this.signPos();
      const ang = rand(0, Math.PI * 2);
      const r = rand(0.9, 1.6);
      this.customers.push({
        id: this.nextId++, x, y,
        tx: s.x + 0.5 + Math.cos(ang) * r, ty: s.y + 0.5 + Math.sin(ang) * r,
        homeX: x, homeY: y,
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
        this.spawnTimer = rand(CC.spawnInterval[0], CC.spawnInterval[1]);
        const n = randInt(CC.groupSize[0], CC.groupSize[1]);
        for (let i = 0; i < n && this.customers.length < CC.maxActive; i++) this.spawnCustomer();
      }

      for (const cu of this.customers) {
        cu.bob += dt;
        switch (cu.state) {
          case 'enter':
            if (this.walk(cu, dt)) { cu.state = 'browse'; cu.wait = 0; }
            break;
          case 'browse': {
            const dish = this.findDish();
            if (dish) {
              dish.obj.claimedBy = cu.id;
              cu.target = { x: dish.x, y: dish.y, objId: dish.obj.id };
              cu.tx = dish.x + 0.5; cu.ty = dish.y + 0.85;
              cu.state = 'toTable';
              break;
            }
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
        if (GA.EQUIPMENT[e.type] && this.inBounds(e.x, e.y)) this.cell(e.x, e.y).equip = this.makeEquip(e.type, e.dir);
      }
      for (const o of data.objects) {
        if (GA.OBJECTS[o.type] && this.inBounds(o.x, o.y)) {
          const obj = this.makeObj(o.type, o.x, o.y);
          obj.done = !!o.done;
          this.cell(o.x, o.y).obj = obj;
        }
      }
      const s = this.signPos();
      if (!this.cell(s.x, s.y).equip) this.cell(s.x, s.y).equip = this.makeEquip('sign', 2);
      return true;
    }
  }

  GA.World = World;
})();
