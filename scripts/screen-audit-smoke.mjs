/** Dependency-light regression checks for critical navigation and storage UX. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { safeStorage, safeSessionStorage } from '../src/lib/safeStorage.ts';

let checks = 0;
const check = (name, fn) => { fn(); checks++; process.stdout.write(`PASS ${name}\n`); };
const app = fs.readFileSync('src/App.tsx','utf8');
const topNav = fs.readFileSync('src/components/layout/TopNav.tsx','utf8');
const offline = fs.readFileSync('src/components/game/OfflineNearby.tsx','utf8');
const notifications = fs.readFileSync('src/components/NotificationCenter.tsx','utf8');
const home = fs.readFileSync('src/components/HomeLobby.tsx','utf8');
const soon = fs.readFileSync('src/components/ComingSoonPane.tsx','utf8');

const originalWindow = globalThis.window;
try {
  check('blocked storage never crashes settings', () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: {
      get localStorage() { throw new DOMException('Blocked','SecurityError'); },
      get sessionStorage() { throw new DOMException('Blocked','SecurityError'); },
    }});
    assert.equal(safeStorage.getItem('theme'), null);
    assert.doesNotThrow(() => safeStorage.setItem('theme','wood'));
    assert.doesNotThrow(() => safeStorage.removeItem('theme'));
    assert.equal(safeSessionStorage.getItem('splash'), null);
    assert.doesNotThrow(() => safeSessionStorage.setItem('splash','yes'));
  });
  check('storage works normally when permitted', () => {
    const data = new Map();
    const store = { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k) };
    Object.defineProperty(globalThis, 'window', { configurable:true, value: {localStorage:store,sessionStorage:store} });
    safeStorage.setItem('theme','wood'); assert.equal(safeStorage.getItem('theme'), 'wood'); safeStorage.removeItem('theme'); assert.equal(safeStorage.getItem('theme'),null);
  });
} finally {
  if (originalWindow === undefined) delete globalThis.window;
  else Object.defineProperty(globalThis,'window',{configurable:true,value:originalWindow});
}
check('app preference reads use guarded storage', () => {
  assert.match(app,/import \{ safeStorage, safeSessionStorage \}/);
  assert.doesNotMatch(app,/(?<!safe)(?<!Session)localStorage\.(getItem|setItem|removeItem)/);
});
check('live room exit uses same confirmation for navigation', () => {
  const start = app.indexOf('const handleModeChange =');
  const end = app.indexOf('// Menu Sidebar', start + 10);
  assert.ok(start >= 0);
  assert.match(app.slice(start,start+1800), /roomId && !isSpectating && !alreadyLeftRoom/);
  assert.match(app.slice(start,start+1800), /leaveRoomWithConfirm\(\)/);
  assert.match(app, /handleModeChange\("Home", true\)/);
});
check('notification deep links do not interrupt live games', () => {
  assert.match(app,/Finish or leave your live match before opening a notification/);
});
check('top navigation recognizes active boards', () => {
  assert.match(topNav,/isBoard = isGameActive \|\|/);
  assert.match(app,/isGameActive=\{isBoardScreenActive\}/);
});
check('offline nearby match warns before leaving', () => {
  assert.match(offline,/const leaveNearby =/);
  assert.match(offline,/window\.confirm\('Leave this nearby match/);
  assert.match(offline,/onClick=\{leaveNearby\}/);
});
check('notifications have keyboard Escape and focus handling', () => {
  assert.match(notifications,/aria-modal="true"/);
  assert.match(notifications,/panelRef\.current\?\.focus\(\)/);
  assert.match(notifications,/event\.key === "Escape"/);
});
check('weekly puzzles correctly labelled', () => { assert.match(home,/Weekly puzzles/); assert.doesNotMatch(home,/>Daily puzzles</); });
check('Learn feature never claims a fictitious launch date', () => { assert.match(soon,/In development/); assert.doesNotMatch(soon,/10 \* 24 \* 60/); });
check('locked Ken levels are checked from both menus', () => {
  const drawer = fs.readFileSync('src/components/layout/MobileDrawers.tsx','utf8');
  assert.match(app,/const handleSidebarKenLevel = \(level: number\) =>/);
  assert.match(app,/if \(level > unlocked\)/);
  assert.match(app,/onSelectKenLevel=\{handleSidebarKenLevel\}/);
  assert.match(drawer,/onSelectKenLevel\?: \(id: number\) => void/);
});
check('profile never advertises unavailable instant withdrawals', () => {
  const profile = fs.readFileSync('src/components/ProfilePage.tsx','utf8');
  assert.doesNotMatch(profile,/Instant Transfers|useComingSoonCountdown/);
  assert.match(profile,/Withdrawals aren't live yet/);
});
check('friends page exposes errors to players', () => {
  const friends = fs.readFileSync('src/components/FriendsPage.tsx','utf8');
  assert.match(friends,/role="alert"/);
  assert.match(friends,/aria-label="Add friend"/);
});
console.log(`PASS: ${checks} critical screen regression checks`);
