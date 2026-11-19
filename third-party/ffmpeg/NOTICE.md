# Bundled FFmpeg and FFprobe

FFmpeg 9.0.2 essentials, Windows x64 static build, supplied by Gyan Doshi:
https://www.gyan.dev/ffmpeg/builds/ (a Windows provider linked by ffmpeg.org).

These separate executables report GPL version 3 or later. The actual archive's
license and README are preserved as COPYING.GPLv3.txt and UPSTREAM-README.txt.
PROVENANCE.json records the pinned archive and executable SHA-256 hashes, exact
version, compiler, configuration, DLL imports and provider-reported FFmpeg source.
BUILD-CONFIG.txt and BINARY-LICENSE.txt preserve the executable's own reports.
UPSTREAM-LICENSE.md and the additional COPYING files describe FFmpeg's component
licensing. This software is based in part on the work of the Independent JPEG Group.

The build uses --enable-gpl --enable-version3 --enable-static; it does not use
--enable-nonfree or --enable-shared. Static codec libraries are incorporated into
these executables; Windows system and UCRT DLLs are still required. No FFplay,
example projects or optional codec DLLs are distributed by this project.

## Public redistribution remains blocked pending source and notice review

The provider archive contains a GPL text and a README, not the complete corresponding
source for this combined static build. Attribution and a link to FFmpeg source alone
do not satisfy all redistribution requirements. Before public release:

- Assemble exact corresponding source for FFmpeg and all incorporated libraries,
  provider patches, and scripts/configuration needed to generate and install this
  build. The README identifies FFmpeg commit 946fcce07b6dcd0331c8cc609192aeff5e1924f8,
  but does not identify every dependency revision or provide a complete build recipe.
- Choose and implement an applicable GPLv3 section 6 source-delivery method for the
  actual distribution channel. For network distribution, provide equivalent access
  to complete corresponding source as required; a generic upstream link is insufficient.
- Audit the exact linked dependency revisions and preserve their required copyright,
  permission and third-party notices (including permissive/Apache components). The
  archive's two notice files and FFmpeg's core license texts are not a completed audit.
- Review the license relationship of the application and distributed components.
  A separate process boundary alone is not a blanket licensing determination.

The application's license has not been changed. The generated installer is for
development verification; its existence does not mean redistribution obligations
have been completed. See COPYING.GPLv3.txt, especially sections 1, 5 and 6.
