// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Terminal } from '@xterm/xterm'
import { SearchAddon } from '@xterm/addon-search'

import { DeployTerminal } from './DeployTerminal'

describe('DeployTerminal', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('doi job: xoa log job truoc, terminal, copy va tim kiem deu theo buffer moi', () => {
    const writeTextSpy = vi.fn()
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: writeTextSpy
      }
    })

    const resetSpy = vi.spyOn(Terminal.prototype, 'reset')
    const findNextSpy = vi.spyOn(SearchAddon.prototype, 'findNext')

    const { rerender } = render(
      <DeployTerminal
        jobId={1}
        buffer="JOB_1_LOGS_ABC"
        completedSteps={0}
        totalSteps={7}
        status="streaming"
      />
    )

    // Copy initial job logs
    const copyBtn = screen.getByRole('button', { name: /Sao chép|Copy/i })
    fireEvent.click(copyBtn)
    expect(writeTextSpy).toHaveBeenCalledWith('JOB_1_LOGS_ABC')

    // Switch to Job 2
    rerender(
      <DeployTerminal
        jobId={2}
        buffer="JOB_2_FRESH_LOGS"
        completedSteps={1}
        totalSteps={7}
        status="streaming"
      />
    )

    expect(resetSpy).toHaveBeenCalled()

    // Copy after switching to job 2: copies job 2 logs only, no job 1
    writeTextSpy.mockClear()
    fireEvent.click(copyBtn)
    expect(writeTextSpy).toHaveBeenLastCalledWith('JOB_2_FRESH_LOGS')
    expect(writeTextSpy).not.toHaveBeenCalledWith(expect.stringContaining('JOB_1'))

    // Search in job 2
    const searchBtn = screen.getByRole('button', { name: /Tìm kiếm|Search/i })
    fireEvent.click(searchBtn)
    const searchInput = screen.getByPlaceholderText(/Tìm trong nhật ký|Search logs/i)
    fireEvent.change(searchInput, { target: { value: 'FRESH' } })
    fireEvent.keyDown(searchInput, { key: 'Enter', code: 'Enter' })
    expect(findNextSpy).toHaveBeenCalledWith('FRESH', { caseSensitive: false })
  })

  it('buffer bi cat con 100.000 ky tu: khong ngung cap nhat sau lan cat dau tien, copy va search theo buffer moi', () => {
    const writeTextSpy = vi.fn()
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: writeTextSpy
      }
    })

    const resetSpy = vi.spyOn(Terminal.prototype, 'reset')
    const writeSpy = vi.spyOn(Terminal.prototype, 'write')

    // Initial stream near 100,000 chars
    const base100k = 'A'.repeat(100_000)
    const { rerender } = render(
      <DeployTerminal
        jobId={10}
        buffer={base100k}
        completedSteps={2}
        totalSteps={7}
        status="streaming"
      />
    )

    const initialWriteCount = writeSpy.mock.calls.length
    expect(initialWriteCount).toBeGreaterThan(0)

    // Simulate 1st truncation: head dropped, new 50 chars added at tail
    const truncatedBuffer1 = base100k.slice(50) + 'TAIL_CHUNK_1'
    rerender(
      <DeployTerminal
        jobId={10}
        buffer={truncatedBuffer1}
        completedSteps={3}
        totalSteps={7}
        status="streaming"
      />
    )

    // Must reset and rewrite truncated buffer
    expect(resetSpy).toHaveBeenCalled()
    expect(writeSpy).toHaveBeenCalledWith(truncatedBuffer1)

    // Copy reflects truncatedBuffer1
    const copyBtn = screen.getByRole('button', { name: /Sao chép|Copy/i })
    fireEvent.click(copyBtn)
    expect(writeTextSpy).toHaveBeenLastCalledWith(truncatedBuffer1)

    // Simulate 2nd chunk after truncation: terminal must NOT stop updating!
    const truncatedBuffer2 = truncatedBuffer1.slice(50) + 'TAIL_CHUNK_2'
    rerender(
      <DeployTerminal
        jobId={10}
        buffer={truncatedBuffer2}
        completedSteps={4}
        totalSteps={7}
        status="streaming"
      />
    )

    // Terminal continued updating on 2nd chunk after truncation
    expect(writeSpy).toHaveBeenCalledWith(truncatedBuffer2)
    fireEvent.click(copyBtn)
    expect(writeTextSpy).toHaveBeenLastCalledWith(truncatedBuffer2)

    // Simulate 3rd incremental chunk that appends without truncation
    const appendedBuffer = truncatedBuffer2 + '_INCREMENTAL_LINE'
    rerender(
      <DeployTerminal
        jobId={10}
        buffer={appendedBuffer}
        completedSteps={4}
        totalSteps={7}
        status="streaming"
      />
    )
    expect(writeSpy).toHaveBeenCalledWith('_INCREMENTAL_LINE')
    fireEvent.click(copyBtn)
    expect(writeTextSpy).toHaveBeenLastCalledWith(appendedBuffer)
  })

  it('deploy terminal giu nguyen hanh vi va step label mac dinh cho man Deploy', () => {
    render(
      <DeployTerminal
        buffer="Deploying application..."
        activeStep="clone"
        completedSteps={1}
        totalSteps={7}
        status="streaming"
      />
    )

    // Live heading and default translated step label "Tải mã nguồn" or custom activeStep
    expect(screen.getByText(/1\/7/)).toBeTruthy()
  })
})
