# Project rules

- Clip-Clip-Go is a Windows-first desktop downloader and file-conversion application.
- Work only inside the selected project folder.
- Do not modify files outside this project.
- Do not implement features that were not requested.
- Inspect only files relevant to the current task.
- Use focused tests and concise verification reports.
- Do not install dependencies without explaining why.
- Do not access personal files outside this project.

## Testing

- The user performs manual functionality testing that requires desktop control, including native file selection, uploads, save dialogs, and similar interactions.
- Do not take control of the desktop for testing or request desktop-control access.
- Automated tests, type-checking, builds, and other checks that do not require desktop control remain allowed.
- Provide a short manual test checklist for the user after relevant changes.
- Do not claim manual functionality was verified unless the user confirms it.

## UI and design

- Read DESIGN.md when creating, changing, or reviewing UI; apply it to present and future UI work.
- Load only the design skills relevant to the current task. Do not read every installed skill for every task.
- The user's explicit project requirements are authoritative when external guidance conflicts.
- Use Emil's relevant design and motion skills for application UI work.
- Use Stageshow only for explicitly requested product illustrations, promotional visuals, or animated demonstrations.
- Keep the application driven by real state; do not introduce staged cursors, fake jobs, or scripted product activity.
