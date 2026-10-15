const selector = 'button:not(:disabled),a[href],input:not(:disabled):not([type="hidden"]),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';

export function focusableDialogElements(panel: HTMLElement): HTMLElement[] {
  return Array.from<HTMLElement>(panel.querySelectorAll<HTMLElement>(selector))
    .filter(element => element.tabIndex >= 0 && !element.closest('[inert],[aria-hidden="true"]') && element.getClientRects().length > 0);
}

function layer(element: HTMLElement): number {
  let maximum = 0;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const z = Number(getComputedStyle(current).zIndex);
    if (Number.isFinite(z)) maximum = Math.max(maximum, z);
  }
  return maximum;
}

export function isTopmostDialog(panel: HTMLElement): boolean {
  const dialogs = Array.from<HTMLElement>(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
    .filter(dialog => dialog.getClientRects().length > 0);
  return dialogs.sort((a, b) => layer(a) - layer(b)).at(-1) === panel;
}

/** One focus trap shared by panels and modal shells, including nested dialogs. */
export function trapDialogFocus(panel: HTMLElement, onEscape?: () => void): () => void {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const frame = requestAnimationFrame(() => { if (isTopmostDialog(panel)) panel.focus(); });
  const keydown = (event: KeyboardEvent) => {
    if (!isTopmostDialog(panel)) return;
    if (event.key === "Escape" && onEscape) { event.preventDefault(); event.stopPropagation(); onEscape(); return; }
    if (event.key !== "Tab") return;
    const controls = focusableDialogElements(panel);
    if (!controls.length) { event.preventDefault(); panel.focus(); return; }
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement as HTMLElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement as HTMLElement))) {
      event.preventDefault(); first.focus();
    }
  };
  document.addEventListener("keydown", keydown);
  return () => {
    cancelAnimationFrame(frame);
    document.removeEventListener("keydown", keydown);
    if (previous?.isConnected && (panel.contains(document.activeElement) || document.activeElement === document.body)) previous.focus();
  };
}
