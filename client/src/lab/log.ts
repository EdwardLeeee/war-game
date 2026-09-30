// The lab's log box. Engine spike finding: once the box was full, new lines were cut off.
// Here the box scrolls to the newest line as lines arrive — unless the reader has scrolled
// up to look at something, in which case it stays put and a 「有新訊息」 button appears.

const MAX_LINES = 300;
/** Within this many px of the end counts as "at the newest line". */
const STICK_PX = 8;

export class LogBox {
  private readonly box: HTMLElement;
  private readonly more: HTMLButtonElement;
  readonly lines: string[] = [];

  constructor(box: HTMLElement, more: HTMLButtonElement) {
    this.box = box;
    this.more = more;
    this.more.hidden = true;
    this.more.addEventListener("click", () => this.toEnd());
    this.box.addEventListener("scroll", () => {
      if (this.atEnd()) this.more.hidden = true;
    });
  }

  add(line: string): void {
    console.log(`PROTO ${line}`);
    const follow = this.atEnd();
    this.lines.push(line);
    const div = document.createElement("div");
    div.textContent = line;
    this.box.appendChild(div);
    while (this.box.childElementCount > MAX_LINES) {
      this.box.firstElementChild?.remove();
      this.lines.shift();
    }
    if (follow) this.toEnd();
    else this.more.hidden = false;
  }

  text(): string {
    return this.lines.join("\n");
  }

  private atEnd(): boolean {
    return this.box.scrollTop + this.box.clientHeight >= this.box.scrollHeight - STICK_PX;
  }

  private toEnd(): void {
    this.box.scrollTop = this.box.scrollHeight;
    this.more.hidden = true;
  }
}
