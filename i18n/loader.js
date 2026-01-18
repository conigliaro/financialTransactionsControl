import enFallback from './en.js';

const supportedLangs = ['en', 'es', 'pt-BR'];
const fallbackTranslations = enFallback ?? {};
let translations = fallbackTranslations;
let translationsLoaded = false;
let activeLang = 'en';
const missingKeys = new Set();

function isDevI18nLoggingEnabled() {
  try {
    if (globalThis?.__I18N_DEBUG === true) return true;
    const env = globalThis?.process?.env;
    if (env?.NODE_ENV === 'development') return true;
    const host = globalThis?.location?.hostname;
    return host === 'localhost' || host === '127.0.0.1';
  } catch {
    return false;
  }
}

async function fetchTranslations(lang) {
  try {
    const url = new URL(`./${lang}.js`, import.meta.url).href;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load ${lang} translations`);
    }
    const source = await response.text();
    const dataUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`;
    const module = await import(/* @vite-ignore */ dataUrl);
    return module.default ?? {};
  } catch (error) {
    if (isDevI18nLoggingEnabled()) {
      console.warn(error?.message ?? String(error));
    }
    return {};
  }
}

export function getBrowserLang() {
  const browserLangs = navigator.languages || [navigator.language || 'en'];
  for (const lang of browserLangs) {
    if (supportedLangs.includes(lang)) {
      return lang;
    }
    if (lang.includes('-')) {
      const baseLang = lang.split('-')[0];
      if (supportedLangs.includes(baseLang)) {
        return baseLang;
      }
    }
  }
  return 'en'; // default
}

export function getActiveLang() {
  return activeLang;
}

export async function loadTranslations(lang = getBrowserLang()) {
  const resolvedLang = supportedLangs.includes(lang) ? lang : getBrowserLang();
  activeLang = resolvedLang;
  const loaded = await fetchTranslations(resolvedLang);
  translations = Object.keys(loaded).length > 0 ? loaded : fallbackTranslations;
  translationsLoaded = true;
  missingKeys.clear();

  try {
    window.dispatchEvent(new CustomEvent('i18n:updated', { detail: { lang: resolvedLang } }));
  } catch {
    // no-op (non-browser/test environments)
  }
}

export async function setLanguage(lang) {
  return loadTranslations(lang);
}

export function t(key, replacements = {}) {
  const hasActive = Object.prototype.hasOwnProperty.call(translations, key);
  const hasFallback = Object.prototype.hasOwnProperty.call(fallbackTranslations, key);

  let translation = hasActive ? translations[key] : hasFallback ? fallbackTranslations[key] : key;

  if (!hasActive && !hasFallback && translationsLoaded && isDevI18nLoggingEnabled() && !missingKeys.has(key)) {
    missingKeys.add(key);
    console.warn(`[i18n] Missing translation key: ${key} (lang=${activeLang})`);
  }

  for (const placeholder in replacements) {
    translation = translation.replace(`{{${placeholder}}}`, replacements[placeholder]);
  }
  return translation;
}
