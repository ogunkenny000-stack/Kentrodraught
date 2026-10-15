/** Dialogs can be rendered out of DOM order (alerts sit above setup sheets). */
export function isTopmostDialog(panel: HTMLElement): boolean {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')).filter(dialog => dialog.getClientRects().length > 0);
  const layer = (dialog: HTMLElement): number => {
    for (let element: HTMLElement | null = dialog; element; element = element.parentElement) {
      const value = Number.parseInt(getComputedStyle(element).zIndex, 10);
      if (Number.isFinite(value)) return value;
    }
    return 0;
  };
  const top = dialogs.reduce<HTMLElement | null>((current, dialog) => !current || layer(dialog) >= layer(current) ? dialog : current, null);
  return top === panel;
}
