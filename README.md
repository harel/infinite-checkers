# Infinite Checkers

When I was younger, much much younger than today, me and my friend Amit came up with this game to make checkers a bit more interesting. One can have a perfectly regular game until the board empties and things start to flip...

A browser prototype of wraparound checkers: the board is a torus. Step (or jump) off one edge and you continue on the opposite side — e.g. **A3 → H4**.

Play it at [infinitecheckers.com](https://infinitecheckers.com).

## Rules (this build)

- Standard starting setup; Red moves first
- Men move forward diagonally; they may only move backward when **capturing**
- **Side edges wrap** for quiet moves (e.g. A3 → H4). Men cannot wrap top/bottom on a quiet move to reach the promotion rank the long way around
- Captures wrap freely (horizontal and vertical) and may go backward
- Captures are mandatory; multi-jumps allowed
- Reach the far rank across the board → promote to a **queen** that slides any distance on a diagonal (including across the wrap)
- Modes: two-player pass-and-play, vs CPU (Red or Black), or **online** via shareable room codes ([PeerJS](https://peerjs.com/) signaling — no self-hosted server)

## Online multiplayer

1. **Play online** creates a room and shows a short code (and copyable link).
2. Your friend opens the link or chooses **Join room** and enters the code.
3. Host plays Red; guest plays Black. Keep both tabs open for the live session.

Signaling uses PeerJS’s public cloud so browsers can find each other; moves then go over a peer data channel. The host validates moves with the local rules engine.

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

Vanilla TypeScript + Vite + [PeerJS](https://peerjs.com/) for online rooms. Game logic in `src/game.ts`; networking in `src/online.ts`; UI in `src/main.ts` + `src/style.css`.
