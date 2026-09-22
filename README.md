# Infinite Checkers

When I was younger, much much younger than today, me and my friend Amit came up with this game to make checkers a bit more interesting. One can have a perfectly regular game until the board empties and things start to flip...

A browser prototype of wraparound checkers: the board is a torus. Step (or jump) off one edge and you continue on the opposite side — e.g. **A3 → H4**.

## Rules (this build)

- Standard starting setup; Red moves first
- Men move forward diagonally; they may only move backward when **capturing**
- **Side edges wrap** for quiet moves (e.g. A3 → H4). Men cannot wrap top/bottom on a quiet move to reach the promotion rank the long way around
- Captures wrap freely (horizontal and vertical) and may go backward
- Captures are mandatory; multi-jumps allowed
- Reach the far rank across the board → promote to a **queen** that slides any distance on a diagonal (including across the wrap)
- Modes: two-player pass-and-play, or vs CPU (play as Red or Black)

## Run

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually `http://localhost:5173`).

```bash
npm run build   # production build → dist/
npm run preview # serve the build locally
```

## Stack

Vanilla TypeScript + Vite. Game logic lives in `src/game.ts`; UI in `src/main.ts` + `src/style.css`.
