import { z } from 'zod'
import type { MetricLine } from './metricParser'

const response = z.object({
  ready: z.boolean(),
  sample_count: z.number().int(),
  scores: z.object({
    zscore_ewma: z.number().nullable(),
    iforest: z.number().nullable(),
    ocsvm: z.number().nullable(),
    ensemble: z.number().nullable()
  }),
  above_threshold: z.object({
    zscore_ewma: z.boolean(),
    iforest: z.boolean(),
    ocsvm: z.boolean(),
    ensemble: z.boolean()
  }),
  detail: z.record(z.string(), z.unknown()).optional()
})
export type MlIngestResponse = z.infer<typeof response>
export class MlApiClient {
  constructor(private readonly baseUrl: string) {}
  async ingest(deploymentId: number, sample: MetricLine): Promise<MlIngestResponse> {
    const res = await fetch(`${this.baseUrl}/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deployment_id: deploymentId, sample })
    })
    if (!res.ok) throw new Error(`ML ingest HTTP ${res.status}`)
    return response.parse(await res.json())
  }
}
