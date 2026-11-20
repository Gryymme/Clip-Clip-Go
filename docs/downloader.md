# Downloader milestone

Paste one HTTP(S) URL, inspect it, choose a source and final output, review the native plan, choose a destination folder and filename, then download. The UI uses real native job state and survives navigation. Converter, Images to PDF and Downloader share one native operation lease. Queue and History remain placeholders.

## Website extraction investigation — 2026-11-21

The three reported inspection failures have different evidence. No browser fallback or site resolver was implemented in this investigation. All public checks were metadata-only or bounded HTML/script fetches, without browser control, credentials, JavaScript execution, media downloads, or access-control/DRM bypass. Public results are observations from this environment, not routine test expectations or universal site-support claims.

### Exact bundled invocation and URL handling

The tested application executable is `C:\Users\User\Documents\Projects\Clip-Clip-Go\src-tauri\target\debug\yt-dlp.exe`, official Windows x64 **2026.10.26**, 23,575,744 bytes, SHA-256 `f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d`. Its hash matches both `scripts/downloader-manifest.json` and the development sidecar `src-tauri/binaries/yt-dlp-x86_64-pc-windows-msvc.exe`. Native resolution uses the application's executable directory and verifies the pinned hash before invocation. `--list-extractors` includes `imdb` and `imdb:list`; verbose inspection reports 1747 loaded extractors, bundled `yt_dlp_ejs` 0.8.0 and Deno 2.9.8. This is not a stripped build missing IMDb.

The following is the production inspection argument array, shown one argument per line. Angle brackets stand for resolved absolute paths or the complete validated input; these are not shell commands or user-configurable arguments.

```text
--ignore-config
--no-config-locations
--no-plugin-dirs
--no-update
--no-cache-dir
--no-remote-components
--no-js-runtimes
--js-runtimes
deno:<app directory>\deno.exe
--ffmpeg-location
<app directory>\ffmpeg.exe
--no-playlist
--break-match-filters
!is_live & live_status !=? is_upcoming & live_status !=? post_live & !has_drm
--playlist-end
1
--socket-timeout
15
--retries
2
--extractor-retries
1
--paths
<owned job directory>
--paths
temp:<owned job directory>
--dump-single-json
--skip-download
--flat-playlist
--no-warnings
--no-progress
--
<complete URL>
```

FFmpeg resolves to `src-tauri/target/debug/ffmpeg.exe` (9.0.2 essentials); Deno resolves to `src-tauri/target/debug/deno.exe` (2.9.8, pinned SHA-256 `924397800533d3eb0ed0c889b20ad70e18b970d93acd8135bc043f425e528266`). The native runner uses argument arrays, a job-owned working directory, a 60-second inspection deadline, concurrent stdout/stderr drainage and Windows process-tree cleanup. Environment is inherited except external `DENO_*` variables are removed and `DENO_DIR`, `DENO_NO_UPDATE_CHECK`, `DENO_NO_PACKAGE_JSON`, `DENO_NO_PROMPT`, `TEMP`, `TMP`, `TMPDIR` are set for the job. No proxy environment variables were present in these probes. PATH is inherited, but the app explicitly selects bundled yt-dlp, Deno and FFmpeg. Minimal nightly probes incidentally discovered a system FFmpeg; app-argument probes used the explicit bundled FFmpeg. No media processing occurred in either case.

Frontend validation passes the trimmed original input. Native validation permits HTTP(S), rejects embedded credentials/control characters and uses URL serialization; it preserves all three supplied URLs, including IMDb's `playlistId`, and the tested YouTube watch/share parameters, encoded query values and fragments. The complete URL is one argument following `--`. There is no app domain allowlist, force-generic option, extractor-selection restriction, or diagnostic redaction applied to the actual input. The post-extraction stream-protocol allowlist cannot cause an engine exit-1 failure. IMDb's upstream extractor itself requests its canonical `/video/vi<ID>` address; this is separate from app URL handling.

### Minimal versus app arguments and newer engine

For each supplied URL, the exact bundled executable was run directly with a minimal documented metadata invocation and then a replay of production arguments/environment. The minimal arguments were `--ignore-config --no-plugin-dirs --no-update --no-cache-dir --no-playlist --socket-timeout 15 --retries 2 --extractor-retries 1 --dump-single-json --skip-download --no-progress -- <URL>`. Both probes added `--verbose` solely to identify extractors/runtime diagnostics. These were headless subprocess replays, not automation of the rendered app. URLs and sensitive diagnostics were redacted before retaining probe reports.

As of this check, the [latest official stable release](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.10.26) is the app's existing 2026.10.26 pin. The newer official [nightly 2026.11.19.232656](https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/tag/2026.11.19.232656), source `f66c9c725ee92c3fc1853ac301ebfb4f40e1bee8`, was downloaded separately under ignored `.engine-cache/coverage/candidate`. Before execution, its 23,629,722-byte executable was verified against both GitHub's asset digest and the publisher's `SHA2-256SUMS`: SHA-256 `f7d8f7ed1642aa641b29cbadb08029d705706215cb72ad7ffa8013655f74ad20`. Both minimal and app-argument checks were repeated with it. None of the three page-level outcomes improved. The nightly release notes contain no IMDb fix; the inspected [upstream IMDb extractor](https://github.com/yt-dlp/yt-dlp/blob/f66c9c725ee92c3fc1853ac301ebfb4f40e1bee8/yt_dlp/extractor/imdb.py) matches this URL pattern and is unchanged from the pin. Master release metadata was reviewed, but a master executable was not tested. The project pin, shipped engines, dependencies and update policy remain unchanged.

| Supplied page | Exact bundled result | App-argument comparison | Verified nightly result | Additional evidence and remaining unknowns |
| --- | --- | --- | --- | --- |
| IMDb `/video/vi3232221721/?playlistId=nm13946181` | Exit **1**, extractor **imdb**, `Unable to extract next.js data` | Same result; **the reported `Unsupported URL` was not reproduced for IMDb** | Same exit 1, `imdb`, parsing error, with both invocations | Separate ordinary HTTP probes of the original and canonical addresses returned **202**, empty bodies and `x-amzn-waf-action: challenge`, without redirects. This suggests an interstitial/challenge explains the missing Next.js data, but those HTTP probes used a different client and do not prove the exact response received inside yt-dlp. A listed extractor does not guarantee an accessible response. No evidence yet justifies browser network detection; an accessible public response/upstream extractor diagnosis is needed first, without bypassing the challenge. |
| FullxCinema `/cheaters-retreat-2-2011/` | Repeated exit **1**, extractor **generic**, `Unsupported URL` | Same result | Same generic exit 1 with both invocations | An initial connection timeout was a separate transient network failure. Later HTML fetch: **200**, 90,150 bytes, no redirect; a same-origin iframe points to `/wp-content/plugins/clean-tube-player/public/player-x.php?[redacted]`. That wrapper returned **200** with HTML5 video/source tags. Passing its complete, unchanged internal URL to the **bundled** engine succeeded with **exit 0**, `html5` / `HTML5MediaEmbed`, one format, under both minimal and app arguments. Therefore static embed discovery or a narrow site extractor is supported by evidence; a browser is not required for this metadata step. The page's comment-form Turnstile script alone is not evidence that the media page was blocked. Full transfer, expiry, headers and final playback were not tested. |
| Cinejoy `/watch/tv/5920/1/1` | Exit **1**, extractor **generic**, `Unsupported URL` | Same result | Same generic exit 1 with both invocations | HTML fetch: **200**, 5,773 bytes, title `Cinejoy`, no redirect, video/source/iframe tags or literal media URLs. It references an external loader at `a.wing.st`; inspected script text references location data. Scripts were not executed and script-triggered navigation was not followed. The runtime media path, current availability, and possible geographic/session differences remain unknown. No basis to assert this is a playable video application, a parked site, or that browser detection is required. Investigate public loader/site data only if further work on this address is warranted. |

The extractor traces reported no redirect to another extractor for the original URLs. The no-redirect HTTP observations above come from the separate ordinary HTTP probes; they are not a complete wire trace of yt-dlp's requests. Errors shown in this section are sanitized excerpts. Full wrapper queries, signed media locations, raw HTML, credentials and engine JSON dumps are not included. Video DownloadHelper's browser/session/network observations were not inspected, so a difference in its result is not proof of an app argument defect or a browser requirement.

### Focused app fix and verification

No incorrect extraction flag or URL restriction was demonstrated. A separate confirmed error-translation defect was fixed: broad substring matching examined URLs themselves (`?filter=...`, `/private/...403`, `/removed`) and conflated parsing/network failures and HTTP denial/authentication. Two regression tests failed against the old code before the fix. Classification now prefers actual engine error lines, excludes URL tokens from classification, and uses specific evidence to distinguish unsupported extraction, parsing, HTTP denial, authentication, bot challenges, missing runtime/components, rate limits, unavailable media, DRM, filter exclusion and network errors. Unknown failures retain a neutral message and the existing bounded sanitized diagnostics. Missing Next.js data remains a parsing error; the app does not infer a bot challenge without engine evidence. Runtime repair messaging refers to the bundled app components, never a system dependency installation.

Production inspection arguments were factored into one helper without changing their values. Offline regressions cover the three URLs, YouTube watch/share URLs, encoded query values, exact single-argument delivery, absence of extractor restrictions, error categories, warning/error precedence, and sensitive URL words. Existing local integration tests retain the selected-source/merge/validation/publication and cancellation coverage. Public probes are investigative, separate from routine tests, and cannot establish successful downloads or general site coverage. Rendered app behavior/native dialogs and a new public YouTube transfer were not tested in this investigation.

Verification completed: `cargo test --manifest-path src-tauri/Cargo.toml downloader:: -- --test-threads=1` passed **18 tests**, with the opt-in public YouTube transfer test ignored. This includes real generated-media/local-HTTP integration and throttled two-source progress, merge, conversion, FFprobe validation and protected publication. The three error regression tests were also rerun after the final message-copy adjustment and passed. `cargo fmt --check`, `cargo check`, TypeScript checking and the production frontend build passed. `npm run tauri -- build --debug --no-bundle` rebuilt `src-tauri/target/debug/clip-clip-go.exe`; cached pinned engines/assets were reused and verified. No installer was produced. The broader non-Downloader native and frontend test suites were not rerun for this native classification change. No new test failures occurred after the intentional pre-fix regression reproduction.

**Smallest justified next implementation:** add a narrowly scoped static resolver for FullxCinema's same-origin player iframe, backed by local HTML fixtures, bounded fetch/depth rules, explicit origin/redirect handling and existing yt-dlp inspection/selection flow. Exclude advertising frames, retain full internal URLs, redact diagnostics and preserve cancellation/deadlines. This is a proposed next step, not implemented support. Do not build a general crawler, extension or embedded browser based on the current evidence. IMDb and Cinejoy need separate investigation rather than routing every failure into that resolver.

## Downloader correction: cause and fix

The confirmed app defect occurred **after both source downloads and their FFprobe checks, before the merge command**. The only old “streams changed” branch rebuilt the plan using `plan::build(&actual, original_settings, engines)` and compared its source IDs with the original plan. `actual` still contained every undownloaded variant from inspection. With Best/Automatic active, measured metadata could change the ranking: a reported 60 fps source measured as 60000/1001 fps, letting an undownloaded 60 fps variant win. A regression reproduced this exact mismatch without any site change. Final validation also used the original automatic source settings and could repeat that selection mistake.

Post-download planning and final validation now bind source selection to the original typed plan's video/audio IDs. Measured codecs/dimensions/frame rates refine copy/encoding decisions for those IDs. There is no automatic downgrade or replacement. The “streams changed” wording is reserved for a completed record identifying another format, or a downloaded selected stream actually lacking its required video/audio kind. Missing refreshed formats, network/site access errors, source validation, output planning, merge, encoder/remux, final validation and publication failures have distinct explanations.

Source FFprobe checks validate the downloaded media and its expected stream kinds; they do not require the final output container or codecs. Final output settings are applied by the subsequent plan and FFmpeg stages. Source duration used for output comparison is measured from downloaded media rather than treating approximate website duration as exact. The throttled fixture deliberately reports an inaccurate site duration to cover this boundary.

Format IDs use an exact, quoted `format_id` filter, including numeric IDs. The original watch/share URL and meaningful parameters are preserved. Each yt-dlp invocation re-extracts the page to obtain fresh signed stream URLs; HTTP 403/410 retries once with another extraction and the same selected IDs. No signed stream URL is stored in the execution plan. Files are tracked from one explicit `after_move` JSON record containing `filepath` and optional `format_id`; the path must be a nonempty regular, nonsymlink file directly inside the unique job workspace. Directory scanning, progress-text filenames and guessed extensions are no longer completion evidence. Existing atomic no-overwrite publication remains in place.

Diagnostics stay in current-job memory: at most 16 records, each with stage, engine, exit code, selected IDs and at most 1600 sanitized stderr characters. URLs, credentials, cookies, authorization data, query assignments and paths are removed or redacted before reaching the frontend. No full engine dump appears in the main UI. Technical diagnostics expand separately beneath job status.

## Progress and UI correction

The original percentage parser used only exact `total_bytes`; fragmented/estimated transfers could therefore remain indeterminate until the final source event supplied a total. The implementation now projects a small numeric progress record, requests newline output at 0.1-second intervals, and handles measured bytes, fragment counts and explicitly labeled byte estimates. No total or estimate means indeterminate progress with live byte/speed information. Partial reads, CRLF, a final record without a newline and oversized lines are covered. Stdout and stderr drain concurrently into independently framed lines; callbacks are serialized only after a full line is available.

Progress is scoped to job ID, stage and the source invocation's index/count. It does not depend on a format-ID field appearing consistently in progress events. Source 2 resets source 1's progress, stale job/stage/source updates are ignored, and a stream's finished event cannot mark the job succeeded. Success is recorded only after validation and protected publication. Cancellation remains active during download, merge, conversion and finalizing; a new boundary test caught and fixed cancellation being misreported as an empty output after staging cleanup.

| Before | After | Why |
| --- | --- | --- |
| Downloader and AppShell both rendered the page title | AppShell owns the single page heading | Clear hierarchy |
| Bare media-link input/action | Reused `EmptySelectionCard`, shared preview footprint, tokens and form-associated Inspect button | Match Converter and Images to PDF |
| Cancel directly followed the progress facts | Separate action row with `space-4` top spacing inside a status card | Keep cancellation distinct and reachable |
| Repeated instructions and technical plan text always visible | Short primary flow, expandable source/output controls, plan details and diagnostics | Keep decisions visible and details available |

The headless fixture checks one heading, shared-card markup, progress/source states, unknown totals, estimates, diagnostics and the action-row structure. It retains long/non-Latin/HTML-looking titles, 2000 variants, missing metadata, failure/cancellation states, both themes, 320–2560px width controls and a 200% text switch. These are SSR assertions and CSS review; no desktop control, native dialogs or browser pixel verification was performed.

## Correction verification and limits

- **Regression/unit and mocked boundaries:** fractional-frame-rate reselection; selected stream kinds; missing progress fields; exact/estimated/fragment/unknown totals; partial pipe reads; stdout/stderr incremental delivery and exit status; job/stage/source scoping; completion containment; redaction; expiry retry retaining IDs; cancellation at every execution stage; encoder/network failure classification; protected publication.
- **Real local media:** a sufficiently large generated video served in 16 KiB chunks with 20 ms pauses. Two reported video variants have rounded 30 fps metadata while the selected actual file is 30000/1001 fps. Source 1 must emit at least three intermediate measured updates before its engine exits; source 2 must reset progress. The test then merges, converts to WebM, FFprobe-checks video/audio and publishes. The broader local smoke test retains all nine output formats and bitrate/property checks.
- **Authorized public fixture:** the user supplied `https://www.youtube.com/watch?v=irVNGjRFZGk&t=1s`. Watch and derived share URLs inspected to the same 146-second item and 45 formats. One explicit 360p H.264 source (format 230) with automatic separate audio downloaded, merged/remuxed to MP4, passed final FFprobe validation and published 5,838,987 bytes. The test did not download the default Best/2160p variant, separately download the share form, exercise every output setting on YouTube, or verify the rendered app/native dialogs. This single result is not a general site-support guarantee. The public test is ignored in routine runs and requires explicit authorization environment variables.
- **Current fixture failure investigated:** the fast local response repeatedly ended after 245,760 bytes, including outside the network sandbox. Instrumentation exposed Windows error 10035 (`WSAEWOULDBLOCK`) from server writes. Accepted sockets inherited the nonblocking listener mode; ignoring the write error truncated the response, while throttling avoided filling the buffer. Accepted connections now explicitly use blocking mode with read/write timeouts and graceful closure. This was a fixture defect, not evidence that the download should be accepted as complete. Earlier PDF publication/10053 issues remain historical observations and are not used to dismiss this failure.

Final correction checks: `npm test` passed 62 frontend tests; the serialized native suite passed 65 tests with four ignored entries (three subprocess helpers exercised by parent tests, plus the opt-in public fixture). The authorized public fixture was run separately and passed. Twenty Downloader SSR/state fixtures and fourteen existing Converter/Images-to-PDF fixtures passed. TypeScript checking, the production frontend build and `cargo check` passed. `npm run tauri -- build --debug --no-bundle` updated `src-tauri/target/debug/clip-clip-go.exe` without creating an installer. The packaged Downloader engines/40 notice files passed verification with empty PATH, and the existing PDF assets/28 PDF notices also verified. No PDF publication failure occurred in this serialized run. No dependencies or engine versions changed in the correction.

## Options

| Area | Implemented choices |
| --- | --- |
| Source | Best available; grouped reported resolutions/frame rates; exact video and audio IDs in advanced source selection |
| Video output | MP4, MKV, WebM |
| Resolution | Same as source; 2160p, 1440p, 1080p, 720p, 480p, 360p when no larger than the reported source height |
| Frame rate | Same as source; 24, 25, 30, 50, 60 fps; increases duplicate frames without interpolation |
| Video encoder | Auto; compatible, available H.264, HEVC, VP9, AV1 encoders from bundled FFmpeg |
| Video quality | Preserve compatible streams; High, Balanced, Smaller file quality presets; separate target bitrate mode, 100–100000 kb/s |
| Video audio | Keep or Remove; compatible codec, bitrate, sample rate, channels in advanced settings |
| Audio output | MP3, M4A/AAC, WAV/PCM 16-bit, FLAC, OGG/Vorbis, Opus |
| Audio bitrate | Preserve/compatible default, 64/96/128/160/192/256/320 kb/s presets, validated custom target; hidden for FLAC/PCM |
| Sample rate | Same as source; supported choices from 8 to 96 kHz; encoder-incompatible rates disabled. Opus decodes at 48 kHz, selected explicitly for conversion from another rate |
| Channels | Same as source, Mono, Stereo; MP3 multichannel input requires an explicit Mono/Stereo selection |

The authoritative compatibility table is `src-tauri/src/downloader/compatibility.json`, consumed by Rust and TypeScript and checked over IPC. Explicit unavailable encoders are rejected. Quality mode uses CRF; target-bitrate mode uses `-b:v` without CRF. Re-encoding uses compatible even dimensions, preserves aspect ratio, and never deliberately upscales. Missing metadata stays unknown. Partial direct-media metadata may require a provisional plan; the app probes downloaded streams and revalidates before encoding. It fails with an explanation if a selected stream or requested property is unavailable.

Default audio conversion uses 192 kb/s for AAC/MP3/Vorbis and 128 kb/s for Opus when stream copy cannot satisfy the selection. Preserve mode uses the existing balanced video preset when encoding is necessary. Neither bitrate increases nor lossless containers recover missing source quality. Target bitrate and approximate stream sizes do not promise an exact final size or average bitrate.

## Execution and limits

Inspection has a 60-second native timeout and does not intentionally download the full media. It uses yt-dlp metadata extraction with skip-download, no-playlist and flat playlist inspection; a watch URL containing a playlist parameter selects only the item. Pure playlists, channels, live/upcoming/processing streams and DRM are rejected. Routine HTTP, native HLS and DASH stream protocols are supported where the pinned extractor succeeds. Website support changes and is not universal. Authentication, browser cookies, login imports, DRM/access-control bypass, queues, batches, saved history and automatic updates are absent. There are no artificial transfer quotas.

yt-dlp runs with argument arrays, ignored external configuration, disabled plugins/cache/update checks/remote components, and only the verified bundled runtime enabled. Source filenames are fixed by the app and contain no website-supplied template values. FFmpeg/FFprobe use explicit resolved paths, local-file protocols and an allowlist of common media demuxers, excluding playlist/concat input files that could reference unrelated local files. A Windows kill-on-close Job Object contains each engine and its descendants; cancellation, timeouts and normal app exit terminate them. Runtime working directories and scratch/cache environment point into the unique job workspace.

All downloaded streams, merge files and encoded outputs stay in one job-owned directory beside the chosen output. Stream copy/remux is selected per stream where compatible. Separate streams are merged with FFmpeg before any necessary conversion. FFprobe validates the final container, codecs, dimensions, frame rate, audio channels/sample rate and known source duration before publication. A same-volume hard link atomically publishes without overwriting; filesystems without hard-link support fail explicitly. Normal completion, cancellation and exit remove only the owned staging directory. A crash/power loss can leave staging files; crash recovery is not implemented.

Metadata buffers are bounded to 2 MiB, source variants to 2000, URLs to 8192 characters, displayed titles to 1024 Unicode characters, stream IDs to 128 safe ASCII characters and filenames to 100 characters. Windows filename sanitation prevents traversal/device names. Filesystem/path/disk-space limits still apply. Higher-effort AV1 encoding can be slow. HDR preservation/tone mapping, subtitles, chapters, attachments and rich downloaded metadata are outside this milestone; re-encoded video uses yuv420p and output metadata is stripped.

## Verification

- Frontend: `npm test`, `npm run typecheck`, `npm run build`.
- Native: `cargo test --manifest-path src-tauri/Cargo.toml`, `cargo check --manifest-path src-tauri/Cargo.toml` (this checkout uses project `.cargo-cache` offline).
- Engines: `npm run engines:verify`, `npm run downloader:verify`; pinned build-time checks also reject missing/damaged sidecars and notices.
- Packaged payload: `node scripts/verify-downloader-resources.mjs` verifies unsuffixed engines and all 40 notice/provenance files beside the debug executable; each engine version command runs with an empty PATH.
- Layout/state: `node scripts/check-downloader-layout.mjs` creates `.engine-cache/ui-check/downloader.html` with Demo data, Worst case, Empty, audio-only, unknown metadata and job-stage fixtures, theme/width/200% text controls. SSR and CSS checks do not verify pixels. No fixture controls or simulated activity ship in the app.
- Local integration: generated H.264/AAC media served by a local HTTP fixture; HTML/direct-media/DASH inspection; stream copy, separate-stream merge, video-only and audio-only; all nine output formats; resolution/frame rate/channels/sample rate checked by FFprobe. Audio 128 kb/s test tolerance is ±10%; short 500 kb/s video fixture allows ±50% for encoder startup/complexity. Actual available video encoders are exercised separately. Progress-driven cancellation rejects publication and cleans scratch. Process-tree cancellation/timeout and publication collision tests are separate native tests.

Routine tests use no public websites. Real-site compatibility, rendered desktop appearance, native dialogs and manual functionality require user testing. No full installer is built. Public redistribution is blocked by the licensing/source preparation described in `third-party/downloader/NOTICE.md` and the existing FFmpeg notice.

Milestone results (2026-11-20): 62 frontend tests passed; the full native suite passed with `--test-threads=1` (57 passed, two child-process fixtures invoked by their parent tests). TypeScript checking, Vite build and Rust checking passed. Sixteen Downloader and fourteen existing Converter/Images-to-PDF SSR fixtures passed. Raw added sidecars are 121,657,312 bytes (116.02 MiB), with 826,314 bytes of notices/provenance. A parallel run encountered a transient existing PDF folder-publication failure; it passed in the serialized suite. Restricted-network runs also intermittently aborted loopback connections (Windows 10053). The final generated-media HTTP integration test passed outside that network sandbox, including the final fixed source filenames and demuxer restrictions. These results do not establish real-site or manual app compatibility.

## Manual checklist

1. Inspect the supplied watch URL and its share form, retaining playback/query parameters. Compare title and source choices; check the single heading/shared link card and Cancel spacing, and cancel inspection.
2. Try default Best/MP4 and an explicit smaller source. Watch source 1 update, source 2 reset, and the merge/finalize stages; confirm playback, sound and duration. The default 2160p download remains a manual check. Also try WebM, audio-only and Remove audio.
3. Try smaller resolution, 24/60 fps, quality preset, target video bitrate, custom lossy audio bitrate, sample rate and Mono/Stereo; verify incompatible values block starting.
4. Choose a folder, try a long/Windows-reserved filename and an existing filename. Confirm an existing file remains untouched.
5. Navigate during inspection/download/conversion, cancel, then close during a job. Confirm no owned engine processes or staging directories remain; starting a conversion during download is blocked.
6. Recheck one audio/video conversion, one image conversion and Images to PDF. Check both themes, keyboard focus, narrow/short windows and 200% text.
