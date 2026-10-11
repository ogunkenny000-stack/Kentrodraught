# Nigerian International Draughts — SCAN 3.1 Engine

Full-featured 10×10 Nigerian Draughts with SCAN 3.1 AI and Kivy GUI.

## Quick Start — macOS Intel i5

```bash
xcode-select --install          # C++ compiler (one time)
pip3 install kivy               # GUI (one time)
make -f Makefile_macos          # compile engine
./run.sh                        # launch game
```

## Quick Start — Linux

```bash
sudo apt install build-essential
pip3 install kivy
make -f Makefile_linux
./run.sh
```

## Nigerian Rules vs FMJD

| Rule | Nigerian (this app) | FMJD Standard |
|------|---------------------|---------------|
| Capture obligation | Must capture if possible | Must capture if possible |
| Max-capture rule | **FREE CHOICE** (rule 2.9) | Must take maximum |
| King type | **Flying King** (long range) | Flying King |
| Huffing rule | **Not enforced** | Not applicable |
| Draw: 1K vs ≤3 pieces | **Draw** (rules 4.1-4.4) | Not the same |

## Engine changes from SCAN 3.1

Only 3 files modified — all search, eval, TT, LMR internals untouched:

- **var.cpp/hpp**: Added `Nigerian` variant type
- **list.cpp**: Rule 2.9 — skip max-capture filter for Nigerian variant  
- **pos.cpp**: Rules 4.1-4.4 — Nigerian draw detection and result scoring

The full 8.5 MB SCAN 3.1 pattern-weight `data/eval` file is used unchanged.

## GUI Features

- Warm Nigerian-themed board (chocolate/sand/ivory)
- Flying-king move highlights, capture flash animation
- Move history, flip board, undo, resign
- Play modes: Human vs AI / AI vs Human / H vs H / AI vs AI
- Strength: Beginner (0.5s) → Max (20s) per move

## Credits

- Engine: SCAN 3.1 © Fabien Letouzey (see LICENSE)
- Nigerian rules: Drafts Techniques Company manual
