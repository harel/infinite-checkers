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
  isPlayable,
  movesFrom,
  rankLabel,
  sameCoord,
  selectSquare,
} from "./game";

type Screen = "menu" | "play";

const app = document.querySelector<HTMLDivElement>("#app")!;

let screen: Screen = "menu";
let state: GameState | null = null;
let cpuThinking = false;

function startGame(mode: GameMode, human: Player = "red"): void {
  state = createGame(mode, human);
  screen = "play";
  cpuThinking = false;
  render();
  maybeCpuTurn();
}

function backToMenu(): void {
  state = null;
  screen = "menu";
  cpuThinking = false;
  render();
}

function onSquareClick(row: number, col: number): void {
  if (!state || state.status !== "playing" || cpuThinking) return;
  if (state.mode === "cpu" && state.turn !== state.humanPlayer) return;

  state = selectSquare(state, { row, col });
  render();
  maybeCpuTurn();
}

function maybeCpuTurn(): void {
  if (!state || state.status !== "playing") return;
  if (state.mode !== "cpu") return;
  if (state.turn === state.humanPlayer) return;

  cpuThinking = true;
  render();

  // Yield so the UI can paint "thinking"
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

function statusText(s: GameState): string {
  if (s.status === "red-wins") return "Red wins!";
  if (s.status === "black-wins") return "Black wins!";
  if (s.status === "draw") return "Draw.";

  if (cpuThinking) {
    return `<span class="cpu-thinking">CPU is thinking…</span>`;
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
  return s.turn === "red" ? "Red to move" : "Black to move";
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
    </div>
  `;
}

function renderBoard(s: GameState): string {
  const selectedMoves: Move[] = s.selected ? movesFrom(s, s.selected) : [];
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
  return `
    <div class="play">
      ${renderBoard(s)}
      <aside class="side">
        <div class="panel">
          <h1>Infinite Checkers</h1>
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
            <button class="btn" data-action="restart" type="button">Restart</button>
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
      </aside>
    </div>
  `;
}

function render(): void {
  if (screen === "menu" || !state) {
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
    if (!state) return;
    startGame(state.mode, state.humanPlayer);
  });
  app.querySelector<HTMLButtonElement>('[data-action="rematch"]')?.addEventListener("click", () => {
    if (!state) return;
    startGame(state.mode, state.humanPlayer);
  });
}

render();
