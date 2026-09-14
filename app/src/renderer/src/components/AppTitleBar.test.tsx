// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AppTitleBar } from './AppTitleBar'

describe('AppTitleBar', () => {
  it('chi hien brand va caption, khong tu ve caption buttons', () => {
    const { container } = render(<AppTitleBar pageTitle="Servers" />)

    expect(screen.getByText('OpsPilot — Servers')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(container.querySelector('.app-titlebar-drag-region')).toBeTruthy()
    expect(container.querySelector('.app-titlebar-right')).toBeNull()
  })
})
