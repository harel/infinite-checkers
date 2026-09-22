import Peer, { type DataConnection, type PeerError } from "peerjs";
import type { GameState, Move, WireState } from "./game";

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "waiting"
  | "connected"
  | "disconnected"
  | "error";

export type OnlineRole = "host" | "guest";

export type OnlineMessage =
  | { type: "hello" }
  | { type: "welcome"; state: WireState }
  | { type: "move"; move: Move }
  | { type: "state"; state: WireState }
  | { type: "resync" }
  | { type: "rematch" }
  | { type: "bye" }
  | { type: "reject"; reason: string };

export interface OnlineSessionCallbacks {
  onStatus: (status: ConnectionStatus, detail?: string) => void;
  onMessage: (msg: OnlineMessage) => void;
}

const ROOM_PREFIX = "ic-";
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateRoomCode(length = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return code;
}

export function normalizeRoomCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function peerIdFromCode(code: string): string {
  return `${ROOM_PREFIX}${normalizeRoomCode(code)}`;
}

export function codeFromPeerId(peerId: string): string {
  return peerId.startsWith(ROOM_PREFIX)
    ? peerId.slice(ROOM_PREFIX.length)
    : peerId;
}

export function roomLink(code: string): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("room", normalizeRoomCode(code));
  return url.toString();
}

export function roomCodeFromUrl(): string | null {
  const code = new URLSearchParams(window.location.search).get("room");
  if (!code) return null;
  const normalized = normalizeRoomCode(code);
  return normalized.length >= 4 ? normalized : null;
}

export function clearRoomFromUrl(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("room")) return;
  url.searchParams.delete("room");
  window.history.replaceState({}, "", url.pathname + url.search + url.hash);
}

function send(conn: DataConnection, msg: OnlineMessage): void {
  if (!conn.open) return;
  conn.send(msg);
}

export class OnlineSession {
  readonly role: OnlineRole;
  readonly roomCode: string;
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private readonly callbacks: OnlineSessionCallbacks;
  private closed = false;

  private constructor(
    role: OnlineRole,
    roomCode: string,
    callbacks: OnlineSessionCallbacks,
  ) {
    this.role = role;
    this.roomCode = normalizeRoomCode(roomCode);
    this.callbacks = callbacks;
  }

  static host(callbacks: OnlineSessionCallbacks): OnlineSession {
    const code = generateRoomCode();
    const session = new OnlineSession("host", code, callbacks);
    session.startHost();
    return session;
  }

  static join(code: string, callbacks: OnlineSessionCallbacks): OnlineSession {
    const session = new OnlineSession("guest", code, callbacks);
    session.startGuest();
    return session;
  }

  get connected(): boolean {
    return this.conn?.open === true;
  }

  sendMessage(msg: OnlineMessage): void {
    if (!this.conn) return;
    send(this.conn, msg);
  }

  sendState(state: GameState): void {
    this.sendMessage({ type: "state", state: wireFromGame(state) });
  }

  sendWelcome(state: GameState): void {
    this.sendMessage({ type: "welcome", state: wireFromGame(state) });
  }

  sendMove(move: Move): void {
    this.sendMessage({ type: "move", move });
  }

  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      if (this.conn?.open) send(this.conn, { type: "bye" });
    } catch {
      /* ignore */
    }
    this.conn?.close();
    this.peer?.destroy();
    this.conn = null;
    this.peer = null;
  }

  private startHost(): void {
    this.callbacks.onStatus("connecting", "Opening room…");
    const peer = new Peer(peerIdFromCode(this.roomCode), {
      debug: 0,
    });
    this.peer = peer;

    peer.on("open", () => {
      if (this.closed) return;
      this.callbacks.onStatus("waiting", "Share the room code and wait for a friend.");
    });

    peer.on("connection", (conn) => {
      if (this.closed) return;
      if (this.conn?.open) {
        // Only one guest
        conn.on("open", () => {
          send(conn, { type: "reject", reason: "Room is full." });
          window.setTimeout(() => conn.close(), 200);
        });
        return;
      }
      this.attachConnection(conn);
    });

    peer.on("error", (err) => this.handlePeerError(err));
    peer.on("disconnected", () => {
      if (this.closed) return;
      this.callbacks.onStatus("disconnected", "Lost connection to signaling. Reconnecting…");
      peer.reconnect();
    });
  }

  private startGuest(): void {
    this.callbacks.onStatus("connecting", "Looking up room…");
    const peer = new Peer({ debug: 0 });
    this.peer = peer;

    peer.on("open", () => {
      if (this.closed) return;
      const conn = peer.connect(peerIdFromCode(this.roomCode), {
        reliable: true,
      });
      this.attachConnection(conn);
    });

    peer.on("error", (err) => this.handlePeerError(err));
    peer.on("disconnected", () => {
      if (this.closed) return;
      this.callbacks.onStatus("disconnected", "Lost connection to signaling.");
    });
  }

  private attachConnection(conn: DataConnection): void {
    this.conn = conn;

    conn.on("open", () => {
      if (this.closed) return;
      this.callbacks.onStatus("connected");
      if (this.role === "guest") {
        send(conn, { type: "hello" });
      }
    });

    conn.on("data", (data) => {
      if (this.closed) return;
      const msg = parseMessage(data);
      if (!msg) return;
      this.callbacks.onMessage(msg);
    });

    conn.on("close", () => {
      if (this.closed) return;
      this.callbacks.onStatus("disconnected", "Opponent disconnected.");
    });

    conn.on("error", () => {
      if (this.closed) return;
      this.callbacks.onStatus("error", "Connection error.");
    });
  }

  private handlePeerError(err: PeerError<string>): void {
    if (this.closed) return;
    const type = err.type;
    if (type === "unavailable-id") {
      this.callbacks.onStatus("error", "Room code already in use. Try creating again.");
      return;
    }
    if (type === "peer-unavailable") {
      this.callbacks.onStatus("error", "Room not found. Check the code — host must keep their tab open.");
      return;
    }
    if (type === "network" || type === "disconnected") {
      this.callbacks.onStatus("disconnected", "Network issue.");
      return;
    }
    this.callbacks.onStatus("error", err.message || "Connection failed.");
  }
}

function wireFromGame(state: GameState): WireState {
  return {
    board: state.board,
    turn: state.turn,
    status: state.status,
    lastMove: state.lastMove,
  };
}

function parseMessage(data: unknown): OnlineMessage | null {
  if (!data || typeof data !== "object") return null;
  const msg = data as OnlineMessage;
  if (typeof msg.type !== "string") return null;
  return msg;
}
