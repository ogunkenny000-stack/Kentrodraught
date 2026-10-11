#!/usr/bin/env python3
"""
Nigerian International Draughts  ·  SCAN 3.1 Engine
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Board geometry : applet.py / Nigerian standard
                 dark squares where (row+col) % 2 == 0
                 sq 1 = top-left, sq 50 = bottom-right

SCAN geometry  : horizontal mirror (col → 9-col)
                 dark squares where (row+col) % 2 == 1

Conversion     : convert_sq(sq) = 2*row_base + 4 - sq   (self-inverse)

Data flow
  Human move  : Nigerian numbers → convert → SCAN hub string → engine
  Engine move : SCAN hub string  → convert → Nigerian numbers → board
"""

import os, sys
os.environ.setdefault('KIVY_NO_ENV_CONFIG', '1')

import re, time, threading, subprocess
from typing import Optional, List, Tuple, Set, Dict

from kivy.app             import App
from kivy.uix.widget      import Widget
from kivy.uix.boxlayout   import BoxLayout
from kivy.uix.label       import Label
from kivy.uix.button      import Button
from kivy.uix.scrollview  import ScrollView
from kivy.uix.popup       import Popup
from kivy.graphics        import Color, Rectangle, Ellipse, Line
from kivy.clock           import Clock
from kivy.core.window     import Window
from kivy.core.text       import Label as CoreLabel

# ══════════════════════════════════════════════════════════════════════════════
# COLOURS
# ══════════════════════════════════════════════════════════════════════════════
C_DARK_SQ   = (0.30, 0.15, 0.05, 1.0)
C_LIGHT_SQ  = (0.84, 0.69, 0.42, 1.0)
C_FRAME     = (0.08, 0.04, 0.01, 1.0)
C_FRAME_EDG = (0.50, 0.27, 0.07, 1.0)
C_WH_RING   = (0.68, 0.52, 0.28, 1.0)
C_WH_FILL   = (0.95, 0.89, 0.73, 1.0)
C_WH_INNER  = (1.00, 0.96, 0.86, 1.0)
C_BK_RING   = (0.38, 0.20, 0.05, 1.0)
C_BK_FILL   = (0.12, 0.06, 0.02, 1.0)
C_BK_INNER  = (0.24, 0.12, 0.03, 1.0)
C_CROWN_G   = (0.94, 0.77, 0.09, 1.0)
C_CROWN_D   = (0.68, 0.49, 0.04, 1.0)
C_SEL_SQ    = (0.18, 0.85, 0.28, 0.75)
C_DEST_Q    = (0.94, 0.86, 0.09, 0.70)
C_DEST_CAP  = (0.96, 0.28, 0.08, 0.70)
C_LAST_FROM = (0.20, 0.50, 0.94, 0.42)
C_LAST_TO   = (0.20, 0.50, 0.94, 0.60)
C_FLASH     = (0.94, 0.16, 0.05, 0.80)
C_UI_BG     = (0.05, 0.02, 0.00, 1.0)
C_PANEL_BG  = (0.08, 0.04, 0.01, 1.0)
C_DIVIDER   = (0.38, 0.20, 0.05, 1.0)
C_HDR       = (0.95, 0.77, 0.33, 1.0)
C_TEXT      = (0.87, 0.79, 0.60, 1.0)
C_DIM       = (0.52, 0.42, 0.26, 1.0)
C_BTN_N     = (0.26, 0.13, 0.03, 1.0)
C_BTN_A     = (0.48, 0.26, 0.07, 1.0)
C_BTN_SEL   = (0.55, 0.32, 0.08, 1.0)
C_BTN_TXT   = (0.95, 0.87, 0.63, 1.0)
C_GOLD      = (0.94, 0.81, 0.19, 1.0)

# ══════════════════════════════════════════════════════════════════════════════
# CONSTANTS
# ══════════════════════════════════════════════════════════════════════════════
THINK_TIMES: Dict[str, float] = {
    'Beginner (3s)': 0.5, 'Easy (5s)': 5.0,
    'Medium (10s)': 10.0, 'Strong (20s)': 20.0, 'Max (40s)': 40.0,
}
PLAY_MODES = ['Human vs AI', 'AI vs Human', 'Human vs Human', 'AI vs AI']

# Board editor: (piece_code, label, btn_color)  — None code = eraser
EDITOR_PIECES = [
    ('w',  '⬜ W Man',  (0.70, 0.60, 0.38, 1.0)),
    ('W',  '♛ W King', (0.82, 0.72, 0.20, 1.0)),
    ('b',  '⬛ B Man',  (0.28, 0.14, 0.04, 1.0)),
    ('B',  '♛ B King', (0.50, 0.25, 0.06, 1.0)),
    (None, '✕ Erase',  (0.48, 0.10, 0.10, 1.0)),
]

# ══════════════════════════════════════════════════════════════════════════════
# NIGERIAN GEOMETRY  (applet.py convention)
#   even rows → dark at even cols;  odd rows → dark at odd cols
#   dark rule: (row+col) % 2 == 0
#   sq 1=(0,0)  sq 5=(0,8)  sq 6=(1,1)  sq 50=(9,9)
#   White at rows 6-9  (sq 31-50)  promotes at row 0
#   Black at rows 0-3  (sq  1-20)  promotes at row 9
# ══════════════════════════════════════════════════════════════════════════════

def ng_sq_to_rc(sq: int) -> Tuple[int, int]:
    z = sq - 1
    row = z // 5
    col = (z % 5) * 2 + (0 if row % 2 == 0 else 1)
    return row, col

def ng_rc_to_sq(row: int, col: int) -> Optional[int]:
    if not (0 <= row < 10 and 0 <= col < 10): return None
    if (row + col) % 2 != 0: return None
    return row * 5 + col // 2 + 1

# ══════════════════════════════════════════════════════════════════════════════
# SQUARE CONVERSION  Nigerian ↔ SCAN  (self-inverse bijection)
#   Within each row-group: 1↔5, 2↔4, 3↔3, 6↔10, 7↔9, 8↔8, ...
# ══════════════════════════════════════════════════════════════════════════════

def convert_sq(sq: int) -> int:
    rb = ((sq - 1) // 5) * 5 + 1
    return 2 * rb + 4 - sq

def convert_move_str(s: str) -> str:
    """Replace every square number in a hub move string."""
    return re.sub(r'\d+', lambda m: str(convert_sq(int(m.group()))), s)

def board_to_scan_fen(board: dict, turn: str) -> str:
    """
    Build a SCAN FEN from a Nigerian-numbered board dict {1..50: pc|None}.
    Iterates SCAN squares 1-50; for each, converts to Nigerian sq via
    convert_sq (self-inverse bijection) and reads the piece code.
    Piece codes shared by both systems: w W b B e.
    """
    chars = [turn]
    for scan_sq in range(1, 51):
        ng_sq = convert_sq(scan_sq)
        pc = board.get(ng_sq)
        chars.append(pc if pc else 'e')
    return ''.join(chars)

# SCAN initial-position FEN strings (51 chars: turn + 50 squares)
_SCAN_FEN = {
    'W': 'W' + 'b'*20 + 'e'*10 + 'w'*20,
    'B': 'B' + 'b'*20 + 'e'*10 + 'w'*20,
}

# ══════════════════════════════════════════════════════════════════════════════
# MOVE TYPE
# ══════════════════════════════════════════════════════════════════════════════

class Move:
    __slots__ = ('from_sq', 'to_sq', 'caps')
    def __init__(self, from_sq: int, to_sq: int, caps: Tuple[int,...] = ()):
        self.from_sq = from_sq
        self.to_sq   = to_sq
        self.caps    = caps
    def is_capture(self) -> bool: return len(self.caps) > 0
    def to_hub(self) -> str:
        sep = 'x' if self.caps else '-'
        s = f'{self.from_sq}{sep}{self.to_sq}'
        for c in self.caps: s += f'x{c}'
        return s
    @staticmethod
    def from_hub(s: str) -> 'Move':
        nums = [int(t) for t in re.split(r'[x\-]', s.strip()) if t.isdigit()]
        if len(nums) < 2: raise ValueError(f"Bad hub: '{s}'")
        return Move(nums[0], nums[1], tuple(nums[2:]))
    def __repr__(self): return f'Move({self.to_hub()})'
    def __eq__(self, o): return (isinstance(o, Move) and self.from_sq==o.from_sq
                                  and self.to_sq==o.to_sq and self.caps==o.caps)
    def __hash__(self): return hash((self.from_sq, self.to_sq, self.caps))

# ══════════════════════════════════════════════════════════════════════════════
# GAME STATE + MOVE GENERATOR
#   All square numbers are in NIGERIAN numbering.
# ══════════════════════════════════════════════════════════════════════════════

_DIRS   = [(-1,-1),(-1,+1),(+1,-1),(+1,+1)]
_PROMO  = {'W': 0, 'B': 9}
_FWD    = {'W': [(-1,-1),(-1,+1)], 'B': [(+1,-1),(+1,+1)]}

def _col(pc: str) -> str:   return 'W' if pc in ('w','W') else 'B'
def _king(pc: str) -> bool: return pc in ('W','B')
def _opp(c: str)  -> str:   return 'B' if c == 'W' else 'W'

class GameState:
    def __init__(self):
        self.board: Dict[int, Optional[str]] = {}
        self.turn:  str  = 'W'
        self.first_mover: str = 'W'
        self.moves: List[Move] = []
        self.legal: List[Move] = []
        self.game_over: bool = False
        self.result:    str  = ''
        self.custom_fen: Optional[str] = None   # set by board editor; overrides default FEN
        self.reset('W')

    def reset(self, first_mover: str = 'W'):
        self.board = {sq: None for sq in range(1, 51)}
        for sq in range(1,  21): self.board[sq] = 'b'
        for sq in range(31, 51): self.board[sq] = 'w'
        self.turn = first_mover
        self.first_mover = first_mover
        self.moves = []; self.game_over = False; self.result = ''
        self.custom_fen = None
        self.legal = self._gen_legal()

    def set_custom(self, board: Dict[int, Optional[str]], turn: str):
        """Load a position from the board editor and build a custom engine FEN."""
        self.board = {sq: board.get(sq) for sq in range(1, 51)}
        self.turn = turn
        self.first_mover = turn
        self.moves = []
        self.game_over = False
        self.result = ''
        self.custom_fen = board_to_scan_fen(self.board, turn)
        self.legal = self._gen_legal()

    def pieces_of(self, color: str) -> List[Tuple[int,str]]:
        return [(sq,pc) for sq,pc in self.board.items()
                if pc and _col(pc)==color]

    def count(self, color: str) -> int:
        return len(self.pieces_of(color))

    def king_count(self, color: str) -> int:
        return sum(1 for _,pc in self.pieces_of(color) if _king(pc))

    def apply_move(self, mv: Move):
        pc = self.board.get(mv.from_sq)
        if pc is None: raise ValueError(f'No piece at {mv.from_sq}')
        self.board[mv.from_sq] = None
        for cap in mv.caps: self.board[cap] = None
        r, _ = ng_sq_to_rc(mv.to_sq)
        color = _col(pc)
        if not _king(pc) and r == _PROMO[color]:
            pc = color            # promote
        self.board[mv.to_sq] = pc
        self.moves.append(mv)
        self.turn = _opp(self.turn)
        self._check_end()

    def undo_two(self):
        n = len(self.moves)
        if n == 0: return
        saved = self.moves[:max(0, n-2)]
        self.reset(self.first_mover)
        for mv in saved: self.apply_move(mv)

    def _check_end(self):
        if self._ng_draw():
            self.game_over = True; self.result = 'draw'; return
        leg = self._gen_legal()
        if not leg:
            winner = _opp(self.turn)
            self.game_over = True
            self.result = 'white_wins' if winner=='W' else 'black_wins'
            return
        self.legal = leg

    def _ng_draw(self) -> bool:
        """Rules 4.1-4.4: lone king vs ≤3 pieces → draw."""
        for lone in ('W','B'):
            lp = self.pieces_of(lone)
            if len(lp)==1 and _king(lp[0][1]) and self.count(_opp(lone))<=3:
                return True
        return False

    # ── Legal move generation ─────────────────────────────────────────────────
    def _gen_legal(self) -> List[Move]:
        caps: List[Move] = []; quiets: List[Move] = []
        for sq,pc in self.pieces_of(self.turn):
            if _king(pc): caps+=self._kcaps(sq); quiets+=self._kquiet(sq)
            else:         caps+=self._mcaps(sq); quiets+=self._mquiet(sq)
        return _dedup(caps) if caps else _dedup(quiets)

    def _mquiet(self, sq: int) -> List[Move]:
        r,c = ng_sq_to_rc(sq); color=_col(self.board[sq]); out=[]
        for dr,dc in _FWD[color]:
            t = ng_rc_to_sq(r+dr, c+dc)
            if t and self.board[t] is None: out.append(Move(sq,t))
        return out

    def _mcaps(self, sq: int) -> List[Move]:
        enemy=_opp(_col(self.board[sq])); res=[]; seen=set()
        bd=dict(self.board); bd[sq]=None
        _mc_rec(sq,sq,bd,[],res,seen,enemy)
        return res

    def _kquiet(self, sq: int) -> List[Move]:
        r,c=ng_sq_to_rc(sq); out=[]
        for dr,dc in _DIRS:
            nr,nc=r+dr,c+dc
            while True:
                t=ng_rc_to_sq(nr,nc)
                if t is None or self.board[t] is not None: break
                out.append(Move(sq,t)); nr+=dr; nc+=dc
        return out

    def _kcaps(self, sq: int) -> List[Move]:
        enemy=_opp(_col(self.board[sq])); res=[]; seen=set()
        bd=dict(self.board); bd[sq]=None
        _kc_rec(sq,sq,bd,[],res,seen,enemy)
        return res

    # ── Helpers ───────────────────────────────────────────────────────────────
    def legal_from(self, sq: int) -> List[Move]:
        return [mv for mv in self.legal if mv.from_sq==sq]

    def legal_dests(self, sq: int) -> Set[int]:
        return {mv.to_sq for mv in self.legal_from(sq)}

    def find_move(self, fsq: int, tsq: int) -> Optional[Move]:
        cands=[mv for mv in self.legal if mv.from_sq==fsq and mv.to_sq==tsq]
        return max(cands, key=lambda m: len(m.caps)) if cands else None

    def can_move_sq(self, sq: int) -> bool:
        pc=self.board.get(sq)
        return bool(pc and _col(pc)==self.turn and self.legal_from(sq))

    def pieces_can_move(self) -> Set[int]:
        return {mv.from_sq for mv in self.legal}

    def all_moves_scan_hub(self) -> str:
        """Full move history in SCAN numbering for engine."""
        return ' '.join(convert_move_str(mv.to_hub()) for mv in self.moves)


# ── Stand-alone recursive helpers (outside class for speed) ──────────────────

def _dedup(moves: List[Move]) -> List[Move]:
    seen: set = set(); out: List[Move] = []
    for mv in moves:
        k=(mv.from_sq,mv.to_sq,frozenset(mv.caps))
        if k not in seen: seen.add(k); out.append(mv)
    return out

def _mc_rec(start, cur, bd, caps, res, seen, enemy):
    r,c=ng_sq_to_rc(cur)
    found = False
    for dr,dc in _DIRS:
        mid=ng_rc_to_sq(r+dr,c+dc); land=ng_rc_to_sq(r+2*dr,c+2*dc)
        if mid is None or land is None: continue
        mp=bd[mid]
        if mp is None or _col(mp)!=enemy: continue
        if mid in caps: continue
        # Captured pieces stay on the board (ghost-piece rule):
        # they block flying kings and prevent re-landing.
        # caps list already prevents double-jumping the same piece.
        if bd[land] is not None and land!=start: continue
        found = True
        _mc_rec(start,land,bd,caps+[mid],res,seen,enemy)
    # Only add when no further jumps exist (terminal node — no prefix captures).
    if caps and not found:
        k=(start,cur,frozenset(caps))
        if k not in seen: seen.add(k); res.append(Move(start,cur,tuple(caps)))

def _kc_rec(start, cur, bd, caps, res, seen, enemy):
    r,c=ng_sq_to_rc(cur)
    found = False
    for dr,dc in _DIRS:
        nr,nc=r+dr,c+dc; esq=None
        while True:
            sq2=ng_rc_to_sq(nr,nc)
            if sq2 is None: break
            p2=bd[sq2]
            if p2 is not None:
                # Captured pieces stay on the board (ghost-piece rule).
                # They still block the ray — king cannot fly through or
                # land on them — but cannot be re-captured (caps check).
                if _col(p2)==enemy and sq2 not in caps: esq=sq2
                break
            nr+=dr; nc+=dc
        if esq is None: continue
        er,ec=ng_sq_to_rc(esq); lr,lc=er+dr,ec+dc
        while True:
            land=ng_rc_to_sq(lr,lc)
            if land is None: break
            if bd[land] is not None and land!=start: break
            found = True
            # Pass bd unchanged — captured piece stays as a ghost wall.
            _kc_rec(start,land,bd,caps+[esq],res,seen,enemy)
            lr+=dr; lc+=dc
    # Only add when no further jumps exist (terminal node — no prefix captures).
    if caps and not found:
        k=(start,cur,frozenset(caps))
        if k not in seen: seen.add(k); res.append(Move(start,cur,tuple(caps)))


# ══════════════════════════════════════════════════════════════════════════════
# SCAN ENGINE  (hub protocol subprocess)
#
# SCAN protocol note:
#   The engine does NOT auto-emit "done" when move-time expires.
#   It only emits "done" when it receives a "stop" command.
#   "level move-time" is just the engine's internal depth/quality guide.
#
#   Correct flow:
#     1. Send:  pos pos=<FEN> [moves=...]
#     2. Send:  go think
#     3. Wait:  max(MIN_THINK, think_sec) seconds  (via threading.Timer)
#     4. Send:  stop
#     5. Recv:  done move=<move>
#
#   MIN_THINK = 2.0 s is enforced as the floor for every move.
# ══════════════════════════════════════════════════════════════════════════════

class ScanEngine:
    MIN_THINK = 0.000005

    def __init__(self, binary: str, work_dir: str):
        self.binary   = binary
        self.work_dir = work_dir
        self.proc: Optional[subprocess.Popen] = None
        self.ready     = False
        self._thinking = False
        self._move_cb  = None
        self._init_cb  = None
        self._stop_timer: Optional[threading.Timer] = None

    # ── Lifecycle ──────────────────────────────────────────────────────────────
    def start(self, on_ready=None) -> bool:
        self._init_cb = on_ready
        try:
            self.proc = subprocess.Popen(
                [self.binary, 'hub'],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                cwd=self.work_dir, text=True, bufsize=1)
            threading.Thread(target=self._reader, daemon=True).start()
            self._send('hub')   # 'init' is sent when engine replies 'wait'
            return True
        except Exception as e:
            print(f'[Engine] start error: {e}')
            return False

    def stop(self):
        self._cancel_timer()
        if self.proc:
            try: self._send('quit')
            except: pass
            try: self.proc.terminate()
            except: pass
        self.proc      = None
        self.ready     = False
        self._thinking = False
        self._move_cb  = None

    # ── Externally called to abort mid-think ────────────────────────────────
    def stop_thinking(self):
        if self._thinking:
            self._cancel_timer()
            self._send('stop')          # engine will emit done, but we ignore it
            self._thinking = False
            self._move_cb  = None

    # ── Internal timer management ───────────────────────────────────────────
    def _cancel_timer(self):
        if self._stop_timer:
            self._stop_timer.cancel()
            self._stop_timer = None

    def _fire_stop(self):
        """Called by threading.Timer after think time expires."""
        self._stop_timer = None
        self._send('stop')              # engine emits "done move=..." shortly after

    # ── I/O ─────────────────────────────────────────────────────────────────
    def _send(self, line: str):
        if self.proc and self.proc.stdin:
            try:
                self.proc.stdin.write(line + '\n')
                self.proc.stdin.flush()
            except Exception as e:
                print(f'[Engine] send: {e}')

    def _reader(self):
        while self.proc:
            try:
                line = self.proc.stdout.readline()
                if not line:
                    break
                self._handle(line.strip())
            except Exception as e:
                print(f'[Engine] reader: {e}')
                break

    def _handle(self, line: str):
        if not line:
            return

        if line == 'wait':
            # Hub protocol: GUI sends 'init' only after receiving 'wait'
            self._send('init')

        elif line == 'ready':
            self.ready = True
            if self._init_cb:
                cb = self._init_cb; self._init_cb = None
                Clock.schedule_once(lambda dt: cb(), 0)

        elif line.startswith('done'):
            self._thinking = False
            self._cancel_timer()
            # Hub spec: done move=<hub_move> [ponder=<hub_move>]
            # Each token is name=value with no spaces inside value
            scan_mv = None
            for token in line.split():
                if token.startswith('move='):
                    scan_mv = token[5:]; break
            if self._move_cb:
                cb = self._move_cb; self._move_cb = None
                Clock.schedule_once(lambda dt, m=scan_mv: cb(m), 0)

        elif line.startswith('error'):
            print(f'[Engine] error from SCAN: {line}')

    # ── Request move ─────────────────────────────────────────────────────────
    def request_move(self, game: GameState, think_sec: float, callback):
        """
        Ask SCAN for its best move.
        • Sends position in SCAN numbering.
        • Sends "go think", then schedules "stop" after the think window.
        • callback(scan_hub_str) is invoked on the Kivy main thread.
        """
        if not self.ready or self._thinking:
            return
        self._move_cb  = callback
        self._thinking = True

        # Build pos command in SCAN numbering.
        # For editor-set positions, use the custom FEN; otherwise the standard start.
        scan_moves = game.all_moves_scan_hub()
        fen        = game.custom_fen if game.custom_fen else _SCAN_FEN[game.first_mover]
        if scan_moves:
            self._send(f'pos pos={fen} moves="{scan_moves}"')
        else:
            self._send(f'pos pos={fen}')

        # Hub spec: level must come before go
        secs = max(self.MIN_THINK, think_sec)
        self._send(f'level move-time={secs:.3f}')

        # Launch search
        self._send('go think')

        # Schedule 'stop' to flush 'done' from engine after think window
        secs = max(self.MIN_THINK, think_sec)
        self._stop_timer = threading.Timer(secs, self._fire_stop)
        self._stop_timer.daemon = True
        self._stop_timer.start()

    @property
    def is_thinking(self) -> bool:
        return self._thinking


# ══════════════════════════════════════════════════════════════════════════════
# BOARD WIDGET
# ══════════════════════════════════════════════════════════════════════════════

class BoardWidget(Widget):
    def __init__(self, **kw):
        super().__init__(**kw)
        self.game: Optional[GameState] = None
        self.selected_sq: Optional[int] = None
        self.highlight_dests: Set[int]  = set()
        self.last_move: Optional[Move]  = None
        self.flash_caps: Set[int]       = set()
        self.flipped: bool              = False
        self._on_move_cb = None
        # Editor mode
        self.editor_mode: bool          = False
        self.editor_piece               = 'w'    # piece code to place; None = erase
        self._on_editor_change_cb       = None
        self.bind(size=self._redraw, pos=self._redraw)

    def _redraw(self, *_): self.redraw()

    @property
    def _cell(self) -> float: return min(self.width, self.height) / 10.8
    @property
    def _bx(self)   -> float: return self.x + (self.width  - self._cell*10)/2
    @property
    def _by(self)   -> float: return self.y + (self.height - self._cell*10)/2

    def _sq_center(self, sq: int) -> Tuple[float, float]:
        row, col = ng_sq_to_rc(sq); cs=self._cell
        if not self.flipped:
            return self._bx+col*cs+cs/2, self._by+(9-row)*cs+cs/2
        else:
            return self._bx+(9-col)*cs+cs/2, self._by+row*cs+cs/2

    def _pixel_to_sq(self, px: float, py: float) -> Optional[int]:
        cs=self._cell
        vc=int((px-self._bx)/cs); vr=int((py-self._by)/cs)
        if not self.flipped: br=9-vr; bc=vc
        else:                br=vr;   bc=9-vc
        return ng_rc_to_sq(br, bc)

    def redraw(self):
        self.canvas.clear()
        if not self.game: return
        cs=self._cell; bx=self._bx; by=self._by

        with self.canvas:
            # Frame
            Color(*C_FRAME)
            Rectangle(pos=(bx-5,by-5), size=(cs*10+10,cs*10+10))
            Color(*C_FRAME_EDG)
            Line(rectangle=(bx-5,by-5,cs*10+10,cs*10+10), width=3)

            # Squares
            for sr in range(10):
                for sc in range(10):
                    br = 9-sr if not self.flipped else sr
                    bc = sc   if not self.flipped else 9-sc
                    dark = (br+bc)%2==0
                    sq   = ng_rc_to_sq(br, bc)
                    x = bx+sc*cs; y = by+sr*cs

                    Color(*(C_DARK_SQ if dark else C_LIGHT_SQ))
                    Rectangle(pos=(x,y), size=(cs,cs))
                    if not dark or sq is None: continue

                    # Highlights
                    if self.last_move:
                        if sq==self.last_move.from_sq:
                            Color(*C_LAST_FROM); Rectangle(pos=(x,y),size=(cs,cs))
                        elif sq==self.last_move.to_sq:
                            Color(*C_LAST_TO);   Rectangle(pos=(x,y),size=(cs,cs))
                    if sq==self.selected_sq:
                        Color(*C_SEL_SQ); Rectangle(pos=(x,y),size=(cs,cs))
                    if sq in self.flash_caps:
                        Color(*C_FLASH); Rectangle(pos=(x,y),size=(cs,cs))
                    if sq in self.highlight_dests and self.game.board.get(sq) is None:
                        is_cap=any(mv.is_capture() for mv in self.game.legal
                                   if mv.from_sq==self.selected_sq and mv.to_sq==sq)
                        Color(*(C_DEST_CAP if is_cap else C_DEST_Q))
                        dr2=cs*0.20
                        Ellipse(pos=(x+cs/2-dr2,y+cs/2-dr2),size=(dr2*2,dr2*2))

            # Coordinate labels
            if cs >= 26:
                for i in range(10):
                    for axis in ('row','col'):
                        n = str(i+1) if not self.flipped else str(10-i)
                        cl=CoreLabel(text=n, font_size=cs*0.19)
                        cl.refresh(); tx=cl.texture
                        if tx:
                            Color(*C_DIM[:3], 0.55)
                            if axis=='row':
                                Rectangle(texture=tx,
                                          pos=(bx-tx.width-2, by+i*cs+cs/2-tx.height/2),
                                          size=tx.size)
                            else:
                                Rectangle(texture=tx,
                                          pos=(bx+i*cs+cs/2-tx.width/2, by-tx.height-2),
                                          size=tx.size)

            # Pieces
            for sq in range(1, 51):
                pc=self.game.board.get(sq)
                if pc: self._draw_piece(sq, pc, cs)

            # Editor overlay: highlight all dark squares as drop-targets
            if self.editor_mode:
                for sq in range(1, 51):
                    cx, cy = self._sq_center(sq)
                    r, c = ng_sq_to_rc(sq)
                    if (r + c) % 2 == 0:        # dark square
                        # faint gold rim on every playable square
                        Color(0.94, 0.81, 0.19, 0.18)
                        sz = cs * 0.94
                        Rectangle(pos=(cx - sz/2, cy - sz/2), size=(sz, sz))

    def _draw_piece(self, sq: int, pc: str, cs: float):
        cx,cy=self._sq_center(sq); king=_king(pc); color=_col(pc)
        r=cs*0.40; fr=r*0.87; ri=r*0.28
        Color(0,0,0,0.42); Ellipse(pos=(cx-r+2,cy-r-2),size=(r*2,r*2))
        Color(*(C_WH_RING if color=='W' else C_BK_RING))
        Ellipse(pos=(cx-r,cy-r),size=(r*2,r*2))
        Color(*(C_WH_FILL if color=='W' else C_BK_FILL))
        Ellipse(pos=(cx-fr,cy-fr),size=(fr*2,fr*2))
        Color(*(C_WH_INNER if color=='W' else C_BK_INNER))
        Ellipse(pos=(cx-ri,cy-ri),size=(ri*2,ri*2))
        if king:
            Color(*C_CROWN_G); kr=r*0.55
            Ellipse(pos=(cx-kr,cy-kr),size=(kr*2,kr*2))
            Color(*C_CROWN_D); kr2=r*0.36
            Ellipse(pos=(cx-kr2,cy-kr2),size=(kr2*2,kr2*2))
            Color(*C_CROWN_G); kd=r*0.17
            Ellipse(pos=(cx-kd,cy-kd),size=(kd*2,kd*2))

    def on_touch_down(self, touch):
        if not self.game: return
        if not self.collide_point(*touch.pos): return
        sq = self._pixel_to_sq(*touch.pos)
        if sq is None: return
        if self.editor_mode:
            self._editor_click(sq)
        elif not self.game.game_over:
            self._click(sq)

    def _editor_click(self, sq: int):
        """Place or erase a piece in board-editor mode."""
        cur = self.game.board.get(sq)
        if self.editor_piece is None or cur == self.editor_piece:
            self.game.board[sq] = None      # erase (or toggle off)
        else:
            self.game.board[sq] = self.editor_piece
        self.redraw()
        if self._on_editor_change_cb:
            self._on_editor_change_cb()

    def _click(self, sq: int):
        g=self.game; pc=g.board.get(sq); clr=g.turn
        if self.selected_sq is None:
            if pc and _col(pc)==clr and g.can_move_sq(sq):
                self.selected_sq=sq; self.highlight_dests=g.legal_dests(sq)
                self.redraw()
        else:
            if sq==self.selected_sq: self._clr(); return
            if pc and _col(pc)==clr and g.can_move_sq(sq):
                self.selected_sq=sq; self.highlight_dests=g.legal_dests(sq)
                self.redraw(); return
            if sq in self.highlight_dests:
                mv=g.find_move(self.selected_sq,sq)
                if mv: self._clr(); self._on_move_cb and self._on_move_cb(mv)
            else: self._clr()

    def _clr(self): self.selected_sq=None; self.highlight_dests=set(); self.redraw()

    def flash_captured(self, caps, on_done=None):
        if not caps:
            if on_done: on_done(); return
        self.flash_caps=set(caps); self.redraw()
        def _off(dt): self.flash_caps=set(); self.redraw(); on_done and on_done()
        Clock.schedule_once(_off, 0.30)


# ══════════════════════════════════════════════════════════════════════════════
# STYLED BUTTON
# ══════════════════════════════════════════════════════════════════════════════

class Btn(Button):
    def __init__(self, **kw):
        kw.setdefault('background_normal',''); kw.setdefault('background_down','')
        kw.setdefault('background_color',C_BTN_N); kw.setdefault('color',C_BTN_TXT)
        kw.setdefault('font_size',14); kw.setdefault('bold',True)
        super().__init__(**kw)
    def on_press(self):   self.background_color=C_BTN_A
    def on_release(self): self.background_color=C_BTN_N


# ══════════════════════════════════════════════════════════════════════════════
# PRE-GAME DIALOG
#   Shows before every new game.
#   Player chooses: who goes first · play mode · strength
# ══════════════════════════════════════════════════════════════════════════════

class PreGamePopup(Popup):
    def __init__(self, on_start, defaults: dict, **kw):
        kw.setdefault('title', 'Nigerian Draughts — New Game')
        kw.setdefault('size_hint', (0.90, 0.85))
        kw.setdefault('auto_dismiss', False)
        kw.setdefault('background_color', (*C_PANEL_BG[:3], 0.97))
        kw.setdefault('title_color', C_HDR)
        kw.setdefault('title_size', 17)
        super().__init__(**kw)
        self._cb   = on_start
        self._fm   = defaults.get('first_mover','W')
        self._mode = defaults.get('play_mode','Human vs AI')
        self._tkey = defaults.get('think_key','Medium (10s)')

        root = BoxLayout(orientation='vertical', spacing=8, padding=12)

        # ── Who goes first ──
        root.add_widget(self._sec_label('Who Goes First?'))
        row_fm = BoxLayout(spacing=6, size_hint_y=None, height=50)
        self._b_fw = Btn(text='⬜  White first', font_size=15)
        self._b_fb = Btn(text='⬛  Black first', font_size=15)
        self._b_fw.bind(on_release=lambda *_: self._set('fm','W'))
        self._b_fb.bind(on_release=lambda *_: self._set('fm','B'))
        row_fm.add_widget(self._b_fw); row_fm.add_widget(self._b_fb)
        root.add_widget(row_fm)
        self._div(root)

        # ── Play mode ──
        root.add_widget(self._sec_label('Play Mode'))
        self._mode_btns: Dict[str,Btn] = {}
        for modes in [PLAY_MODES[:2], PLAY_MODES[2:]]:
            row = BoxLayout(spacing=5, size_hint_y=None, height=46)
            for m in modes:
                short = m.replace('Human','H').replace(' vs ','⚔')
                b = Btn(text=short, font_size=13)
                b.bind(on_release=lambda *_,md=m: self._set('mode',md))
                self._mode_btns[m]=b; row.add_widget(b)
            root.add_widget(row)
        self._div(root)

        # ── Strength ──
        root.add_widget(self._sec_label('AI Strength (min 2 s always)'))
        self._str_btns: Dict[str,Btn] = {}
        srow = BoxLayout(spacing=4, size_hint_y=None, height=46)
        for key in THINK_TIMES:
            short = key.split('(')[0].strip()
            b = Btn(text=short, font_size=12)
            b.bind(on_release=lambda *_,k=key: self._set('str',k))
            self._str_btns[key]=b; srow.add_widget(b)
        root.add_widget(srow)
        self._div(root)

        # ── Start ──
        go = Button(text='▶  START GAME', font_size=19, bold=True,
                    background_normal='', background_color=(*C_CROWN_G[:3],1.0),
                    color=(0.04,0.02,0.00,1.0), size_hint_y=None, height=58)
        go.bind(on_release=self._go)
        root.add_widget(go)
        self.content = root
        self._refresh()

    @staticmethod
    def _sec_label(t): return Label(text=f'[b]{t}[/b]', markup=True,
                                    font_size=14, color=C_HDR,
                                    size_hint_y=None, height=26, halign='center')
    @staticmethod
    def _div(p):
        d = Widget(size_hint_y=None, height=1)
        with d.canvas:
            Color(*C_DIVIDER)
            rect = Rectangle(pos=d.pos, size=d.size)
        d.bind(pos=lambda i, v: setattr(rect, 'pos', v),
               size=lambda i, v: setattr(rect, 'size', v))
        p.add_widget(d)

    def _set(self, field, val):
        if field=='fm':   self._fm=val
        elif field=='mode': self._mode=val
        elif field=='str':  self._tkey=val
        self._refresh()

    def _refresh(self):
        self._b_fw.background_color = C_BTN_SEL if self._fm=='W' else C_BTN_N
        self._b_fb.background_color = C_BTN_SEL if self._fm=='B' else C_BTN_N
        for m,b in self._mode_btns.items():
            b.background_color = C_BTN_SEL if m==self._mode else C_BTN_N
        for k,b in self._str_btns.items():
            b.background_color = C_BTN_SEL if k==self._tkey else C_BTN_N

    def _go(self, *_):
        self.dismiss()
        self._cb(first_mover=self._fm, play_mode=self._mode, think_key=self._tkey)


# ══════════════════════════════════════════════════════════════════════════════
# MAIN APP
# ══════════════════════════════════════════════════════════════════════════════

class NigerianDraughtsApp(App):
    title = 'Nigerian Draughts – kennykentro'

    def __init__(self, **kw):
        super().__init__(**kw)
        self.game       = GameState()
        self.engine     = self._make_engine()
        self.play_mode  = 'Human vs AI'
        self.think_time = 10.0
        self.think_key  = 'Medium (10s)'
        self._ai_lock   = False
        self._dlg_open  = False
        self.board_w:    Optional[BoardWidget] = None
        self.status_lbl: Optional[Label]       = None
        self.think_lbl:  Optional[Label]       = None
        self.hist_lbl:   Optional[Label]       = None
        self._think_ev   = None
        # Board editor state
        self._editor_mode: bool     = False
        self._editor_turn: str      = 'W'
        self._edit_piece_btns: dict = {}   # pc→Btn
        self._edit_turn_btns: dict  = {}   # turn→Btn
        self._ctrl_box              = None  # dynamic control area widget

    @staticmethod
    def _engine_dir() -> str:
        return os.path.dirname(os.path.abspath(__file__))

    @staticmethod
    def _engine_bin() -> str:
        d = NigerianDraughtsApp._engine_dir()
        for n in ('scan_nigerian','scan_nigerian.exe','scan'):
            p=os.path.join(d,n)
            if os.path.isfile(p) and os.access(p,os.X_OK): return p
        return os.path.join(d,'scan_nigerian')

    def _make_engine(self): return ScanEngine(self._engine_bin(), self._engine_dir())

    # ── Build ─────────────────────────────────────────────────────────────────
    def build(self):
        Window.clearcolor=C_UI_BG
        Window.minimum_width=700; Window.minimum_height=560
        root=BoxLayout(orientation='horizontal', spacing=6, padding=6)
        bw=BoardWidget(size_hint=(0.62,1))
        bw.game=self.game; bw._on_move_cb=self._on_human_move
        root.add_widget(bw); self.board_w=bw
        root.add_widget(self._build_panel())
        self.engine.start(on_ready=self._engine_ready)
        return root

    def _build_panel(self) -> BoxLayout:
        p=BoxLayout(orientation='vertical', spacing=5, padding=8)
        p.size_hint=(0.38,1)
        p.add_widget(Label(text='[b]NIGERIAN\nDRAUGHTS[/b]',
                           markup=True, font_size=17, halign='center',
                           color=C_HDR, size_hint_y=None, height=80))
        self._div(p)
        self.status_lbl=Label(text='Loading engine…', font_size=12, halign='center',
                              valign='middle', color=C_TEXT, size_hint_y=None,
                              height=54, markup=True)
        p.add_widget(self.status_lbl)
        self.think_lbl=Label(text='', font_size=12, halign='center',
                             color=C_GOLD, size_hint_y=None, height=22, markup=True)
        p.add_widget(self.think_lbl)
        self._div(p)

        # Dynamic control area — swapped between game controls and editor controls
        self._ctrl_box = BoxLayout(orientation='vertical', spacing=4,
                                   size_hint_y=None, height=0)
        self._ctrl_box.bind(minimum_height=self._ctrl_box.setter('height'))
        self._populate_game_controls()
        p.add_widget(self._ctrl_box)

        self._div(p)
        p.add_widget(Label(text='Move History', font_size=12, color=C_DIM,
                           size_hint_y=None, height=22))
        sv=ScrollView(size_hint=(1,1))
        self.hist_lbl=Label(text='', markup=True, font_size=11, color=C_TEXT,
                            halign='left', valign='top', size_hint_y=None)
        self.hist_lbl.bind(texture_size=lambda i,ts: setattr(i,'height',ts[1]))
        sv.add_widget(self.hist_lbl); p.add_widget(sv)
        self._div(p)
        p.add_widget(Label(text='[color=554422]kennykentro · Nigerian rules[/color]',
                           markup=True, font_size=9, halign='center',
                           size_hint_y=None, height=22))
        return p

    def _populate_game_controls(self):
        """Fill _ctrl_box with the normal game buttons."""
        box = self._ctrl_box
        box.clear_widgets()
        r1=BoxLayout(spacing=4, size_hint_y=None, height=46)
        for txt,cb in [('⟳ New',self._on_new),('↩ Undo',self._on_undo),('⇅ Flip',self._on_flip)]:
            b=Btn(text=txt); b.bind(on_release=cb); r1.add_widget(b)
        box.add_widget(r1)
        r2=BoxLayout(spacing=4, size_hint_y=None, height=46)
        b_res=Btn(text='⚑  Resign'); b_res.bind(on_release=self._on_resign); r2.add_widget(b_res)
        b_ed=Btn(text='✏ Edit Board', background_color=(0.18,0.35,0.12,1.0))
        b_ed.bind(on_release=lambda *_: self._enter_editor())
        r2.add_widget(b_ed)
        box.add_widget(r2)

    def _populate_editor_controls(self):
        """Fill _ctrl_box with the board-editor palette and actions."""
        box = self._ctrl_box
        box.clear_widgets()

        box.add_widget(Label(text='[b]✏  BOARD  EDITOR[/b]', markup=True,
                             font_size=13, color=C_GOLD,
                             size_hint_y=None, height=26, halign='center'))

        # Piece palette
        box.add_widget(Label(text='Piece to place:', font_size=11, color=C_DIM,
                             size_hint_y=None, height=20, halign='left'))
        self._edit_piece_btns = {}
        for row_pcs in [EDITOR_PIECES[:2], EDITOR_PIECES[2:]]:
            row = BoxLayout(spacing=3, size_hint_y=None, height=42)
            for pc, lbl, base_col in row_pcs:
                b = Btn(text=lbl, font_size=11, background_color=base_col)
                b.bind(on_release=lambda *_, p=pc: self._on_editor_piece(p))
                self._edit_piece_btns[pc] = b
                row.add_widget(b)
            box.add_widget(row)
        self._refresh_editor_btns()

        # Turn selector
        box.add_widget(Label(text='Who moves next:', font_size=11, color=C_DIM,
                             size_hint_y=None, height=20, halign='left'))
        trow = BoxLayout(spacing=4, size_hint_y=None, height=40)
        self._edit_turn_btns = {}
        for turn, lbl in [('W','⬜ White'), ('B','⬛ Black')]:
            b = Btn(text=lbl, font_size=12)
            b.bind(on_release=lambda *_, t=turn: self._on_editor_turn(t))
            self._edit_turn_btns[turn] = b; trow.add_widget(b)
        box.add_widget(trow)
        self._refresh_turn_btns()

        # Action buttons
        arow1 = BoxLayout(spacing=4, size_hint_y=None, height=42)
        b_go = Button(text='▶ Start from here', font_size=13, bold=True,
                      background_normal='', background_color=(*C_CROWN_G[:3],1.0),
                      color=(0.04,0.02,0.00,1.0))
        b_go.bind(on_release=lambda *_: self._on_edit_start())
        arow1.add_widget(b_go)
        box.add_widget(arow1)

        arow2 = BoxLayout(spacing=4, size_hint_y=None, height=40)
        for txt, cb, col in [
            ('🗑 Clear', self._on_edit_clear, (0.35,0.10,0.04,1.0)),
            ('↺ Reset',  self._on_edit_reset, (0.20,0.25,0.10,1.0)),
            ('✕ Cancel', self._on_edit_cancel,(0.25,0.25,0.25,1.0)),
        ]:
            b = Btn(text=txt, font_size=11, background_color=col)
            b.bind(on_release=lambda *_, c=cb: c())
            arow2.add_widget(b)
        box.add_widget(arow2)

    @staticmethod
    def _div(parent):
        d = Widget(size_hint_y=None, height=1)
        with d.canvas:
            Color(*C_DIVIDER)
            rect = Rectangle(pos=d.pos, size=d.size)
        d.bind(pos=lambda i, v: setattr(rect, 'pos', v),
               size=lambda i, v: setattr(rect, 'size', v))
        parent.add_widget(d)

    # ── Engine ready ──────────────────────────────────────────────────────────
    def _engine_ready(self):
        self._update_status()
        Clock.schedule_once(lambda dt: self._show_dialog(), 0.3)

    # ── Pre-game dialog ───────────────────────────────────────────────────────
    def _show_dialog(self):
        if self._dlg_open: return
        self._dlg_open=True
        dlg=PreGamePopup(
            on_start=self._start_game,
            defaults=dict(first_mover=self.game.first_mover,
                          play_mode=self.play_mode,
                          think_key=self.think_key))
        dlg.bind(on_dismiss=lambda *_: setattr(self,'_dlg_open',False))
        dlg.open()

    def _start_game(self, first_mover, play_mode, think_key):
        self.play_mode=play_mode; self.think_key=think_key
        self.think_time=THINK_TIMES.get(think_key,5.0)
        self._ai_lock=False; self._stop_think(); self.engine.stop_thinking()
        # Hub protocol: new-game clears the engine's transposition table
        if self.engine.ready:
            self.engine._send('new-game')
        self.game.reset(first_mover)
        bw=self.board_w; bw.last_move=None; bw.selected_sq=None
        bw.highlight_dests=set(); bw.flash_caps=set(); bw.redraw()
        self._update_status(); self._update_hist()
        if self._ai_should_move():
            Clock.schedule_once(lambda dt: self._req_ai(), 0.5)

    # ── Human move ────────────────────────────────────────────────────────────
    def _on_human_move(self, mv: Move):
        if self.game.game_over or self._ai_lock: return
        pc=self.game.board.get(mv.from_sq,'')
        if pc and not self._is_human(_col(pc)): return
        self._exec(mv, then=self._after_human)

    def _after_human(self):
        if self.game.game_over: self._show_result(); return
        if self._ai_should_move():
            Clock.schedule_once(lambda dt: self._req_ai(), 0.25)

    # ── AI move ───────────────────────────────────────────────────────────────
    def _ai_should_move(self) -> bool:
        return (not self.game.game_over and self.engine.ready
                and not self._ai_lock and not self._is_human(self.game.turn))

    def _req_ai(self):
        if self.game.game_over or self._ai_lock or not self.engine.ready: return
        self._ai_lock=True; self._start_think()
        self.engine.request_move(self.game, self.think_time, self._on_ai_move)

    def _on_ai_move(self, scan_hub: Optional[str]):
        """Receive SCAN move → convert SCAN→Nigerian → apply."""
        self._stop_think(); self._ai_lock=False
        if scan_hub is None:
            self._update_status('Engine returned no move.')
            return
        ng_hub = convert_move_str(scan_hub)     # ← THE CONVERSION
        try:   mv = Move.from_hub(ng_hub)
        except Exception as e:
            self._update_status(f'Parse error: {e}'); return
        if self.game.game_over: return
        self._exec(mv, then=self._after_ai)

    def _after_ai(self):
        if self.game.game_over: self._show_result(); return
        if self.play_mode=='AI vs AI':
            Clock.schedule_once(lambda dt: self._req_ai(), 0.5)

    # ── Execute move ──────────────────────────────────────────────────────────
    def _exec(self, mv: Move, then=None):
        def _apply():
            self.game.apply_move(mv); self.board_w.last_move=mv
            self.board_w.redraw(); self._update_hist(); self._update_status()
            if then: then()
        if mv.is_capture(): self.board_w.flash_captured(mv.caps, on_done=_apply)
        else:               _apply()

    # ── Board editor ─────────────────────────────────────────────────────────
    def _enter_editor(self):
        """Switch to board-editor mode."""
        self.engine.stop_thinking(); self._ai_lock = False; self._stop_think()
        self._editor_mode = True
        self._editor_turn = self.game.turn
        bw = self.board_w
        bw.editor_mode  = True
        bw.editor_piece = 'w'
        bw.selected_sq  = None; bw.highlight_dests = set()
        bw._on_editor_change_cb = lambda: self._update_status()
        bw.redraw()
        self._populate_editor_controls()
        self._update_status()

    def _exit_editor(self):
        """Return board widget to normal play mode."""
        self._editor_mode = False
        bw = self.board_w
        bw.editor_mode = False; bw.editor_piece = 'w'
        bw._on_editor_change_cb = None
        bw.redraw()
        self._populate_game_controls()

    def _on_editor_piece(self, pc):
        self.board_w.editor_piece = pc
        self._refresh_editor_btns()

    def _on_editor_turn(self, turn: str):
        self._editor_turn = turn
        self._refresh_turn_btns()

    def _refresh_editor_btns(self):
        cur = self.board_w.editor_piece
        for pc, lbl, base_col in EDITOR_PIECES:
            b = self._edit_piece_btns.get(pc)
            if b:
                b.background_color = (*base_col[:3], 1.0) if pc == cur \
                    else (*[x*0.6 for x in base_col[:3]], 0.9)

    def _refresh_turn_btns(self):
        for t, b in self._edit_turn_btns.items():
            b.background_color = C_BTN_SEL if t == self._editor_turn else C_BTN_N

    def _on_edit_start(self):
        """Apply the edited position and start a game from it."""
        # Validate: there must be at least one piece per side
        board = self.game.board
        whites = [sq for sq,pc in board.items() if pc in ('w','W')]
        blacks = [sq for sq,pc in board.items() if pc in ('b','B')]
        if not whites or not blacks:
            self._update_status('Need ≥1 piece per side!')
            return
        turn = self._editor_turn
        self._exit_editor()
        if self.engine.ready:
            self.engine._send('new-game')
        self.game.set_custom(board, turn)
        bw = self.board_w
        bw.last_move = None; bw.selected_sq = None
        bw.highlight_dests = set(); bw.flash_caps = set()
        bw.redraw()
        self._update_status(); self._update_hist()
        if self._ai_should_move():
            Clock.schedule_once(lambda dt: self._req_ai(), 0.5)

    def _on_edit_clear(self):
        """Remove all pieces from the board (editor only)."""
        for sq in self.game.board: self.game.board[sq] = None
        self.board_w.redraw()

    def _on_edit_reset(self):
        """Restore standard starting position in the editor."""
        b = self.game.board
        for sq in range(1,  51): b[sq] = None
        for sq in range(1,  21): b[sq] = 'b'
        for sq in range(31, 51): b[sq] = 'w'
        self.board_w.redraw()

    def _on_edit_cancel(self):
        """Cancel editor without changing anything."""
        self._exit_editor()
        self._update_status()

    # ── Controls ──────────────────────────────────────────────────────────────
    def _on_new(self, *_):
        self.engine.stop_thinking(); self._ai_lock=False; self._stop_think()
        self._show_dialog()

    def _on_undo(self, *_):
        if not self.game.moves: return
        self.engine.stop_thinking(); self._ai_lock=False; self._stop_think()
        self.game.undo_two()
        bw=self.board_w; bw.last_move=self.game.moves[-1] if self.game.moves else None
        bw.selected_sq=None; bw.highlight_dests=set(); bw.redraw()
        self._update_status(); self._update_hist()

    def _on_flip(self, *_):
        self.board_w.flipped=not self.board_w.flipped; self.board_w.redraw()

    def _on_resign(self, *_):
        if self.game.game_over: return
        self.game.game_over=True; winner=_opp(self.game.turn)
        self.game.result='white_wins' if winner=='W' else 'black_wins'
        self._show_result()

    def _is_human(self, color: str) -> bool:
        if self.play_mode=='Human vs Human': return True
        if self.play_mode=='AI vs AI':       return False
        if self.play_mode=='Human vs AI':    return color=='W'
        if self.play_mode=='AI vs Human':    return color=='B'
        return True

    # ── Think animation ───────────────────────────────────────────────────────
    def _start_think(self):
        self._tdots=0
        def _tick(dt):
            if not self.engine.is_thinking: return
            dots='.'*(self._tdots%4+1)
            side='White' if self.game.turn=='W' else 'Black'
            if self.think_lbl:
                self.think_lbl.markup=True
                self.think_lbl.text=f'[b]{side} thinking{dots}[/b]'
            self._tdots+=1
        self._think_ev=Clock.schedule_interval(_tick, 0.38)

    def _stop_think(self):
        if self._think_ev: self._think_ev.cancel(); self._think_ev=None
        if self.think_lbl: self.think_lbl.text=''

    # ── Status label ──────────────────────────────────────────────────────────
    def _update_status(self, extra=''):
        if not self.status_lbl: return
        g=self.game
        if not self.engine.ready:
            self.status_lbl.markup=True
            self.status_lbl.text='[b]⚙ Loading engine…[/b]'; return
        if g.game_over:
            self.status_lbl.markup=True
            self.status_lbl.text=self._result_txt(); return
        wm=g.count('W')-g.king_count('W'); wk=g.king_count('W')
        bm=g.count('B')-g.king_count('B'); bk=g.king_count('B')
        tw='[b][color=f5ead0]WHITE[/color][/b]'
        tb='[b][color=c8a46e]BLACK[/color][/b]'
        ts=tw if g.turn=='W' else tb
        cap='\n[b][color=ff6644]⚡ MUST CAPTURE[/color][/b]' if any(mv.is_capture() for mv in g.legal) else ''
        mt=''
        if self.play_mode=='Human vs AI':   mt=' (you)' if g.turn=='W' else ' (SCAN)'
        elif self.play_mode=='AI vs Human': mt=' (SCAN)' if g.turn=='W' else ' (you)'
        self.status_lbl.markup=True
        self.status_lbl.text=(f'{ts}{mt} to move{cap}\n'
                               f'[color=aaaaaa]⬜{wm}M {wk}K  ·  ⬛{bm}M {bk}K[/color]')
        if extra: self.status_lbl.text+=f'\n[color=ff8888]{extra}[/color]'

    def _result_txt(self) -> str:
        r=self.game.result
        if r=='white_wins': return '[b][color=f5ead0]◈ WHITE WINS ◈[/color][/b]'
        if r=='black_wins': return '[b][color=c8a46e]◈ BLACK WINS ◈[/color][/b]'
        if r=='draw':       return '[b][color=aaaaaa]★ DRAW (rules 4.1-4.4) ★[/color][/b]'
        return '[b]Game Over[/b]'

    def _show_result(self):
        self.board_w.redraw(); self._update_status(); self._stop_think()
        rt=self.game.result.replace('_',' ').upper()
        pop=Popup(title='Game Over',
                  content=Label(text=f'[b]{rt}[/b]', markup=True,
                                halign='center', font_size=22, color=C_GOLD),
                  size_hint=(0.52,0.28),
                  background_color=(*C_PANEL_BG[:3],0.97), title_color=C_HDR)
        pop.open(); Clock.schedule_once(lambda dt: pop.dismiss(), 3.5)

    # ── Move history ──────────────────────────────────────────────────────────
    def _update_hist(self):
        if not self.hist_lbl: return
        mvs=self.game.moves
        if not mvs:
            self.hist_lbl.markup=True
            self.hist_lbl.text='[color=554422]No moves yet[/color]'; return
        lines=[]
        for i in range(0,len(mvs),2):
            n=i//2+1
            wm=mvs[i].to_hub()
            bm=mvs[i+1].to_hub() if i+1<len(mvs) else '…'
            lines.append(f'[color=665533]{n:2d}.[/color] '
                         f'[color=e8dcbe]{wm}[/color]  '
                         f'[color=a07840]{bm}[/color]')
        self.hist_lbl.markup=True
        self.hist_lbl.text='\n'.join(lines)

    def on_stop(self): self.engine.stop()


# ══════════════════════════════════════════════════════════════════════════════
# ENTRY POINT
# ══════════════════════════════════════════════════════════════════════════════
if __name__ == '__main__':
    NigerianDraughtsApp().run()
