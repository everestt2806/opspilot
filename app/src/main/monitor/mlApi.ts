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
const statusResponse = z.object({
  deployment_id: z.number().int(),
  trained: z.boolean(),
  sample_count: z.number().int(),
  min_samples_required: z.number().int(),
  trained_at: z.string().nullable().optional()
})
const trainResponse = z.object({
  deployment_id: z.number().int(),
  trained: z.boolean(),
  train_sample_count: z.number().int(),
  feature_vector_count: z.number().int()
})
export type MlIngestResponse = z.infer<typeof response>
export type MlStatusResponse = z.infer<typeof statusResponse>
export type MlTrainResponse = z.infer<typeof trainResponse>
export class MlApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 5000
  ) {}
  private async request(path: string, init?: RequestInit): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(this.timeoutMs)
    })
    if (!res.ok) throw new Error(`ML HTTP ${res.status}`)
    return res.json()
  }
  async status(deploymentId: number): Promise<MlStatusResponse> {
    return statusResponse.parse(await this.request(`/status?deployment_id=${deploymentId}`))
  }
  async ingest(deploymentId: number, sample: MetricLine): Promise<MlIngestResponse> {
    return response.parse(
      await this.request('/ingest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deployment_id: deploymentId, sample })
      })
    )
  }
  async train(deploymentId: number, samples: MetricLine[]): Promise<MlTrainResponse> {
    return trainResponse.parse(
      await this.request('/train', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deployment_id: deploymentId, samples })
      })
    )
  }
}
