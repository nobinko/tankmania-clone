import { io } from "socket.io-client";

export function connectSocket() {
  // DEVは別ポートのサーバへ / PRODは同一オリジンへ（Render）
  const url = import.meta.env.DEV ? "http://localhost:3000" : undefined;
  return io(url);
}
