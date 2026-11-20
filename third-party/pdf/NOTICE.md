# PDF components

PDFium 158.0.8125.0 is the non-V8, non-XFA Windows x64 build from
bblanchon/pdfium-binaries, built from upstream PDFium chromium/8125. The pinned
archive, executable hash and source reference are in scripts/pdf-manifest.json.
PDFium is BSD-style licensed; its bundled dependencies have individual terms.
All license texts from the binary archive, build flags and version are retained
under pdfium/. No JavaScript/form runtime or network fetch API is invoked.

Noto Sans Regular is from notofonts/noto-fonts at the revision in that manifest,
under the SIL Open Font License (NotoSans-OFL.txt). The font is redistributed
unmodified and embedded in generated PDFs. It is independent of the removed
Office runtime. The application license has not changed.

The Rust pdfium-render wrapper is MIT OR Apache-2.0; ttf-parser is MIT OR Apache-2.0.
Their license texts are included beside this notice. Retained text and FFmpeg
component notices remain separately applicable.
