import { expect, it } from 'vitest'
import { controllerSchemaCommandSchema } from './controllerSchemaUpgradeProtocol'
import { controllerSchemaBackupDirectory } from './controllerSchemaUpgradeCli'
const snapshot = {
  format: 1,
  controller_id: '11111111-1111-4111-8111-111111111111',
  schema_sha256: 'a'.repeat(64),
  state_sha256: 'b'.repeat(64),
  key_sha256: 'c'.repeat(64),
  database_inode: 1,
  key_inode: 2,
  quiescent: true,
  schema_version: 29
}
const input = { format: 1, request_key: '22222222-2222-4222-8222-222222222222', expected: snapshot }
it('requires an exact schema pair and rejects every path, SQL and authority override', () => {
  expect(controllerSchemaCommandSchema.safeParse(input).success).toBe(true)
  for (const patch of [
    { path: '/other' },
    { data_directory: '/other' },
    { sql: 'DROP TABLE app' },
    { uid: 0 },
    { command: 'id' }
  ])
    expect(controllerSchemaCommandSchema.safeParse({ ...input, ...patch }).success).toBe(false)
  for (const version of [undefined, 30, 31, 32, 33, 34, 36])
    expect(
      controllerSchemaCommandSchema.safeParse({
        ...input,
        expected: { ...snapshot, schema_version: version }
      }).success
    ).toBe(false)
})
it('does not expose a Desktop or arbitrary working-copy backup path', () => {
  expect(() => controllerSchemaBackupDirectory(input.request_key)).toThrow()
})
