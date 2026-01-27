import Phaser from "phaser";
import { io } from "socket.io-client";

// ✅ 2-A（Vite proxy）を入れていれば、devでもprodでもこれでOK
// - dev: http://localhost:5173 から /socket.io を proxy 経由で http://localhost:3000 に流れる
// - prod(Render): 同一オリジンでそのまま繋がる
const socket = io();

type Player = { id: string; x: number; y: number; hp: number; name: string; score: number; deaths: number };
type Bullet = { id: string; x: number; y: number };
type ServerState = { t: number; players: Player[]; bullets: Bullet[] };

const NAME_MAX_LENGTH = 20;
type ScreenState = "entry" | "lobby" | "room";

let desiredName = "";
let nameConfirmed = false;
let currentScreen: ScreenState = "entry";
let gameInstance: Phaser.Game | null = null;

const uiRoot = document.createElement("div");
uiRoot.style.position = "fixed";
uiRoot.style.inset = "0";
uiRoot.style.display = "flex";
uiRoot.style.alignItems = "center";
uiRoot.style.justifyContent = "center";
uiRoot.style.background = "rgba(0, 0, 0, 0.6)";
uiRoot.style.zIndex = "2000";
document.body.appendChild(uiRoot);

const sendName = (name: string) => {
  if (!name) return;
  socket.emit("set_name", { name });
};

const setScreen = (next: ScreenState) => {
  if (currentScreen === next) return;
  currentScreen = next;
  renderScreen();
  if (currentScreen === "room") {
    startGame();
  }
};

const createPanel = (titleText: string) => {
  const panel = document.createElement("div");
  panel.style.background = "#1b1b1b";
  panel.style.border = "1px solid #333";
  panel.style.borderRadius = "8px";
  panel.style.padding = "24px";
  panel.style.color = "#fff";
  panel.style.fontFamily = "monospace";
  panel.style.textAlign = "center";
  panel.style.minWidth = "300px";

  const title = document.createElement("div");
  title.textContent = titleText;
  title.style.fontSize = "18px";
  title.style.marginBottom = "12px";

  panel.appendChild(title);
  return panel;
};

const renderEntry = () => {
  const panel = createPanel("名前を入力してください");

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Player";
  input.maxLength = NAME_MAX_LENGTH;
  input.style.padding = "8px 10px";
  input.style.fontSize = "16px";
  input.style.width = "220px";
  input.style.borderRadius = "6px";
  input.style.border = "1px solid #444";
  input.style.marginBottom = "12px";

  const button = document.createElement("button");
  button.textContent = "入室";
  button.style.marginLeft = "8px";
  button.style.padding = "8px 14px";
  button.style.fontSize = "15px";
  button.style.borderRadius = "6px";
  button.style.border = "1px solid #444";
  button.style.background = "#2c2c2c";
  button.style.color = "#fff";
  button.style.cursor = "pointer";

  const form = document.createElement("div");
  form.appendChild(input);
  form.appendChild(button);

  panel.appendChild(form);
  uiRoot.appendChild(panel);

  const submit = () => {
    const name = input.value.trim().slice(0, NAME_MAX_LENGTH);
    desiredName = name || "Player";
    nameConfirmed = true;
    if (socket.connected) {
      sendName(desiredName);
    }
    setScreen("lobby");
  };

  button.addEventListener("click", submit);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submit();
  });
  input.focus();
};

const renderLobby = () => {
  const panel = createPanel("ロビー");

  const nameLine = document.createElement("div");
  nameLine.textContent = `名前: ${desiredName || "Player"}`;
  nameLine.style.marginBottom = "16px";

  const button = document.createElement("button");
  button.textContent = "ルームへ入室";
  button.style.padding = "8px 16px";
  button.style.fontSize = "15px";
  button.style.borderRadius = "6px";
  button.style.border = "1px solid #444";
  button.style.background = "#2c2c2c";
  button.style.color = "#fff";
  button.style.cursor = "pointer";

  panel.appendChild(nameLine);
  panel.appendChild(button);
  uiRoot.appendChild(panel);

  button.addEventListener("click", () => {
    setScreen("room");
  });
};

const renderScreen = () => {
  uiRoot.innerHTML = "";
  if (currentScreen === "room") {
    uiRoot.style.display = "none";
    return;
  }
  uiRoot.style.display = "flex";
  if (currentScreen === "entry") renderEntry();
  if (currentScreen === "lobby") renderLobby();
};

renderScreen();

socket.on("connect", () => {
  if (nameConfirmed) {
    sendName(desiredName);
  }
});

class GameScene extends Phaser.Scene {
  meId: string | null = null;
  players = new Map<string, Phaser.GameObjects.Container>();
  bullets = new Map<string, Phaser.GameObjects.Arc>();
  aiming = false;
  private stateBuffer: ServerState[] = [];
  private lastServerState: ServerState | null = null;
  private serverTimeOffsetMs = 0;

  // ★ネット状態表示
  netText!: Phaser.GameObjects.Text;
  scoreText!: Phaser.GameObjects.Text;

  // ★操作説明オーバーレイ
  helpContainer!: Phaser.GameObjects.Container;
  helpBg!: Phaser.GameObjects.Rectangle;
  helpText!: Phaser.GameObjects.Text;

  private shortId(id: string | null) {
    return id ? id.slice(0, 6) : "------";
  }

  private setNetStatus(line: string) {
    this.netText.setText(`NET: ${line}`);
  }

  private buildHelpOverlay() {
    const pad = 10;
    const margin = 12;

    const helpLines = [
      "操作",
      "・左クリック：移動（遠い地点をクリック）",
      "・自機の近くをクリック：AIM開始（ドラッグして方向）",
      "・ボタンを離す：発射",
      "・H：このヘルプ表示/非表示",
      "",
      "※ NET が CONNECTED 以外なら再接続中かも",
    ].join("\n");

    this.helpText = this.add
      .text(0, 0, helpLines, {
        fontFamily: "monospace",
        fontSize: "13px",
        color: "#ffffff",
        lineSpacing: 4,
      })
      .setOrigin(0, 0);

    const w = this.helpText.width + pad * 2;
    const h = this.helpText.height + pad * 2;

    // 左下に配置
    const x = margin;
    const y = this.scale.height - h - margin;

    this.helpBg = this.add
      .rectangle(x, y, w, h, 0x000000, 0.55)
      .setOrigin(0, 0);

    this.helpText.setPosition(x + pad, y + pad);

    this.helpContainer = this.add.container(0, 0, [this.helpBg, this.helpText]);

    // 画面固定＆最前面（UIなので）
    // ScrollFactor 0 は固定UI用に使える :contentReference[oaicite:4]{index=4}
    this.helpBg.setScrollFactor(0).setDepth(999);
    this.helpText.setScrollFactor(0).setDepth(999);
    this.helpContainer.setDepth(999);

    // 8秒後に自動で消す（邪魔になりにくくする）
    this.time.delayedCall(8000, () => {
      if (this.helpContainer?.visible) this.helpContainer.setVisible(false);
    });
  }

  private setScoreStatus(player?: Player) {
    if (!player) {
      this.scoreText.setText("SCORE: --\nDEATHS: --");
      return;
    }
    this.scoreText.setText(`SCORE: ${player.score}\nDEATHS: ${player.deaths}`);
  }

  create() {
    this.input.mouse?.disableContextMenu();

    // 左上HUD（カメラ固定＆最前面）
    this.netText = this.add
      .text(12, 12, "NET: CONNECTING", {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#ffffff",
        backgroundColor: "rgba(0,0,0,0.55)",
        padding: { x: 8, y: 6 },
      })
      .setScrollFactor(0)
      .setDepth(1000);

    this.scoreText = this.add
      .text(12, 48, "SCORE: --\nDEATHS: --", {
        fontFamily: "monospace",
        fontSize: "14px",
        color: "#ffffff",
        backgroundColor: "rgba(0,0,0,0.55)",
        padding: { x: 8, y: 6 },
        lineSpacing: 2,
      })
      .setScrollFactor(0)
      .setDepth(1000);

    // 操作説明オーバーレイ
    this.buildHelpOverlay();

    // Hでトグル（PhaserのKeyboard入力） :contentReference[oaicite:5]{index=5}
    this.input.keyboard?.on("keydown-H", () => {
      this.helpContainer.setVisible(!this.helpContainer.visible);
    });

    // 初期状態
    this.setNetStatus(socket.connected ? "CONNECTED" : "CONNECTING");
    this.setScoreStatus();

    // Socket.IO：接続/切断/エラー
    socket.on("connect", () => {
      this.meId = socket.id ?? null;
      this.setNetStatus(`CONNECTED (${this.shortId(this.meId)})`);
      if (nameConfirmed) {
        sendName(desiredName);
      }
    });

    socket.on("disconnect", (reason) => {
      this.meId = null;
      this.setNetStatus(`DISCONNECTED (${reason})`);
      this.setScoreStatus();
    });

    socket.on("connect_error", (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.setNetStatus(`CONNECT_ERROR (${msg})`);
    });

    // 再接続の進捗（Manager側イベント）
    socket.io.on("reconnect_attempt", (attempt: number) => {
      this.setNetStatus(`RECONNECTING (try ${attempt})`);
    });

    socket.io.on("reconnect", (attempt: number) => {
      this.meId = socket.id ?? null;
      this.setNetStatus(`RECONNECTED (try ${attempt}, ${this.shortId(this.meId)})`);
    });

    socket.io.on("reconnect_failed", () => {
      this.setNetStatus("RECONNECT_FAILED (reload)");
    });

    // ゲーム状態
    socket.on("state", (state: ServerState) => {
      const clientNow = Date.now();
      this.serverTimeOffsetMs = state.t - clientNow;
      this.lastServerState = state;
      this.stateBuffer.push(state);
      if (this.stateBuffer.length > 2) {
        this.stateBuffer.shift();
      }
      const me = state.players.find((player) => player.id === this.meId);
      this.setScoreStatus(me);
    });

    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      const me = this.players.get(this.meId ?? "");
      if (!me) return;

      const mx = p.worldX, my = p.worldY;
      const dx = mx - me.x, dy = my - me.y;
      const d = Math.hypot(dx, dy);

      if (d < 24) this.aiming = true;             // 自分の近く→AIM
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

  update() {
    if (!this.lastServerState) return;

    if (this.stateBuffer.length < 2) {
      this.syncPlayers(this.lastServerState.players);
      this.syncBullets(this.lastServerState.bullets);
      return;
    }

    const [prev, next] = this.stateBuffer;
    const nowServerTime = Date.now() + this.serverTimeOffsetMs;
    const span = next.t - prev.t;
    if (span <= 0) {
      this.syncPlayers(next.players);
      this.syncBullets(next.bullets);
      return;
    }

    const alpha = Phaser.Math.Clamp((nowServerTime - prev.t) / span, 0, 1);
    const prevPlayers = new Map(prev.players.map((player) => [player.id, player]));
    const prevBullets = new Map(prev.bullets.map((bullet) => [bullet.id, bullet]));

    const lerpedPlayers = next.players.map((player) => {
      const base = prevPlayers.get(player.id);
      if (!base) return player;
      return {
        ...player,
        x: Phaser.Math.Linear(base.x, player.x, alpha),
        y: Phaser.Math.Linear(base.y, player.y, alpha),
      };
    });

    const lerpedBullets = next.bullets.map((bullet) => {
      const base = prevBullets.get(bullet.id);
      if (!base) return bullet;
      return {
        ...bullet,
        x: Phaser.Math.Linear(base.x, bullet.x, alpha),
        y: Phaser.Math.Linear(base.y, bullet.y, alpha),
      };
    });

    this.syncPlayers(lerpedPlayers);
    this.syncBullets(lerpedBullets);
  }

  syncPlayers(list: Player[]) {
    const seen = new Set<string>();

    for (const pl of list) {
      seen.add(pl.id);

      let obj = this.players.get(pl.id);
      if (!obj) {
        const body = this.add.circle(0, 0, 14, 0x888888);
        const nameText = this.add
          .text(0, -34, pl.name ?? "Player", {
            fontFamily: "monospace",
            fontSize: "12px",
            color: "#ffffff",
          })
          .setOrigin(0.5);
        const hp = this.add.rectangle(0, -22, 34, 6, 0x00ff00).setOrigin(0.5);
        obj = this.add.container(pl.x, pl.y, [body, nameText, hp]);
        this.players.set(pl.id, obj);
      }

      obj.setPosition(pl.x, pl.y);

      const body = obj.list[0] as Phaser.GameObjects.Arc;
      body.setFillStyle(pl.id === this.meId ? 0x66aaff : 0x888888);

      const nameText = obj.list[1] as Phaser.GameObjects.Text;
      nameText.setText(pl.name ?? "Player");

      const hpBar = obj.list[2] as Phaser.GameObjects.Rectangle;
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

const startGame = () => {
  if (gameInstance) return;
  gameInstance = new Phaser.Game({
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    backgroundColor: "#111",
    scene: [GameScene],
  });
};
