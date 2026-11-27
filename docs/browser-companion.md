# ClipClipGO browser companion

The independently developed Chrome Manifest V3 companion complements pasted-link yt-dlp downloads. No Video DownloadHelper code or assets were used. Chrome is the supported target; store publishing and Edge/Firefox packaging remain deferred. Detection does not guarantee availability or site support. No browser, cookies, credentials, remote extension code or telemetry is bundled/imported.

## Supported unpacked setup

1. Open ClipClipGO → Settings → **Extension Installation Guide** (also reachable from Downloader).
2. Choose **Open Extensions page**, or **Copy address** and paste `chrome://extensions/` into Chrome. Enable **Developer mode** yourself.
3. Choose **Load unpacked** in Chrome and select the folder displayed in ClipClipGO. **Open extension folder** and **Copy folder path** help locate it.
4. Copy the actual extension ID shown by Chrome and paste it into ClipClipGO. Choose **Connect / Finish setup**. No PowerShell command is required.
5. Keep ClipClipGO open, open the extension popup and click **Connect**. It reloads the native connection and makes at most three bounded attempts. Confirm **Connected** in both places. After 60 seconds without a handshake, Settings returns to **Bridge ready**; you can retry. A saved ID/registry write never proves connection.
6. In a normal HTTP(S) tab, choose **Allow this site** once and approve its website origin. Detection then runs automatically across open tabs/navigation on that permitted site, until access is revoked through the popup or Chrome. Start playback. Allow trusted frame/CDN origins if needed, rescan and restart playback. Select a source → **Send to ClipClipGO**. Review the existing source/output plan and explicitly confirm the download in the desktop app.

The complete loadable folder is named **extension**, directly inside the actual application directory. Paths follow custom/per-user installations; there is no hard-coded Program Files location. Files include manifest, JavaScript, CSS, local Montserrat and its OFL license; end users need no build tools. No session data is written there. A debug build first uses its packaged sibling folder, otherwise explicitly identifies the project’s `browser-companion/extension` fallback. Release builds require the packaged sibling. When updating an already loaded unpacked extension, click Chrome’s **Reload** yourself; if its path/ID changes, paste the new ID and finish setup again.

Developer build (from this repository, cached engines available):

```powershell
$env:CARGO_HOME="$PWD/.cargo-cache"
$env:CARGO_NET_OFFLINE="true"
npm run tauri -- build --debug --no-bundle
```

This builds the host automatically, updates `src-tauri/target/debug/clip-clip-go.exe`, and prepares the sibling `extension` folder without building an installer. Start the app yourself and use Settings. Legacy development scripts remain optional compatibility tools; they are not required for normal unpacked setup.

## Store path and desktop ownership

`browser-companion/distribution.json` has nullable `chrome.extensionId` and `chrome.storeUrl`, currently **unset**. The app offers unpacked setup without pretending there is a store listing. When a real matching HTTPS Chrome Web Store listing is configured, an additional store option explains that **Proceed** prepares the bridge and opens the listing; the user adds the extension in Chrome. Store installation would not require Developer mode. Unpacked remains available as an alternative. No listing was published or invented.

Browser targeting uses actual top-level normal Chrome windows and validated executable paths, then the supported Windows default or an explicit chooser. It does not read history, unrelated tabs or browser profiles. Background process counts are not treated as windows. Chrome profiles, unusual/PWA windows and portable installations require manual verification. Opening uses fixed arguments or a validated listing; browser preferences/policies are not edited.

User-triggered setup creates/updates only this per-user default **REG_SZ** value:

```text
HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\com.clipclipgo.companion
(Default) = <owned bridge directory>\com.clipclipgo.companion.json
```

New setup uses `%LOCALAPPDATA%\ClipClipGO\BrowserBridge\chrome`, avoiding Program Files writes and administrator requirements. A debug build reuses a legacy `<project>\.browser-companion\chrome` setup only when that exact manifest is currently registered. Release builds use LocalAppData. The directory contains only the host copy `clipclipgo-native-host.exe`, `host-config.json` (owner/version, exact ID, desktop path, host hash), and Native Messaging manifest. No media URLs are stored there.

The ID must be exactly 32 lowercase `a`–`p` letters before setup performs any mutation. The manifest allows exactly `chrome-extension://<configured-id>/`, with no wildcard. Canonical executable paths/names, ownership, manifests and host SHA-256 are checked. Setup/repair/ID changes are idempotent for this installation’s files; another registration/installation, links or unknown bridge files cause refusal. Close the old extension connection before repairing an in-use host. A real authenticated handshake with the currently configured ID is required for **Connected**; its lease expires after about 25 seconds without heartbeat. The host returns an actionable app-closed response rather than repeatedly launching full app instances.

## Lifecycle fix and privacy boundaries

Confirmed defects: main-page/SPA navigation deleted the activated session, and a worker restart lost the in-memory request identity needed to accept an in-flight response. Both new regressions failed before the fix. Sending a candidate did not globally disable discovery. Before 0.4.0 another tab required its own activation; persistent browser grants now replace that model. We have not replayed the reported real-site sequence in Chrome; missing CDN/frame access or site-specific player behavior may still contribute.

- Companion **0.4.0** removes timed/per-tab activation. Actual Chrome host grants are checked on worker startup/restoration, permission events and periodic reconciliation; already-open permitted tabs are injected automatically. Navigation rotates identity and clears old candidates. A new origin works automatically only if already granted. SPA injection avoids immediately relabeling old DOM media. Tab closure clears its data. Child navigation clears that frame’s candidates/document identity; stale responses cannot repopulate another navigation.
- The worker restores bounded request identity from session storage after suspension; only transient in-memory request context can contain Referer (maximum 512 records/30 seconds). No Cookie/Authorization header is stored. Sending, native disconnection and revoking another origin do not stop unrelated authorized tabs. The popup can reopen without starting a new session.
- Optional website access is required for page and media origins. `activeTab` does not cover arbitrary cross-origin media. Missing root/frame permissions have actionable UI; unknown CDN origins can be granted explicitly under **Settings → Access and Troubleshooting**. Root-page access is required even when its CDN is permitted; temporary activeTab access alone never enables detection. Listeners reject unpermitted pages before inspecting headers. No mandatory all-sites grant or browsing-history permission is used.
- Requests/content types and permitted isolated-world media elements identify direct/extensionless media, HLS and DASH. Exact URL + frame deduplication preserves signed queries and distinct media. Known segments are filtered; unknown segment naming may still resemble complete files. Limits: 50 sources/tab, ten-minute candidate lifetime and bounded session-string budget. Site grants have no app-imposed timeout. Observers periodically revalidate authorization; revocation sends an immediate stop, clears affected candidates/context and rejects stale script messages. Chrome may require a reload for restricted or previously loaded frames. Request identities are capped at 128/tab. No response bodies/media cache are collected by the extension.
- Page, frame and discovered media URLs remain separate. The desktop inspects the discovered URL, retains source/output separation and requires explicit Download confirmation. No alternate source resolutions are invented for a direct file. Blob URLs are explained as browser-local. Encrypted playback marks matching sources protected; protection cannot always be inferred from request metadata. DRM/access-control bypass is absent.
- Sources, signed URLs and narrowly scoped context live only in memory or trusted `storage.session`, never sync storage or visited sites’ storage. Session end clears session data. **Settings → Settings and Privacy** stores only the Light/Dark preference in extension-owned local storage; its default follows the existing system appearance until explicitly chosen. **Clear extension data** clears temporary sources/context, preserves theme/site grants and resumes permitted observation; current players and later requests may be detected again. **Review Site Permission** reads actual browser grants (including broad/wildcard patterns), supports individual revocation and links to Chrome for grants Chrome will not remove programmatically. **Revoke website access** removes optional grants; overlapping or browser-controlled grants may remain and are shown honestly.

The existing v1 length-prefixed bounded JSON protocol, sender/field validation and current-user/session-restricted Windows named pipe remain intact. Host/desktop peer paths, registration and hash are authenticated. Only fixed hello/candidate operations are accepted; no commands, paths, engine options or arbitrary headers. Stdout contains protocol frames only. These local checks do not protect against an attacker already controlling the Windows account/app files.

Referer remains limited to the selected media origin through the existing job-scoped in-memory loopback transport, dropped on redirects and other-host children. Cookies, integrated authentication and automatic redirects are disabled. Ordinary completed HLS/static DASH are supported within the documented transport subset; live/protected/complex manifests can fail explicitly. Existing engine selection, typed plans, cancellation, merge/conversion, FFprobe validation and no-overwrite publication are unchanged.

## Removal

Remove the extension through Chrome’s Extensions page. Chrome removes extension-owned storage; this is not a secure-erasure guarantee for backups, paging or OS caches. No uninstall callback or automatic reinstallation is assumed. Removal does not delete downloads or desktop history.

Desktop bridge resources remain app-owned. In the popup click **Disconnect**, then in ClipClipGO Settings choose **Remove desktop bridge**. This validates ownership and removes only the registration and three known files; an in-use file reports a retryable error. Future installer/uninstaller maintenance must own these packaged assets and per-user resources, handle install moves/in-use hosts and remove only its own registration. Installer/uninstaller behavior has not been exercised here.

## Verification and manual retest

Focused checks distinguish actual code with Chrome API mocks, real native stdio/pipe/media integration, mocked registry boundaries and UI SSR/CSS assertions. No Chrome interaction, installation, registry mutation or public media download was performed by the agent. See the current follow-up verification in [downloader.md](downloader.md). Local fixtures are available via `npm run companion:fixtures` (you open and operate them).

| Before | After | Evidence / limit |
| --- | --- | --- |
| Cramped popup rows | 440 × 540px, local Montserrat, wrapping controls/titles and bounded settings scrolling | SSR/DOM + CSS checks; browser pixels remain manual |
| Empty list obscured permission state | Media Detected / No Media Detected, separate access/error hints, three-section settings dialog and Light/Dark | Worker mocks + presentation fixtures |
| Unpublished store forced a registration script | Unpacked steps, actual folder actions, validated ID and real handshake | Native filesystem fixtures/mock registry; installed UI remains manual |

Manual checklist: load/reload the packaged folder, use ID setup without PowerShell, verify waiting then Connected; send/download A then B on the same site (including SPA/reload), open another tab on a permitted site without activation; grant a second site and repeat; leave detection enabled beyond ten minutes; check frame/CDN denial/regrant/rescan, popup reopening, native disconnect/reconnect and worker restart; inspect long/missing titles and multiple sources in both themes/enlarged text; clear data, revoke access, repair/change ID and remove the owned bridge; confirm downloads remain and pasted YouTube/conversion still work. Retest custom/per-user and Program Files installations yourself before distribution; no full installer was built here.

Official references: [Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [webRequest](https://developer.chrome.com/docs/extensions/reference/api/webRequest), [webNavigation](https://developer.chrome.com/docs/extensions/reference/api/webNavigation), [session storage](https://developer.chrome.com/docs/extensions/reference/api/storage), [Tauri resources](https://v2.tauri.app/develop/resources/).

Extension-only refresh (no native build/registration): `node browser-companion/build-extension.mjs` validates all JavaScript and copies the complete extension to `src-tauri/target/debug/extension`. Reload that same unpacked folder manually. `--check` validates source without copying. Normal desktop resource packaging still includes the authoritative `browser-companion/extension` folder. Focused 0.4.0 checks use Chrome API mocks, observer fixtures, theme/dialog DOM tests and local HTTP thumbnail/preview media; no real browser permission interaction or pixel measurements were performed.

Companion **0.5.0** keeps static thumbnails: actual-video posters (including relative/lazy attributes), then a readable current decoded frame, then the default illustration. Captures never seek/control playback, skip encrypted/MediaStream players, fit within 320×180 and 48,000 encoded characters, and are attempted at most eight times per injected observer. Canvas security failures are respected. Poster transfers remain permission-gated, cookie-free, capped at 256 KiB, with two concurrent transfers. Missing IntersectionObserver now starts loading directly. Snapshot/poster UI hints are stripped before native handoff and are never durable preferences. Signed URLs remain intact. Some poster CDNs still need an explicit Settings grant; tainted/unready/detached players may have no snapshot.

Header gear opens Settings; Disconnect is at its top. Main Allow/Rescan shares one action, Send scrolls normally, and playback/rescan notes are collapsed under Diagnostics. Settings retains actual-grant review/count/revocation and the additional-origin input; the thumbnail shortcut is removed. Blue textbox focus and destructive red hover apply; dialog motion scales from the center and respects reduced motion. Verification includes real generated JPEG HTTP loading/FFmpeg decoding, mocked canvas capture/taint boundaries, DOM state checks and SSR/CSS fixtures. This does not prove Chrome raster rendering, real-site canvas access or manual interaction; those remain user checks.
