import {themeController} from './theme';
// Runs before React renders. Storage access is guarded, including restricted WebViews.
let applied=false;let clearThemeMotion:ReturnType<typeof setTimeout>;
export const theme = themeController({getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)},matchMedia('(prefers-color-scheme: dark)'),value=>{const root=document.documentElement;if(applied&&root.dataset.theme!==value){root.classList.add('theme-changing');void root.offsetWidth;clearTimeout(clearThemeMotion);clearThemeMotion=setTimeout(()=>root.classList.remove('theme-changing'),180);}root.dataset.theme=value;root.style.colorScheme=value;applied=true;});
