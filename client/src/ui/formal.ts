// 正式介面 (R6, D-087; ceo 2026-10-19): off until R6-1 to R6-4 are all in and checked against the
// approved boards, so that no player sees the new look and the prototype's mixed; a last PR then
// turns it on. Test pages turn it on with ?test=1&ui=r6. Off, the page is the prototype's, as it was.

export const FORMAL_UI_DEFAULT = false;

/** The root element says which: data-ui="r6" (ui/r6.css applies only then). */
export function applyFormalUi(on: boolean, root: HTMLElement = document.documentElement): void {
  if (on) root.dataset.ui = "r6";
  else delete root.dataset.ui;
}

export function formalUi(root: HTMLElement = document.documentElement): boolean {
  return root.dataset.ui === "r6";
}
