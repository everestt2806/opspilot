// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AppTitleBar } from './AppTitleBar'

describe('AppTitleBar', () => {
  it('chi hien brand va caption, khong tu ve caption buttons', () => {
    render(<AppTitleBar pageTitle="Servers" />)

    expect(screen.getByText('OpsPilot — Servers')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
