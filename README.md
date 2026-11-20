# Clip-Clip-Go

Clip-Clip-Go is a Windows desktop application being built to combine authorized media downloading with local conversion of video, audio, image, and document files into appropriate formats through a user-friendly interface.

The working foundation uses Tauri 2, React, TypeScript, Vite, npm, and plain CSS. It provides a dark desktop shell with keyboard focus styles and navigation between Downloader, Converter, Queue, History, and Settings.

## Converter

The Converter selects one local file through a native Windows file dialog and displays its name, full path, exact size, and preliminary video, audio, image, or document category. File size and path come from native filesystem metadata; conversion providers inspect content separately. Replace and remove controls are available; cancellation or an unsuccessful replacement preserves the previous selection.

Single-file **audio/video conversion is implemented**, using bundled FFmpeg and FFprobe executables. Users do not need to install engines, configure an engine folder, or change PATH. Available output choices depend on the bundled encoders and the actual media streams. Single-image conversion is also implemented with a compiled-in Rust provider; it needs no external tools. Document selection remains available, with conversion disabled.

| Input | Outputs |
| --- | --- |
| MP4, MKV, WebM, MOV | MP4, MKV, WebM; audio extraction to MP3, WAV, FLAC, M4A |
| MP3, WAV, FLAC, M4A, OGG | MP3, WAV, FLAC, M4A |
| JPG/JPEG, PNG, WebP, BMP, TIFF/TIF (single still image) | JPG, PNG, WebP, BMP, TIFF |
| DOC, DOCX, ODT, RTF | Planned only: PDF, DOCX, ODT, TXT |
| TXT | Planned only: PDF, DOCX, ODT |
| PPT, PPTX, ODP | Planned only: PDF, PPTX, ODP |
| XLS, XLSX, ODS | Planned only: PDF, XLSX, ODS, CSV |
| PDF | Planned only: TXT, PNG, JPG |

Extension matching is case-insensitive; JPEG/JPG and TIF/TIFF use the same routes. Output choices are specific to the input format. PDF-to-text will initially require a text-based PDF; scanned documents need OCR, which is not offered. PDF-to-image is planned to produce one image per page, and spreadsheet-to-CSV may export only one sheet. PDF-to-Word and unrelated cross-category routes are not offered.

Compatible output choices are retained when replacing a file. Selection and the active job survive page navigation during the current session. There is no saved configuration or job database.

## Bundled engines

Windows x64 builds include FFmpeg and FFprobe **9.0.2 essentials** from [Gyan Doshi](https://www.gyan.dev/ffmpeg/builds/), a provider linked by [ffmpeg.org](https://ffmpeg.org/download.html#build-windows). They are static software-codec builds; Windows system/UCRT components and WebView2 remain platform requirements. The app resolves the exact binaries beside its executable, validates their SHA-256 hashes, versions and encoders, and never falls back to PATH or downloads engines at runtime. Missing or damaged engines produce a repair/reinstall message. Version details are available in Converter.

The archive URL, SHA-256, executable hashes, target, exact compiler/configuration and source reference are pinned in [the engine manifest](scripts/ffmpeg-manifest.json). Full reports and license texts are in [third-party/ffmpeg](third-party/ffmpeg/NOTICE.md) and installed under `notices/ffmpeg/`.

**Public redistribution is not cleared yet.** These executables report GPLv3-or-later. Complete corresponding source for this exact combined static build, dependency revisions/build scripts and a complete third-party notice audit still need to be assembled and supplied using an applicable GPLv3 distribution method. Attribution and a generic source link alone are insufficient. See [remaining obligations](third-party/ffmpeg/NOTICE.md). The application's license has not been changed.

| Output | Fixed encoding preset / required encoders |
| --- | --- |
| MP4, MKV | H.264 (`libx264`, medium, CRF 23, 8-bit YUV 4:2:0); optional AAC audio (`aac`, 192 kb/s) |
| WebM | VP9 (`libvpx-vp9`, CRF 32); optional Opus audio (`libopus`, 128 kb/s) |
| MP3 | `libmp3lame`, quality 2, stereo |
| WAV | `pcm_s16le`, 16-bit PCM |
| FLAC | `flac`, compression level 5 |
| M4A | `aac`, 192 kb/s |

## Converting one image

Select a JPEG/JPG, PNG, WebP, BMP or TIFF/TIF file. The native provider decodes its content (the extension alone is not validation) and displays the detected format and dimensions. Choose an image output and use the same **Convert** action and native Save dialog. Images use the existing single-job lifecycle, navigation retention and output protection; audio/video and image jobs cannot run together. Image conversion works even when the FFmpeg sidecars are unavailable.

Image support uses Rust `image = 0.25.10`, with only JPEG, PNG, WebP, BMP and TIFF codec features enabled and default features disabled. It compiles into the app: users install no image tools and download no image engines. JPEG output uses quality 90; PNG uses default compression/adaptive filtering; WebP uses lossless encoding of normalized pixels; BMP and TIFF use the library's fixed defaults. Aliases and case are normalized; output extensions are enforced as `.jpg`, `.png`, `.webp`, `.bmp` or `.tiff`.

Dimensions are preserved after applying EXIF orientation to the pixels; a 90°/270° orientation swaps width and height. PNG, WebP, BMP (32-bit V4) and TIFF preserve transparency. JPEG cannot preserve alpha: transparent pixels are composited onto white, with a contextual explanation before conversion. Some other applications may not display alpha in BMP files correctly.

Outputs are normalized to 8-bit RGB/RGBA channels. Source EXIF (including GPS), ICC profiles, textual metadata and other source metadata are not copied. Orientation is applied once rather than retained as an orientation tag. No ICC profile transformation or color-managed matching is performed; wide-gamut/profile-dependent images may change appearance. Higher bit-depth images lose precision, and JPEG is lossy. This is not a promise of lossless conversion or complete metadata/color preservation.

Only single still images are accepted. APNG, animated WebP, multipage/SubIFD TIFF, multi-picture JPEG (MPF/MPO) and BMP arrays are rejected rather than silently dropping images. Unsupported image variants and corrupt/truncated content produce an error. Safety limits are 16 million pixels, 16,384 pixels per side, 128 MiB encoded input and 128 MiB decoded pixel data; a 128 MiB decoder-allocation budget is also requested. The library's allocation budget is best effort, not a hard cap on total process memory. Orientation, normalized pixels and encoders require additional bounded image buffers. Oversized images fail with a readable message.

Decoding and encoding run off the UI thread. Image jobs show real stages and indeterminate progress, without estimated percentages or processed media time. Cancellation is checked between stages (and during compositing/header scans); a codec operation may need to finish first. After cancellation, its output is never published and its owned staging file is removed. Output is staged beside the destination, flushed, decoded again to verify its actual format and oriented dimensions, then published without overwriting. Originals and existing destinations are protected.

## Converting one audio/video file

Select a file. FFprobe validates its container and identifies the first actual video stream and first audio stream; embedded cover art, subtitles, attachments, chapters, and metadata are excluded. Audio outputs require an audio stream. Video outputs use the first actual video stream and optional first audio stream. Odd video dimensions are rounded up to even dimensions for the fixed codec presets.

Choose an available output and select **Convert**. A native Save dialog suggests `<input>_converted.<format>`. The chosen filename is normalized to the correct extension. The original file and existing destinations are protected, including if another application creates the destination during conversion; choose another filename when a destination exists.

FFmpeg runs without a shell into a unique temporary file beside the destination. Progress comes from its machine-readable output; when duration is unknown, the UI shows indeterminate progress and the reported processed time. Completion requires a successful process exit, a nonempty output, and FFprobe validation of the expected container and encoded streams before no-overwrite publication. This is a structural output check, not a full decode audit.

Only one conversion runs at a time. File, format, and engine controls are locked during the job. **Cancel conversion** terminates and reaps the owned process and cleans up only its staging file. Closing the app also stops its owned process and removes its active temporary output. Progress and terminal results remain visible when navigating away and back; there is no queue or conversion history.

Document conversion is not available yet. Its category remains extension-based, and its listed routes are plans whose actual support will be validated with future engines. Downloader, Queue, History, and Settings remain placeholders. Batch processing, downloading, OCR and advanced quality controls are not implemented.

## Development

From the project root, launch the desktop application:

```sh
npm run tauri dev
```

The desktop command starts Vite and the native Tauri application. Native file selection requires this desktop launch.

To start only the frontend in a browser:

```sh
npm run dev
```

The browser preview cannot open the native file dialog and displays a message directing you to the desktop app.

The Tauri CLI is a local development dependency. Node.js/npm, Rust with the MSVC toolchain, Visual Studio C++ build tools, a Windows SDK, and WebView2 are required. The npm and Cargo lockfiles are retained. Only `x86_64-pc-windows-msvc` is supported; preparation and native builds reject other targets clearly. Use a Windows x64 CI runner.

On a fresh checkout, run `npm ci`. Both desktop development and installer builds automatically run project-local engine preparation before compiling; `npm run engines:prepare` can also be run explicitly. The script downloads the pinned archive only when verified sidecars are absent, verifies SHA-256 before extraction, and extracts only FFmpeg, FFprobe and the archive's two notice files. Already verified binaries are reused; a verified cached archive supports offline regeneration. A mismatched cache fails with an actionable error. No global tools or PATH changes are made.

Generated engines live in `src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe` and `ffprobe-x86_64-pc-windows-msvc.exe`. These and `.engine-cache/` are ignored by Git. Keep the tracked preparation scripts, manifest and notices. CI may cache `.engine-cache/`; preparation always checks hashes. The Tauri hooks run preparation and then the frontend command, without recursive npm hooks.

Build the Windows MSI (for development verification while redistribution review remains open):

```sh
npm run tauri -- build --ci
```

The release executable is `src-tauri/target/release/clip-clip-go.exe`. The installer is `src-tauri/target/release/bundle/msi/Clip-Clip-Go_0.1.0_x64_en-US.msi`. An explicit `--target x86_64-pc-windows-msvc` adds that target directory between `target/` and `release/`. Tauri caches WiX packaging tools locally in `src-tauri/target/.tauri/`; it may download these build tools and the WebView2 bootstrapper during packaging. This does not install the app.

No portable ZIP is provided. Copying the app executable alone is insufficient: any portable folder must retain the accompanying `ffmpeg.exe`, `ffprobe.exe` and `notices/ffmpeg/` directory. Normal installed first use needs no engine download.

Inspect an MSI payload without installation using `powershell -NoProfile -File scripts/verify-installer.ps1 -Installer <project-local-msi-path>`. It reads the MSI and extracts embedded cabinets into the project cache, then verifies engine/notice hashes and installation directories.

## Verification

- `npm run engines:verify`: verify prepared binaries, notices, static DLL imports, versions and required encoders without downloading.
- `npm test`: focused preparation, compatibility, selection locking, and conversion-state tests using Node's built-in test runner.
- `npm run typecheck`: TypeScript checking.
- `npm run build`: TypeScript checking and frontend production build.
- `cargo check --manifest-path src-tauri/Cargo.toml`: native checking.
- `cargo test --manifest-path src-tauri/Cargo.toml`: command/preset, FFprobe, progress, cancellation/reaping, output protection, and failure-cleanup tests, plus generated image fixtures for all 25 input/output pairs, alpha, EXIF orientation, animation/pages, decoding limits and cancellation. The real-engine smoke test runs with an empty PATH in an isolated child process, uses prepared sidecars, generates a short video/audio fixture and exercises all seven existing output presets plus audio-only WAV-to-FLAC in `src-tauri/target/conversion-tests`, with cleanup. Missing sidecars fail the test rather than silently skipping. Other tests use mock process results.

The user confirmed selection and output choices for all four categories before image conversion was added. Manual conversion and native dialog testing are performed by the user. Automated checks do not establish manual functionality verification.

Manual checklist: launch current source with `npm run tauri dev` (or rebuild and install an updated MSI yourself); an existing installer does not update automatically when source changes. Check bundled versions without system FFmpeg or an engine folder; convert a short video and extract audio to new filenames; check a silent video and a corrupt file; cancel a longer conversion and verify no destination or staging file remains; attempt an existing/identical destination; navigate away/back while converting; close the app during a job; convert images across the five formats, check oriented dimensions and transparent PNG-to-JPEG white compositing; reject animated/multipage, corrupt and oversized images; recheck document selection with conversion disabled.
