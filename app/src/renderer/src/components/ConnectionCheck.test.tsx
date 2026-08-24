// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { VpsConnectionCheck, VpsDiagnosis, VpsInput } from '@shared/ipc'

import { CheckFailedError, ConnectionCheck } from './ConnectionCheck'

const VALUES: VpsInput = {
  name: 'VM01',
  host: '221.121.1.79',
  port: 22,
  username: 'root',
  auth_type: 'password',
  secret: 'dummy',
  provider: 'WiService',
  region: 'Hanoi'
}

const FIREWALL_DIAGNOSIS: VpsDiagnosis = {
  code: 'PORT_TIMEOUT',
  title: 'Mọi cổng đều im lặng — nghi firewall chặn toàn bộ inbound',
  cause: 'Máy vẫn “Running” nhưng không cổng nào trả lời, kể cả SSH.',
  fixes: ['Thêm quy tắc firewall cho cổng SSH (22)']
}

const OK_RESULT: VpsConnectionCheck = {
  ssh_ok: true,
  docker_installed: true,
  docker_version: '29.4.3',
  workdir_writable: true,
  steps: [
    { label: 'Kết nối SSH', ok: true, detail: 'OK' },
    { label: 'Docker', ok: true, detail: '29.4.3' },
    { label: 'Ghi được /opt/opspilot', ok: true, detail: 'OK' }
  ]
}

const NO_DOCKER_RESULT: VpsConnectionCheck = {
  ...OK_RESULT,
  docker_installed: false,
  docker_version: null,
  steps: [
    { label: 'Kết nối SSH', ok: true, detail: 'OK' },
    { label: 'Docker', ok: false, detail: 'chưa cài' },
    { label: 'Ghi được /opt/opspilot', ok: true, detail: 'OK' }
  ]
}

const FIREWALL_RESULT: VpsConnectionCheck = {
  ssh_ok: false,
  docker_installed: false,
  docker_version: null,
  workdir_writable: false,
  steps: [{ label: 'Kết nối SSH', ok: false, detail: 'TCP timeout' }],
  diagnosis: FIREWALL_DIAGNOSIS
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ConnectionCheck', () => {
  it('state idle: nut kiem tra + goi y, chua goi runCheck', () => {
    const runCheck = vi.fn()
    render(<ConnectionCheck getValues={() => VALUES} runCheck={runCheck} />)

    expect(screen.getByText('Check connection')).toBeTruthy()
    expect(screen.getByText(/Fill in the details and click check/)).toBeTruthy()
    expect(runCheck).not.toHaveBeenCalled()
  })

  it('state loading: hien dang kiem tra trong khi runCheck chay', async () => {
    const gate = deferred<VpsConnectionCheck>()
    render(<ConnectionCheck getValues={() => VALUES} runCheck={() => gate.promise} />)

    fireEvent.click(screen.getByText('Check connection'))
    expect(screen.getByText('Checking connection…')).toBeTruthy()

    await act(async () => {
      gate.resolve(OK_RESULT)
    })
  })

  it('state success: danh sach buoc xanh + docker warning neu thieu Docker', async () => {
    const gate = deferred<VpsConnectionCheck>()
    const runCheck = vi.fn(() => gate.promise)
    render(<ConnectionCheck getValues={() => VALUES} runCheck={runCheck} />)

    fireEvent.click(screen.getByText('Check connection'))
    await act(async () => {
      gate.resolve(NO_DOCKER_RESULT)
    })

    expect(screen.getByText('Connection successful')).toBeTruthy()
    expect(screen.getByText('Kết nối SSH')).toBeTruthy()
    expect(screen.getByText('— chưa cài')).toBeTruthy()
    expect(screen.getByText('Docker is not installed on the server')).toBeTruthy()
    expect(screen.getByText('Ghi được /opt/opspilot')).toBeTruthy()
  })

  it('state done + ssh loi: hien diagnosis day du (case firewall WiService)', async () => {
    const gate = deferred<VpsConnectionCheck>()
    render(<ConnectionCheck getValues={() => VALUES} runCheck={() => gate.promise} />)

    fireEvent.click(screen.getByText('Check connection'))
    await act(async () => {
      gate.resolve(FIREWALL_RESULT)
    })

    expect(screen.getByText(FIREWALL_DIAGNOSIS.title)).toBeTruthy()
    expect(screen.getByText(FIREWALL_DIAGNOSIS.cause)).toBeTruthy()
    expect(screen.getByText(FIREWALL_DIAGNOSIS.fixes[0])).toBeTruthy()
    expect(screen.getByText('PORT_TIMEOUT')).toBeTruthy()
  })

  it('state failed: runCheck nem loi -> hien message + chi tiet ky thuat', async () => {
    const runCheck = vi
      .fn()
      .mockRejectedValue(new CheckFailedError('Fill in all fields first.', 'raw: missing field'))
    render(<ConnectionCheck getValues={() => VALUES} runCheck={runCheck} />)

    fireEvent.click(screen.getByText('Check connection'))
    expect(await screen.findByText('Fill in all fields first.')).toBeTruthy()
    expect(screen.getByText(/raw: missing field/)).toBeTruthy()
  })

  it('nut Kiem tra lai goi lai runCheck tu ket qua that bai', async () => {
    const firstGate = deferred<VpsConnectionCheck>()
    const secondGate = deferred<VpsConnectionCheck>()
    const runCheck = vi
      .fn()
      .mockReturnValueOnce(firstGate.promise)
      .mockReturnValueOnce(secondGate.promise)
    render(<ConnectionCheck getValues={() => VALUES} runCheck={runCheck} />)

    fireEvent.click(screen.getByText('Check connection'))
    await act(async () => {
      firstGate.resolve(FIREWALL_RESULT)
    })

    fireEvent.click(screen.getByText('Check again'))
    expect(runCheck).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Checking connection…')).toBeTruthy()

    await act(async () => {
      secondGate.resolve(OK_RESULT)
    })
    expect(screen.getByText('Connection successful')).toBeTruthy()
  })

  it('thieu Docker + da luu VPS: nut Cai Docker ngay -> confirm -> install-docker -> hien version', async () => {
    const installDocker = vi
      .fn()
      .mockResolvedValue({ ok: true, data: { docker_version: '27.2.1' } })
    vi.stubGlobal('api', { invoke: installDocker })
    const gate = deferred<VpsConnectionCheck>()
    render(<ConnectionCheck getValues={() => VALUES} runCheck={() => gate.promise} vpsId={1} />)

    fireEvent.click(screen.getByText('Check connection'))
    await act(async () => {
      gate.resolve(NO_DOCKER_RESULT)
    })

    expect(screen.getByText('Docker is not installed on the server')).toBeTruthy()
    fireEvent.click(screen.getByText('Install Docker now'))
    expect((await screen.findAllByText('Install Docker on this VPS?')).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByText('Install Docker'))

    await waitFor(() => expect(installDocker).toHaveBeenCalledWith('vps:install-docker', 1))
    expect(
      await screen.findByText('Docker 27.2.1 installed. Click "Refresh" to update.')
    ).toBeTruthy()
  })

  it('thieu Docker + chua luu VPS: khong co nut cai, chi huong dan luu truoc', async () => {
    const gate = deferred<VpsConnectionCheck>()
    render(<ConnectionCheck getValues={() => VALUES} runCheck={() => gate.promise} />)

    fireEvent.click(screen.getByText('Check connection'))
    await act(async () => {
      gate.resolve(NO_DOCKER_RESULT)
    })

    expect(
      screen.getByText('Save the VPS first, then reopen this dialog to install Docker.')
    ).toBeTruthy()
    expect(screen.queryByText('Install Docker now')).toBeNull()
  })
})
