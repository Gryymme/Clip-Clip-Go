# Clip-Clip-Go

Clip-Clip-Go is a Windows desktop application combining local media, image and text/PDF conversion with a user-friendly interface. Authorized media downloading is planned; Downloader, Queue, History and Settings remain placeholders.

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
| Multiple supported still images, in Images to PDF mode | One PDF in the visible list order |

Extension matching is case-insensitive. Markdown output uses `.md`, HTML uses `.html`, and JPEG uses `.jpg`. Identical-format document conversions are not offered. Microsoft Office and OpenDocument formats, including DOC/DOCX, RTF, XLS/XLSX, PPT/PPTX, ODT, ODS and ODP, are unsupported. **LibreOffice and optional Office installation are permanently cancelled.** The short historical decision is in [docs/office-runtime.md](docs/office-runtime.md).

Select files with native dialogs. Metadata is obtained natively without loading files into the frontend. Content is checked by the applicable provider. Selection, output choices, image order, page settings and the current job survive navigation during the session. There is one active conversion across all providers. There is no saved configuration, queue, history or database.

Originals are preserved. The native Save dialog chooses a new destination; output extensions are enforced. Existing/identical destinations are rejected, including publication races. Validated output is staged beside its destination and published without overwriting. Cancellation takes effect at safe processing boundaries; an encoding/rendering operation may finish before cancellation is observed. No simulated jobs, progress or success are shown.

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

Use the dedicated mode within Converter; single-image conversion remains separate. Choose multiple still images, add more, remove or use Move up/Move down. Each visible row becomes one PDF page in that order; duplicate additions are ignored. Choose **A4** (fit inside 12.7 mm margins) or **Image-sized** (150 DPI, no margins). Aspect ratio and EXIF orientation are applied; transparency is composited onto white. Images are decoded one at a time and embedded as JPEG at quality 90. Animated/multipage inputs are rejected. The resulting PDF is reopened and its page count validated before publication.

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

Desktop development/build hooks run `engines:prepare` and `pdf:prepare` before the frontend. Pinned URLs, SHA-256 hashes, versions and build flags are in `scripts/ffmpeg-manifest.json` and `scripts/pdf-manifest.json`. Verified project-local caches are reused; downloads/extraction happen only during developer setup/build. No global installation or PATH changes occur. `npm run pdf:prepare` can be run separately; `npm run pdf:verify-resources` checks the compiled debug payload. Generated assets/caches are ignored by Git. Preserve tracked manifests, preparation scripts and notices.

Build a Windows debug application without an installer:

```sh
npm run tauri -- build --debug --no-bundle
```

The executable is `src-tauri/target/debug/clip-clip-go.exe`. Retain its accompanying `ffmpeg.exe`, `ffprobe.exe`, `pdf/` and `notices/` trees. Copying the executable alone is insufficient; no portable ZIP is provided. This milestone does not build/install an MSI or implement installer component selection.

Notices are in `third-party/ffmpeg`, `third-party/text` and `third-party/pdf` and are packaged under `notices/`. PDFium binary dependencies, Noto Sans OFL, and native wrapper licenses are retained. The application license is unchanged. **FFmpeg public redistribution/source obligations remain open** as documented in [its notice](third-party/ffmpeg/NOTICE.md); attribution alone is insufficient.

See [docs/text-pdf.md](docs/text-pdf.md) for measured cleanup, dependency/resource sizes and verification results.

## Verification and manual checks

Automated: `npm test`, `npm run typecheck`, `npm run build`, `cargo test --manifest-path src-tauri/Cargo.toml`, `cargo check --manifest-path src-tauri/Cargo.toml`, and the debug build above. This checkout's cached Rust checks use PowerShell `$env:CARGO_HOME="$PWD/.cargo-cache"` and `$env:CARGO_NET_OFFLINE="true"`; temporary files can be directed to `.engine-cache/tmp`. `node scripts/check-converter-layout.mjs` creates isolated development fixtures in `.engine-cache/ui-check/`; it renders edge-case markup and supports CSS review, without desktop control or native dialogs.

The user performs manual functionality testing. Automated/SSR checks do not establish visual or native-dialog verification.

Manual checklist: try each document route with Unicode and multiline content; verify PDF pagination/reading order; render all pages and a range to new PNG/JPEG folders; try scanned, encrypted, corrupt and missing-asset files; add/reorder/remove images, inspect A4/image-sized pages, orientation and transparency; cancel and test existing destinations; navigate away/back; recheck one audio/video and single-image conversion; confirm Office inputs are rejected; check narrow windows, keyboard focus and 200% text scaling.
