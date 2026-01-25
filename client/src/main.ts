import Phaser from "phaser";
import { io } from "socket.io-client";

const socket = io(import.meta.env.DEV ? "http://localhost:3000" : undefined);

type Player = { id: string; x: number; y: number; hp: number };
type Bullet = { id: string; x: number; y: number };

class GameScene extends Phaser.Scene {
  meId: string | null = null;
  players = new Map<string, Phaser.GameObjects.Container>();
  bullets = new Map<string, Phaser.GameObjects.Arc>();
  aiming = false;

  create() {
    this.input.mouse?.disableContextMenu();

    socket.on("connect", () => {
      this.meId = socket.id ?? null;
    });

    socket.on("state", (state: { players: Player[]; bullets: Bullet[] }) => {
      this.syncPlayers(state.players);
      this.syncBullets(state.bullets);
    });

    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      const me = this.players.get(this.meId ?? "");
      if (!me) return;

      const mx = p.worldX, my = p.worldY;
      const dx = mx - me.x, dy = my - me.y;
      const d = Math.hypot(dx, dy);

      if (d < 24) this.aiming = true;       // 自分の近く→AIM
      else socket.emit("move", { x: mx, y: my }); // それ以外→移動
    });

    this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      if (!this.aiming) return;
      this.aiming = false;

      const me = this.players.get(this.meId ?? "");
      if (!me) return;

      const mx = p.worldX, my = p.worldY;
      const angle = Math.atan2(my - me.y, mx - me.x);
      socket.emit("shoot", { angle });
    });
  }

  syncPlayers(list: Player[]) {
    const seen = new Set<string>();

    for (const pl of list) {
      seen.add(pl.id);

      let obj = this.players.get(pl.id);
      if (!obj) {
        const body = this.add.circle(0, 0, 14, 0x888888);
        const hp = this.add.rectangle(0, -22, 34, 6, 0x00ff00).setOrigin(0.5);
        obj = this.add.container(pl.x, pl.y, [body, hp]);
        this.players.set(pl.id, obj);
      }

      obj.setPosition(pl.x, pl.y);

      const body = obj.list[0] as Phaser.GameObjects.Arc;
      body.setFillStyle(pl.id === this.meId ? 0x66aaff : 0x888888);

      const hpBar = obj.list[1] as Phaser.GameObjects.Rectangle;
      hpBar.width = 34 * Math.max(0, Math.min(1, pl.hp));
      hpBar.setFillStyle(pl.hp > 0.5 ? 0x00ff00 : 0xffaa00);
    }

    for (const [id, obj] of this.players) {
      if (!seen.has(id)) {
        obj.destroy(true);
        this.players.delete(id);
      }
    }
  }

  syncBullets(list: Bullet[]) {
    const seen = new Set<string>();

    for (const b of list) {
      seen.add(b.id);
      let obj = this.bullets.get(b.id);
      if (!obj) {
        obj = this.add.circle(b.x, b.y, 4, 0xffffff);
        this.bullets.set(b.id, obj);
      } else {
        obj.setPosition(b.x, b.y);
      }
    }

    for (const [id, obj] of this.bullets) {
      if (!seen.has(id)) {
        obj.destroy(true);
        this.bullets.delete(id);
      }
    }
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  backgroundColor: "#111",
  scene: [GameScene],
});
