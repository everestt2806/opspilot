import type { DeployEvent, DeployStep, IpcError } from '@shared/ipc'

export const SEVEN_STEPS: DeployStep[] = [
  'PRECHECK',
  'UPLOAD',
  'RENDER',
  'BUILD',
  'DEPLOY',
  'HEALTHCHECK',
  'RECORD'
]

export interface StepUi {
  status: 'pending' | 'running' | 'done' | 'failed'
  durationMs: number
}

export type FinalStatus = 'running' | 'failed' | 'rolled_back'

export interface RunView {
  deploymentId: number
  steps: Record<DeployStep, StepUi>
  buffer: string
  error?: IpcError
  finished?: { status: FinalStatus; totalDurationMs: number; appUrl?: string }
}

export function initialSteps(): Record<DeployStep, StepUi> {
  return Object.fromEntries(
    SEVEN_STEPS.map((step) => [step, { status: 'pending', durationMs: 0 }])
  ) as Record<DeployStep, StepUi>
}

/**
 * Giữ nguyên chunk y như lệnh SSH trả về (kể cả ANSI và \r) — xterm tự render màu
 * và tiến trình, reducer không được lọc (spec 3.3).
 */
export function applyEvent(prev: RunView, event: DeployEvent): RunView {
  const steps = { ...prev.steps }
  switch (event.type) {
    case 'step-start':
      steps[event.step] = { status: 'running', durationMs: 0 }
      break
    case 'log':
      return { ...prev, steps, buffer: prev.buffer + event.chunk }
    case 'step-done':
      steps[event.step] = { status: 'done', durationMs: event.duration_ms }
      break
    case 'step-failed':
      return {
        ...prev,
        steps: { ...steps, [event.step]: { status: 'failed', durationMs: 0 } },
        error: event.error
      }
    case 'finished':
      return {
        ...prev,
        steps,
        finished: {
          status: event.status,
          totalDurationMs: event.total_duration_ms,
          appUrl: event.app_url
        }
      }
  }
  return { ...prev, steps }
}
