// 正式介面 (R6, D-087; ceo 2026-10-19): off until R6-1 to R6-4 were in and checked against the approved
// boards; on by default from R24-01 (D-150, the user 2026-11-15: 「設成預設」, with R24-02 and R24-03).
// ?ui=proto still opens the prototype, on any page (as ?ui=r6 did before, logged and saved as always).

export const FORMAL_UI_DEFAULT = true;

/** The root element says which: data-ui="r6" (ui/r6.css applies only then). */
export function applyFormalUi(on: boolean, root: HTMLElement = document.documentElement): void {
  if (on) root.dataset.ui = "r6";
  else delete root.dataset.ui;
}

export function formalUi(root: HTMLElement = document.documentElement): boolean {
  return root.dataset.ui === "r6";
}
