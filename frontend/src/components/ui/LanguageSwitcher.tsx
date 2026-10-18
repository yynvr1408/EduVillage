import React from 'react'
import { useTranslation } from 'react-i18next'
import { Globe } from 'lucide-react'
import { SUPPORTED_LANGUAGES } from '../../i18n'

export interface LanguageSwitcherProps {
  className?: string
}

/** A plain <select> rather than a custom dropdown: works with screen readers and keyboard
 * navigation for free, and costs nothing extra to render - fitting for a low-bandwidth-first app. */
export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({ className = '' }) => {
  const { t, i18n } = useTranslation()

  return (
    <label className={`inline-flex items-center gap-1.5 text-xs text-[#687775] ${className}`}>
      <Globe className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span className="sr-only">{t('language.switchLabel')}</span>
      <select
        value={i18n.resolvedLanguage}
        onChange={(e) => void i18n.changeLanguage(e.target.value)}
        aria-label={t('language.switchLabel')}
        className="bg-transparent border border-[#E1E8E4] rounded-md px-2 py-1 text-xs text-[#202B2A] cursor-pointer hover:border-[#0F5B57] focus-visible:outline-2 focus-visible:outline-[#0F5B57]"
      >
        {SUPPORTED_LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.label}
          </option>
        ))}
      </select>
    </label>
  )
}
