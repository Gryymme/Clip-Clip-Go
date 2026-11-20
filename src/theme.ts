export type ThemePreference = 'system' | 'light' | 'dark';
export const themeKey = 'clipclipgo.theme';
export function preference(value: unknown): ThemePreference { return value === 'light' || value === 'dark' ? value : 'system'; }
export function themeController(storage: Pick<Storage,'getItem'|'setItem'>, media: Pick<MediaQueryList,'matches'|'addEventListener'|'removeEventListener'>, apply: (theme:'light'|'dark')=>void) {
  let current: ThemePreference = 'system';
  try { current = preference(storage.getItem(themeKey)); } catch {}
  const render = () => apply(current === 'system' ? media.matches ? 'dark' : 'light' : current);
  media.addEventListener('change',render); render();
  return { get:()=>current, set(value:ThemePreference) {current=preference(value); let saved=true; try {storage.setItem(themeKey,current);} catch {saved=false;} render(); return saved;}, dispose:()=>media.removeEventListener('change',render) };
}
