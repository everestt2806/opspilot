import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import type { ProductProjectSourceVerificationInput } from '../../../../docs/contracts/product-project-source-verification'
import type {
  ProductPostgresMetadata,
  ProductPostgresReference
} from '../../../../docs/contracts/product-postgres'
import { ProductPostgresRepository } from '../db/productPostgresRepository'
import { ProductPostgresError, postgresReferenceSchema } from './productPostgres'
import { canonicalH2Json } from './productH2Proof'
import { TargetEnrollmentRepository } from './targetEnrollmentRepository'
import { readProductPostgresSourceBinding } from './productSourceBindings'

/** Metadata-only proof for source review. Does not supply credentials, a claim,
 * runtime env-file, provisioning, ready state or permission to dispatch.
 */
export class ProductPostgresPreflight {
  private constructor(
    readonly appId: number,
    readonly sourceHash: string,
    readonly reference: ProductPostgresReference,
    readonly metadata: ProductPostgresMetadata
  ) {}
  static review(
    db: Database.Database,
    input: ProductProjectSourceVerificationInput,
    cipher?: AesGcmCredentialCipher
  ): ProductPostgresPreflight | null {
    const fail = (): never => {
      throw new ProductPostgresError('PRODUCT_POSTGRES_UNAVAILABLE')
    }
    try {
      if (db.inTransaction) fail()
      return db.transaction(() => {
        const row = db
          .prepare(
            `SELECT s.deploy_config_json,s.config_sha256 FROM product_source_config s
          JOIN product_app_control c ON c.app_id=s.app_id AND c.source_generation=s.source_generation
          WHERE c.app_id=? AND c.controller_id=? AND c.ownership_generation=? AND c.source_generation=?
          AND c.source_config_sha256=? AND c.mode='product'`
          )
          .get(
            input.app_id,
            input.controller_id,
            input.expected_ownership_generation,
            input.expected_source_generation,
            input.expected_source_config_sha256
          ) as { deploy_config_json: string; config_sha256: string } | undefined
        if (!row || row.config_sha256 !== input.expected_source_config_sha256) return fail()
        const config = JSON.parse(row.deploy_config_json)
        if (
          createHash('sha256').update(canonicalH2Json(config)).digest('hex') !== row.config_sha256
        )
          fail()
        if (!Object.hasOwn(config, 'database')) return null
        if (!cipher) return fail()
        const reference = postgresReferenceSchema.parse(config.database)
        if (
          !config.needs_db ||
          reference.controller_id !== input.controller_id ||
          reference.ownership_generation !== input.expected_ownership_generation
        )
          fail()
        const target = new TargetEnrollmentRepository(db).target(
          input.controller_id,
          input.app_id,
          input.expected_ownership_generation,
          true
        )
        if (target.ssh_security_revision !== input.expected_target_security_revision) fail()
        const scope = {
          controller_id: input.controller_id,
          app_id: input.app_id,
          ownership_generation: input.expected_ownership_generation,
          target
        }
        readProductPostgresSourceBinding(
          db,
          scope,
          input.expected_source_generation,
          row.config_sha256,
          reference
        )
        const metadata = new ProductPostgresRepository(db, cipher).verifyAvailableInTransaction(
          scope,
          reference.database_id
        )
        if (metadata.framework !== config.framework) fail()
        return new ProductPostgresPreflight(input.app_id, row.config_sha256, reference, metadata)
      })()
    } catch {
      return fail()
    }
  }
}
