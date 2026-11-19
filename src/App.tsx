import { useReducer, useRef, useState } from 'react';
import Converter from './converter/Converter';
import { initialSelection, selectionReducer } from './converter/selection';

const pages = [
  { name: 'Downloader', description: 'A future home for authorized media downloads.' },
  { name: 'Converter', description: 'A future home for local video, audio, image, and document conversion.' },
  { name: 'Queue', description: 'A future home for managing pending work.' },
  { name: 'History', description: 'A future home for reviewing past activity.' },
  { name: 'Settings', description: 'A future home for application preferences.' },
] as const;

export default function App() {
  const [activePage, setActivePage] = useState<(typeof pages)[number]>(pages[0]);
  const [selection, dispatchSelection] = useReducer(selectionReducer, initialSelection);
  const selectionBusy = useRef(false);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="sidebar">
        <p className="brand-name">Clip-Clip-Go</p>
        <nav aria-label="Main navigation">
          <ul className="navigation-list">
            {pages.map((page) => (
              <li key={page.name}>
                <button
                  className="navigation-button"
                  type="button"
                  aria-current={activePage.name === page.name ? 'page' : undefined}
                  onClick={() => setActivePage(page)}
                >
                  {page.name}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <main id="main-content" tabIndex={-1}>
        <header className="page-header">
          <h1>{activePage.name}</h1>
        </header>
        {activePage.name === 'Converter' ? <Converter state={selection} dispatch={dispatchSelection} busy={selectionBusy} /> : <section className="placeholder" aria-labelledby="placeholder-title" aria-live="polite" aria-atomic="true">
          <h2 id="placeholder-title">Not implemented yet</h2>
          <p>{activePage.description}</p>
          <p className="placeholder-note">This preview provides navigation only. No files or jobs are processed.</p>
        </section>}
      </main>
    </div>
  );
}
