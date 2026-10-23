# Rust engine and match replay downloads

Choose a ZIP below and select **Download raw file** on GitHub.

- [Python PDN player + all ten challenge games](nigerian-draughts-pdn-player.zip) — **115 KB**. Includes an offline desktop viewer, individual and combined PDNs, and one CSV row per played move. Extract everything together. On Windows double-click `run_player.bat`; on Linux/macOS run `python3 pdn_player.py`. Requires Python 3.10+ with Tkinter.
- [Clean engine package](nigerian-draughts-clean.zip) — 19.3 MB. Includes the Linux engine, GUI, complete Rust source, trained evaluation data, and GPL license.
- [Source-only engine package](nigerian-draughts-source.zip) — 6.25 MB. Includes the complete Rust project and trained evaluation data; build it locally.
- [SHA-256 checksums](SHA256SUMS)

The replay package contains the fresh challenge of the exact GitHub Rust build against the unchanged original C++ engine: **0 Rust wins, 0 C++ wins, 10 draws**, one second per move, five games per color. All 1,253 plies are included, including the preset 12-ply opening for each game. Capture strings were converted to proper PDN landing-square paths and checked against every recorded board. The desktop viewer's navigation, autoplay, board flip, and game loading were tested.

Old comparison binaries, match logs, and research scripts were removed from the cleaned engine packages. Their source, executables, and trained weights are byte-identical to the previous engine delivery. The engine package includes its earlier validation result of 4 wins, 2 losses, and 4 draws; the replay package records the separate fresh challenge above.

The prebuilt engine binaries target Linux x86-64 and were optimized for the cloud CPU. For other platforms or processors, rebuild from source. The engine GUI uses X11. The separate Python replay player runs locally on Windows, Linux, or macOS with Python and Tkinter.
