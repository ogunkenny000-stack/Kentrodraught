# Rust engine downloads

Choose a ZIP below and select **Download raw file** on GitHub.

- [Clean engine package](nigerian-draughts-clean.zip) — 19.3 MB. Includes the Linux engine, GUI, complete Rust source, trained evaluation data, and GPL license.
- [Source-only package](nigerian-draughts-source.zip) — 6.25 MB. Includes the complete Rust project and trained evaluation data; build it locally.
- [SHA-256 checksums](SHA256SUMS)

Old comparison binaries, match logs, and research scripts were removed from these packages. The retained source, executables, and trained weights are byte-identical to the previous delivery.

The prebuilt binaries target Linux x86-64 and were optimized for the cloud CPU. For other platforms or processors, rebuild from source. The GUI uses X11. Build and run instructions are included in each ZIP.

The recorded final ten-game C++ comparison at one second per move was 4 wins, 2 losses, and 4 draws. The requested seven-win target was not reached in that comparison.
