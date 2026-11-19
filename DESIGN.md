# Clip-Clip-Go design guidance

Apply these rules when creating, changing, or reviewing the interface. Explicit project requirements take precedence over external design guidance.

## Interface rules

1. Remove filler badges. Keep badges only when they communicate meaningful status or information.
2. Remove redundant labels while preserving accessible names and necessary field labels.
3. Avoid arbitrary italics.
4. Use monospace only where useful, such as code, technical identifiers, and paths.
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

- The desktop shell uses a clean dark interface, plain CSS, accessible text contrast, and visible keyboard focus.
- Downloader, Converter, Queue, History, and Settings remain honest placeholders until their functionality is requested and implemented.
