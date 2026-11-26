import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { createShip, createWorld, stepWorld, botCommand, emptyCommand, type Command, type Mode, type World, type Ship } from './rules.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, 'dist');
const PORT = Number(process.env.PORT || 8787);
const BOT_NAMES = ['黑帆·雷诺', '海妖·赛琳', '铁钩·巴克', '北风·艾拉', '幽灵·摩根', '珊瑚·露娜'];

interface Room {
  code: string;
  mode: Mode;
  difficulty: 'easy' | 'normal' | 'hard';
  world: World;
  clients: Map<string, WebSocket>;
  commands: Map<string, Command>;
  emptySince: number;
  endedAt: number;
}

const rooms = new Map<string, Room>();
let idCounter = 0;

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do { code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); } while (rooms.has(code));
  return code;
}

function resetRoom(room: Room) {
  const humans: { id: string; name: string; color: number }[] = [];
  for (const [id, ws] of room.clients) {
    const old = room.world.ships.find(s => s.id === id);
    if (ws.readyState === WebSocket.OPEN && old) humans.push({ id, name: old.name, color: old.color });
  }
  const ships: Ship[] = [];
  let seed = ++idCounter * 17;
  humans.forEach((h, i) => ships.push(createShip(h.id, h.name, false, h.color, seed + i * 31)));
  for (let i = ships.length; i < 6; i++) {
    ships.push(createShip(`bot-${room.code}-${i}`, BOT_NAMES[i % BOT_NAMES.length], true, [0xf0a85c, 0xe76b62, 0x8d7bd6, 0x7ac9a8, 0xd8c36a, 0x6fa8d6][i], seed + i * 31));
  }
  room.world = createWorld(room.mode, 180, ships);
  room.commands.clear();
  room.endedAt = 0;
  for (const ws of room.clients.values()) safeSend(ws, { type: 'reset', world: room.world });
}

function createRoom(mode: Mode, difficulty: 'easy' | 'normal' | 'hard', code?: string): Room {
  const roomCode = code || makeCode();
  const room: Room = {
    code: roomCode, mode, difficulty,
    world: createWorld(mode, 180, []),
    clients: new Map(), commands: new Map(), emptySince: 0, endedAt: 0
  };
  rooms.set(roomCode, room);
  resetRoom(room);
  return room;
}

function safeSend(ws: WebSocket, obj: unknown) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function sanitizeName(name: unknown) {
  return String(name || '船长').replace(/[<>]/g, '').slice(0, 14);
}

function joinRoom(ws: WebSocket, msg: any) {
  const mode: Mode = ['free', 'storm', 'treasure'].includes(msg.mode) ? msg.mode : 'free';
  const difficulty = ['easy', 'normal', 'hard'].includes(msg.difficulty) ? msg.difficulty : 'normal';
  let room: Room | undefined;
  if (msg.roomCode) room = rooms.get(String(msg.roomCode).toUpperCase());
  // 通过房间码加入一间已结束的房间时，直接开新一局
  if (room?.world.ended) resetRoom(room);
  if (!room && msg.action === 'quick') {
    room = [...rooms.values()].find(r => !r.world.ended && r.clients.size < 6 && r.mode === mode);
  }
  if (!room) room = createRoom(mode, difficulty, msg.roomCode ? String(msg.roomCode).toUpperCase() : undefined);
  if (room.clients.size >= 6) {
    safeSend(ws, { type: 'error', message: '房间已满 / Room full' });
    return;
  }
  const id = `p${++idCounter}`;
  // 真人接替一个电脑槽位
  const bot = room.world.ships.find(s => s.isBot);
  if (bot) {
    bot.id = id; bot.name = sanitizeName(msg.nickname); bot.isBot = false;
    bot.color = [0xf0a85c, 0xe76b62, 0x8d7bd6, 0x7ac9a8, 0xd8c36a, 0x6fa8d6][room.clients.size % 6];
  } else {
    room.world.ships.push(createShip(id, sanitizeName(msg.nickname), false, 0xf0a85c, idCounter * 7));
  }
  room.clients.set(id, ws);
  room.commands.set(id, emptyCommand());
  room.emptySince = 0;
  (ws as any).roomCode = room.code;
  (ws as any).playerId = id;
  safeSend(ws, { type: 'welcome', id, roomCode: room.code, mode: room.mode, world: room.world });
  broadcast(room, { type: 'notice', text: `${sanitizeName(msg.nickname)} 加入战场 / joined` });
}

function leaveRoom(ws: any) {
  const room: Room | undefined = rooms.get(ws.roomCode);
  if (!room) return;
  const id = ws.playerId;
  room.clients.delete(id);
  room.commands.delete(id);
  const ship = room.world.ships.find(s => s.id === id);
  if (ship) {
    ship.isBot = true;
    ship.name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
    ship.color = 0x9a8f7a;
  }
  if (room.clients.size === 0) room.emptySince = Date.now();
}

function broadcast(room: Room, obj: unknown) {
  const data = JSON.stringify(obj);
  for (const ws of room.clients.values()) if (ws.readyState === WebSocket.OPEN) ws.send(data);
}

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  let file = path.join(dist, url === '/' ? 'index.html' : url);
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('lsy Stormbreakers server is running. Open Vite dev server at http://localhost:5173');
    return;
  }
  const ext = path.extname(file);
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws: any) => {
  ws.on('message', raw => {
    let msg: any;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'join') joinRoom(ws, msg);
    else if (msg.type === 'command') {
      const room: Room | undefined = rooms.get(ws.roomCode);
      if (!room || !ws.playerId) return;
      const c = msg.command || {};
      room.commands.set(ws.playerId, {
        thrust: Math.max(-1, Math.min(1, Number(c.thrust) || 0)),
        turn: Math.max(-1, Math.min(1, Number(c.turn) || 0)),
        fireL: !!c.fireL, fireR: !!c.fireR, dash: !!c.dash, repair: !!c.repair, supply: !!c.supply, brake: !!c.brake
      } as Command);
    }
    else if (msg.type === 'ping') safeSend(ws, { type: 'pong', t: msg.t });
    else if (msg.type === 'restart') {
      const room: Room | undefined = rooms.get(ws.roomCode);
      if (room && room.world.ended) resetRoom(room);
    }
  });
  ws.on('close', () => leaveRoom(ws));
  ws.on('error', () => leaveRoom(ws));
});

let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  for (const room of rooms.values()) {
    if (room.emptySince && now - room.emptySince > 60000) { rooms.delete(room.code); continue; }
    if (room.world.ended) {
      if (!room.endedAt) {
        room.endedAt = now;
        broadcast(room, { type: 'ended', world: room.world });
      }
      continue;
    }
    const commands: Record<string, Command> = {};
    for (const s of room.world.ships) {
      if (s.isBot) commands[s.id] = botCommand(room.world, s.id, room.difficulty);
      else commands[s.id] = room.commands.get(s.id) || emptyCommand();
    }
    stepWorld(room.world, dt, commands);
    if (room.world.events.length) {
      broadcast(room, { type: 'events', events: room.world.events, t: room.world.t });
      room.world.events.length = 0;
    }
    broadcast(room, { type: 'state', world: room.world, t: room.world.t });
  }
}, 50);

server.listen(PORT, '0.0.0.0', () => console.log(`[lsy Stormbreakers] authoritative server listening on ${PORT}`));
