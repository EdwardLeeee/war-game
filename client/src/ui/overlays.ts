// DOM pieces drawn over the battlefield by the gestures: the hold cue, the selection box,
// the skill wheel, the prompt bar for map-tap modes, the ✓ / ✗ of building placement and a
// short message line. Temporary prototype interface (GDD §10 draft), not an approved design.

import { type CommandBody, type CommandKind, Reject } from "../sim.ts";

export interface WheelButton {
  id: string;
  label: string;
}

export interface PromptButton {
  label: string;
  /** Wider, primary-coloured button. */
  primary?: boolean;
  onTap: () => void;
}

/** What a rejected command's reason code means, for the message line. */
export const REJECT_TEXT: Record<number, string> = {
  [Reject.NotOwner]: "不是你的單位",
  [Reject.InvalidTarget]: "目標不在了",
  [Reject.CannotAfford]: "資源不夠",
  [Reject.PopulationCap]: "人口已滿（訓練中的也算），先蓋民居",
  [Reject.MageCap]: "法師已達上限",
  [Reject.NoCrystal]: "魔晶不夠一發晶砲",
  [Reject.Cooldown]: "晶砲還在冷卻",
  [Reject.BadPlacement]: "這裡不能蓋",
  [Reject.QueueFull]: "訓練佇列已滿",
  [Reject.NotAvailable]: "現在不能這樣做",
  [Reject.TownNotYours]: "不是你攻下的城鎮",
  [Reject.TownChoiceMade]: "這座城鎮已經選過了",
  [Reject.GameOver]: "這局已經結束",
  [Reject.OutOfRange]: "超出晶砲射程（8 格）",
};

/**
 * The same reason code means different things for different commands (sim/PROTOCOL.md 3.1
 * and 3.2); these say it plainly for the command that was rejected.
 */
const BY_COMMAND: Partial<Record<number, Partial<Record<CommandKind, string>>>> = {
  [Reject.NotAvailable]: {
    build: "主城和箭樓不能蓋",
    repair: "這裡現在不需要農民（沒有受損，或田已經有人耕）",
    train: "這棟建築還沒蓋好，或不訓練這種兵",
    rally: "這棟建築不能設集結點",
    gather: "只有農民能採集",
    cast: "只有法師能發晶砲",
    autocast: "只有法師能自動施放",
  },
  [Reject.InvalidTarget]: {
    cast: "晶砲的落點不在地圖內",
    town_choice: "這座城鎮現在不能選",
  },
  [Reject.CannotAfford]: {
    town_choice: "治理要先投入金和木，現在不夠",
  },
};

/**
 * Farmers sent to repair the own main city while it is locked (hit in the last 10 s): the
 * order is accepted and they wait beside it, so this only tells the player why nothing happens yet.
 */
export const REPAIR_LOCKED_TEXT = "主城剛被攻擊，暫時不能修理：農民會在旁邊等，10 秒內沒再被打就開始修";

/** What to tell the player when a command comes back rejected. */
export function rejectText(reason: number, cmd: CommandBody | undefined): string {
  const specific = cmd === undefined ? undefined : BY_COMMAND[reason]?.[cmd.c];
  return specific ?? REJECT_TEXT[reason] ?? "指令沒有執行";
}

const WHEEL_RADIUS = 72;
const WHEEL_BUTTON = 60;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent.appendChild(e);
  return e;
}

export class Overlays {
  private readonly root: HTMLElement;
  private readonly cue: HTMLElement;
  private readonly marquee: HTMLElement;
  private readonly wheelBackdrop: HTMLElement;
  private readonly wheel: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly promptText: HTMLElement;
  private readonly promptButtons: HTMLElement;
  private readonly place: HTMLElement;
  private readonly placeOk: HTMLButtonElement;
  private readonly placeCancel: HTMLButtonElement;
  private readonly toastBox: HTMLElement;
  private toastTimer = 0;
  wheelItems: string[] | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.cue = el("div", "press-cue", root);
    this.marquee = el("div", "marquee", root);
    this.wheelBackdrop = el("div", "wheel-backdrop", root);
    this.wheel = el("div", "wheel", root);
    this.wheel.setAttribute("role", "menu");
    this.prompt = el("div", "prompt", root);
    this.promptText = el("span", "prompt-text", this.prompt);
    this.promptButtons = el("span", "prompt-buttons", this.prompt);
    this.place = el("div", "place-confirm", root);
    this.placeOk = el("button", "place-ok", this.place);
    this.placeOk.type = "button";
    this.placeOk.textContent = "✓";
    this.placeOk.setAttribute("aria-label", "確定蓋在這裡");
    this.placeCancel = el("button", "place-cancel", this.place);
    this.placeCancel.type = "button";
    this.placeCancel.textContent = "✗";
    this.placeCancel.setAttribute("aria-label", "取消放建築");
    this.toastBox = el("div", "toast", root);
    this.toastBox.setAttribute("role", "status");
    for (const e of [this.cue, this.marquee, this.wheelBackdrop, this.wheel, this.prompt, this.place, this.toastBox]) e.hidden = true;
  }

  showCue(x: number, y: number, on: boolean): void {
    this.cue.hidden = !on;
    if (!on) return;
    this.cue.style.left = `${x}px`;
    this.cue.style.top = `${y}px`;
    // Restart the closing animation.
    this.cue.classList.remove("run");
    void this.cue.offsetWidth;
    this.cue.classList.add("run");
  }

  showBox(x0: number, y0: number, x1: number, y1: number): void {
    const s = this.marquee.style;
    this.marquee.hidden = false;
    s.left = `${Math.min(x0, x1)}px`;
    s.top = `${Math.min(y0, y1)}px`;
    s.width = `${Math.abs(x1 - x0)}px`;
    s.height = `${Math.abs(y1 - y0)}px`;
  }

  hideBox(): void {
    this.marquee.hidden = true;
  }

  /** Buttons on an arc above the finger, kept on screen; a tap anywhere else closes it. */
  openWheel(x: number, y: number, buttons: WheelButton[], onPick: (id: string) => void): void {
    this.closeWheel();
    this.wheelItems = buttons.map((b) => b.id);
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    const span = buttons.length === 2 ? 90 : 120;
    buttons.forEach((b, i) => {
      const deg = -90 - span / 2 + (buttons.length === 1 ? span / 2 : (span * i) / (buttons.length - 1));
      const rad = (deg * Math.PI) / 180;
      const bx = Math.min(Math.max(x + WHEEL_RADIUS * Math.cos(rad), WHEEL_BUTTON / 2 + 8), w - WHEEL_BUTTON / 2 - 8);
      const by = Math.min(Math.max(y + WHEEL_RADIUS * Math.sin(rad), WHEEL_BUTTON / 2 + 8), h - WHEEL_BUTTON / 2 - 8);
      const btn = el("button", "wheel-item", this.wheel);
      btn.type = "button";
      btn.setAttribute("role", "menuitem");
      btn.dataset.item = b.id;
      btn.textContent = b.label;
      btn.style.left = `${bx - WHEEL_BUTTON / 2}px`;
      btn.style.top = `${by - WHEEL_BUTTON / 2}px`;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.closeWheel();
        onPick(b.id);
      });
    });
    this.wheel.hidden = false;
    this.wheelBackdrop.hidden = false;
    this.wheelBackdrop.onpointerdown = (e) => {
      e.preventDefault();
      this.closeWheel();
    };
  }

  closeWheel(): void {
    this.wheel.replaceChildren();
    this.wheel.hidden = true;
    this.wheelBackdrop.hidden = true;
    this.wheelItems = null;
  }

  showPrompt(text: string, buttons: PromptButton[]): void {
    this.promptText.textContent = text;
    this.promptButtons.replaceChildren();
    for (const b of buttons) {
      const btn = el("button", b.primary === true ? "primary" : "secondary", this.promptButtons);
      btn.type = "button";
      btn.textContent = b.label;
      btn.addEventListener("click", b.onTap);
    }
    this.prompt.hidden = false;
  }

  hidePrompt(): void {
    this.prompt.hidden = true;
  }

  /**
   * ✓ and ✗ next to the preview's screen rectangle: right of it, else left, below or above,
   * whichever stays on screen without covering an interface panel (`avoid`, screen rects).
   */
  showPlace(
    rect: { x: number; y: number; w: number; h: number },
    okEnabled: boolean,
    onOk: () => void,
    onCancel: () => void,
    avoid: DOMRect[] = [],
  ): void {
    const W = this.root.clientWidth;
    const H = this.root.clientHeight;
    const bw = 112;
    const bh = 52;
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    const candidates = [
      { x: rect.x + rect.w + 10, y: cy - bh / 2 },
      { x: rect.x - 10 - bw, y: cy - bh / 2 },
      { x: cx - bw / 2, y: rect.y + rect.h + 10 },
      { x: cx - bw / 2, y: rect.y - 10 - bh },
    ];
    const clear = (p: { x: number; y: number }) =>
      p.x >= 8 && p.y >= 8 && p.x + bw <= W - 8 && p.y + bh <= H - 8 &&
      avoid.every((a) => p.x + bw <= a.left || p.x >= a.right || p.y + bh <= a.top || p.y >= a.bottom);
    const spot = candidates.find(clear) ?? { x: W / 2 - bw / 2, y: H / 2 - bh / 2 };
    this.place.style.left = `${spot.x}px`;
    this.place.style.top = `${spot.y}px`;
    this.placeOk.disabled = !okEnabled;
    this.placeOk.onclick = onOk;
    this.placeCancel.onclick = onCancel;
    this.place.hidden = false;
  }

  hidePlace(): void {
    this.place.hidden = true;
  }

  toast(text: string): void {
    this.toastBox.textContent = text;
    this.toastBox.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastBox.hidden = true;
    }, 2200);
  }
}
