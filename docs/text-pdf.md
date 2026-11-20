# Text/PDF implementation and cleanup

## Product decision and removed components

LibreOffice and optional Office installation are permanently cancelled. Microsoft Office/OpenDocument formats are unsupported; PDF remains a document category. The implementation keeps the media/image providers and native text parser instead of introducing an Office suite, browser runtime or cloud service.

Positive identification used the pinned preparation receipt, named integration scripts/configuration and the measured compiled resource tree. Cleanup deleted only project-owned artifacts. No Windows profiles were created, external ACLs changed, system installation/shared fonts touched, or Git mutations performed. User/native-text changes and retained component notices were preserved.

| Removed artifact group | Bytes |
| --- | ---: |
| Inspection archive/cabinet/payload/runtime cache | 5,861,038,816 |
| Prepared Office resource cache | 1,582,603,803 |
| Compiled debug Office resource tree | 1,582,603,205 |
| Other owned diagnostics, scripts, notices and exclusive fixtures | 104,239 |
| **Gross removal** | **9,026,350,063 (8.406 GiB)** |

This is gross deleted file size, not net free-space change after subsequent builds. The former installed Office runtime alone was 1,582,603,205 bytes. Shared caches were deliberately retained: measured afterward, Rust target output was 12,175,514,193 bytes, the project Cargo cache 706,909,106 bytes and npm cache 294,630,038 bytes. These include compiler/dependency/test output and are not installed resources. No speculative cache pruning was performed.

Removed integration: preparation/MSI-extraction/containment scripts, AppContainer experiment, Office-only fixture/tests, Tauri overlay/wrapper/hooks, download and reconstructed-runtime caches, copied fonts/CRTs, runtime notices/provenance and large evidence documents. The shared FFmpeg installer-inspection script, FFmpeg/image/text code and native library notices remain. No Rust/npm package was exclusively required by LibreOffice; its runtime was external, so no speculative dependency removal was needed.

`docs/office-runtime.md` is now only a short cancellation note. Remaining names in guidance/packaging notes record cancellation; source/tests contain unsupported-format rejection and resource-absence assertions. No active Office route, runtime discovery, resource entry, preparation hook or Cargo dependency remains. Incremental compiler caches may contain stale historical strings; they are retained build caches, not deployed Office resources.

## Architecture and included components

- `text.rs` retains native pulldown-cmark/htmd conversion and its inert HTML/explicit-asset rules. TXT → HTML and HTML → TXT were added. A focused handler preserves basic headerless HTML tables; the first row becomes a Markdown header. Complex merged/nested table layout is not preserved.
- `pdf.rs` uses **pdfium-render = 0.9.5** and **ttf-parser = 0.25.1**, with defaults disabled for the wrapper and explicit `pdfium_8125`, `thread_safe`, `image_025` features. Ten new lockfile packages were added, including two WASM-only wrapper dependencies. No npm dependency or UI framework was added.
- The checksum-pinned Windows x64 PDFium build is **158.0.8125.0**, from bblanchon/pdfium-binaries `chromium/8125`. Its supplied configuration disables V8/XFA and its PE imports are only ADVAPI32, GDI32, KERNEL32 and USER32. It requires no installed PDF tool, browser or app-local CRT collection. Import/version/configuration/license information is retained under `third-party/pdf/pdfium/`.
- Noto Sans Regular is pinned to notofonts/noto-fonts commit `ffebf8c1ee449e544955a7e813c54f9b73848eac`. Its full OFL is retained. It is a new independent asset, not a font salvaged from the removed Office runtime. Generation embeds it; unsupported scripts/glyphs fail explicitly.
- `scripts/pdf-manifest.json` pins archive/font URLs, SHA-256, DLL hash and all notice hashes. `pdf:prepare` verifies before extraction, copies only the DLL/font, validates dependencies/notices, rejects unknown resource files and reuses cached verified assets. Preparation runs only in desktop dev/build hooks; no first-launch downloads, global installation or PATH changes occur.
- Tauri resources map the two generated assets to `pdf/` and licenses/provenance to `notices/pdf/`. Runtime resolution is an exact application-relative path with checksum validation, with no system/PATH fallback. Native text and image code does not load PDFium unless a PDF operation is requested.
- Typed native commands add PDF inspection, multiple-image picking and Images to PDF. Input paths must have been authorized by native selection. Output paths come only from native dialogs. The existing Core operation slot, job polling/revisions, cancellation and navigation state are reused. Page progress contains real completed/total counts; layout has no fabricated percentage.
- PDF files use existing no-overwrite staging. Page-image batches stage in one unique neighboring folder, validate every image, then use Windows `MoveFileExW` without replacement. Job-owned staging directories are registered for cancellation/app-exit cleanup. Native PDF APIs are serialized, and input/page/pixel/output budgets bound application-managed work. They are not a hard OS memory sandbox.

Official references checked before selection: [PDFium API](https://pdfium.googlesource.com/pdfium/+/refs/heads/chromium/8125/public/fpdfview.h), [PDFium editing API](https://pdfium.googlesource.com/pdfium/+/refs/heads/chromium/8125/public/fpdf_edit.h), [pdfium-render](https://docs.rs/pdfium-render/0.9.5/pdfium_render/), [binary provider](https://github.com/bblanchon/pdfium-binaries), [immutable Noto source](https://github.com/notofonts/noto-fonts/tree/ffebf8c1ee449e544955a7e813c54f9b73848eac).

## Size impact and packaging

| Added component | Bytes |
| --- | ---: |
| PDFium DLL | 7,586,816 |
| Noto Sans font | 569,208 |
| Required component/license/provenance notices | 164,567 |
| **Added installed resources** | **8,320,591 (7.935 MiB)** |
| Pinned PDFium compressed download | 3,904,987 |
| Font download | 569,208 |

The measured debug executable grew from 21,281,280 to 25,441,280 bytes (4,160,000 bytes) after compiling the PDF integration. This is a debug measurement, not a claim about release executable or compressed MSI size. No installer was produced; installer compressed impact is unmeasured. Current output is `src-tauri/target/debug/clip-clip-go.exe` with its neighboring sidecars, `pdf/` and `notices/` trees. Do not distribute only the executable. Retained FFmpeg corresponding-source obligations remain open; the application license is unchanged.

## Verified stages

1. Removed only identified Office artifacts and obsolete hooks; direct local Tauri workflow restored. Asset preparation passed using cached, hash-verified PDFium/font data.
2. Generated PDF fixtures verified pagination, wrapping bounds, embedded fonts, exact Latin/Greek/Cyrillic extraction, headings/lists/links/code/basic table content and local images. Missing assets and unsupported characters fail without publication.
3. Page-image fixtures verified page counts, selected ranges, order, rotation/aspect ratio, dimensions, PNG/JPEG contents, white compositing and cancellation/races. Images-to-PDF fixtures verified order through rendered colors, A4/image-sized sizes, EXIF orientation, alpha flattening and multipage rejection. Corrupt/encrypted/image-only PDFs and invalid image files were tested.
4. Full native regression: **39 passed, 1 intentionally ignored child-process fixture** (that fixture is invoked explicitly by its parent process test). This includes the real bundled FFmpeg smoke test, all 25 image format pairs and native text regression/security tests. Focused text/PDF reruns covered subsequent handler/error-message changes.
5. Frontend: **44 tests passed**, TypeScript and production build passed. Windows Tauri debug build passed with no installer. `pdf:verify-resources` verified both deployed asset hashes, all **28** notice files, retained FFmpeg/text notices, and absence of compiled Office resources. Cargo dependency-tree inspection found no LibreOffice/soffice dependency.
6. Seven SSR edge-case fixtures render Empty, One, Worst case, 100 pages, PDF range, scanned PDF and invalid range. The dev-only fixture is `.engine-cache/ui-check/converter.html`; its dataset and 200% text toggles never ship. CSS was reviewed for 320–2560 px and 200% text. **No browser/pixel measurements, visual app inspection, desktop control or native-dialog automation were performed.**

| Before | After | Why |
| --- | --- | --- |
| Long native page-size option descriptions | Short labels and associated default explanations | Native select labels cannot wrap at narrow widths/large text |
| Removed row could strand keyboard focus | Focus next remove control or Add images | Keyboard continuity |
| Basic headerless HTML tables could flatten into unrelated paragraphs | A focused table handler preserves rows/cells | Preserve available structure without changing other parser behavior |

## Limitations and manual handoff

The complete conversion matrix and bounds are in README.md. PDF generation is reflowed, with font-covered precomposed Latin/Greek/Cyrillic; CJK, complex scripts, emoji and combining sequences are rejected. Existing-PDF extraction depends on its text mapping/order; page boundaries are preserved but original styling/tables/semantic headings/link annotations are not reconstructed. No OCR/password handling, CSS printing, full Office formats, batch job queue or persistence is added. Cancellation waits for the current native codec/render step to finish.

Manual checks: all document routes with native selection/Save; Unicode pagination and reconstructed reading order; all/ranged PDF pages to a new PNG/JPEG folder; image list add/remove/reorder and A4/image-sized results; orientation/white transparency; scanned/encrypted/corrupt/missing-asset errors; cancellation, destination protection and navigation retention; retained media/single-image conversion; narrow windows, visible focus and 200% text. The user performs these checks. Installed-app/installer behavior was not verified.
