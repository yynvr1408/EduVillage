import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import en from './locales/en.json'
import zh from './locales/zh.json'
import hi from './locales/hi.json'
import ar from './locales/ar.json'
import bn from './locales/bn.json'
import pt from './locales/pt.json'
import ru from './locales/ru.json'
import ur from './locales/ur.json'
import id from './locales/id.json'
import sw from './locales/sw.json'
import ja from './locales/ja.json'
import te from './locales/te.json'
import mr from './locales/mr.json'
import ta from './locales/ta.json'
import gu from './locales/gu.json'
import kn from './locales/kn.json'
import or_ from './locales/or.json'
import ml from './locales/ml.json'
import pa from './locales/pa.json'
import as_ from './locales/as.json'
import mai from './locales/mai.json'

// Global tier: the world's most-spoken languages by total speakers (English, Mandarin, Hindi,
// Arabic, Bengali, Portuguese, Russian, Urdu, Indonesian, Swahili, Japanese), followed by an
// India tier covering the remaining major scheduled languages by speaker count / literacy.
export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'ar', label: 'العربية' },
  { code: 'bn', label: 'বাংলা' },
  { code: 'pt', label: 'Português' },
  { code: 'ru', label: 'Русский' },
  { code: 'ur', label: 'اردو' },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'sw', label: 'Kiswahili' },
  { code: 'ja', label: '日本語' },
  { code: 'te', label: 'తెలుగు' },
  { code: 'mr', label: 'मराठी' },
  { code: 'ta', label: 'தமிழ்' },
  { code: 'gu', label: 'ગુજરાતી' },
  { code: 'kn', label: 'ಕನ್ನಡ' },
  { code: 'or', label: 'ଓଡ଼ିଆ' },
  { code: 'ml', label: 'മലയാളം' },
  { code: 'pa', label: 'ਪੰਜਾਬੀ' },
  { code: 'as', label: 'অসমীয়া' },
  { code: 'mai', label: 'मैथिली' },
] as const

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code']

// Translations are bundled (imported as JSON, not fetched at runtime) on purpose: this app is
// offline-first and low-bandwidth-first, so a language switch must never cost a network request
// — every language is already in the JS bundle the user downloaded once.
i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      zh: { translation: zh },
      hi: { translation: hi },
      ar: { translation: ar },
      bn: { translation: bn },
      pt: { translation: pt },
      ru: { translation: ru },
      ur: { translation: ur },
      id: { translation: id },
      sw: { translation: sw },
      ja: { translation: ja },
      te: { translation: te },
      mr: { translation: mr },
      ta: { translation: ta },
      gu: { translation: gu },
      kn: { translation: kn },
      or: { translation: or_ },
      ml: { translation: ml },
      pa: { translation: pa },
      as: { translation: as_ },
      mai: { translation: mai },
    },
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code),
    interpolation: { escapeValue: false }, // React already escapes
    detection: {
      // Remembered explicitly (see LanguageSwitcher) before falling back to the browser's own
      // language list, so a deliberate choice always wins over Accept-Language/navigator.language.
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
      lookupLocalStorage: 'lanternEd:language',
    },
  })

export default i18n
