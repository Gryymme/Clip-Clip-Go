// One local outline family for navigation and generic file illustrations.
const paths = {
  download: 'M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4',
  convert: 'M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4',
  images: 'M8 3h12v14H8zM4 7v14h12M8 13l4-4 8 8M16 7h.01',
  queue: 'M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01',
  history: 'M3 11a9 9 0 1 1 3 7M3 4v7h7M12 7v5l3 2',
  settings: 'M4 7h16M4 17h16M9 4v6M15 14v6',
  document: 'M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6',
  audio: 'M9 17V6l10-2v11M9 9l10-2M9 17a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3ZM19 15a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3Z',
  image: 'M3 4h18v16H3zM3 16l5-5 5 5 3-3 5 5M16 8h.01',
  video: 'M3 5h13v14H3zM16 10l5-3v10l-5-3',
} as const;
export type IconName = keyof typeof paths;
export default function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return <svg className={`icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}
