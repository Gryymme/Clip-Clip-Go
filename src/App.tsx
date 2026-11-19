import { useState } from 'react';

const pages = [
  { name: 'Downloader', description: 'A future home for authorized media downloads.' },
  { name: 'Converter', description: 'A future home for local video, audio, image, and document conversion.' },
  { name: 'Queue', description: 'A future home for managing pending work.' },
  { name: 'History', description: 'A future home for reviewing past activity.' },
  { name: 'Settings', description: 'A future home for application preferences.' },
] as const;

export default function App() {
  const [activePage, setActivePage] = useState<(typeof pages)[number]>(pages[0]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">C</span>
          <div><p className="brand-name">Clip-Clip-Go</p><p className="brand-caption">Desktop workspace</p></div>
        </div>
        <nav aria-label="Main navigation">
          {pages.map((page) => (
            <button
              key={page.name}
              type="button"
              aria-current={activePage.name === page.name ? 'page' : undefined}
              onClick={() => setActivePage(page)}
            >
              {page.name}
            </button>
          ))}
        </nav>
        <p className="sidebar-note">Foundation preview<br />All tools are placeholders.</p>
      </aside>
      <main id="main-content" tabIndex={-1}>
        <header className="page-header">
          <p className="eyebrow">Your workspace</p>
          <h1>{activePage.name}</h1>
        </header>
        <section className="placeholder" aria-labelledby="placeholder-title" aria-live="polite" aria-atomic="true">
          <span className="status-label">Placeholder</span>
          <h2 id="placeholder-title">{activePage.name}: Not implemented yet</h2>
          <p>{activePage.description}</p>
          <p className="placeholder-note">This preview provides navigation only. No files or jobs are processed.</p>
        </section>
      </main>
    </div>
  );
}
