import type { ReactNode } from 'react';
import { pages, type PageName } from '../navigation';
import Icon from './Icon';
export default function AppShell({ activePage, onNavigate, children }: { activePage: PageName; onNavigate: (page: PageName) => void; children: ReactNode }) {
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar" aria-label="Application sidebar">
      <header className="sidebar-header"><h2 className="brand-name" aria-label="ClipClipGO"><span>ClipClip</span><span className="brand-accent">GO</span></h2></header>
      <nav className="sidebar-navigation" aria-label="Main navigation">
        <ul className="navigation-list">{pages.map(page => <li key={page.name} className={'groupStart' in page ? 'navigation-group-start' : undefined}>
          <button className="navigation-button" type="button" aria-current={activePage === page.name ? 'page' : undefined} onClick={() => onNavigate(page.name)}><Icon name={page.icon} /><span>{page.name}</span></button>
        </li>)}</ul>
      </nav>
      <footer className="sidebar-footer"><p className="brand-attribution">GRYYMME © {new Date().getFullYear()}</p></footer>
    </aside>
    <main key={activePage} id="main-content" tabIndex={-1} aria-label={activePage}>
      <div className="workspace"><header className="page-header"><h1>{activePage}</h1></header>{children}</div>
    </main>
  </div>;
}
