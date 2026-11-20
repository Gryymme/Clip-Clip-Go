# Downloader engine notices

ClipClipGO bundles the unmodified official Windows x64 yt-dlp 2026.10.26 executable and Deno 2.9.8 runtime. FFmpeg and FFprobe are the existing pinned application sidecars. No engine or challenge-component download occurs at first launch; automatic updating is disabled.

- yt-dlp source: https://github.com/yt-dlp/yt-dlp/tree/2026.10.26
- yt-dlp binary and publisher checksums: https://github.com/yt-dlp/yt-dlp/releases/tag/2026.10.26
- Deno source and binary: https://github.com/denoland/deno/releases/tag/v2.9.8
- Runtime setup documentation: https://github.com/yt-dlp/yt-dlp/wiki/EJS

The yt-dlp source is Unlicense. Its official PyInstaller Windows executable is a combined **GPLv3+** work, including dependencies; it must not be described as entirely public domain. The retained upstream THIRD_PARTY_LICENSES text contains dependency notices. `COPYING.GPLv3.txt` provides GPLv3. The official executable also embeds yt-dlp-ejs, so the app disables remote-component fetching. The official EJS documentation recommends Deno and describes its restricted challenge execution.

Deno and rusty_v8 are MIT licensed; V8 and bundled dependencies retain their own terms. `deno-Cargo.lock` and `deno-Cargo.toml` retain the pinned upstream dependency inventory. `RUNTIME-NOTICE-SOURCES.json` records exact runtime notice source revisions and hashes, including ICU, Abseil, LLVM runtime libraries and V8 dependencies. These inventories/notices are provenance, not a claim that complete corresponding source has been assembled.

**Public redistribution remains a release blocker:** assemble and review the GPL corresponding-source/materials and dependency licensing for the exact official yt-dlp/PyInstaller executable and existing FFmpeg build before distributing an installer or binary publicly. The runtime inventory also requires a final distribution license audit. This milestone builds no installer and makes no completed-redistribution-compliance claim. Existing FFmpeg obligations remain documented in `../ffmpeg/NOTICE.md`.

Pinned URLs, archive/executable SHA-256 values, notice hashes and measured sizes are in `scripts/downloader-manifest.json` and `PROVENANCE.json`. Preparation verifies checksums before extraction or execution and only extracts `deno.exe`. The app resolves verified sidecars beside its executable and never falls back to PATH.
