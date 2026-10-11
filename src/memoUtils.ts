// A comparator for React.memo that ignores function-typed props.
//
// App.tsx passes most callback props as inline arrow functions or plain
// (non-useCallback'd) handlers, so they get a new reference on every one of
// App.tsx's renders. React.memo's default strict comparison would see those
// as "changed" and re-render the child anyway -- defeating the point of memo
// for components like LobbyDashboard/TournamentDashboard, which don't need to
// re-render just because, say, the game clock ticked in the parent.
//
// This treats any prop that is a function on both sides as "equal" (its
// behavior doesn't meaningfully change from render to render, only its
// reference does) and does a normal Object.is comparison on everything else.
export function shallowEqualIgnoringFunctions<T extends Record<string, any>>(prev: T, next: T): boolean {
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);
  if (prevKeys.length !== nextKeys.length) return false;

  for (const key of prevKeys) {
    const a = prev[key];
    const b = next[key];
    if (typeof a === "function" && typeof b === "function") continue;
    if (!Object.is(a, b)) return false;
  }
  return true;
}
