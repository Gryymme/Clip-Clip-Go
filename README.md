# Clip-Clip-Go

Clip-Clip-Go is a Windows desktop application being built to combine authorized media downloading with local conversion of video, audio, image, and document files into appropriate formats through a user-friendly interface.

The working foundation uses Tauri 2, React, TypeScript, Vite, npm, and plain CSS. It provides a dark desktop shell with keyboard focus styles and navigation between Downloader, Converter, Queue, History, and Settings.

Every page is a placeholder labeled **Not implemented yet**. Downloading, conversion, job processing, history storage, and saved settings are planned functionality and are not implemented.

## Development

From the project root, launch the desktop application:

```sh
npm run tauri dev
```

The Tauri CLI is a local development dependency. Node.js/npm, Rust with the MSVC toolchain, Visual Studio C++ build tools, a Windows SDK, and WebView2 are required. The npm and Cargo lockfiles are retained.

Other scripts: `npm run dev` starts only the frontend, `npm run typecheck` checks TypeScript, and `npm run build` checks and builds the frontend. Installer packaging is disabled for this milestone.

## Verification

TypeScript checking, the frontend production build, and native compilation and process launch through `npm run tauri dev` passed. Visual verification is pending: confirm the desktop window opens, each navigation button switches to the matching placeholder, and Tab/Enter/Space navigation has visible focus.
