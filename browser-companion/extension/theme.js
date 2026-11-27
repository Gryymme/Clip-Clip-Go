// Loaded before styles. Only this minimal preference uses durable storage.
(() => {
  const root=document.documentElement;
  const fallback=()=>matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';
  const apply=value=>{root.dataset.theme=['light','dark'].includes(value)?value:fallback();delete root.dataset.themePending;return root.dataset.theme;};
  let settled=false;
  const timeout=setTimeout(()=>{if(!settled)apply();},500);
  globalThis.clipclipgoThemeReady=chrome.storage.local.get('theme').then(({theme})=>apply(theme)).catch(()=>apply()).finally(()=>{settled=true;clearTimeout(timeout);});
})();
