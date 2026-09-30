// Touch and mouse: tap to select or to order, long-press then drag to box-select,
// one-finger drag to pan, two-finger pinch to zoom (mouse wheel on desktop).

import type { PlayerCommand } from "./protocol.ts";
import { type Scene, TILE_PX } from "./render.ts";

const LONG_PRESS_MS = 350;
const SLOP_PX = 10;
const MIN_SCALE = 0.15;
const MAX_SCALE = 4;

interface Pointer {
  x: number;
  y: number;
  startX: number;
  startY: number;
}

export function attachInput(canvas: HTMLCanvasElement, scene: Scene, marquee: HTMLElement, send: (cmd: PlayerCommand) => void): void {
  const pointers = new Map<number, Pointer>();
  let mode: "none" | "tap" | "pan" | "box" | "pinch" = "none";
  let pressTimer = 0;
  let pinchDist = 0;
  let pinchScale = 1;
  let pinchWorld = { x: 0, y: 0 };
  const world = scene.world;

  const toWorld = (sx: number, sy: number) => ({ x: (sx - world.x) / world.scale.x, y: (sy - world.y) / world.scale.y });
  const local = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const zoomAt = (sx: number, sy: number, scale: number, anchor = toWorld(sx, sy)) => {
    const s = Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE);
    world.scale.set(s);
    world.position.set(sx - anchor.x * s, sy - anchor.y * s);
  };

  const showBox = (p: Pointer) => {
    marquee.style.display = "block";
    marquee.style.left = `${Math.min(p.startX, p.x)}px`;
    marquee.style.top = `${Math.min(p.startY, p.y)}px`;
    marquee.style.width = `${Math.abs(p.x - p.startX)}px`;
    marquee.style.height = `${Math.abs(p.y - p.startY)}px`;
  };

  const tap = (sx: number, sy: number) => {
    const w = toWorld(sx, sy);
    let best: { id: number; team: number } | null = null;
    let bestD = (TILE_PX * 0.9) ** 2;
    for (const u of scene.unitsAt()) {
      const d = (u.x - w.x) ** 2 + (u.y - w.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    const mine = [...scene.selected];
    if (best !== null && best.team === 0) {
      scene.selected = new Set([best.id]);
    } else if (best !== null && mine.length > 0) {
      send({ c: "attack", u: mine, target: best.id });
    } else if (mine.length > 0) {
      send({ c: "move", u: mine, x: Math.floor(w.x / TILE_PX), y: Math.floor(w.y / TILE_PX) });
    }
  };

  const boxSelect = (p: Pointer) => {
    const a = toWorld(Math.min(p.startX, p.x), Math.min(p.startY, p.y));
    const b = toWorld(Math.max(p.startX, p.x), Math.max(p.startY, p.y));
    scene.selected = new Set(scene.unitsAt().filter((u) => u.team === 0 && u.x >= a.x && u.x <= b.x && u.y >= a.y && u.y <= b.y).map((u) => u.id));
  };

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    const { x, y } = local(e);
    pointers.set(e.pointerId, { x, y, startX: x, startY: y });
    window.clearTimeout(pressTimer);
    if (pointers.size === 1) {
      mode = "tap";
      pressTimer = window.setTimeout(() => {
        if (mode === "tap") {
          mode = "box";
          showBox(pointers.get(e.pointerId) as Pointer);
        }
      }, LONG_PRESS_MS);
    } else if (pointers.size === 2) {
      mode = "pinch";
      marquee.style.display = "none";
      const [p, q] = [...pointers.values()];
      pinchDist = Math.hypot(p.x - q.x, p.y - q.y) || 1;
      pinchScale = world.scale.x;
      pinchWorld = toWorld((p.x + q.x) / 2, (p.y + q.y) / 2);
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    const p = pointers.get(e.pointerId);
    if (p === undefined) return;
    const { x, y } = local(e);
    const dx = x - p.x;
    const dy = y - p.y;
    p.x = x;
    p.y = y;
    if (mode === "pinch" && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, (pinchScale * d) / pinchDist, pinchWorld);
    } else if (mode === "box") {
      showBox(p);
    } else if (mode === "tap" && Math.hypot(x - p.startX, y - p.startY) > SLOP_PX) {
      mode = "pan";
      window.clearTimeout(pressTimer);
      world.position.set(world.x + (x - p.startX), world.y + (y - p.startY));
    } else if (mode === "pan") {
      world.position.set(world.x + dx, world.y + dy);
    }
  });

  const end = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId);
    if (p === undefined) return;
    pointers.delete(e.pointerId);
    window.clearTimeout(pressTimer);
    if (mode === "tap" && e.type === "pointerup") tap(p.x, p.y);
    if (mode === "box") {
      boxSelect(p);
      marquee.style.display = "none";
    }
    if (pointers.size === 0) mode = "none";
    else if (mode === "pinch") mode = "none"; // lifting one of two fingers ends the gesture
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const { x, y } = local(e);
      zoomAt(x, y, world.scale.x * Math.exp(-e.deltaY * 0.0015));
    },
    { passive: false },
  );
}
