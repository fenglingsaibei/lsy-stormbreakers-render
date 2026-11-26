// 客户端与服务端共用的游戏规则 / Shared rules used by client and server
export type Mode = 'free' | 'storm' | 'treasure';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface Command {
  thrust: number;   // -1..1
  turn: number;     // -1..1
  fireL: boolean;
  fireR: boolean;
  dash: boolean;
  repair: boolean;
  supply: boolean;
  brake?: boolean;   // 触屏松手后的短时制动
}

export const emptyCommand = (): Command => ({ thrust: 0, turn: 0, fireL: false, fireR: false, dash: false, repair: false, supply: false, brake: false });

export interface Ship {
  id: string;
  name: string;
  x: number; z: number; h: number; speed: number;
  hp: number; score: number; kills: number;
  alive: boolean; respawnAt: number;
  reloadL: number; reloadR: number;
  dashCd: number; dashTime: number;
  repairCd: number; supplyCd: number;
  ammoL: number; ammoR: number;
  isBot: boolean; color: number;
  lastHitBy?: string;
}

export interface Ball { id: number; owner: string; x: number; z: number; vx: number; vz: number; born: number; life: number; damage: number }
export interface Chest { id: number; x: number; z: number; alive: boolean; respawnAt: number }
export interface GameEvent { type: 'fire' | 'hit' | 'sink' | 'pickup' | 'dash' | 'repair' | 'supply' | 'respawn' | 'end'; x: number; z: number; owner?: string; side?: 'L' | 'R'; color?: number; text?: string }
export interface World {
  t: number; duration: number; mode: Mode;
  ships: Ship[]; balls: Ball[]; chests: Chest[];
  events: GameEvent[];
  safeR: number; ended: boolean; winnerId?: string;
  seq: number;
}

export const RULES = {
  arenaR: 155,
  shipR: 4.4,
  maxSpeed: 19,
  accel: 13,
  friction: 5.5,
  turnRate: 1.15,
  maxHp: 100,
  reload: 3,
  maxAmmo: 12,
  ballSpeed: 72,
  ballLife: 2.1,
  ballDamage: 17,
  dashCd: 10,
  dashTime: 1.1,
  dashSpeed: 32,
  repairCd: 12,
  repairAmount: 42,
  supplyCd: 14,
  respawnDelay: 5,
  killScore: 100,
  chestScore: 35,
  chestRespawn: 12,
  botCount: 3
};

export function rand(seed: number) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function spawnPoint(seed: number, radius = 105): { x: number; z: number } {
  const a = rand(seed) * Math.PI * 2;
  const r = 45 + rand(seed + 9) * radius;
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}

export function createShip(id: string, name: string, isBot: boolean, color: number, seed: number): Ship {
  const p = spawnPoint(seed);
  return {
    id, name, isBot, color,
    x: p.x, z: p.z, h: rand(seed + 3) * Math.PI * 2,
    speed: 0, hp: RULES.maxHp, score: 0, kills: 0,
    alive: true, respawnAt: 0,
    reloadL: 0, reloadR: 0, dashCd: 0, dashTime: 0,
    repairCd: 0, supplyCd: 0, ammoL: RULES.maxAmmo, ammoR: RULES.maxAmmo
  };
}

export function createWorld(mode: Mode, duration: number, ships: Ship[]): World {
  const chestCount = mode === 'treasure' ? 9 : 3;
  const chests: Chest[] = [];
  for (let i = 0; i < chestCount; i++) {
    const p = spawnPoint(i * 13 + 77, 110);
    chests.push({ id: i, x: p.x, z: p.z, alive: true, respawnAt: 0 });
  }
  return { t: 0, duration, mode, ships, balls: [], chests, events: [], safeR: 130, ended: false, seq: 1 };
}

function fire(world: World, s: Ship, side: 'L' | 'R') {
  const key = side === 'L' ? 'reloadL' : 'reloadR';
  const ammo = side === 'L' ? 'ammoL' : 'ammoR';
  if (!s.alive || s[key] > 0 || s[ammo] <= 0) return;
  const sign = side === 'L' ? -1 : 1;
  const base = s.h + sign * Math.PI / 2;
  for (let i = -1; i <= 1; i++) {
    const a = base + i * 0.075;
    world.balls.push({
      id: world.seq++, owner: s.id,
      // 侧舷炮口：右向量为 (cos h, -sin h)，左舷取反
      x: s.x + Math.cos(s.h) * sign * 4.5, z: s.z - Math.sin(s.h) * sign * 4.5,
      vx: Math.sin(a) * RULES.ballSpeed, vz: Math.cos(a) * RULES.ballSpeed,
      born: world.t, life: RULES.ballLife, damage: RULES.ballDamage
    });
  }
  s[ammo]--;
  s[key] = RULES.reload;
  world.events.push({ type: 'fire', x: s.x, z: s.z, owner: s.id, side, color: s.color });
}

function moveShip(s: Ship, cmd: Command, dt: number, safeR: number, mode: Mode) {
  if (!s.alive) return;
  s.reloadL = Math.max(0, s.reloadL - dt);
  s.reloadR = Math.max(0, s.reloadR - dt);
  s.dashCd = Math.max(0, s.dashCd - dt);
  s.repairCd = Math.max(0, s.repairCd - dt);
  s.supplyCd = Math.max(0, s.supplyCd - dt);
  s.dashTime = Math.max(0, s.dashTime - dt);

  if (cmd.dash && s.dashCd <= 0) {
    s.dashCd = RULES.dashCd;
    s.dashTime = RULES.dashTime;
    s.speed = Math.max(s.speed, RULES.dashSpeed);
  }
  if (cmd.repair && s.repairCd <= 0 && s.hp < RULES.maxHp) {
    s.repairCd = RULES.repairCd;
    s.hp = Math.min(RULES.maxHp, s.hp + RULES.repairAmount);
  }
  if (cmd.supply && s.supplyCd <= 0) {
    s.supplyCd = RULES.supplyCd;
    s.ammoL = RULES.maxAmmo;
    s.ammoR = RULES.maxAmmo;
  }

  const steer = Math.max(-1, Math.min(1, cmd.turn));
  const speedFactor = 0.45 + 0.55 * Math.min(1, Math.abs(s.speed) / 8);
  s.h += steer * RULES.turnRate * speedFactor * dt * (s.speed < -0.5 ? -1 : 1);

  if (cmd.thrust > 0) s.speed += RULES.accel * cmd.thrust * dt;
  else if (cmd.thrust < 0) s.speed += RULES.accel * 0.6 * cmd.thrust * dt;
  else {
    const drag = RULES.friction * dt;
    s.speed = Math.abs(s.speed) <= drag ? 0 : s.speed - Math.sign(s.speed) * drag;
  }
  const cap = s.dashTime > 0 ? RULES.dashSpeed : RULES.maxSpeed;
  s.speed = Math.max(-7, Math.min(cap, s.speed));
  if (cmd.brake && cmd.thrust === 0) s.speed *= Math.exp(-14 * dt);

  s.x += Math.sin(s.h) * s.speed * dt;
  s.z += Math.cos(s.h) * s.speed * dt;

  const limit = Math.min(RULES.arenaR - 5, safeR - 3);
  const d = Math.hypot(s.x, s.z);
  if (d > limit) {
    s.x = s.x / d * limit;
    s.z = s.z / d * limit;
    s.speed *= 0.45;
  }
  if (mode === 'storm' && d > safeR - 8) {
    s.hp -= 7 * dt;
  }
}

// 联机客户端本地预测使用同一套移动规则
export function predictShip(s: Ship, cmd: Command, dt: number, safeR: number, mode: Mode) {
  moveShip(s, cmd, dt, safeR, mode);
}

export function stepWorld(world: World, dt: number, commands: Record<string, Command>) {
  if (world.ended) return;
  dt = Math.min(dt, 0.05);
  world.t += dt;
  if (world.mode === 'storm') world.safeR = Math.max(42, 130 - world.t * 0.55);

  for (const s of world.ships) {
    const cmd = commands[s.id] || emptyCommand();
    moveShip(s, cmd, dt, world.safeR, world.mode);
  }

  // 船体碰撞：推开，不瞬移
  for (let i = 0; i < world.ships.length; i++) {
    const a = world.ships[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < world.ships.length; j++) {
      const b = world.ships[j];
      if (!b.alive) continue;
      const dx = b.x - a.x, dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      const min = RULES.shipR * 2.1;
      if (d < min && d > 0.001) {
        const push = (min - d) / 2;
        a.x -= dx / d * push; a.z -= dz / d * push;
        b.x += dx / d * push; b.z += dz / d * push;
        a.speed *= 0.75; b.speed *= 0.75;
      }
    }
  }

  for (const s of world.ships) {
    const cmd = commands[s.id] || emptyCommand();
    if (cmd.fireL) fire(world, s, 'L');
    if (cmd.fireR) fire(world, s, 'R');
  }

  const balls: Ball[] = [];
  for (const b of world.balls) {
    b.x += b.vx * dt; b.z += b.vz * dt;
    if (world.t - b.born > b.life || Math.hypot(b.x, b.z) > RULES.arenaR + 12) continue;
    let hit = false;
    for (const s of world.ships) {
      if (!s.alive || s.id === b.owner) continue;
      if (Math.hypot(s.x - b.x, s.z - b.z) < RULES.shipR + 1.2) {
        s.hp -= b.damage;
        s.lastHitBy = b.owner;
        world.events.push({ type: 'hit', x: b.x, z: b.z, owner: s.id, color: s.color });
        if (s.hp <= 0) {
          s.hp = 0; s.alive = false; s.speed = 0; s.respawnAt = world.t + RULES.respawnDelay;
          const killer = world.ships.find(k => k.id === b.owner);
          if (killer) { killer.score += RULES.killScore; killer.kills++; }
          world.events.push({ type: 'sink', x: s.x, z: s.z, owner: s.id, color: s.color, text: killer ? killer.name : '' });
        }
        hit = true;
        break;
      }
    }
    if (!hit) balls.push(b);
  }
  world.balls = balls;

  for (const c of world.chests) {
    if (!c.alive && world.t >= c.respawnAt) {
      const p = spawnPoint(c.id * 31 + Math.floor(world.t / 30) * 7 + 5, 110);
      c.x = p.x; c.z = p.z; c.alive = true;
    }
    if (!c.alive) continue;
    for (const s of world.ships) {
      if (!s.alive) continue;
      if (Math.hypot(s.x - c.x, s.z - c.z) < RULES.shipR + 1.5) {
        c.alive = false; c.respawnAt = world.t + RULES.chestRespawn;
        s.score += RULES.chestScore;
        world.events.push({ type: 'pickup', x: c.x, z: c.z, owner: s.id, color: s.color });
        break;
      }
    }
  }

  for (const s of world.ships) {
    if (!s.alive && world.t >= s.respawnAt) {
      const p = spawnPoint(Math.floor(world.t * 17 + s.name.length * 3), 100);
      s.x = p.x; s.z = p.z; s.h = rand(world.t + s.x) * Math.PI * 2;
      s.speed = 0; s.hp = RULES.maxHp; s.alive = true;
      s.ammoL = RULES.maxAmmo; s.ammoR = RULES.maxAmmo;
      s.reloadL = 0; s.reloadR = 0;
      world.events.push({ type: 'respawn', x: s.x, z: s.z, owner: s.id });
    }
  }

  if (world.t >= world.duration) {
    world.ended = true;
    const best = [...world.ships].sort((a, b) => b.score - a.score)[0];
    world.winnerId = best ? best.id : undefined;
    world.events.push({ type: 'end', x: 0, z: 0 });
  }
}

// 无需大模型的规则型电脑对手
export function botCommand(world: World, id: string, difficulty: Difficulty): Command {
  const cmd = emptyCommand();
  const me = world.ships.find(s => s.id === id);
  if (!me || !me.alive) return cmd;
  const enemies = world.ships.filter(s => s.id !== id && s.alive);
  let target = enemies[0];
  let bestD = Infinity;
  for (const e of enemies) {
    const d = Math.hypot(e.x - me.x, e.z - me.z);
    if (d < bestD) { bestD = d; target = e; }
  }
  let tx = 0, tz = 0;
  const distCenter = Math.hypot(me.x, me.z);
  const boundary = distCenter > RULES.arenaR - 32;
  const stormOutside = world.mode === 'storm' && distCenter > world.safeR - 24;
  if (boundary || stormOutside) { tx = -me.x; tz = -me.z; }
  else if (target && bestD < 75) {
    // 侧舷战：与目标保持约 40 距离，船身横对目标
    const toT = Math.atan2(target.x - me.x, target.z - me.z);
    const desired = toT + (me.score % 2 === 0 ? -Math.PI / 2 : Math.PI / 2);
    tx = me.x + Math.sin(desired) * 30;
    tz = me.z + Math.cos(desired) * 30;
    if (bestD < 26) { tx = me.x - Math.sin(toT) * 25; tz = me.z - Math.cos(toT) * 25; }
  } else {
    const chest = world.chests.filter(c => c.alive).sort((a, b) =>
      Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z))[0];
    if (chest && Math.hypot(chest.x - me.x, chest.z - me.z) < 85) { tx = chest.x; tz = chest.z; }
    else if (target) { tx = target.x; tz = target.z; }
  }
  const want = Math.atan2(tx - me.x, tz - me.z);
  let diff = Math.atan2(Math.sin(want - me.h), Math.cos(want - me.h));
  const skill = difficulty === 'easy' ? 0.55 : difficulty === 'hard' ? 1 : 0.8;
  cmd.turn = Math.max(-1, Math.min(1, diff * 1.8 * skill));
  const targetDist = Math.hypot(tx - me.x, tz - me.z);
  cmd.thrust = targetDist > 12 ? 1 : 0;
  if (difficulty === 'easy' && Math.sin(world.t * 1.7 + me.x) > 0.9) cmd.thrust = 0;

  if (target) {
    const bearing = Math.atan2(target.x - me.x, target.z - me.z);
    const rel = Math.atan2(Math.sin(bearing - me.h), Math.cos(bearing - me.h));
    const tolerance = difficulty === 'hard' ? 0.32 : difficulty === 'easy' ? 0.55 : 0.42;
    if (bestD < 78) {
      const sideRel = Math.abs(Math.abs(rel) - Math.PI / 2);
      if (sideRel < tolerance) {
        cmd.fireR = rel > 0 && me.reloadR <= 0 && me.ammoR > 0;
        cmd.fireL = rel < 0 && me.reloadL <= 0 && me.ammoL > 0;
      }
    }
  }
  if (me.hp < 48 && me.repairCd <= 0) cmd.repair = true;
  if ((me.ammoL === 0 || me.ammoR === 0) && me.supplyCd <= 0) cmd.supply = true;
  if (difficulty !== 'easy' && target && bestD > 55 && bestD < 100 && me.dashCd <= 0 && Math.sin(world.t * 0.7 + me.z) > 0.97) cmd.dash = true;
  return cmd;
}

export function publicShip(s: Ship) {
  return { ...s };
}
