# Clip-Clip-Go design guidance

Apply these rules when creating, changing, or reviewing the interface. Explicit project requirements take precedence over external design guidance.

## Interface rules

1. Remove filler badges. Keep badges only when they communicate meaningful status or information.
2. Remove redundant labels while preserving accessible names and necessary field labels.
3. Avoid arbitrary italics.
4. Use monospace only where useful, such as code and technical identifiers. Filenames and paths use the normal application font by default.
5. Use a consistent design system with shared tokens and reusable components.
6. Show the actual product workflow rather than decorative mockups or invented activity.
7. Give the main feature the most useful space and visual priority.
8. Group related elements through spacing before adding borders and containers.
9. Use specific, task-oriented headings.
10. Make the primary call to action clear and keep secondary actions visually quieter.
11. Use a consistent accent color, with separate semantic colors for statuses.
12. Keep icons consistent in family, stroke weight, size, and optical alignment.
13. Remove embellishments that do not improve comprehension or interaction.
14. For concentric nested corners, use `inner radius = max(0, outer radius - inset)`, accounting for borders and padding.
15. Maintain readable text and control contrast, including secondary text.
16. Wrap headings at sensible widths. Avoid awkward isolated words and clipping.
17. Check optical alignment as well as mathematical alignment.
18. Use tabular numerals for changing numeric displays, such as progress, speed, duration, and file sizes.
19. Provide meaningful loading, empty, success, and error states where applicable. Do not fake progress.
20. Animate useful feedback and state changes. Keep frequent interactions fast and respect reduced-motion preferences.

## Accessibility and resilience

- Keyboard access and visible focus are required.
- Long filenames, paths, narrow windows, and text scaling must remain usable.
- Keep application behavior driven by real state. Do not introduce staged cursors, fake jobs, or scripted product activity.

## Shared system and continuity

- Establish shared CSS tokens for color, typography, spacing, radii, and motion when UI code is created or updated.
- Preserve existing design choices unless they conflict with these rules.
- Record approved design decisions briefly below as the project evolves. Do not treat unreviewed experiments or external skill defaults as approved decisions.

## Approved design decisions

- The desktop shell supports neutral dark and light themes with a clean interface, plain CSS, accessible text contrast, and visible keyboard focus.
- Use locally bundled Montserrat (variable normal weight 100–900) with system sans-serif fallbacks throughout the app, including app-rendered buttons, inputs, selects and dialogs. Use a restrained type scale with clear heading levels.
- The sidebar brand is **ClipClipGO**: center the single accessible heading, keep ClipClip in primary text and GO in #4285F4. This does not rename the project, package, executable or application identifiers.
- Use a traditional full-height sidebar attached to the left edge, with no floating inset or outer corner rounding. Main content scrolls independently; branding stays stationary and navigation scrolls internally. Below the desktop minimum width, use bounded compact navigation without overlapping the workspace. Native chrome remains unchanged.
- Make ClipClipGO prominent (30px at default scale). Place GRYYMME © with the dynamically computed current year in a small, centered, muted footer at the bottom of the sidebar. Header and footer do not shrink or overlap navigation; only navigation scrolls in short windows.
- Use a shared 12px base radius for controls, selected navigation and cards; derive nested radii from the enclosing surface's inset (never blindly repeat the radius). Avoid pill-shaped ordinary controls.
- Use neutral charcoal/grays in dark mode and corresponding neutral light surfaces. Navigation selection uses gray fill, with a distinct keyboard-focus outline; no colored fill or left-edge stripe.
- Solid action buttons use the explicitly requested #4285F4 with white text (approximately 3.56:1 contrast: below WCAG AA 4.5:1 for normal text; retain this documented limitation), darker #1D4ED8 hover and #1E40AF pressed states. Secondary actions stay outlined/unfilled; removal is identified by its label and semantic error color. Disabled/loading controls remain distinguishable and unavailable. Keep status colors semantic.
- Settings offers System Default, Light and Dark. Persist the preference itself, including system; follow prefers-color-scheme changes only for System Default. Apply CSS color-scheme and all shared theme tokens consistently. CSS does not control native Windows dialogs/title bars.
- Images to PDF reuses FileCard/Thumbnail for each image. Retain bounded, sequential, cached preview work across navigation/reordering, prune removed images, cancel stale work and pause generation during conversion. Show oriented source dimensions when available; preview failure never blocks conversion.
- Navigation order: Downloader, Converter, Images to PDF, Merge PDF, Queue, History, Settings. Selection uses a restrained background, text and icons; keyboard focus has a separate visible outline. Do not use a selected item's left-edge accent.
- Converter is the single-file workflow; Images to PDF is a separate destination. Keep selections, ordering, options and the shared active job above page lifetimes. Navigation must preserve state and the one-active-conversion rule.
- Group conversion screens into selected file(s), output/options, destination/primary action and job status. Use spacing first, compact headings and progressive disclosure for full paths, long format lists and technical details.
- Single-file summaries use a fixed 88×80px preview footprint beside wrapping filenames, readable size, type and relevant dimensions/duration/page count. Generate bounded image/video thumbnails natively from authorized selections; never expose broad filesystem URLs. Use consistent local vector icons for audio/documents, with honest loading and fallback states. Preview failure must not block conversion; stale requests must be cancelled or ignored.
- Long filenames and paths wrap rather than becoming indistinguishable ellipses. Bound long image lists with an accessible scroll region so output options and actions remain reachable. Preserve contrast, keyboard access and reduced-motion behavior at narrow sizes and enlarged text.
- Downloader, Queue and History remain honest placeholders until their functionality is requested and implemented.

- Decorative dividers/card borders use subtle, theme-specific neutral tokens; outlined secondary buttons use a separate subdued token. Input boundaries and high-contrast focus outlines use independent tokens and must not be faded with decoration. Preserve existing corner radii.
- Bundle the unmodified official Montserrat variable TTF and OFL license locally (upstream currently supplies no variable WOFF2). Preload it, disable synthetic weights and inherit typography in app controls. Keep fallback glyph support, technical monospace and generated-PDF fonts unchanged. No external font requests.

- Converter and Images to PDF share the same choose-file card treatment, with vertically centered text/actions and natural wrapping beside the fixed thumbnail footprint. Selected-image cards remain separate ordered entries.
- Drag feedback belongs only to the active selection card, uses a distinct outline/surface state and clears on leave/drop/cancellation. Keep accessible Choose buttons; use native paths, scaled hit testing and one handler per mounted destination. Reject invalid drops contextually, preserve usable selections, and lock file changes during a job.
- Images to PDF supports A4, Letter, Legal, Image sized and Custom. Store physical dimensions canonically in PDF points; units and DPI are presentation controls. Keep custom fields labeled, responsive and session-retained; explain pixel DPI and margin constraints next to them.
