// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AppTitleBar } from './AppTitleBar'

describe('AppTitleBar', () => {
  it('chi hien brand, khong lap ten trang va khong tu ve caption buttons', () => {
    const { container } = render(<AppTitleBar />)

    expect(screen.getByLabelText('OpsPilot')).toBeTruthy()
    expect(screen.getByText('OpsPilot')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(container.querySelector('.app-titlebar-drag-region')).toBeTruthy()
    expect(container.querySelector('.app-titlebar-caption')).toBeNull()
    expect(container.querySelector('.app-titlebar-right')).toBeNull()
  })
})
