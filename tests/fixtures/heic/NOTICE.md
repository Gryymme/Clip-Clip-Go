# HEIC test fixtures

These small geometric test patterns and HEIF item containers were generated for
Clip-Clip-Go using `node scripts/generate-heic-fixtures.mjs` and the project's
hash-pinned bundled FFmpeg 9.0.2 / libx265 encoder. They contain real HEVC data.
They contain no third-party photographs. The patterns, container-writing script,
and generated fixtures are dedicated to the public domain under CC0 1.0:
https://creativecommons.org/publicdomain/zero/1.0/

- `pattern.heic`: 64 × 48, four colored quadrants, 8-bit SDR.
- `rotated.heic`: the pattern with a HEIF `irot=1` (90° counterclockwise) property.
- `mirrored.heic`: the pattern with a HEIF `imir=0` (vertical flip).
- `cropped.heic`: central 32 × 24 clean aperture (`clap`).
- `transformed.heic`: clean aperture, quarter turn, then vertical flip.
- `rotated-exif.heic`: `irot=1` plus conflicting informative EXIF Orientation 6;
  the HEIF property controls the result and EXIF must not rotate it again.
- `alpha.heic`: a separate auxiliary alpha item; intentionally unsupported.
- `primary-second.heic`: blue image first, quadrant pattern second and primary.
- `grid.heic`: 128 × 48 primary grid of two 64 × 48 HEVC tiles.
- `grid-rotated.heic`: the same tile grid with primary `irot=1`, yielding 48 × 128.
- `ten-bit.heic`: actual 10-bit HEVC; intentionally unsupported by the app.

No encoder is added to the application workflow. Tests consume these committed
fixtures offline; regeneration is optional and uses the existing bundled tool.
