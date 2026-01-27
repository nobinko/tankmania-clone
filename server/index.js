const path = require("path");
const express = require("express");
const { createServer } = require("http");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;

const TICK_RATE = 20;
const STATE_BROADCAST_HZ = 10;
const MOVE_MAX_DIST = 220;
const MOVE_COOLDOWN_MS = 450;
const SHOOT_COOLDOWN_MS = 450;
const BULLET_SPEED = 520;
const BULLET_TTL_MS = 1500;
const HIT_RADIUS = 16;
const RESPAWN_INVULN_MS = 1500;
const WORLD_WIDTH = 800;
const WORLD_HEIGHT = 600;
const RESPAWN_POINTS = [
  { x: 140, y: 140 },
  { x: 660, y: 140 },
  { x: 140, y: 460 },
  { x: 660, y: 460 },
];

const app = express();

// client/dist を配信
const distPath = path.join(__dirname, "../client/dist");
app.use(express.static(distPath));

// SPA直リンク対策（Express v5 形式。v4なら "*" に戻す）
app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: true, methods: ["GET", "POST"] },
});

const players = new Map();
let bullets = [];

function clampMove(fromX, fromY, toX, toY, maxDist) {
  const dx = toX - fromX, dy = toY - fromY;
  const d = Math.hypot(dx, dy) || 1;
  if (d <= maxDist) return { x: toX, y: toY };
  const k = maxDist / d;
  return { x: fromX + dx * k, y: fromY + dy * k };
}
const clampToWorld = (x, y) => ({
  x: Math.min(WORLD_WIDTH, Math.max(0, x)),
  y: Math.min(WORLD_HEIGHT, Math.max(0, y)),
});
const isFiniteNumber = (value) => Number.isFinite(value);
const normalizeAngle = (angle) => {
  const twoPi = Math.PI * 2;
  return ((angle + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
};
const now = () => Date.now();
const respawnPlayer = (player, t) => {
  const spawn = RESPAWN_POINTS[player.spawnIndex % RESPAWN_POINTS.length];
  player.spawnIndex += 1;
  player.x = spawn.x + Math.random() * 20 - 10;
  player.y = spawn.y + Math.random() * 20 - 10;
  player.hp = 1.0;
  player.move = null;
  player.invulnUntil = t + RESPAWN_INVULN_MS;
  player.nextActionAt = t + 600;
};

io.on("connection", (socket) => {
  const player = {
    id: socket.id,
    x: 0,
    y: 0,
    hp: 1.0,
    move: null,
    nextActionAt: 0,
    invulnUntil: 0,
    score: 0,
    deaths: 0,
    spawnIndex: 0,
  };
  respawnPlayer(player, now());
  players.set(socket.id, player);

  socket.on("move", (payload) => {
    const { x, y } = payload ?? {};
    const p = players.get(socket.id);
    if (!p) return;
    const t = now();
    if (t < p.nextActionAt) return;
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
      console.warn("move: invalid coordinates", { x, y, id: socket.id });
      return;
    }
    const target = clampMove(p.x, p.y, x, y, MOVE_MAX_DIST);
    const clampedTarget = clampToWorld(target.x, target.y);
    p.move = { sx: p.x, sy: p.y, tx: clampedTarget.x, ty: clampedTarget.y, t0: t, t1: t + MOVE_COOLDOWN_MS };
    p.nextActionAt = t + MOVE_COOLDOWN_MS;
  });

  socket.on("shoot", (payload) => {
    const { angle } = payload ?? {};
    const p = players.get(socket.id);
    if (!p) return;
    const t = now();
    if (t < p.nextActionAt) return;
    if (!isFiniteNumber(angle)) {
      console.warn("shoot: invalid angle", { angle, id: socket.id });
      return;
    }
    const normalizedAngle = normalizeAngle(angle);

    bullets.push({
      id: `${socket.id}:${t}:${Math.random().toString(16).slice(2)}`,
      owner: socket.id,
      x: p.x, y: p.y,
      vx: Math.cos(normalizedAngle) * BULLET_SPEED,
      vy: Math.sin(normalizedAngle) * BULLET_SPEED,
      bornAt: t
    });
    p.nextActionAt = t + SHOOT_COOLDOWN_MS;
  });

  socket.on("disconnect", () => {
    players.delete(socket.id);
    bullets = bullets.filter(b => b.owner !== socket.id);
  });
});

// ゲームループ
let last = now();
setInterval(() => {
  const t = now();
  const dt = (t - last) / 1000;
  last = t;

  for (const p of players.values()) {
    if (p.move) {
      const m = p.move;
      const k = Math.min(1, Math.max(0, (t - m.t0) / (m.t1 - m.t0)));
      p.x = m.sx + (m.tx - m.sx) * k;
      p.y = m.sy + (m.ty - m.sy) * k;
      if (k >= 1) p.move = null;
    }
  }

  for (const b of bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x < 0 || b.x > WORLD_WIDTH || b.y < 0 || b.y > WORLD_HEIGHT) {
      b.bornAt = 0;
    }
  }

  bullets = bullets.filter(b => (t - b.bornAt) <= BULLET_TTL_MS);

  for (const b of bullets) {
    for (const p of players.values()) {
      if (p.id === b.owner) continue;
      if (t < p.invulnUntil) continue;
      const d = Math.hypot(p.x - b.x, p.y - b.y);
      if (d < HIT_RADIUS) {
        p.hp = Math.max(0, p.hp - 0.2);
        b.bornAt = 0;
        if (p.hp <= 0) {
          p.deaths += 1;
          const killer = players.get(b.owner);
          if (killer) killer.score += 1;
          respawnPlayer(p, t);
        }
        break;
      }
    }
  }
}, 1000 / TICK_RATE);

// 状態配信
setInterval(() => {
  const ps = Array.from(players.values()).map(p => ({
    id: p.id,
    x: p.x,
    y: p.y,
    hp: p.hp,
    score: p.score,
    deaths: p.deaths,
  }));
  const bs = bullets.filter(b => b.bornAt > 0).map(b => ({ id: b.id, x: b.x, y: b.y }));
  io.emit("state", { t: now(), players: ps, bullets: bs });
}, 1000 / STATE_BROADCAST_HZ);

httpServer.listen(PORT, "0.0.0.0", () => console.log(`server on :${PORT}`));
