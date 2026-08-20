import { z } from 'zod'

import type { ActionLogEntry, HistoryFilter } from '@shared/ipc'

import type { ActionLogRepository } from '../db/actionLogRepository'
import { AppError } from '../errors'

const filterSchema = z.object({
  actions: z.array(z.string().trim().min(1).max(64)).optional(),
  vps_id: z.number().int().positive().optional(),
  from_ts: z.string().datetime({ offset: true }).optional(),
  to_ts: z.string().datetime({ offset: true }).optional(),
  limit: z.number().int().min(1).max(200),
  offset: z.number().int().min(0)
})

/** UC-09: tra cứu action_log với bộ lọc — chạm đúng kênh 'history:list' trong contract. */
export class HistoryService {
  constructor(private readonly repository: ActionLogRepository) {}

  list(rawFilter: HistoryFilter): ActionLogEntry[] {
    const result = filterSchema.safeParse(rawFilter)
    if (!result.success) {
      throw new AppError(
        'VALIDATION',
        'Bộ lọc lịch sử không hợp lệ. Hãy tải lại trang rồi thử lại.'
      )
    }
    const { actions, vps_id, from_ts, to_ts, limit, offset } = result.data
    return this.repository.list({ actions, vps_id, from_ts, to_ts, limit, offset })
  }
}
