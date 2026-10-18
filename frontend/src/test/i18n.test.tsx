import React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useTranslation } from 'react-i18next'
import i18n, { SUPPORTED_LANGUAGES } from '../i18n'
import { LanguageSwitcher } from '../components/ui/LanguageSwitcher'

const Probe: React.FC = () => {
  const { t } = useTranslation()
  return <p>{t('auth.howSigningIn')}</p>
}

describe('i18n scaffolding', () => {
  afterEach(() => {
    void i18n.changeLanguage('en') // never leak a language choice into the next test
  })

  it('resolves a real key to English text by default, not the raw key', async () => {
    render(<Probe />)
    expect(screen.getByText('How are you signing in?')).toBeInTheDocument()
    expect(screen.queryByText('auth.howSigningIn')).not.toBeInTheDocument()
  })

  it('every supported language has a translation for every key English has (no silent fallback gaps)', () => {
    const en = i18n.getResourceBundle('en', 'translation')
    const flatten = (obj: Record<string, unknown>, prefix = ''): string[] =>
      Object.entries(obj).flatMap(([k, v]) =>
        typeof v === 'object' && v !== null ? flatten(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]
      )
    const enKeys = flatten(en).sort()

    for (const { code } of SUPPORTED_LANGUAGES) {
      if (code === 'en') continue
      const bundle = i18n.getResourceBundle(code, 'translation')
      expect(bundle, `missing resource bundle for "${code}"`).toBeTruthy()
      expect(flatten(bundle).sort(), `"${code}" is missing keys English has`).toEqual(enKeys)
    }
  })

  it('LanguageSwitcher lists every supported language and switching re-renders translated text', () => {
    render(
      <>
        <LanguageSwitcher />
        <Probe />
      </>
    )
    const select = screen.getByRole('combobox', { name: /language/i })
    for (const { code, label } of SUPPORTED_LANGUAGES) {
      expect(screen.getByRole('option', { name: label })).toHaveValue(code)
    }

    fireEvent.change(select, { target: { value: 'hi' } })
    expect(screen.getByText('आप किस तरह साइन इन कर रहे हैं?')).toBeInTheDocument()
  })
})
