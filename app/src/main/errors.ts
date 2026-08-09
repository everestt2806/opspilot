import type { DeployStep, IpcError, MigrateStep } from '@shared/ipc'

export class AppError extends Error {
  constructor(
    readonly code: IpcError['code'],
    readonly userMessage: string,
    readonly context: {
      step?: DeployStep | MigrateStep
      cause?: unknown
    } = {}
  ) {
    super(code)
    this.name = 'AppError'
  }
}

export function toIpcError(error: unknown): IpcError {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.userMessage,
      technical: technicalMessage(error.context.cause),
      step: error.context.step
    }
  }

  return {
    code: 'UNKNOWN',
    message:
      'Đã xảy ra lỗi không mong đợi. Hãy thử lại và mở chi tiết kỹ thuật nếu lỗi còn tiếp diễn.',
    technical: technicalMessage(error)
  }
}

function technicalMessage(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  return undefined
}
