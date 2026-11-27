import { randomUUID } from 'node:crypto'
import { fixture as base } from '../product-project-reconnection-desktop-lab/fixture'
import { ProductPostgresRepository } from '../../src/main/db/productPostgresRepository'
import { ProductPostgresSelection } from '../../src/main/controlPlane/productPostgresSelection'
import { DesktopReconnectedPostgresInspection } from '../../src/main/controlPlane/desktopReconnectedPostgresInspection'
import { reviewPostgresInspection } from '../../src/main/controlPlane/productPostgresInspection'
import type { DesktopControllerEnrollment } from '../../src/main/controlPlane/desktopControllerEnrollment'

type Fixture = Awaited<ReturnType<typeof base>> & {
  pg: ReturnType<ProductPostgresRepository['prepare']>
  reads: { count: number; after: undefined | (() => void | Promise<void>) }
  inspector: Pick<DesktopControllerEnrollment, 'inspectPostgres'>
  reader: DesktopReconnectedPostgresInspection
}
export async function fixture(directory: string): Promise<Fixture> {
  const f = await base(directory)
  const context = await f.admin.reconnectionContext(f.bindingId, {
    format: 1,
    controller_id: f.controllerId,
    app_id: 42
  })
  const request = {
    format: 1 as const,
    request_key: randomUUID(),
    scope: context.scope,
    expected_source_generation: context.source.generation,
    expected_source_config_sha256: context.source.config_sha256
  }
  const pg = new ProductPostgresRepository(f.remote, f.remoteCipher).prepare(
    request,
    f.controllerId,
    'unix:1000'
  )
  new ProductPostgresSelection(f.remote, f.remoteCipher).select(
    { ...request, database_id: pg.metadata.database_id },
    f.controllerId,
    'unix:1000'
  )
  const reads = { count: 0, after: undefined as undefined | (() => void | Promise<void>) }
  const inspector: Pick<DesktopControllerEnrollment, 'inspectPostgres'> = {
    async inspectPostgres(_binding, input, guard) {
      guard?.()
      reads.count++
      const verified = reviewPostgresInspection(
        f.remote,
        f.remoteCipher,
        f.controllerId,
        input.context
      )
      const result = {
        context: verified,
        read: input.read,
        instance: {
          database_id: pg.metadata.database_id,
          container_id: 'a'.repeat(64),
          image_id: 'sha256:' + 'b'.repeat(64),
          volume: `opspilot-pg-${pg.metadata.database_id}-data`,
          volume_created_at: '2026-11-17T00:00:00Z',
          system_identifier: '1234567',
          state: 'ready' as const,
          public_port: null
        },
        checked_at: new Date().toISOString(),
        data:
          input.read.operation === 'tables'
            ? [
                {
                  schema: 'public',
                  name: 'notes',
                  columns: [
                    { name: 'id', data_type: 'integer', nullable: false },
                    { name: 'title', data_type: 'text', nullable: false }
                  ]
                }
              ]
            : input.read.operation === 'rows'
              ? [
                  { id: 1, title: 'Deployment checklist' },
                  { id: 2, title: 'Weekly release' }
                ]
              : null
      }
      await reads.after?.()
      guard?.()
      return result
    }
  }
  return {
    ...f,
    pg,
    reads,
    inspector,
    reader: new DesktopReconnectedPostgresInspection(f.subject, inspector)
  }
}
