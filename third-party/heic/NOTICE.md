# HEIC input decoding

HEIC input uses the existing **FFmpeg/FFprobe 9.0.2 essentials** Windows x64
sidecars and FFmpeg's native software HEVC decoder / MOV-HEIF demuxer. No libheif,
Windows codec extension, Python runtime, additional DLL or separately downloaded
decoder is used. Conventional raster decoding and all image output encoding
continue to use the compiled Rust `image` crate.

The exact executables, build configuration, hashes, license texts and unresolved
redistribution work are in `../ffmpeg/`. This particular combined static build
reports **GPL-3.0-or-later**. HEIC support adds no binary, changes no application
license, and does not resolve the existing requirement to assemble complete
corresponding source/build materials, fulfill GPLv3 source delivery and review
all included dependency notices before public redistribution. A process boundary
alone is not a license determination. HEVC/HEIF patent rights may require separate
assessment; this project makes **no claim of patent clearance**.

Official implementation references verified for the pinned FFmpeg release:

- https://github.com/FFmpeg/FFmpeg/blob/n9.0.2/libavformat/mov.c
  (`pitm` primary-item IDs, item/grid handling, HEIF crop/rotation/mirror, removal
  of informative EXIF Orientation before exporting HEIF image metadata).
- https://github.com/FFmpeg/FFmpeg/blob/n9.0.2/fftools/ffmpeg_demux.c
  (assembled tile-grid filter outputs).
- https://ffmpeg.org/ffmpeg.html (stream selection, transforms and limits).
- https://ffmpeg.org/legal.html (license and patent considerations).

`npm run engines:verify` checks the pinned executables and dependencies, then
actually probes/decodes project-generated primary-item, transform and tile-grid
fixtures. The Tauri bundle already includes both executables and FFmpeg notices;
this notice is packaged in `notices/heic/`. Fixtures and their generation script
are development inputs, not required decoder assets.
