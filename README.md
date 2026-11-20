# Clip-Clip-Go

Clip-Clip-Go is a Windows desktop application combining single-link media downloading with local media, image and text/PDF conversion. Visible branding is **ClipClipGO**. Queue and History remain placeholders.

## Downloader

Paste one HTTP/HTTPS media-page or direct-media URL, choose **Inspect link**, select a source and final output, review the native execution summary, choose a destination folder and filename, then download. Inspection is cancellable and limited to 60 seconds; missing metadata stays unknown. Source quality defaults to Best available, with distinct reported resolutions/frame rates and advanced exact video/audio stream selection. Separate video/audio streams are merged; video-only and audio-only sources are identified without claiming nonexistent audio.

| Settings | Implemented choices |
| --- | --- |
| Video container | MP4, MKV, WebM |
| Resolution | Same as source; applicable 2160p, 1440p, 1080p, 720p, 480p, 360p; aspect ratio preserved, no upscaling |
| Frame rate | Same as source; 24, 25, 30, 50, 60 fps. Increases duplicate frames; no interpolation |
| Video encoding | Auto or compatible available H.264, HEVC, VP9, AV1 software encoders |
| Video quality | Preserve compatible streams, High, Balanced, Smaller file; distinct custom target bitrate mode (100–100000 kb/s) |
| Video audio | Keep or Remove; compatible audio codec, bitrate, sample rate and channel controls |
| Audio output | MP3, M4A/AAC, WAV/PCM 16-bit, FLAC, OGG/Vorbis, Opus |
| Audio bitrate | Preserve/compatible default, 64/96/128/160/192/256/320 kb/s presets and codec-validated custom target; hidden for lossless/PCM |
| Sample rate/channels | Same as source and codec-compatible rates from 8–96 kHz; Same, Mono, Stereo channels. Opus uses 48 kHz; multichannel MP3 needs explicit Mono/Stereo |

Advanced settings are expandable. A shared native compatibility contract drives both frontend and Rust validation. The plan copies/remuxes compatible streams and re-encodes only streams that require changes. Preserve mode uses a balanced preset if encoding is necessary. Unknown source codecs produce a provisional plan that is checked against FFprobe after download. Higher bitrates/quality settings and converting lossy audio to FLAC cannot restore detail; source sizes may be approximate and final size/bitrate is not promised.

The link input uses the same selection card as Converter and Images to PDF. Source IDs remain fixed after planning: measured frame rates or other approximate metadata cannot silently select another stream after download. Each source re-extracts the original page to resolve current media links, with one fresh extraction retry after HTTP 403/410. Completed files come from structured yt-dlp completion records and must belong to the job workspace. Stage-specific errors offer expandable, bounded diagnostics with engine exit status and selected IDs; credentials and URLs are redacted.

Downloads use bundled **yt-dlp 2026.10.26**, including its embedded EJS challenge scripts, **Deno 2.9.8**, and the existing **FFmpeg/FFprobe 9.0.2 essentials**. The two added raw executables total **121,657,312 bytes (116.02 MiB)**, plus retained notices; compressed installer growth is not measured. Developer preparation is pinned and checksum-verified. Users install nothing, configure no PATH and download no engines/components at first launch. There are no automatic engine updates.

Actual native stages are Inspecting, Downloading, Merging, Converting and Finalizing. Progress identifies the current source and resets between sources. It uses measured bytes or fragment counts, labels byte estimates with “About”, and stays indeterminate when no total or estimate is available. Completion of one stream does not complete the job. Download state and cancellation survive navigation. All engine-backed work shares the existing one-operation lock, including conversion. Windows process trees are terminated on cancellation/timeouts/normal app exit. Streams, merges and conversion outputs stay in a unique job directory; FFprobe validates output before atomic publication without overwriting. Windows filenames are sanitized. Protected publication requires a destination filesystem supporting hard links; unsupported destinations fail explicitly. Crashes/power loss can leave staging directories; crash recovery is not implemented.

Support depends on the pinned yt-dlp extractor and site behavior; every website is not promised. Supported HTTP/native HLS/DASH sources must be one completed, unprotected item. Pure playlists/channels, live/upcoming/processing streams, authentication/cookie importing, DRM/access-control bypass, batches, queues and history persistence are outside this milestone. A watch URL with a playlist parameter selects its item only. No artificial download quotas are imposed. Subtitles, chapters, attachments, HDR preservation/tone mapping and rich downloaded metadata are not implemented; re-encoded video uses yuv420p.

See [Downloader implementation, correction evidence and manual checklist](docs/downloader.md) and [engine provenance/notices](third-party/downloader/NOTICE.md). Routine integration tests use generated media and a local HTTP fixture, independent of public sites. An explicitly authorized YouTube fixture passed watch/share inspection and a 360p two-source download through merge, FFprobe validation and publication; this does not establish universal YouTube or default-2160p compatibility. Native dialogs and app appearance remain manual. Public binary redistribution remains blocked by GPL source/material preparation and the final dependency-license review; no installer is built in this milestone.

## Implemented conversions

| Input | Outputs |
| --- | --- |
| MP4, MKV, WebM, MOV | MP4, MKV, WebM; audio extraction to MP3, WAV, FLAC, M4A |
| MP3, WAV, FLAC, M4A, OGG | MP3, WAV, FLAC, M4A |
| JPEG/JPG, PNG, WebP, BMP, TIFF/TIF (one still image) | JPG, PNG, WebP, BMP, TIFF |
| TXT | Markdown, HTML, PDF |
| Markdown (.md/.markdown) | TXT, HTML, PDF |
| HTML (.html/.htm) | TXT, Markdown, PDF |
| PDF | TXT, Markdown, HTML, PNG page images, JPEG page images |
| Multiple supported still images, on Images to PDF | One PDF in the visible list order |

Extension matching is case-insensitive. Markdown output uses `.md`, HTML uses `.html`, and JPEG uses `.jpg`. Identical-format document conversions are not offered. Microsoft Office and OpenDocument formats, including DOC/DOCX, RTF, XLS/XLSX, PPT/PPTX, ODT, ODS and ODP, are unsupported. **LibreOffice and optional Office installation are permanently cancelled.** The short historical decision is in [docs/office-runtime.md](docs/office-runtime.md).

Select files with native dialogs or drop supported local files onto the selection card. Converter accepts exactly one file; multiple files produce “Choose one file”. Images to PDF appends supported images in delivered order, keeps existing duplicate handling, and reports rejected or excess files. Directories and URLs are rejected. File changes are blocked during a conversion; Choose buttons remain the keyboard alternative. Metadata is obtained natively without loading files into the frontend. Content is checked by the applicable provider. Selection, output choices, image order, page settings and the current job survive navigation during the session. There is one active download or conversion across all providers. Only the theme preference is saved locally; there is no saved conversion configuration, queue, history or database.

## Navigation and file previews

The sidebar displays **ClipClipGO** and provides Downloader, Converter, Images to PDF, Queue, History and Settings. **Converter** opens the single-file workflow; **Images to PDF** has its own page. Navigation retains both workflows' selections and options, and an active conversion remains visible and cancellable across pages. Project and application identifiers are unchanged.

The full-height sidebar is attached to the left edge and stays in place while the workspace scrolls. Short windows scroll navigation internally; narrow layouts move it above the workspace. Locally bundled Montserrat, shared controls and distinct keyboard focus are used throughout. Full paths and detailed engine information are expandable rather than dominating the workspace. The centered brand has a blue GO; the dynamic-year GRYYMME © attribution is anchored at the sidebar bottom. Decorative borders are subtle, while input boundaries and keyboard focus stay distinct.

Selected images show oriented thumbnails; video shows one frame generated by bundled FFmpeg, with no playback. Audio and documents use local vector icons. Preview work returns only bounded PNG data (up to 320×240 pixels and 384 KiB) and image dimensions, never the original file to the frontend. There are no preview files or object URLs to retain. Replacing/removing a selection cancels or ignores stale work; app exit cancels owned preview processes. Loading/fallback states keep a fixed footprint, and unavailable previews do not prevent valid conversion.

Originals are preserved. The native Save dialog chooses a new destination; output extensions are enforced. Existing/identical destinations are rejected, including publication races. Validated output is staged beside its destination and published without overwriting. Cancellation takes effect at safe processing boundaries; an encoding/rendering operation may finish before cancellation is observed. No simulated jobs, progress or success are shown.

Settings → **Theme** offers **System Default**, **Light** and **Dark**. System Default follows OS appearance changes; explicit choices override it. The preference (including system) is stored locally across restarts. Theme tokens cover application controls and scrollbars where supported; native Windows dialogs/title bars retain Windows styling. Solid action buttons use #4285F4 with white text, as requested; its approximately 3.56:1 contrast is below the AA requirement for normal-sized text.

Images to PDF uses the shared compact file cards, with oriented native thumbnails, readable sizes and source dimensions where available. Previews load sequentially and are cached for the selected list across navigation/reordering; removal releases cached data. Preview failure does not block PDF creation.

The UI font is the unmodified [official Montserrat variable font](https://github.com/JulietaUla/Montserrat), bundled offline with its OFL license and pinned source/hash in `public/fonts/montserrat/`. The upstream variable asset is TTF (744,936 bytes); no font processing dependency was added. Generated PDFs still embed Noto Sans; native dialogs/title bars retain Windows typography.

## Text and PDF

Text inputs must be UTF-8. Text outputs are UTF-8 with normalized LF line endings. TXT is treated literally, with Markdown/HTML syntax escaped. Native parsing preserves headings, paragraphs, lists, links, fenced code and basic tables where the output permits; exact round trips are not promised. Headerless HTML tables use their first row as a Markdown header; merged/nested table layout is not preserved. TXT keeps readable text and image alt text rather than rich layout or image pixels.

HTML is parsed as inert data: JavaScript is never executed, scripts/styles/head metadata are ignored, and active objects are rejected. CSS, background images and interactive forms are outside the supported subset. No remote images, stylesheets or links are automatically fetched. Markdown raw HTML is shown literally. Supported image references are relative local raster files canonicalized inside the source folder, or validated embedded PNG data. Missing, unsupported, remote/UNC or escaping image references fail explicitly. HTML output is self-contained with embedded PNGs and a restrictive CSP; Markdown can contain PNG data URLs, which some viewers do not display. Absolute HTTP(S)/mailto links and fragments remain inert; unsafe and relative hyperlinks are rejected.

### Generate PDF

TXT, Markdown and HTML produce paginated A4 PDFs with wrapping and an **embedded Noto Sans Regular font**. Headings use larger text; lists, code, links (including their visible URLs), basic table rows and supported images are reflowed. This is a readable document layout, not HTML/CSS printing or preservation of an original page design. Images are flattened onto white and encoded as JPEG at quality 90; PDFs are not claimed lossless.

Generation is tested with precomposed Latin/diacritics, Greek and Cyrillic. CJK, Arabic, Hebrew, Indic scripts, emoji, combining sequences and glyphs absent from the font are unsupported in this milestone. Unsupported characters cause a readable error identifying the code point instead of a silently blank glyph. Use precomposed characters where possible. Extraction/rendering of an existing PDF has different font coverage and may use its embedded fonts or platform substitutions.

### Extract PDF text

PDF → TXT/Markdown/HTML is **reconstructed content**, based on PDFium's text order. Original styling, exact tables, semantic heading levels and perfect multicolumn reading order are not recovered. Only extracted visible text is retained; annotation/link targets are not separately reconstructed. TXT separates pages with form feeds; Markdown uses page headings and escaped text; HTML uses page sections with escaped preformatted text.

An image-only/no-extractable-text PDF produces an OCR-not-supported explanation; page image rendering remains available. Mixed PDFs preserve page boundaries, including blank-text pages. Encrypted/password-protected PDFs are rejected; password handling is not implemented.

### PDF pages to images

Choose PNG or JPEG and leave Pages blank for all pages, or enter a validated range such as `1-3, 5`. Duplicates are removed and results follow document order. Rendering uses **150 DPI**, respects page rotation/aspect ratio and produces white-background images, including JPEG quality 90.

In the Save dialog, enter a **new output folder name**. Ordered files such as `document-page-001.png` are rendered sequentially in a job-owned staging directory. Every page is decoded again to validate its format/dimensions. Only the completed folder is published, without replacing an existing folder. Cancellation/failure removes the job's staging folder. Progress reports actual completed page counts.

### Images to PDF

Open **Images to PDF** in the sidebar; single-image conversion remains on Converter. Choose multiple still images, add more, remove or use Move up/Move down. Each visible row becomes one PDF page in that order; duplicate additions are ignored. Choose **A4**, **Letter** (8.5 × 11 in), **Legal** (8.5 × 14 in), **Custom**, or **Image sized** (150 DPI, no margins). Fixed and custom pages fit inside half-inch (12.7 mm) margins. Custom Width/Height accept decimal inches, centimeters or pixels. Pixels require DPI (default 96, range 1–2400): points = pixels × 72 / DPI; inches use 72 points and centimeters use 72 / 2.54 points per unit. Switching units or DPI preserves canonical physical dimensions without cumulative rounding. Each side must exceed 1 inch (positive space inside margins) and be at most 200 inches; invalid or nonfinite dimensions cannot start conversion. These page-generation bounds do not expand PDF page-rendering limits. Options remain selected across navigation. Aspect ratio and EXIF orientation are applied; transparency is composited onto white. Images are decoded one at a time and embedded as JPEG at quality 90. Animated/multipage inputs are rejected. The resulting PDF is reopened and its page count validated before publication.

### Limits

- Text source: 4 MiB, 128 nesting levels, 100,000 parser nodes/events; normalized assets: 16 MiB combined, with existing per-image limits; normal text output: 32 MiB.
- PDF input/output validation: 128 MiB and 1–500 pages. Extraction: at most two million characters per page and 32 MiB extracted text; escaped reconstruction is bounded to 64 MiB.
- PDF page rendering: at most 16 million pixels/16,384 pixels per side at 150 DPI; sequential pages and at most 512 MiB staged page-image output.
- Images to PDF: 1–100 still images and 100 million combined decoded pixels. PDF document assets share the combined pixel budget. Individual image limits remain 16 million pixels, 16,384 pixels per side and 128 MiB input/decoded data.

These bounds limit application-managed buffers; PDFium/codec internal allocations are not an operating-system memory sandbox. Very complex documents may still fail. Progress is indeterminate during layout/encoding steps without measurable totals, and page-based once page totals are known.

## Retained audio/video and image behavior

Bundled FFmpeg/FFprobe **9.0.2 essentials** validate media and use explicit H.264/AAC (MP4/MKV), VP9/Opus (WebM), MP3, PCM WAV, FLAC and AAC M4A presets. Audio extraction requires an audio stream. The first actual video stream and optional first audio stream are selected; cover art, subtitles and attachments are excluded. Media progress comes from FFmpeg. Success requires exit and output-container/codec validation. Cancellation/app exit terminates and reaps the owned process. See [the pinned manifest](scripts/ffmpeg-manifest.json).

Single-image conversion uses compiled Rust `image = 0.25.10`, with only JPEG, PNG, WebP, BMP and TIFF codecs. EXIF orientation is applied; dimensions are preserved after orientation. Supported alpha is retained except JPEG, which composites onto white at quality 90. Outputs use 8-bit channels; WebP is lossless for normalized pixels. Metadata/ICC profiles are not copied and no ICC color transform is performed. Animated/multipage images and corrupt/oversized inputs are rejected. This is not complete metadata preservation or universally lossless conversion.

## Bundled components and development

Users install no conversion tools, choose no engine folders and receive no first-launch engine downloads. FFmpeg/FFprobe are local sidecars; PDFium is an application-local DLL with V8 and XFA disabled. Native image/text libraries are compiled into the app. Missing/damaged bundled assets produce a repair message; there is no PATH/system-tool fallback.

The local Tauri 2 CLI, React, TypeScript, Vite and plain CSS foundation requires Windows x64, Node/npm, Rust MSVC, C++ build tools/Windows SDK and WebView2. npm/Cargo lockfiles are retained. On a fresh checkout use `npm ci`.

Desktop launch (native dialogs/conversion):

```sh
npm run tauri dev
```

Frontend preview only (no native dialogs/conversion):

```sh
npm run dev
```

Desktop development/build hooks run `engines:prepare`, `downloader:prepare` and `pdf:prepare` before the frontend. Pinned URLs, SHA-256 hashes, versions and build flags are in `scripts/ffmpeg-manifest.json`, `scripts/downloader-manifest.json` and `scripts/pdf-manifest.json`. Verified project-local caches are reused; downloads/extraction happen only during developer setup/build. No global installation or PATH changes occur. `npm run pdf:prepare` can be run separately; `npm run pdf:verify-resources` checks the compiled debug payload. Generated assets/caches are ignored by Git. Preserve tracked manifests, preparation scripts and notices.

Build a Windows debug application without an installer:

```sh
npm run tauri -- build --debug --no-bundle
```

The executable is `src-tauri/target/debug/clip-clip-go.exe`. Retain its accompanying `ffmpeg.exe`, `ffprobe.exe`, `yt-dlp.exe`, `deno.exe`, `pdf/` and `notices/` trees. Copying the executable alone is insufficient; no portable ZIP is provided. This milestone does not build/install an MSI or implement installer component selection.

Notices are in `third-party/ffmpeg`, `third-party/downloader`, `third-party/text` and `third-party/pdf` and are packaged under `notices/`. PDFium binary dependencies, Noto Sans OFL, and native wrapper licenses are retained. The application license is unchanged. **FFmpeg public redistribution/source obligations remain open** as documented in [its notice](third-party/ffmpeg/NOTICE.md); attribution alone is insufficient.

See [docs/text-pdf.md](docs/text-pdf.md) for measured cleanup, dependency/resource sizes and verification results.

## Verification and manual checks

Automated: `npm test`, `npm run typecheck`, `npm run build`, `cargo test --manifest-path src-tauri/Cargo.toml`, `cargo check --manifest-path src-tauri/Cargo.toml`, and the debug build above. This checkout's cached Rust checks use PowerShell `$env:CARGO_HOME="$PWD/.cargo-cache"` and `$env:CARGO_NET_OFFLINE="true"`; temporary files can be directed to `.engine-cache/tmp`. `node scripts/check-converter-layout.mjs` creates isolated development fixtures in `.engine-cache/ui-check/converter.html` with dataset, viewport and enlarged-text controls. It checks rendered markup/state and supports CSS review; it does not measure browser pixels or verify native dialogs. Fixture controls do not ship in the application.

The user performs manual functionality testing. Automated/SSR checks do not establish visual or native-dialog verification.

Manual checklist: try each document route with Unicode and multiline content; verify PDF pagination/reading order; render all pages and a range to new PNG/JPEG folders; try scanned, encrypted, corrupt and missing-asset files; add/reorder/remove images, inspect A4/image-sized pages, orientation and transparency; cancel and test existing destinations; navigate away/back; recheck one audio/video and single-image conversion; confirm Office inputs are rejected; check narrow windows, keyboard focus and 200% text scaling.

For the layout/preview pass: check all six destinations; retain a single file and an ordered image list while switching pages; try long filenames/paths, short windows and enlarged text; confirm oriented image/video previews and audio/document icons; rapidly replace/remove selections to check stale previews; verify conversion and cancellation still work when a preview is unavailable. Desktop appearance, native dialogs and manual functionality require user confirmation.

Native drop integration uses [Tauri 2.12.5 webview drag/drop events](https://v2.tauri.app/reference/javascript/api/namespacewebview/#ondragdropevent); physical coordinates are mapped to the active selection card with the current WebView pixel ratio. Only actual OS-delivered drop paths can be claimed once by the native metadata command. No general filesystem permission or browser File.path is used. Drops outside a selection card are ignored. Detach developer tools when testing drop coordinates (a documented WebView limitation).
