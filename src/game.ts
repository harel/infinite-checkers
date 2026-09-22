/** Infinite Checkers — toroidal board game engine */

export const BOARD_SIZE = 8;

export type Player = "red" | "black";
export type PieceKind = "man" | "queen";

export interface Piece {
  player: Player;
  kind: PieceKind;
}

export type Square = Piece | null;
export type Board = Square[][];

export interface Coord {
  row: number;
  col: number;
}

export interface JumpStep {
  from: Coord;
  to: Coord;
  captured: Coord;
}

export interface Move {
  from: Coord;
  to: Coord;
  path: Coord[];
  captures: Coord[];
}

export type GameMode = "pvp" | "cpu";

export interface GameState {
  board: Board;
  turn: Player;
  selected: Coord | null;
  legalMoves: Move[];
  status: "playing" | "red-wins" | "black-wins" | "draw";
  mode: GameMode;
  humanPlayer: Player;
  lastMove: Move | null;
  mustContinue: Coord | null;
}

const DIRS: Coord[] = [
  { row: -1, col: -1 },
  { row: -1, col: 1 },
  { row: 1, col: -1 },
  { row: 1, col: 1 },
];

export function wrap(n: number): number {
  return ((n % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE;
}

export function coordKey(c: Coord): string {
  return `${c.row},${c.col}`;
}

export function sameCoord(a: Coord, b: Coord): boolean {
  return a.row === b.row && a.col === b.col;
}

export function opponent(p: Player): Player {
  return p === "red" ? "black" : "red";
}

/** Dark playable squares: (row + col) is odd with row 0 at top. */
export function isPlayable(row: number, col: number): boolean {
  return (row + col) % 2 === 1;
}

export function createInitialBoard(): Board {
  const board: Board = Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => null),
  );

  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (!isPlayable(row, col)) continue;
      if (row <= 2) {
        board[row][col] = { player: "black", kind: "man" };
      } else if (row >= 5) {
        board[row][col] = { player: "red", kind: "man" };
      }
    }
  }
  return board;
}

export function cloneBoard(board: Board): Board {
  return board.map((row) => row.map((sq) => (sq ? { ...sq } : null)));
}

function getPiece(board: Board, c: Coord): Square {
  return board[wrap(c.row)][wrap(c.col)];
}

function setPiece(board: Board, c: Coord, piece: Square): void {
  board[wrap(c.row)][wrap(c.col)] = piece;
}

function forwardDirs(player: Player): Coord[] {
  // Red moves "up" (decreasing row), black moves "down" (increasing row)
  return player === "red"
    ? [
        { row: -1, col: -1 },
        { row: -1, col: 1 },
      ]
    : [
        { row: 1, col: -1 },
        { row: 1, col: 1 },
      ];
}

function promotionRow(player: Player): number {
  return player === "red" ? 0 : BOARD_SIZE - 1;
}

function maybePromote(piece: Piece, row: number): Piece {
  if (piece.kind === "queen") return piece;
  if (row === promotionRow(piece.player)) {
    return { player: piece.player, kind: "queen" };
  }
  return piece;
}

/**
 * Man: quiet diagonal steps forward only.
 * Columns may wrap (A3 → H4), but rows must not — otherwise a man on
 * its back rank could step "around" onto the promotion rank and queen
 * without crossing the board. Backward / row-wrap travel is capture-only.
 */
function manQuietMoves(board: Board, from: Coord, player: Player): Move[] {
  const moves: Move[] = [];
  for (const d of forwardDirs(player)) {
    const rawRow = from.row + d.row;
    const rawCol = from.col + d.col;
    if (rawRow < 0 || rawRow >= BOARD_SIZE) continue;
    const to = { row: rawRow, col: wrap(rawCol) };
    if (!getPiece(board, to)) {
      moves.push({ from, to, path: [from, to], captures: [] });
    }
  }
  return moves;
}

/**
 * Queen (flying): slide any number of empty diagonals, wrapping at most
 * one full board cycle (BOARD_SIZE - 1 steps) so we don't loop forever.
 */
function queenQuietMoves(board: Board, from: Coord): Move[] {
  const moves: Move[] = [];
  for (const d of DIRS) {
    for (let dist = 1; dist < BOARD_SIZE; dist++) {
      const to = {
        row: wrap(from.row + d.row * dist),
        col: wrap(from.col + d.col * dist),
      };
      if (sameCoord(to, from)) break;
      if (getPiece(board, to)) break;
      moves.push({ from, to, path: [from, to], captures: [] });
    }
  }
  return moves;
}

/**
 * Man capture: jump adjacent enemy onto empty landing (wrap-aware).
 * Multi-jumps explored recursively.
 */
function manCapturesFrom(
  board: Board,
  from: Coord,
  player: Player,
  capturedSoFar: Coord[],
  path: Coord[],
): Move[] {
  const results: Move[] = [];
  let found = false;

  // Captures allowed in all diagonal directions (standard checkers)
  for (const d of DIRS) {
    const mid = { row: wrap(from.row + d.row), col: wrap(from.col + d.col) };
    const land = {
      row: wrap(from.row + d.row * 2),
      col: wrap(from.col + d.col * 2),
    };

    const victim = getPiece(board, mid);
    if (!victim || victim.player === player) continue;
    if (capturedSoFar.some((c) => sameCoord(c, mid))) continue;
    if (getPiece(board, land)) continue;
    // Don't land on a square already in the capture path (except start is ok after wrap loops — block revisit)
    if (path.some((c) => sameCoord(c, land))) continue;

    found = true;
    const nextBoard = cloneBoard(board);
    const piece = getPiece(nextBoard, from)!;
    setPiece(nextBoard, from, null);
    setPiece(nextBoard, mid, null);
    setPiece(nextBoard, land, piece);

    const nextCaptured = [...capturedSoFar, mid];
    const nextPath = [...path, land];
    const continuations = manCapturesFrom(
      nextBoard,
      land,
      player,
      nextCaptured,
      nextPath,
    );

    if (continuations.length === 0) {
      results.push({
        from: path[0],
        to: land,
        path: nextPath,
        captures: nextCaptured,
      });
    } else {
      results.push(...continuations);
    }
  }

  if (!found && capturedSoFar.length > 0) {
    results.push({
      from: path[0],
      to: from,
      path,
      captures: capturedSoFar,
    });
  }

  return results;
}

/**
 * Queen capture (flying): approach along a diagonal, jump one enemy,
 * land on any empty square beyond (wrap-aware), then continue.
 */
function queenCapturesFrom(
  board: Board,
  from: Coord,
  player: Player,
  capturedSoFar: Coord[],
  path: Coord[],
): Move[] {
  const results: Move[] = [];
  let found = false;

  for (const d of DIRS) {
    let enemy: Coord | null = null;
    // Scan for first piece along this diagonal
    for (let dist = 1; dist < BOARD_SIZE; dist++) {
      const sq = {
        row: wrap(from.row + d.row * dist),
        col: wrap(from.col + d.col * dist),
      };
      if (sameCoord(sq, from)) break;

      const piece = getPiece(board, sq);
      if (!piece) continue;

      if (piece.player === player) break;
      if (capturedSoFar.some((c) => sameCoord(c, sq))) break;
      enemy = sq;
      // Look for landing squares beyond the enemy
      for (let landDist = dist + 1; landDist < BOARD_SIZE + dist; landDist++) {
        const land = {
          row: wrap(from.row + d.row * landDist),
          col: wrap(from.col + d.col * landDist),
        };
        if (sameCoord(land, from) || sameCoord(land, enemy)) break;
        if (getPiece(board, land)) break;
        if (path.some((c) => sameCoord(c, land))) continue;

        found = true;
        const nextBoard = cloneBoard(board);
        const mover = getPiece(nextBoard, from)!;
        setPiece(nextBoard, from, null);
        setPiece(nextBoard, enemy, null);
        setPiece(nextBoard, land, mover);

        const nextCaptured = [...capturedSoFar, enemy];
        const nextPath = [...path, land];
        const continuations = queenCapturesFrom(
          nextBoard,
          land,
          player,
          nextCaptured,
          nextPath,
        );

        if (continuations.length === 0) {
          results.push({
            from: path[0],
            to: land,
            path: nextPath,
            captures: nextCaptured,
          });
        } else {
          results.push(...continuations);
        }
      }
      break;
    }
  }

  if (!found && capturedSoFar.length > 0) {
    results.push({
      from: path[0],
      to: from,
      path,
      captures: capturedSoFar,
    });
  }

  return results;
}

export function getCapturesForPiece(board: Board, from: Coord): Move[] {
  const piece = getPiece(board, from);
  if (!piece) return [];
  if (piece.kind === "queen") {
    return queenCapturesFrom(board, from, piece.player, [], [from]);
  }
  return manCapturesFrom(board, from, piece.player, [], [from]);
}

export function getQuietMovesForPiece(board: Board, from: Coord): Move[] {
  const piece = getPiece(board, from);
  if (!piece) return [];
  if (piece.kind === "queen") return queenQuietMoves(board, from);
  return manQuietMoves(board, from, piece.player);
}

export function getAllMoves(board: Board, player: Player): Move[] {
  const captures: Move[] = [];
  const quiet: Move[] = [];

  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const piece = board[row][col];
      if (!piece || piece.player !== player) continue;
      const from = { row, col };
      captures.push(...getCapturesForPiece(board, from));
      quiet.push(...getQuietMovesForPiece(board, from));
    }
  }

  // Captures are mandatory when available
  return captures.length > 0 ? captures : quiet;
}

export function applyMove(board: Board, move: Move): Board {
  const next = cloneBoard(board);
  const piece = getPiece(next, move.from);
  if (!piece) return next;

  setPiece(next, move.from, null);
  for (const cap of move.captures) {
    setPiece(next, cap, null);
  }
  const promoted = maybePromote(piece, move.to.row);
  // If a man captures onto the promotion row mid-sequence in some rules
  // they promote immediately; we promote only at final landing for simplicity,
  // unless the final square is the promotion row.
  setPiece(next, move.to, promoted);
  return next;
}

export function countPieces(board: Board, player: Player): number {
  let n = 0;
  for (const row of board) {
    for (const sq of row) {
      if (sq?.player === player) n++;
    }
  }
  return n;
}

export function createGame(mode: GameMode, humanPlayer: Player = "red"): GameState {
  const board = createInitialBoard();
  const turn: Player = "red";
  return {
    board,
    turn,
    selected: null,
    legalMoves: getAllMoves(board, turn),
    status: "playing",
    mode,
    humanPlayer,
    lastMove: null,
    mustContinue: null,
  };
}

export function movesFrom(state: GameState, from: Coord): Move[] {
  return state.legalMoves.filter((m) => sameCoord(m.from, from));
}

export function selectSquare(state: GameState, coord: Coord): GameState {
  if (state.status !== "playing") return state;

  const piece = state.board[coord.row][coord.col];
  if (piece && piece.player === state.turn) {
    const fromMoves = movesFrom(state, coord);
    if (fromMoves.length === 0) {
      return { ...state, selected: null };
    }
    return { ...state, selected: coord };
  }

  if (!state.selected) return state;

  const candidates = movesFrom(state, state.selected).filter((m) =>
    sameCoord(m.to, coord),
  );
  if (candidates.length === 0) {
    // Click elsewhere: deselect or select other piece
    if (piece && piece.player === state.turn) {
      return selectSquare({ ...state, selected: null }, coord);
    }
    return { ...state, selected: null };
  }

  // Prefer longest capture if multiple landings match
  candidates.sort((a, b) => b.captures.length - a.captures.length);
  return commitMove(state, candidates[0]);
}

export function commitMove(state: GameState, move: Move): GameState {
  const board = applyMove(state.board, move);
  const nextTurn = opponent(state.turn);
  const nextMoves = getAllMoves(board, nextTurn);

  let status: GameState["status"] = "playing";
  if (countPieces(board, nextTurn) === 0 || nextMoves.length === 0) {
    status = state.turn === "red" ? "red-wins" : "black-wins";
  }

  return {
    ...state,
    board,
    turn: status === "playing" ? nextTurn : state.turn,
    selected: null,
    legalMoves: status === "playing" ? nextMoves : [],
    status,
    lastMove: move,
    mustContinue: null,
  };
}

/** Simple material + mobility heuristic for CPU. */
export function evaluate(board: Board, perspective: Player): number {
  let score = 0;
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const p = board[row][col];
      if (!p) continue;
      const value = p.kind === "queen" ? 4.5 : 1;
      // Slight preference for central-ish / advanced men
      const advance =
        p.player === "red" ? BOARD_SIZE - 1 - row : row;
      const bonus = p.kind === "man" ? advance * 0.08 : 0.2;
      const s = value + bonus;
      score += p.player === perspective ? s : -s;
    }
  }
  score += getAllMoves(board, perspective).length * 0.05;
  score -= getAllMoves(board, opponent(perspective)).length * 0.05;
  return score;
}

export function chooseCpuMove(
  state: GameState,
  depth = 4,
): Move | null {
  const moves = state.legalMoves;
  if (moves.length === 0) return null;

  const me = state.turn;
  let best: Move = moves[0];
  let bestScore = -Infinity;

  // Shuffle lightly for variety among equal scores
  const ordered = [...moves].sort(() => Math.random() - 0.5);

  for (const move of ordered) {
    const board = applyMove(state.board, move);
    const score = -negamax(board, opponent(me), depth - 1, -Infinity, Infinity, me);
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best;
}

function negamax(
  board: Board,
  turn: Player,
  depth: number,
  alpha: number,
  beta: number,
  root: Player,
): number {
  const moves = getAllMoves(board, turn);
  if (depth === 0 || moves.length === 0) {
    if (moves.length === 0) {
      // Side to move loses
      return turn === root ? -1000 - depth : 1000 + depth;
    }
    return (turn === root ? 1 : -1) * evaluate(board, root);
  }

  let best = -Infinity;
  for (const move of moves) {
    const next = applyMove(board, move);
    const score = -negamax(next, opponent(turn), depth - 1, -beta, -alpha, root);
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return best;
}

export function fileLabel(col: number): string {
  return String.fromCharCode(65 + col); // A-H
}

export function rankLabel(row: number): string {
  return String(BOARD_SIZE - row); // 8 at top
}
