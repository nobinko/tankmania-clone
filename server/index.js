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
const now = () => Date.now();

io.on("connection", (socket) => {
  players.set(socket.id, {
    id: socket.id,
    x: 200 + Math.random() * 200,
    y: 200 + Math.random() * 200,
    hp: 1.0,
    move: null,
    nextActionAt: 0,
  });

  socket.on("move", ({ x, y }) => {
    const p = players.get(socket.id);
    if (!p) return;
    const t = now();
    if (t < p.nextActionAt) return;

    const target = clampMove(p.x, p.y, x, y, MOVE_MAX_DIST);
    p.move = { sx: p.x, sy: p.y, tx: target.x, ty: target.y, t0: t, t1: t + MOVE_COOLDOWN_MS };
    p.nextActionAt = t + MOVE_COOLDOWN_MS;
  });

  socket.on("shoot", ({ angle }) => {
    const p = players.get(socket.id);
    if (!p) return;
    const t = now();
    if (t < p.nextActionAt) return;

    bullets.push({
      id: `${socket.id}:${t}:${Math.random().toString(16).slice(2)}`,
      owner: socket.id,
      x: p.x, y: p.y,
      vx: Math.cos(angle) * BULLET_SPEED,
      vy: Math.sin(angle) * BULLET_SPEED,
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
  }

  bullets = bullets.filter(b => (t - b.bornAt) <= BULLET_TTL_MS);

  for (const b of bullets) {
    for (const p of players.values()) {
      if (p.id === b.owner) continue;
      const d = Math.hypot(p.x - b.x, p.y - b.y);
      if (d < HIT_RADIUS) {
        p.hp = Math.max(0, p.hp - 0.2);
        b.bornAt = 0;
        if (p.hp <= 0) {
          p.hp = 1.0;
          p.x = 200 + Math.random() * 200;
          p.y = 200 + Math.random() * 200;
          p.move = null;
          p.nextActionAt = t + 600;
        }
      }
    }
  }
}, 1000 / TICK_RATE);

// 状態配信
setInterval(() => {
  const ps = Array.from(players.values()).map(p => ({ id: p.id, x: p.x, y: p.y, hp: p.hp }));
  const bs = bullets.filter(b => b.bornAt > 0).map(b => ({ id: b.id, x: b.x, y: b.y }));
  io.emit("state", { t: now(), players: ps, bullets: bs });
}, 1000 / STATE_BROADCAST_HZ);

httpServer.listen(PORT, "0.0.0.0", () => console.log(`server on :${PORT}`));
