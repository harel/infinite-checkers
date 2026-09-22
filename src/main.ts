import "./style.css";
import {
  BOARD_SIZE,
  GameMode,
  GameState,
  Move,
  Player,
  chooseCpuMove,
  commitMove,
  coordKey,
  createGame,
  fileLabel,
  findLegalMove,
  fromWireState,
  isPlayable,
  movesFrom,
  rankLabel,
  sameCoord,
  selectSquareResult,
} from "./game";
import {
  ConnectionStatus,
  OnlineSession,
  clearRoomFromUrl,
  roomCodeFromUrl,
  roomLink,
} from "./online";

type Screen = "menu" | "online-lobby" | "play";

const app = document.querySelector<HTMLDivElement>("#app")!;

let screen: Screen = "menu";
let state: GameState | null = null;
let cpuThinking = false;
let online: OnlineSession | null = null;
let onlineStatus: ConnectionStatus = "idle";
let onlineDetail = "";
let lobbyMode: "create" | "join" = "create";
let joinCodeInput = "";
let copyFeedback = "";

function myOnlineColor(): Player | null {
  if (!online) return null;
  return online.role === "host" ? "red" : "black";
}

function isMyOnlineTurn(): boolean {
  if (!state || !online) return false;
  return state.turn === myOnlineColor();
}

function destroyOnline(): void {
  online?.destroy();
  online = null;
  onlineStatus = "idle";
  onlineDetail = "";
  copyFeedback = "";
}

function startGame(mode: GameMode, human: Player = "red"): void {
  if (mode !== "online") destroyOnline();
  state = createGame(mode, human);
  screen = "play";
  cpuThinking = false;
  render();
  maybeCpuTurn();
}

function backToMenu(): void {
  destroyOnline();
  clearRoomFromUrl();
  state = null;
  screen = "menu";
  cpuThinking = false;
  joinCodeInput = "";
  render();
}

function openOnlineLobby(mode: "create" | "join", presetCode = ""): void {
  destroyOnline();
  lobbyMode = mode;
  joinCodeInput = presetCode;
  screen = "online-lobby";
  onlineStatus = "idle";
  onlineDetail = "";
  render();

  if (mode === "create") {
    beginHost();
  }
}

function beginHost(): void {
  state = createGame("online", "red");
  online = OnlineSession.host({
    onStatus: handleOnlineStatus,
    onMessage: handleOnlineMessage,
  });
}

function beginGuest(code: string): void {
  online = OnlineSession.join(code, {
    onStatus: handleOnlineStatus,
    onMessage: handleOnlineMessage,
  });
}

function handleOnlineStatus(status: ConnectionStatus, detail = ""): void {
  onlineStatus = status;
  onlineDetail = detail;
  if (status === "error" || status === "disconnected") {
    render();
    return;
  }
  if (status === "connected" && online?.role === "host" && state) {
    // Wait for hello before welcome — still re-render lobby/play
  }
  render();
}

function handleOnlineMessage(msg: import("./online").OnlineMessage): void {
  if (!online) return;

  switch (msg.type) {
    case "hello":
      if (online.role === "host" && state) {
        online.sendWelcome(state);
        screen = "play";
        render();
      }
      break;
    case "welcome":
      if (online.role === "guest") {
        state = fromWireState(msg.state, "online", "black");
        screen = "play";
        clearRoomFromUrl();
        render();
      }
      break;
    case "state":
      if (state) {
        const human = myOnlineColor() ?? state.humanPlayer;
        state = fromWireState(msg.state, "online", human);
        screen = "play";
        render();
      }
      break;
    case "move":
      if (online.role === "host" && state) {
        applyHostRemoteMove(msg.move);
      }
      break;
    case "rematch":
      if (online.role === "host") {
        state = createGame("online", "red");
        online.sendState(state);
        screen = "play";
        render();
      }
      break;
    case "resync":
      if (online.role === "host" && state) {
        online.sendState(state);
      }
      break;
    case "bye":
      onlineStatus = "disconnected";
      onlineDetail = "Opponent left.";
      render();
      break;
    case "reject":
      onlineStatus = "error";
      onlineDetail = msg.reason;
      destroyOnline();
      render();
      break;
  }
}

function applyHostRemoteMove(move: Move): void {
  if (!state || !online || online.role !== "host") return;
  if (state.turn !== "black") return;
  const legal = findLegalMove(state, move);
  if (!legal) {
    online.sendState(state);
    return;
  }
  state = commitMove(state, legal);
  online.sendState(state);
  render();
}

function onSquareClick(row: number, col: number): void {
  if (!state || state.status !== "playing" || cpuThinking) return;
  if (state.mode === "cpu" && state.turn !== state.humanPlayer) return;
  if (state.mode === "online") {
    if (onlineStatus !== "connected" || !online) return;
    if (!isMyOnlineTurn()) return;
  }

  const result = selectSquareResult(state, { row, col });

  if (state.mode === "online" && online && result.move) {
    if (online.role === "host") {
      state = result.state;
      online.sendState(state);
      render();
      return;
    }
    // Guest: send move, clear local selection; wait for host state
    online.sendMove(result.move);
    state = { ...state, selected: null };
    render();
    return;
  }

  state = result.state;
  render();
  maybeCpuTurn();
}

function maybeCpuTurn(): void {
  if (!state || state.status !== "playing") return;
  if (state.mode !== "cpu") return;
  if (state.turn === state.humanPlayer) return;

  cpuThinking = true;
  render();

  window.setTimeout(() => {
    if (!state) return;
    const move = chooseCpuMove(state, 3);
    if (move) {
      state = commitMove(state, move);
    }
    cpuThinking = false;
    render();
  }, 380);
}

function requestOnlineRematch(): void {
  if (!online || !state) return;
  if (online.role === "host") {
    state = createGame("online", "red");
    online.sendState(state);
    render();
  } else {
    online.sendMessage({ type: "rematch" });
  }
}

function statusText(s: GameState): string {
  if (s.status === "red-wins") return "Red wins!";
  if (s.status === "black-wins") return "Black wins!";
  if (s.status === "draw") return "Draw.";

  if (s.mode === "online" && onlineStatus !== "connected") {
    return onlineDetail || "Waiting for connection…";
  }

  if (cpuThinking) {
    return `<span class="cpu-thinking">CPU is thinking…</span>`;
  }

  if (s.mode === "online" && !isMyOnlineTurn()) {
    return "Waiting for opponent…";
  }

  const hasCaptures = s.legalMoves.some((m) => m.captures.length > 0);
  if (hasCaptures) {
    return "Capture available — jumps are mandatory (backward + wrap OK).";
  }
  return "Men move forward; sides wrap. No top/bottom wrap unless capturing.";
}

function turnName(s: GameState): string {
  if (s.mode === "cpu") {
    if (s.turn === s.humanPlayer) return "Your turn";
    return "CPU's turn";
  }
  if (s.mode === "online") {
    if (isMyOnlineTurn()) return "Your turn";
    return "Opponent's turn";
  }
  return s.turn === "red" ? "Red to move" : "Black to move";
}

function connectionBadge(): string {
  if (!online) return "";
  const label =
    onlineStatus === "connected"
      ? "Online"
      : onlineStatus === "waiting"
        ? "Waiting"
        : onlineStatus === "connecting"
          ? "Connecting"
          : onlineStatus === "disconnected"
            ? "Disconnected"
            : onlineStatus === "error"
              ? "Error"
              : "Online";
  return `<span class="conn-badge ${onlineStatus}" title="${escapeAttr(onlineDetail)}">${label}</span>`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function renderCredits(): string {
  return `
    <footer class="credits">
      Game conceived by Harel Malka &amp; Amit Shani.
      Created by Harel Malka @ <a href="https://ourea.io" target="_blank" rel="noopener noreferrer">Ourea</a>.
    </footer>
  `;
}

function renderMenu(): string {
  return `
    <div class="screen">
      <header class="hero">
        <h1 class="brand">Infinite Checkers</h1>
        <p class="tagline">
          Classic checkers on a board that never ends — step off one edge,
          arrive on the other. Queens fly the long way around.
        </p>
      </header>
      <div class="mode-grid">
        <button class="mode-card" data-action="online-create" type="button">
          <h2>Play online</h2>
          <p>Create a room and share a code with a friend. You play Red.</p>
        </button>
        <button class="mode-card" data-action="online-join" type="button">
          <h2>Join room</h2>
          <p>Enter a room code to play Black against the host.</p>
        </button>
        <button class="mode-card" data-mode="pvp" type="button">
          <h2>Two players</h2>
          <p>Pass-and-play on one screen. Red moves first.</p>
        </button>
        <button class="mode-card" data-mode="cpu" data-color="red" type="button">
          <h2>vs CPU — play Red</h2>
          <p>You start. The CPU plays Black with a short look-ahead.</p>
        </button>
        <button class="mode-card" data-mode="cpu" data-color="black" type="button">
          <h2>vs CPU — play Black</h2>
          <p>CPU opens as Red. Good for a tougher first move.</p>
        </button>
      </div>
      <aside class="rules">
        <strong>House rules.</strong>
        Men move forward diagonally; they only go backward when capturing.
        Columns wrap (A3 → H4), but you can’t wrap the long way around to queen
        yourself. Captures wrap freely. Reach the far rank across the board to
        promote. Queens slide any distance. Captures are mandatory.
      </aside>
      ${renderCredits()}
    </div>
  `;
}

function renderOnlineLobby(): string {
  if (lobbyMode === "create") {
    const code = online?.roomCode ?? "······";
    const link = online ? roomLink(online.roomCode) : "";
    return `
      <div class="screen lobby">
        <header class="hero">
          <h1 class="brand">Online room</h1>
          <p class="tagline">Share this code or link. Keep this tab open — you’re the host (Red).</p>
        </header>
        <div class="panel lobby-panel">
          <p class="lobby-label">Room code</p>
          <p class="room-code" aria-live="polite">${code}</p>
          <div class="actions">
            <button class="btn primary" data-action="copy-code" type="button" ${online ? "" : "disabled"}>Copy code</button>
            <button class="btn" data-action="copy-link" type="button" ${online ? "" : "disabled"}>Copy link</button>
          </div>
          ${copyFeedback ? `<p class="copy-feedback">${copyFeedback}</p>` : ""}
          <p class="status-line">${onlineDetail || statusForLobby()}</p>
          ${link ? `<p class="lobby-link"><code>${link}</code></p>` : ""}
          <div class="actions lobby-cancel">
            <button class="btn" data-action="menu" type="button">Cancel</button>
          </div>
        </div>
        ${renderCredits()}
      </div>
    `;
  }

  return `
    <div class="screen lobby">
      <header class="hero">
        <h1 class="brand">Join room</h1>
        <p class="tagline">Enter the host’s room code. You’ll play Black.</p>
      </header>
      <div class="panel lobby-panel">
        <label class="lobby-label" for="room-code-input">Room code</label>
        <input id="room-code-input" class="room-input" type="text" maxlength="8" autocomplete="off" spellcheck="false" value="${escapeAttr(joinCodeInput)}" placeholder="e.g. K7M2QX" />
        <div class="actions">
          <button class="btn primary" data-action="join-submit" type="button">Join</button>
          <button class="btn" data-action="menu" type="button">Cancel</button>
        </div>
        <p class="status-line ${onlineStatus === "error" ? "win" : ""}">${onlineDetail || statusForLobby()}</p>
      </div>
      ${renderCredits()}
    </div>
  `;
}

function statusForLobby(): string {
  if (onlineStatus === "connecting") return "Connecting…";
  if (onlineStatus === "waiting") return "Waiting for opponent to join…";
  if (onlineStatus === "connected") return "Connected!";
  if (onlineStatus === "error") return onlineDetail || "Something went wrong.";
  return "";
}

function renderBoard(s: GameState): string {
  const canInteract =
    s.mode !== "online" ||
    (onlineStatus === "connected" && isMyOnlineTurn() && s.status === "playing");
  const selectedMoves: Move[] =
    canInteract && s.selected ? movesFrom(s, s.selected) : [];
  const hintKeys = new Set(selectedMoves.map((m) => coordKey(m.to)));
  const captureHints = new Set(
    selectedMoves.filter((m) => m.captures.length > 0).map((m) => coordKey(m.to)),
  );
  const lastFrom = s.lastMove ? coordKey(s.lastMove.from) : null;
  const lastTo = s.lastMove ? coordKey(s.lastMove.to) : null;
  const lastCaps = new Set((s.lastMove?.captures ?? []).map(coordKey));

  let cells = "";
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const key = coordKey({ row, col });
      const playable = isPlayable(row, col);
      const piece = s.board[row][col];
      const classes = [
        "square",
        playable ? "dark" : "light",
        col === 0 || col === BOARD_SIZE - 1 ? "edge-col" : "",
        row === 0 || row === BOARD_SIZE - 1 ? "edge-row" : "",
        s.selected && sameCoord(s.selected, { row, col }) ? "selected" : "",
        hintKeys.has(key) ? "hint" : "",
        captureHints.has(key) ? "capture" : "",
        lastFrom === key ? "last-from" : "",
        lastTo === key ? "last-to" : "",
      ]
        .filter(Boolean)
        .join(" ");

      const aria = `${fileLabel(col)}${rankLabel(row)}`;
      let inner = "";
      if (lastCaps.has(key)) {
        inner += `<span class="capture-trail" aria-hidden="true"></span>`;
      }
      if (piece) {
        inner += `<span class="piece ${piece.player}${piece.kind === "queen" ? " queen" : ""}" aria-hidden="true"></span>`;
      }

      cells += `<button type="button" class="${classes}" data-row="${row}" data-col="${col}" aria-label="${aria}"${playable ? "" : ' tabindex="-1"'}>${inner}</button>`;
    }
  }

  const files = Array.from({ length: BOARD_SIZE }, (_, i) => fileLabel(i))
    .map((f) => `<span>${f}</span>`)
    .join("");

  return `
    <div class="board-shell">
      <div class="board-wrap-hint" aria-hidden="true"></div>
      <div class="board" role="grid" aria-label="Checkers board">${cells}</div>
      <div class="labels">${files}</div>
    </div>
  `;
}

function renderPlay(s: GameState): string {
  const win = s.status !== "playing";
  const onlineMeta =
    s.mode === "online" && online
      ? `<p class="online-meta">You are ${myOnlineColor()} · Room ${online.roomCode} ${connectionBadge()}</p>`
      : "";

  return `
    <div class="play">
      ${renderBoard(s)}
      <aside class="side">
        <div class="panel">
          <h1>Infinite Checkers</h1>
          ${onlineMeta}
          <div class="turn-row">
            <span class="turn-dot ${s.turn}" aria-hidden="true"></span>
            <span class="turn-label">${turnName(s)}</span>
          </div>
          <p class="status-line ${win ? "win" : ""}">${statusText(s)}</p>
          <div class="actions">
            ${
              win
                ? `<button class="btn primary" data-action="rematch" type="button">Rematch</button>`
                : ""
            }
            <button class="btn" data-action="menu" type="button">Main menu</button>
            ${
              s.mode !== "online"
                ? `<button class="btn" data-action="restart" type="button">Restart</button>`
                : ""
            }
          </div>
        </div>
        <div class="panel">
          <dl class="legend">
            <dt>Wrap</dt>
            <dd>Side edges wrap for steps (A3 → H4). Men can’t wrap top/bottom to sneak a queen.</dd>
            <dt>Queens</dt>
            <dd>Slide any number of empty diagonals — including around the board.</dd>
            <dt>Captures</dt>
            <dd>Jumps may go backward and wrap freely. Chain them when you can.</dd>
          </dl>
        </div>
        ${renderCredits()}
      </aside>
    </div>
  `;
}

function render(): void {
  if (screen === "menu") {
    app.innerHTML = renderMenu();
    bindMenu();
    return;
  }
  if (screen === "online-lobby") {
    app.innerHTML = renderOnlineLobby();
    bindLobby();
    return;
  }
  if (!state) {
    screen = "menu";
    app.innerHTML = renderMenu();
    bindMenu();
    return;
  }
  app.innerHTML = renderPlay(state);
  bindPlay();
}

function bindMenu(): void {
  app.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode as GameMode;
      const color = (btn.dataset.color as Player | undefined) ?? "red";
      startGame(mode, color);
    });
  });
  app
    .querySelector<HTMLButtonElement>('[data-action="online-create"]')
    ?.addEventListener("click", () => openOnlineLobby("create"));
  app
    .querySelector<HTMLButtonElement>('[data-action="online-join"]')
    ?.addEventListener("click", () => openOnlineLobby("join"));
}

function bindLobby(): void {
  app.querySelector<HTMLButtonElement>('[data-action="menu"]')?.addEventListener("click", backToMenu);

  app.querySelector<HTMLButtonElement>('[data-action="copy-code"]')?.addEventListener("click", async () => {
    if (!online) return;
    await copyText(online.roomCode);
    copyFeedback = "Code copied.";
    render();
  });

  app.querySelector<HTMLButtonElement>('[data-action="copy-link"]')?.addEventListener("click", async () => {
    if (!online) return;
    await copyText(roomLink(online.roomCode));
    copyFeedback = "Link copied.";
    render();
  });

  const input = app.querySelector<HTMLInputElement>("#room-code-input");
  input?.addEventListener("input", () => {
    joinCodeInput = input.value.toUpperCase();
  });
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitJoin();
  });

  app.querySelector<HTMLButtonElement>('[data-action="join-submit"]')?.addEventListener("click", submitJoin);
}

function submitJoin(): void {
  const code = joinCodeInput.trim();
  if (code.length < 4) {
    onlineDetail = "Enter the full room code.";
    onlineStatus = "error";
    render();
    return;
  }
  destroyOnline();
  onlineStatus = "connecting";
  onlineDetail = "Connecting to host…";
  render();
  beginGuest(code);
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

function bindPlay(): void {
  app.querySelectorAll<HTMLButtonElement>(".square.dark").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = Number(btn.dataset.row);
      const col = Number(btn.dataset.col);
      onSquareClick(row, col);
    });
  });

  app.querySelector<HTMLButtonElement>('[data-action="menu"]')?.addEventListener("click", backToMenu);
  app.querySelector<HTMLButtonElement>('[data-action="restart"]')?.addEventListener("click", () => {
    if (!state || state.mode === "online") return;
    startGame(state.mode, state.humanPlayer);
  });
  app.querySelector<HTMLButtonElement>('[data-action="rematch"]')?.addEventListener("click", () => {
    if (!state) return;
    if (state.mode === "online") {
      requestOnlineRematch();
      return;
    }
    startGame(state.mode, state.humanPlayer);
  });
}

// Deep-link: ?room=CODE
const bootRoom = roomCodeFromUrl();
if (bootRoom) {
  openOnlineLobby("join", bootRoom);
  beginGuest(bootRoom);
} else {
  render();
}
