# Clip-Clip-Go

Clip-Clip-Go is a Windows desktop application being built to combine authorized media downloading with local conversion of video, audio, image, and document files into appropriate formats through a user-friendly interface.

The working foundation uses Tauri 2, React, TypeScript, Vite, npm, and plain CSS. It provides a dark desktop shell with keyboard focus styles and navigation between Downloader, Converter, Queue, History, and Settings.

## Converter

The Converter selects one local file through a native Windows file dialog and displays its name, full path, exact size, and preliminary video/audio category. Metadata comes from the native layer without loading the file contents into memory. Replace and remove controls are available; cancellation or an unsuccessful replacement preserves the previous selection.

Supported inputs: MP4, MKV, WebM, MOV, MP3, WAV, FLAC, M4A, and OGG. Video inputs offer MP4, MKV, WebM, or audio extraction to MP3, WAV, FLAC, and M4A. Audio inputs offer MP3, WAV, FLAC, and M4A. Compatible output choices are retained when replacing a file. The selected file and format survive page navigation during the current session and reset when the application is reloaded or closed.

**Conversion is not available yet.** The Convert button is disabled. Categorization uses the filename extension; FFprobe validation and actual conversion are not implemented. Downloader, Queue, History, and Settings remain placeholders. There is no downloading, job processing, database, batch processing, or persistence.

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

These checks passed for the selection milestone. Browser checks with test-only native responses covered long filenames and paths, 320–2560px widths, 200% text, and selection retention across navigation. The desktop app compiled and launched, and its Converter screen was inspected. Native UI automation was stopped before the file-dialog result could be verified; manually confirm selecting and cancelling in the dialog, displayed metadata, and output choices for both a video and an audio file.
