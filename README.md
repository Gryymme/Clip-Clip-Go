# Clip-Clip-Go

Clip-Clip-Go is a Windows desktop application being built to combine authorized media downloading with local conversion of video, audio, image, and document files into appropriate formats through a user-friendly interface.

The working foundation uses Tauri 2, React, TypeScript, Vite, npm, and plain CSS. It provides a dark desktop shell with keyboard focus styles and navigation between Downloader, Converter, Queue, History, and Settings.

## Converter

The Converter selects one local file through a native Windows file dialog and displays its name, full path, exact size, and preliminary video, audio, image, or document category. Metadata comes from the native layer without loading the file contents into memory. Replace and remove controls are available; cancellation or an unsuccessful replacement preserves the previous selection.

The selection UI offers the following **planned conversion routes**, whose actual support will be validated when conversion engines are integrated:

| Input | Planned outputs |
| --- | --- |
| MP4, MKV, WebM, MOV | MP4, MKV, WebM; audio extraction to MP3, WAV, FLAC, M4A |
| MP3, WAV, FLAC, M4A, OGG | MP3, WAV, FLAC, M4A |
| JPG/JPEG, PNG, WebP, BMP, TIFF/TIF | JPG, PNG, WebP, BMP, TIFF |
| DOC, DOCX, ODT, RTF | PDF, DOCX, ODT, TXT |
| TXT | PDF, DOCX, ODT |
| PPT, PPTX, ODP | PDF, PPTX, ODP |
| XLS, XLSX, ODS | PDF, XLSX, ODS, CSV |
| PDF | TXT, PNG, JPG |

Extension matching is case-insensitive; JPEG/JPG and TIF/TIFF use the same routes. Output choices are specific to the input format. PDF-to-text will initially require a text-based PDF; scanned documents need OCR, which is not offered. PDF-to-image is planned to produce one image per page, and spreadsheet-to-CSV may export only one sheet. PDF-to-Word and unrelated cross-category routes are not offered.

Compatible output choices are retained when replacing a file. The selected file and format survive page navigation during the current session and reset when the application is reloaded or closed.

**Conversion is not available yet.** The Convert button is disabled. Categorization uses the filename extension; content inspection, FFprobe validation, and actual conversion are not implemented. Downloader, Queue, History, and Settings remain placeholders. There is no downloading, job processing, database, batch processing, or persistence.

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

The Tauri CLI is a local development dependency. Node.js/npm, Rust with the MSVC toolchain, Visual Studio C++ build tools, a Windows SDK, and WebView2 are required. The npm and Cargo lockfiles are retained. Installer packaging is disabled for this milestone.

## Verification

- `npm test`: focused format-compatibility and selection-state tests using Node's built-in test runner.
- `npm run typecheck`: TypeScript checking.
- `npm run build`: TypeScript checking and frontend production build.
- `cargo check --manifest-path src-tauri/Cargo.toml`: native checking.
- `cargo test --manifest-path src-tauri/Cargo.toml`: native metadata tests.

The user confirmed that audio/video selection and appropriate output choices work. Manual functionality testing, including native file dialogs, is performed by the user; image/document selection still needs that confirmation. Automated checks do not establish manual verification.

Manual checklist: select images including JPEG/TIF aliases and mixed-case extensions; select a text document, presentation, spreadsheet, and PDF to check their distinct outputs and contextual notes; test cancel, replace, remove, and navigation retention; recheck audio/video selections. Convert must remain disabled throughout.
