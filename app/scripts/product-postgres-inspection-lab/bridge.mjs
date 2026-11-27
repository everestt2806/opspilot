/* eslint-disable @typescript-eslint/explicit-function-return-type -- Explicit private Linux SSH/Docker acceptance. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

/** Invoked only by the explicit root/private selection lab opt-in. Credentials
 * stay in process memory and Python stdin; the production CLI gets only context.
 */
export async function inspectSelectedPostgres({
  db,
  data,
  scope,
  root,
  scratch,
  modules,
  artifact,
  bundlePin,
  prepared,
  selected,
  nonce,
  cli,
  check,
  admin
}) {
  const require = createRequire(join(modules, 'package.json'))
  const { build } = require('esbuild')
  const outfile = join(scratch, 'inspection-fixture.cjs')
  await build({
    entryPoints: [join(import.meta.dirname, '../product-postgres-lab/entry.ts')],
    outfile,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    bundle: true,
    packages: 'external',
    nodePaths: [modules],
    logLevel: 'silent',
    plugins: [
      {
        name: 'fixture-sql-raw',
        setup(builder) {
          builder.onResolve({ filter: /\.sql\?raw$/ }, (args) => ({
            path: resolve(args.resolveDir, args.path.replace(/\?raw$/, '')),
            namespace: 'fixture-sql'
          }))
          builder.onLoad({ filter: /.*/, namespace: 'fixture-sql' }, (args) => ({
            contents: readFileSync(args.path, 'utf8'),
            loader: 'text'
          }))
        }
      }
    ]
  })
  const { ProductPostgresRepository, loadControllerCredentialCipher, loadControllerRuntimeKey } =
    createRequire(import.meta.url)(outfile)
  const credentials = new ProductPostgresRepository(
    db,
    loadControllerCredentialCipher(data)
  ).readCredentials(scope, prepared.metadata.database_id)
  const key = loadControllerRuntimeKey(data, scope)
  const packet = {
    root,
    key: key.toString('base64'),
    nonce,
    identity: { ...scope, database_id: prepared.metadata.database_id },
    credentials: {
      admin_password: credentials.administrator_password,
      app_password: credentials.application_password
    }
  }
  const fixture = (operation) => {
    const child = spawnSync(
      'python3',
      [join(import.meta.dirname, 'bridge_fixture.py'), operation],
      {
        input: JSON.stringify(packet),
        encoding: 'utf8',
        timeout: 120000,
        maxBuffer: 65536,
        env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', PYTHONDONTWRITEBYTECODE: '1' }
      }
    )
    if (child.error || child.status !== 0) {
      // Only the fixture's fixed numeric location diagnostic is publishable.
      const location = /\{"fixture_failure_lines": \[[0-9, ]+\]\}/.exec(child.stderr)?.[0]
      assert.fail('PRIVATE_INSPECTION_FIXTURE_FAILED ' + (location ?? operation))
    }
    for (const value of Object.values(packet.credentials)) {
      assert(!child.stdout.includes(value) && !child.stderr.includes(value))
    }
    return JSON.parse(child.stdout)
  }
  const context = {
    format: 1,
    controller_id: scope.controller_id,
    app_id: scope.app_id,
    expected_ownership_generation: scope.ownership_generation,
    expected_source_generation: selected.source_generation,
    expected_source_config_sha256: selected.source_config_sha256,
    expected_target_security_revision: scope.target.ssh_security_revision,
    database_id: prepared.metadata.database_id
  }
  const query = (read, overrides = {}) => ({
    artifact,
    manifest_sha256: bundlePin,
    inspection: { context: { ...context, ...overrides }, read }
  })
  const databaseBefore = JSON.stringify(db.prepare('SELECT * FROM product_app_control').all())
  try {
    const before = fixture('setup')
    const inspected = cli('managed-postgres-inspection', query({ operation: 'inspect' }))
    assert.deepEqual(inspected.instance, before.instance)
    assert.equal(inspected.data, null)
    const tables = cli('managed-postgres-inspection', query({ operation: 'tables' }))
    assert.deepEqual(
      tables.data.map((t) => [t.schema, t.name]),
      [['public', 'sample']]
    )
    const rows = cli(
      'managed-postgres-inspection',
      query({ operation: 'rows', schema: 'public', table: 'sample', limit: 10 })
    )
    assert.deepEqual(rows.data, [{ id: 1, marker: 'controller-bridge' }])
    check(
      'production_same_UID_CLI_cipher_and_pinned_SSH_inspect_tables_rows_reach_selected_instance'
    )
    cli(
      'managed-postgres-inspection',
      query({ operation: 'inspect' }, { database_id: '00000000-0000-4000-8000-000000000001' }),
      true
    )
    cli(
      'managed-postgres-inspection',
      query({ operation: 'rows', schema: 'public', table: 'sample', limit: 101 }),
      true
    )
    cli(
      'managed-postgres-inspection',
      { ...query({ operation: 'inspect' }), manifest_sha256: '0'.repeat(64) },
      true
    )
    check('production_CLI_refuses_wrong_instance_limit_and_bundle_pin')
    if (admin) {
      const inspected = admin(
        'managed-postgres-inspection',
        query({ operation: 'inspect' }).inspection
      )
      assert.deepEqual(inspected.instance, before.instance)
      const tables = admin('managed-postgres-inspection', query({ operation: 'tables' }).inspection)
      assert.deepEqual(
        tables.data.map((t) => [t.schema, t.name]),
        [['public', 'sample']]
      )
      const sample = admin(
        'managed-postgres-inspection',
        query({ operation: 'rows', schema: 'public', table: 'sample', limit: 10 }).inspection
      )
      assert.deepEqual(sample.data, [{ id: 1, marker: 'controller-bridge' }])
      check('actual_same_UID_Python_admin_to_CLI_pinned_SSH_PostgreSQL_reads_correct_instance')
      admin(
        'managed-postgres-inspection',
        query({ operation: 'rows', schema: 'public', table: 'absent_relation', limit: 1 })
          .inspection,
        // PostgreSQL resolves an absent FROM relation before evaluating CASE;
        // the reader deliberately suppresses its raw error as UNAVAILABLE.
        'POSTGRES_INSPECTION_UNAVAILABLE'
      )
      admin(
        'managed-postgres-inspection',
        query({ operation: 'rows', schema: 'public', table: 'reader_view', limit: 1 }).inspection,
        'POSTGRES_INSPECTION_RELATION_UNAVAILABLE'
      )
      admin(
        'managed-postgres-inspection',
        {
          ...query({ operation: 'inspect' }).inspection,
          artifact: '/caller/untrusted',
          manifest_sha256: '0'.repeat(64)
        },
        'PRODUCT_POSTGRES_INPUT_INVALID'
      )
      check('same_UID_admin_preserves_safe_inspection_error_and_refuses_caller_artifact_injection')
    }
    assert.deepEqual(fixture('snapshot'), before)
    assert.equal(
      JSON.stringify(db.prepare('SELECT * FROM product_app_control').all()),
      databaseBefore
    )
    assert.equal(db.prepare('SELECT count(*) n FROM product_deploy_job').get().n, 0)
    check(
      'controller_inspection_preserves_CID_volume_system_ID_journal_rows_configuration_and_zero_jobs'
    )
  } finally {
    const cleanup = fixture('cleanup')
    assert.equal(cleanup.private_cleanup, true)
    key.fill(0)
    check('controller_inspection_private_Docker_resources_removed_by_exact_ownership')
  }
}
