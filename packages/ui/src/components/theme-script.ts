// Kept out of the 'use client' theme module: server components (the root layout) import this
// string, and values exported from client modules reach them as references, not values.

export const THEME_STORAGE_KEY = 'madar-theme';

/**
 * Inline this in <head> (before paint) to apply the saved theme without a flash.
 * Without a saved choice, the OS preference applies through CSS.
 */
export const themeScript = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t}}catch(e){}})();`;
