// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { FleetSummary } from './FleetSummary'
import { strings } from '../strings'

interface FleetSummaryProps {
  total: number
  online: number
  offline: number
  appCount: number
  loading: boolean
}

function renderSummary(props: FleetSummaryProps): void {
  render(<FleetSummary {...props} />)
}

describe('FleetSummary — 4 o so lieu', () => {
  it('hien dung 4 con so truyen vao', () => {
    renderSummary({ total: 3, online: 2, offline: 1, appCount: 5, loading: false })

    expect(screen.getByLabelText(strings.vpsControl.fleet.totalVps).textContent).toContain('3')
    expect(screen.getByLabelText(strings.vpsControl.fleet.checkedNow).textContent).toContain('2')
    expect(screen.getByLabelText(strings.vpsControl.fleet.checkFailed).textContent).toContain('1')
    expect(screen.getByLabelText(strings.vpsControl.fleet.totalApps).textContent).toContain('5')
  })

  it('loading: hien skeleton, khong hien con so', () => {
    renderSummary({ total: 3, online: 2, offline: 1, appCount: 5, loading: true })

    expect(screen.getByLabelText(strings.vpsControl.fleet.totalVps).textContent).toBe(
      strings.vpsControl.fleet.totalVps
    )
    expect(
      screen.getByLabelText(strings.vpsControl.fleet.totalVps).querySelector('.ant-skeleton')
    ).toBeTruthy()
  })
})
