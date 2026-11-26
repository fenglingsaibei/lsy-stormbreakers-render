import { OceanScene, type Quality } from './gfx.ts';
import { GameAudio } from './audio.ts';
import {
  createShip, createWorld, stepWorld, botCommand, predictShip, emptyCommand,
  RULES, type Command, type Mode, type Difficulty, type World, type Ship, type GameEvent
} from './rules.ts';

export type Phase = 'menu' | 'connecting' | 'playing' | 'ended';

export interface Hud {
  phase: Phase;
  hp: number;
  score: number;
  time: number;
  leaderboard: { id: string; name: string; score: number; kills: number; alive: boolean; isMe: boolean; color: number; x: number; z: number }[];
  reloadL: number; reloadR: number;
  dashCd: number; repairCd: number; supplyCd: number;
  ammoL: number; ammoR: number;
  alive: boolean; respawnIn: number;
  mode: Mode; online: boolean; roomCode: string;
  connection: boolean; menuOpen: boolean;
  stormR: number; safeR: number;
  x: number; z: number; heading: number;
  notice: string;
  winnerId?: string;
}

const BOT_NAMES = ['黑帆·雷诺', '海妖·赛琳', '铁钩·巴克', '北风·艾拉', '幽灵·摩根'];
const BOT_COLORS = [0xe76b62, 0x8d7bd6, 0x7ac9a8, 0xd8c36a, 0x6fa8d6];
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class GameEngine {
  gfx!: OceanScene;
  audio = new GameAudio();
  world?: World;
  phase: Phase = 'menu';
  localId = '';
  roomCode = '';
  online = false;
  connected = false;
  paused = false;
  menuOpen = false;
  notice = '';
  mode: Mode = 'free';
  difficulty: Difficulty = 'normal';
  nickname = '船长';
  private ws?: WebSocket;
  private predicted?: Ship;
  private visual = new Map<string, { x: number; z: number; h: number }>();
  private keys = new Set<string>();
  private steerPointer: number | null = null;
  private steerPoint: { x: number; z: number } | null = null;
  private firePointers = new Map<number, 'L' | 'R'>();
  private mobileFire = { L: false, R: false };
  private queued = { dash: false, repair: false, supply: false, fireL: false, fireR: false };
  private brakeUntil = 0;
  private lastTime = 0;
  private animTime = 0;
  private snapTimer = 0;
  private hudTimer = 0;
  private raf = 0;
  private onHud: (h: Hud) => void;
  private pointerHandlers: { down: (e: PointerEvent) => void; move: (e: PointerEvent) => void; up: (e: PointerEvent) => void } | null = null;
  private keyDown = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'q', 'e', 'r', 'f', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      if (this.phase === 'playing') e.preventDefault();
    }
    if (k === 'escape' || k === 'p') { if (!e.repeat) this.onToggleMenu?.(); return; }
    if (this.phase !== 'playing' || this.menuOpen) return;
    if (!e.repeat && k === ' ') this.queued.dash = true;
    if (!e.repeat && k === 'r') this.queued.repair = true;
    if (!e.repeat && k === 'f') this.queued.supply = true;
    // 快速点按也要可靠开炮：按下瞬间入队，下一帧一定消费
    if (!e.repeat && k === 'q') this.queued.fireL = true;
    if (!e.repeat && k === 'e') this.queued.fireR = true;
    this.keys.add(k);
  };
  private keyUp = (e: KeyboardEvent) => { this.keys.delete(e.key.toLowerCase()); };
  onToggleMenu?: () => void;
  onPhaseChange?: (phase: Phase) => void;

  constructor(private container: HTMLElement, quality: Quality, onHud: (h: Hud) => void) {
    this.onHud = onHud;
    this.initGfx(quality);
    window.addEventListener('keydown', this.keyDown, { passive: false });
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', () => { this.keys.clear(); this.setMobileFire('L', false); this.setMobileFire('R', false); });
    this.lastTime = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(.05, (now - this.lastTime) / 1000);
      this.lastTime = now;
      this.update(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private initGfx(quality: Quality) {
    if (this.gfx) {
      if (this.pointerHandlers) {
        const cv = this.gfx.renderer.domElement;
        cv.removeEventListener('pointerdown', this.pointerHandlers.down);
        cv.removeEventListener('pointermove', this.pointerHandlers.move);
        cv.removeEventListener('pointerup', this.pointerHandlers.up);
        cv.removeEventListener('pointercancel', this.pointerHandlers.up);
      }
      this.gfx.dispose();
    }
    this.gfx = new OceanScene(this.container, quality);
    const down = (e: PointerEvent) => {
      if (this.phase !== 'playing' || this.menuOpen) return;
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      if (this.steerPointer === null) {
        this.steerPointer = e.pointerId;
        this.steerPoint = this.gfx.raycastWater(e.clientX, e.clientY);
      } else if (!this.firePointers.has(e.pointerId)) {
        this.firePointers.set(e.pointerId, e.clientX < window.innerWidth / 2 ? 'L' : 'R');
      }
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== this.steerPointer) return;
      e.preventDefault();
      this.steerPoint = this.gfx.raycastWater(e.clientX, e.clientY);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId === this.steerPointer) {
        this.steerPointer = null; this.steerPoint = null;
        this.brakeUntil = performance.now() + 500; // 松手即刹停
      }
      this.firePointers.delete(e.pointerId);
    };
    const cv = this.gfx.renderer.domElement;
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('contextmenu', e => e.preventDefault());
    this.pointerHandlers = { down, move, up };
    this.gfx.setPlayer(this.localId, this.phase !== 'playing');
  }

  applyQuality(q: Quality) { this.initGfx(q); }
  setVolume(v: number) { this.audio.setVolume(v); }
  setMuted(m: boolean) { this.audio.setMuted(m); }

  setMobileFire(side: 'L' | 'R', on: boolean) {
    this.mobileFire[side] = on;
    if (on) this.audio.init();
  }

  triggerSkill(skill: 'dash' | 'repair' | 'supply') {
    if (this.phase !== 'playing' || this.menuOpen) return;
    this.queued[skill] = true;
    this.audio.init();
  }

  enterMenu() {
    this.disconnect();
    this.phase = 'menu';
    this.world = undefined;
    this.predicted = undefined;
    this.menuOpen = false; this.paused = false;
    this.setPlayerCamera();
    this.onPhaseChange?.('menu');
  }

  private setPlayerCamera() {
    this.gfx.setPlayer(this.online ? this.localId : this.localId, this.phase !== 'playing');
  }

  startSolo(mode: Mode, difficulty: Difficulty, nickname: string) {
    this.disconnect();
    this.mode = mode; this.difficulty = difficulty; this.nickname = nickname;
    this.online = false; this.roomCode = ''; this.connected = true;
    const me = createShip('me', nickname || '船长', false, 0xf0a85c, 11);
    const ships = [me];
    for (let i = 0; i < 3; i++) ships.push(createShip(`bot${i}`, BOT_NAMES[i], true, BOT_COLORS[i], 30 + i * 17));
    this.world = createWorld(mode, 180, ships);
    this.localId = 'me';
    this.phase = 'playing'; this.paused = false; this.menuOpen = false;
    this.predicted = undefined;
    this.visual.clear();
    this.setPlayerCamera();
    this.audio.init();
    this.notice = '';
    this.onPhaseChange?.('playing');
  }

  connectOnline(mode: Mode, difficulty: Difficulty, nickname: string, action: 'quick' | 'create' | 'join', roomCode?: string) {
    this.disconnect();
    this.mode = mode; this.difficulty = difficulty; this.nickname = nickname;
    this.online = true; this.connected = false;
    this.phase = 'connecting'; this.menuOpen = false;
    this.onPhaseChange?.('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'join', mode, difficulty, nickname, action, roomCode }));
    ws.onmessage = ev => {
      let msg: any;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'welcome') {
        this.localId = msg.id; this.roomCode = msg.roomCode; this.mode = msg.mode;
        this.world = msg.world; this.connected = true;
        this.phase = 'playing'; this.predicted = { ...this.world.ships.find(s => s.id === this.localId)! };
        this.visual.clear();
        this.setPlayerCamera(); this.audio.init();
        this.onPhaseChange?.('playing');
      } else if (msg.type === 'state' && this.world) {
        this.world = msg.world;
        this.reconcile();
        if (this.world.ended && this.phase === 'playing') this.finish();
      } else if (msg.type === 'events') {
        for (const e of msg.events as GameEvent[]) this.handleEvent(e);
      } else if (msg.type === 'ended' && this.world) {
        this.world = msg.world;
        this.finish();
      } else if (msg.type === 'reset' && msg.world) {
        this.world = msg.world;
        this.localId = this.world.ships.find(s => s.name === this.nickname && !s.isBot)?.id || this.localId;
        this.predicted = { ...this.world.ships.find(s => s.id === this.localId)! };
        this.visual.clear();
        this.phase = 'playing'; this.menuOpen = false;
        this.setPlayerCamera();
        this.onPhaseChange?.('playing');
      } else if (msg.type === 'notice') {
        this.notice = msg.text;
      } else if (msg.type === 'error') {
        this.notice = msg.message;
        this.phase = 'menu'; this.onPhaseChange?.('menu');
        this.disconnect();
      }
    };
    ws.onclose = () => {
      if (this.online && this.phase !== 'menu') {
        this.connected = false;
        this.notice = '连接断开 / Disconnected';
        this.phase = 'menu'; this.onPhaseChange?.('menu');
      }
    };
  }

  private reconcile() {
    const auth = this.world?.ships.find(s => s.id === this.localId);
    if (!auth || !this.predicted) return;
    const p = this.predicted;
    p.x += (auth.x - p.x) * .25;
    p.z += (auth.z - p.z) * .25;
    p.h += Math.atan2(Math.sin(auth.h - p.h), Math.cos(auth.h - p.h)) * .25;
    p.speed += (auth.speed - p.speed) * .25;
    p.hp = auth.hp; p.score = auth.score; p.alive = auth.alive;
    p.reloadL = auth.reloadL; p.reloadR = auth.reloadR;
    p.dashCd = auth.dashCd; p.repairCd = auth.repairCd; p.supplyCd = auth.supplyCd;
    p.ammoL = auth.ammoL; p.ammoR = auth.ammoR;
    p.respawnAt = auth.respawnAt;
  }

  disconnect() {
    if (this.ws) { this.ws.onclose = null; this.ws.close(); this.ws = undefined; }
    this.connected = false; this.online = false;
    this.firePointers.clear(); this.mobileFire.L = this.mobileFire.R = false;
  }

  private me() { return this.world?.ships.find(s => s.id === this.localId); }

  private getCommand(): Command {
    const cmd = emptyCommand();
    if (this.phase !== 'playing' || this.menuOpen) return cmd;
    const k = this.keys;
    cmd.thrust = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? .7 : 0);
    cmd.turn = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    cmd.fireL = k.has('q') || this.queued.fireL || this.mobileFire.L || [...this.firePointers.values()].includes('L');
    cmd.fireR = k.has('e') || this.queued.fireR || this.mobileFire.R || [...this.firePointers.values()].includes('R');
    cmd.dash = this.queued.dash; cmd.repair = this.queued.repair; cmd.supply = this.queued.supply;
    cmd.brake = this.steerPointer === null && performance.now() < this.brakeUntil;
    this.queued.dash = this.queued.repair = this.queued.supply = this.queued.fireL = this.queued.fireR = false;

    if (this.steerPointer !== null && this.steerPoint) {
      const s = this.online && this.predicted ? this.predicted : this.me();
      if (s && s.alive) {
        const dx = this.steerPoint.x - s.x, dz = this.steerPoint.z - s.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 5) {
          const want = Math.atan2(dx, dz);
          const diff = Math.atan2(Math.sin(want - s.h), Math.cos(want - s.h));
          cmd.turn = clamp(diff * 2.2, -1, 1);
          // 拖得越远油门越大，但不会瞬移
          cmd.thrust = clamp(dist / 22, .35, 1);
          if (dist < 12 && Math.abs(s.speed) > 0) cmd.thrust = 0;
        } else { cmd.thrust = 0; cmd.turn = 0; }
      }
    }
    return cmd;
  }

  private handleEvent(e: GameEvent) {
    const s = this.me();
    const near = s ? Math.hypot(s.x - e.x, s.z - e.z) < 180 : true;
    if (!near) return;
    if (e.type === 'fire') { this.gfx.spawnEffect('fire', e.x, e.z, this.animTime); if (e.owner === this.localId || Math.hypot(s!.x - e.x, s!.z - e.z) < 70) this.audio.cannon(); }
    else if (e.type === 'hit') { this.gfx.spawnEffect('hit', e.x, e.z, this.animTime); this.audio.hit(); }
    else if (e.type === 'sink') { this.gfx.spawnEffect('sink', e.x, e.z, this.animTime); this.audio.explosion(); }
    else if (e.type === 'pickup') { this.gfx.spawnEffect('pickup', e.x, e.z, this.animTime); if (e.owner === this.localId) this.audio.pickup(); }
    else if (e.type === 'dash') { this.gfx.spawnEffect('dash', e.x, e.z, this.animTime); }
    else if (e.type === 'respawn') { this.gfx.spawnEffect('respawn', e.x, e.z, this.animTime); }
    else if (e.type === 'repair') { this.gfx.spawnEffect('repair', e.x, e.z, this.animTime); }
  }

  private finish() {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.menuOpen = false;
    const me = this.me();
    this.audio.end(me && this.world?.winnerId === me.id);
    this.onPhaseChange?.('ended');
  }

  setMenuOpen(open: boolean) {
    this.menuOpen = open;
    if (!this.online) this.paused = open;
    if (!open) { this.keys.clear(); this.queued.dash = this.queued.repair = this.queued.supply = this.queued.fireL = this.queued.fireR = false; }
  }

  restart() {
    if (this.phase !== 'ended') return;
    if (this.online) {
      this.ws?.send(JSON.stringify({ type: 'restart' }));
    } else {
      this.startSolo(this.mode, this.difficulty, this.nickname);
    }
  }

  private consumeWorldEvents() {
    if (!this.world?.events.length) return;
    for (const e of this.world.events) this.handleEvent(e);
    this.world.events.length = 0;
  }

  private update(dt: number) {
    const running = this.phase === 'playing' && !this.paused;
    if (running) {
      this.animTime += dt;
      const cmd = this.getCommand();
      if (this.world && !this.online) {
        const commands: Record<string, Command> = {};
        for (const s of this.world.ships) commands[s.id] = s.isBot ? botCommand(this.world, s.id, this.difficulty) : (s.id === this.localId ? cmd : emptyCommand());
        stepWorld(this.world, dt, commands);
        this.consumeWorldEvents();
        if (this.world.ended) this.finish();
      } else if (this.online && this.predicted) {
        predictShip(this.predicted, cmd, dt, this.world?.safeR || 130, this.mode);
        this.snapTimer += dt;
        if (this.snapTimer >= .05) {
          this.snapTimer = 0;
          this.ws?.send(JSON.stringify({ type: 'command', command: cmd }));
        }
      }
    } else if (this.phase === 'menu' || this.phase === 'connecting') {
      this.animTime += dt;
    }

    if (this.world && this.phase !== 'menu') {
      const states = this.world.ships.map(s => {
        let x = s.x, z = s.z, h = s.h, speed = s.speed;
        if (s.id === this.localId && this.online && this.predicted && s.alive) {
          x = this.predicted.x; z = this.predicted.z; h = this.predicted.h; speed = this.predicted.speed;
        }
        let v = this.visual.get(s.id);
        if (!v) { v = { x, z, h }; this.visual.set(s.id, v); }
        const a = Math.min(1, dt * (this.online ? 11 : 20));
        v.x += (x - v.x) * a; v.z += (z - v.z) * a;
        v.h += Math.atan2(Math.sin(h - v.h), Math.cos(h - v.h)) * a;
        return { id: s.id, x: v.x, z: v.z, h: v.h, speed, alive: s.alive, color: s.color, name: s.name };
      });
      this.gfx.syncShips(states, this.animTime, this.localId);
      this.gfx.syncChests(this.world.chests, this.animTime);
    } else if (this.phase === 'menu') {
      this.gfx.syncShips([], this.animTime, '');
      this.gfx.syncChests([], this.animTime);
    }

    this.gfx.update(dt, this.animTime);

    this.hudTimer += dt;
    if (this.hudTimer >= .1) {
      this.hudTimer = 0;
      this.pushHud();
    }
  }

  private pushHud() {
    const w = this.world;
    const me = this.me();
    const pred = this.online && this.predicted ? this.predicted : me;
    this.onHud({
      phase: this.phase,
      hp: me?.hp || 0,
      score: me?.score || 0,
      time: w ? Math.max(0, w.duration - w.t) : 180,
      leaderboard: w ? [...w.ships].sort((a, b) => b.score - a.score).map(s => ({
        id: s.id, name: s.name, score: s.score, kills: s.kills, alive: s.alive,
        isMe: s.id === this.localId, color: s.color, x: s.x, z: s.z
      })) : [],
      reloadL: me?.reloadL || 0, reloadR: me?.reloadR || 0,
      dashCd: me?.dashCd || 0, repairCd: me?.repairCd || 0, supplyCd: me?.supplyCd || 0,
      ammoL: me?.ammoL || 0, ammoR: me?.ammoR || 0,
      alive: me?.alive ?? false,
      respawnIn: me && !me.alive ? Math.max(0, me.respawnAt - w!.t) : 0,
      mode: this.mode, online: this.online, roomCode: this.roomCode,
      connection: this.connected, menuOpen: this.menuOpen,
      stormR: RULES.arenaR, safeR: w?.safeR || 130,
      x: pred?.x || 0, z: pred?.z || 0, heading: pred?.h || 0,
      notice: this.notice,
      winnerId: w?.winnerId
    });
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    this.disconnect();
    this.gfx.dispose();
  }
}
