import {themeController} from './theme';
// Runs before React renders. Storage access is guarded, including restricted WebViews.
export const theme = themeController({getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)},matchMedia('(prefers-color-scheme: dark)'),value=>{document.documentElement.dataset.theme=value;document.documentElement.style.colorScheme=value;});
