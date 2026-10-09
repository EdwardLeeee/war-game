// Placeholder graphics (brief: geometric shapes, own and enemy colours clearly apart, unit
// silhouettes told apart). Every shape is drawn once at start-up into a texture; units and
// buildings are white so a sprite tint gives the owner colour, with a dark outline that the
// tint leaves dark. Nodes keep their own colours.

import { Container, type Renderer, Graphics, Rectangle, Text, type Texture } from "pixi.js";
import { BuildingType, NodeKind, NO_OWNER, NEUTRAL, UnitType } from "../sim.ts";

/** Texture pixels per world px, so shapes stay sharp at MAX_ZOOM on a 3x screen. */
const RES = 4;
const INK = 0x14110e;

export const OWN_TINT = 0x4f8ff0;
export const ENEMY_TINT = 0xe0473d;
export const NEUTRAL_TINT = 0xd8d2c0;
export const SHIELD_TINT = 0x5fe3f0;
export const WARNING_TINT = 0xff8a2a;

export function ownerTint(owner: number, me: number): number {
  if (owner === me) return OWN_TINT;
  if (owner === NEUTRAL || owner === NO_OWNER) return NEUTRAL_TINT;
  return ENEMY_TINT;
}

/** Building labels: one character each (GDD §8 names). */
export const BUILDING_GLYPH: Record<number, string> = {
  [BuildingType.MainCity]: "主",
  [BuildingType.House]: "民",
  [BuildingType.LumberCamp]: "伐",
  [BuildingType.Mine]: "礦",
  [BuildingType.Granary]: "糧",
  [BuildingType.Farm]: "田",
  [BuildingType.Barracks]: "營",
  [BuildingType.Range]: "射",
  [BuildingType.MageHall]: "術",
  [BuildingType.TownTower]: "塔",
  // A player's arrow tower (round 7): its own tower shape and glyph, unlike the big city's 塔.
  [BuildingType.ArrowTower]: "箭",
  [BuildingType.Stable]: "馬",
  [BuildingType.Outpost]: "哨",
};

export interface Atlas {
  /** Indexed by UnitType; 32 x 32 world px, centred. */
  units: Texture[];
  ring: Texture;
  white: Texture;
  /** 64 x 64, scaled to the footprint. */
  building: Texture;
  farm: Texture;
  /** A player's arrow tower (round 7): a narrow tower with battlements, 64 x 64. */
  tower: Texture;
  /** Someone hides inside (BuildingFlag.Occupied, round 7): a small shield, 16 x 16. */
  occupied: Texture;
  /** An outpost holding (BuildingFlag.Hold, D-080): a small tag reading 守, 16 x 16. */
  hold: Texture;
  glyphs: Record<number, Texture>;
  /** Indexed by NodeKind; 32 x 32. */
  nodes: Texture[];
  flag: Texture;
}

function shape(renderer: Renderer, size: number, draw: (g: Graphics) => void): Texture {
  const g = new Graphics();
  draw(g);
  const tex = renderer.generateTexture({ target: g, resolution: RES, antialias: true, frame: new Rectangle(0, 0, size, size) });
  g.destroy();
  return tex;
}

const outline = { width: 1.6, color: INK };

const atlases = new WeakMap<Renderer, Atlas>();

/** The shapes for this renderer, drawn once and shared by every game on the page. */
export function atlasFor(renderer: Renderer): Atlas {
  let a = atlases.get(renderer);
  if (a === undefined) {
    a = buildAtlas(renderer);
    atlases.set(renderer, a);
  }
  return a;
}

function buildAtlas(renderer: Renderer): Atlas {
  const units: Texture[] = [];
  // Farmer: small round body.
  units[UnitType.Farmer] = shape(renderer, 32, (g) => g.circle(16, 16, 7).fill(0xffffff).stroke(outline));
  // Spearman: a wedge pointing the way it faces, with a spear.
  units[UnitType.Spearman] = shape(renderer, 32, (g) => {
    g.moveTo(8, 16).lineTo(29, 16).stroke({ width: 2, color: INK });
    g.poly([6, 7, 22, 16, 6, 25]).fill(0xffffff).stroke(outline);
  });
  // Ranged: a diamond with a bow arc.
  units[UnitType.Ranged] = shape(renderer, 32, (g) => {
    g.poly([16, 7, 24, 16, 16, 25, 8, 16]).fill(0xffffff).stroke(outline);
    g.moveTo(25, 8).quadraticCurveTo(31, 16, 25, 24).stroke({ width: 1.6, color: INK });
  });
  // Mage: a six-pointed star.
  units[UnitType.Mage] = shape(renderer, 32, (g) => g.star(16, 16, 6, 11, 5.5).fill(0xffffff).stroke(outline));
  // Cavalry (round 7): two notched arrowheads one behind the other (»). A single dart was too
  // like the spearman's wedge at play size.
  units[UnitType.Cavalry] = shape(renderer, 32, (g) => {
    g.poly([2, 7, 15, 16, 2, 25, 7, 16]).fill(0xffffff).stroke(outline);
    g.poly([14, 6, 29, 16, 14, 26, 19, 16]).fill(0xffffff).stroke(outline);
  });
  // Militia: a square.
  units[UnitType.Militia] = shape(renderer, 32, (g) => g.rect(9, 9, 14, 14).fill(0xffffff).stroke(outline));

  const ring = shape(renderer, 32, (g) => g.circle(16, 16, 14).stroke({ width: 2, color: 0xffffff }));
  const white = shape(renderer, 4, (g) => g.rect(0, 0, 4, 4).fill(0xffffff));
  const building = shape(renderer, 64, (g) => g.roundRect(3, 3, 58, 58, 8).fill(0xffffff).stroke({ width: 3, color: INK }));
  const farm = shape(renderer, 64, (g) => {
    g.rect(2, 2, 60, 60).fill(0xd9c27a).stroke({ width: 2, color: 0x7a6532 });
    for (let y = 10; y < 60; y += 10) g.moveTo(6, y).lineTo(58, y).stroke({ width: 2, color: 0x8f7a3a });
  });

  const tower = shape(renderer, 64, (g) => {
    g.poly([14, 60, 14, 16, 20, 16, 20, 6, 27, 6, 27, 16, 37, 16, 37, 6, 44, 6, 44, 16, 50, 16, 50, 60]).fill(0xffffff).stroke({ width: 3, color: INK });
  });
  const occupied = shape(renderer, 16, (g) => {
    g.poly([8, 1, 14, 3, 14, 8, 8, 15, 2, 8, 2, 3]).fill(0xf5f1e6).stroke({ width: 1.4, color: INK });
    g.circle(8, 7, 2).fill(INK);
  });

  const hold = (() => {
    const c = new Container();
    c.addChild(new Graphics().roundRect(0, 0, 16, 16, 3).fill(0xf5f1e6).stroke({ width: 1.4, color: INK }));
    const t = new Text({ text: "守", style: { fontFamily: "-apple-system, 'Noto Sans TC', sans-serif", fontSize: 12, fontWeight: "700", fill: INK } });
    t.anchor.set(0.5);
    t.position.set(8, 8.5);
    c.addChild(t);
    const tex = renderer.generateTexture({ target: c, resolution: RES });
    c.destroy({ children: true });
    return tex;
  })();

  const glyphs: Record<number, Texture> = {};
  for (const [type, ch] of Object.entries(BUILDING_GLYPH)) {
    const t = new Text({ text: ch, style: { fontFamily: "-apple-system, 'Noto Sans TC', sans-serif", fontSize: 30, fontWeight: "700", fill: INK } });
    glyphs[Number(type)] = renderer.generateTexture({ target: t, resolution: RES });
    t.destroy();
  }

  const nodes: Texture[] = [];
  nodes[NodeKind.Tree] = shape(renderer, 32, (g) => {
    g.circle(16, 17, 12).fill(0x2e5a2c).stroke({ width: 1.5, color: 0x183317 });
    g.circle(12, 13, 5).fill(0x3f7a3b);
  });
  nodes[NodeKind.GoldMine] = shape(renderer, 32, (g) => {
    g.roundRect(4, 8, 24, 18, 5).fill(0x6b5a45).stroke(outline);
    g.circle(12, 16, 4).fill(0xf2c230);
    g.circle(20, 19, 3.5).fill(0xf2c230);
  });
  nodes[NodeKind.Berries] = shape(renderer, 32, (g) => {
    g.circle(16, 17, 11).fill(0x3d6b35).stroke({ width: 1.5, color: 0x1f3a1b });
    for (const [x, y] of [[11, 13], [19, 12], [15, 20], [22, 19]]) g.circle(x, y, 2.6).fill(0xd6304a);
  });
  nodes[NodeKind.CrystalVein] = shape(renderer, 32, (g) => {
    g.poly([16, 3, 22, 16, 16, 29, 10, 16]).fill(0x7af0ff).stroke({ width: 1.5, color: 0x1b6f7c });
    g.poly([7, 12, 11, 19, 7, 26, 3, 19]).fill(0x9cf5ff).stroke({ width: 1.2, color: 0x1b6f7c });
  });

  const flag = shape(renderer, 32, (g) => {
    g.moveTo(9, 29).lineTo(9, 3).stroke({ width: 2.5, color: INK });
    g.poly([10, 4, 28, 9, 10, 15]).fill(0xffffff).stroke({ width: 1.5, color: INK });
  });

  return { units, ring, white, building, farm, tower, occupied, hold, glyphs, nodes, flag };
}
