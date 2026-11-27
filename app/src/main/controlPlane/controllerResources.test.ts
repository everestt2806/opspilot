import { describe, expect, it, vi } from 'vitest'
import { assessProductResources, ControllerResourceAdmission } from './controllerResources'
import {
  PRODUCT_RESOURCE_MIN_DISK_BYTES as disk,
  PRODUCT_RESOURCE_MIN_RAM_BYTES as ram
} from '../../../../docs/contracts/product-controller-readiness'
const good = {
  cpu_count: 2,
  available_ram_bytes: ram + 1,
  workspace_available_bytes: disk + 1,
  docker_ready: true,
  port_ready: true
}
describe('Controller resource admission', () => {
  it('requires strictly more than the RAM/disk minimum and a responsive Docker/owned or free port', () => {
    expect(assessProductResources(good, true).state).toBe('ready')
    for (const patch of [
      { available_ram_bytes: ram },
      { workspace_available_bytes: disk },
      { docker_ready: false },
      { port_ready: false }
    ])
      expect(assessProductResources({ ...good, ...patch }, true)).toEqual({
        state: 'deferred',
        reason: 'resource_unavailable'
      })
  })
  it.each([
    null,
    {},
    { ...good, cpu_count: 0 },
    { ...good, available_ram_bytes: NaN },
    { ...good, workspace_available_bytes: -1 },
    { ...good, available_ram_bytes: Number.MAX_SAFE_INTEGER + 1 },
    { ...good, docker_ready: undefined }
  ])('rejects malformed or unknown remote evidence %j', (value) => {
    expect(assessProductResources(value, true)).toEqual({
      state: 'deferred',
      reason: 'resource_unknown'
    })
  })
  it('never measures or claims before recovery or after abort; measurement error fails closed', () => {
    const measure = vi.fn(() => good),
      abort = new AbortController()
    const admission = new ControllerResourceAdmission('/unit', () => false, measure)
    expect(admission.check(abort.signal).state).toBe('deferred')
    expect(measure).not.toHaveBeenCalled()
    abort.abort()
    expect(
      new ControllerResourceAdmission('/unit', () => true, measure).check(abort.signal).state
    ).toBe('deferred')
    expect(measure).not.toHaveBeenCalled()
    expect(
      new ControllerResourceAdmission(
        '/unit',
        () => true,
        () => {
          throw new Error('unit')
        }
      ).check(new AbortController().signal)
    ).toEqual({ state: 'deferred', reason: 'resource_unknown' })
    expect(
      new ControllerResourceAdmission('/unit', () => true, measure).check(
        new AbortController().signal
      )
    ).toEqual({ state: 'ready' })
  })
})
