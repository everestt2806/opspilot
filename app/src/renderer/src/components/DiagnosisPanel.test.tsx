// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { VpsDiagnosis } from '@shared/ipc'

import { DiagnosisPanel } from './DiagnosisPanel'

// Fixture là case thật từ TK-A10: firewall WiService chặn toàn bộ inbound.
const WISERVICE_FIREWALL: VpsDiagnosis = {
  code: 'PORT_TIMEOUT',
  title: 'Mọi cổng đều im lặng — nghi firewall chặn toàn bộ inbound',
  cause: 'Máy vẫn “Running” nhưng không cổng nào trả lời, kể cả SSH.',
  fixes: [
    'Mở dashboard nhà cung cấp: kiểm tra máy đang ở trạng thái Running',
    'Thêm quy tắc firewall cho cổng SSH (22) — ví dụ WiService chặn toàn bộ inbound theo mặc định'
  ]
}

describe('DiagnosisPanel', () => {
  it('hien du 3 dieu: chuyen gi + vi sao + cach sua, kem ma loi', () => {
    render(<DiagnosisPanel diagnosis={WISERVICE_FIREWALL} />)

    expect(screen.getByText(WISERVICE_FIREWALL.title)).toBeTruthy()
    expect(screen.getByText(WISERVICE_FIREWALL.cause)).toBeTruthy()
    for (const fix of WISERVICE_FIREWALL.fixes) {
      expect(screen.getByText(fix)).toBeTruthy()
    }
    expect(screen.getByText('PORT_TIMEOUT')).toBeTruthy()
  })

  it('hien nut Kiem tra lai khi co onRetry, goi dung callback', () => {
    const onRetry = vi.fn()
    render(<DiagnosisPanel diagnosis={WISERVICE_FIREWALL} onRetry={onRetry} />)

    const button = screen.getByText('Kiểm tra lại')
    expect(button).toBeTruthy()
    button.click()
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
