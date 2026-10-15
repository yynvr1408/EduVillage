import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import App from './App'

// This is a harness smoke test, not a feature test: the app is still the Vite
// starter template (no EduVillage screens yet). It proves `npm test` is wired up
// correctly so real component tests can be added as the UI gets built.
describe('App', () => {
  it('renders without crashing', () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })

  it('updates the counter on click', async () => {
    const user = userEvent.setup()
    render(<App />)
    const button = screen.getByRole('button', { name: /count is 0/i })
    await user.click(button)
    expect(screen.getByRole('button', { name: /count is 1/i })).toBeInTheDocument()
  })
})
