/* eslint-disable @typescript-eslint/explicit-function-return-type -- Explicit development VPS read-only acceptance. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

// Discover CURRENT context from read-only controller SQLite. This is not a
// Desktop project/source-selection receipt and must never be stored as one.
const contextCommand = `python3 - <<'PY'
import json,sqlite3
c=sqlite3.connect('file:/var/lib/opspilot-controller/opspilot.db?mode=ro',uri=True);c.row_factory=sqlite3.Row
result=[]
for r in c.execute('SELECT p.*,c.source_config_sha256 FROM product_source_postgres p JOIN product_app_control c ON c.app_id=p.app_id AND c.source_generation=p.source_generation WHERE p.app_id IN (7,8) ORDER BY p.app_id'):
 t=json.loads(r['target_binding_json'])
 result.append({'format':1,'controller_id':r['controller_id'],'app_id':r['app_id'],'expected_ownership_generation':r['ownership_generation'],'expected_source_generation':r['source_generation'],'expected_source_config_sha256':r['source_config_sha256'],'expected_target_security_revision':t['ssh_security_revision'],'database_id':r['database_id']})
assert len(result)==2
print(json.dumps(result));c.close()
PY`

export async function verifyInspector({ code, ssh, vault, binding, snapshot, evidence, check }) {
  const before = await snapshot()
  const response = await ssh.exec(1, contextCommand, {
    logCommand: false,
    retryOnReconnect: false,
    timeoutMs: 15000,
    maxStdoutBytes: 4096,
    maxStderrBytes: 1024
  })
  assert.equal(response.code, 0)
  const contexts = JSON.parse(response.stdout)
  assert.equal(contexts.length, 2)
  const transport = new code.DesktopControllerEnrollment(vault, ssh)
  const observations = []
  for (let i = 0; i < contexts.length; i++) {
    const context = contexts[i]
    const expected = i === 0 ? before.postgres : before.postgres8
    assert.equal(context.app_id, 7 + i)
    assert.equal(context.database_id, expected.database_id)
    const call = (read) => transport.inspectPostgres(binding, { context, read })
    const inspected = await call({ operation: 'inspect' })
    assert.equal(inspected.instance.database_id, expected.database_id)
    assert.equal(inspected.instance.container_id, expected.container_id)
    assert.equal(inspected.instance.volume, expected.volume)
    assert.equal(inspected.instance.system_identifier, expected.system_identifier)
    assert.equal(inspected.instance.public_port, null)
    assert.equal(inspected.data, null)
    const tables = await call({ operation: 'tables' })
    const table = tables.data.find(
      (item) => item.schema === 'public' && item.name === 'acceptance_sample'
    )
    assert(table)
    assert.deepEqual(
      table.columns.map((item) => item.name),
      ['id', 'label']
    )
    const samples = []
    for (const limit of [10, 100]) {
      const rows = await call({
        operation: 'rows',
        schema: 'public',
        table: 'acceptance_sample',
        limit
      })
      assert.equal(rows.instance.container_id, expected.container_id)
      assert.equal(rows.data.length, limit)
      assert(
        rows.data.every((row) => Number.isSafeInteger(row.id) && typeof row.label === 'string')
      )
      samples.push({
        limit,
        returned: rows.data.length,
        digest: createHash('sha256').update(JSON.stringify(rows.data)).digest('hex')
      })
    }
    await assert.rejects(
      () =>
        transport.inspectPostgres(binding, {
          context: { ...context, database_id: contexts[1 - i].database_id },
          read: { operation: 'inspect' }
        }),
      (error) =>
        ['PRODUCT_POSTGRES_UNAVAILABLE', 'PRODUCT_POSTGRES_AUTHORITY_CHANGED'].includes(error.code)
    )
    await assert.rejects(
      () => call({ operation: 'rows', schema: 'public', table: 'acceptance_sample', limit: 101 }),
      (error) => error.code === 'POSTGRES_INSPECTION_INPUT_INVALID'
    )
    await assert.rejects(
      () =>
        call({ operation: 'rows', schema: 'public', table: 'opspilot_absent_relation', limit: 1 }),
      (error) => error.code === 'POSTGRES_INSPECTION_UNAVAILABLE'
    )
    observations.push({
      app_id: context.app_id,
      database_id: expected.database_id,
      container_id: expected.container_id,
      columns: table.columns,
      samples
    })
    check(
      `actual_Main_transport_installed_Root_sameUID_pinned_SSH_PG_app${context.app_id}_inspect_tables_rows10_rows100_and_cross_instance_limit_missing_relation_refusal`
    )
  }
  const after = await snapshot()
  for (const key of [
    'postgres',
    'postgres8',
    'apps',
    'containers',
    'owners',
    'desired',
    'helpers',
    'content_digest',
    'files',
    'vps_digest',
    'database_inode'
  ])
    assert.deepEqual(after[key], before[key])
  evidence.inspector = {
    status: 'PASS',
    scope: 'REAL_MAIN_TRANSPORT_ROOT_SAME_UID_CLI_PINNED_SSH_TWO_POSTGRES_INSTANCES',
    observations,
    controller_and_target_material_unchanged: true,
    raw_samples_persisted: false,
    desktop_project_receipts_manufactured: false,
    service_project_receipt_guard_and_GUI_live_tested: false,
    limitation:
      'Prior private Desktop project profiles were removed. This transport proof does not bypass or prove the Service/UI own-current-selection-receipt guard.'
  }
  check(
    'real_inspector_keeps_two1000_row_databases_CIDs_volumes_systemIDs_source_env_keys_helpers_and_policy_unchanged'
  )
}
