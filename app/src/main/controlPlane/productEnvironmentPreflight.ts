import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import type { ProductEnvironmentMetadata } from '../../../../docs/contracts/product-environment'
import type { ProductProjectSourceVerificationInput } from '../../../../docs/contracts/product-project-source-verification'
import type { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import { ProductEnvironmentRepository } from '../db/productEnvironmentRepository'
import { TargetEnrollmentRepository } from './targetEnrollmentRepository'
import { canonicalH2Json } from './productH2Proof'
import { ProductEnvironmentError } from './productEnvironment'

export const productEnvironmentReferenceSchema = z.strictObject({
  controller_id: z.string().min(1).max(128),
  ownership_generation: z.number().int().positive(),
  revision: z.number().int().positive()
})

/** Chỉ metadata đã xác thực; không có giá trị hoặc phương thức render runtime. */
export class ProductEnvironmentPreflight {
  private constructor(
    readonly appId: number,
    readonly sourceHash: string,
    readonly reference: z.output<typeof productEnvironmentReferenceSchema>,
    readonly metadata: ProductEnvironmentMetadata
  ) {}

  static review(
    db: Database.Database,
    input: ProductProjectSourceVerificationInput,
    cipher?: AesGcmCredentialCipher
  ): ProductEnvironmentPreflight | null {
    const fail = (): never => {
      throw new ProductEnvironmentError('PRODUCT_ENVIRONMENT_UNAVAILABLE')
    }
    try {
      if (db.inTransaction) fail()
      const source = db
        .prepare(
          `SELECT s.deploy_config_json,s.config_sha256
        FROM product_source_config s JOIN product_app_control c
        ON c.app_id=s.app_id AND c.source_generation=s.source_generation
        WHERE c.app_id=? AND c.controller_id=? AND c.ownership_generation=?
        AND c.source_generation=? AND c.source_config_sha256=? AND c.mode='product'`
        )
        .get(
          input.app_id,
          input.controller_id,
          input.expected_ownership_generation,
          input.expected_source_generation,
          input.expected_source_config_sha256
        ) as { deploy_config_json: string; config_sha256: string } | undefined
      if (!source || source.config_sha256 !== input.expected_source_config_sha256) fail()
      const config = JSON.parse(source!.deploy_config_json)
      if (
        createHash('sha256').update(canonicalH2Json(config)).digest('hex') !== source!.config_sha256
      )
        fail()
      if (!Object.hasOwn(config, 'environment')) return null
      if (!cipher) fail()
      const reference = productEnvironmentReferenceSchema.parse(config.environment)
      if (
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
      const binding = db
        .prepare(
          `SELECT controller_id,ownership_generation,environment_revision,
        target_binding_json,source_config_sha256 FROM product_source_environment
        WHERE app_id=? AND source_generation=?`
        )
        .get(input.app_id, input.expected_source_generation) as
        | {
            controller_id: string
            ownership_generation: number
            environment_revision: number
            target_binding_json: string
            source_config_sha256: string
          }
        | undefined
      if (
        !binding ||
        binding.controller_id !== reference.controller_id ||
        binding.ownership_generation !== reference.ownership_generation ||
        binding.environment_revision !== reference.revision ||
        binding.source_config_sha256 !== source!.config_sha256 ||
        binding.target_binding_json !== canonicalH2Json(target)
      )
        fail()
      const metadata = new ProductEnvironmentRepository(db, cipher!).metadata(
        {
          controller_id: input.controller_id,
          app_id: input.app_id,
          ownership_generation: input.expected_ownership_generation,
          target
        },
        reference.revision
      )
      if (metadata.framework !== config.framework) fail()
      return new ProductEnvironmentPreflight(
        input.app_id,
        source!.config_sha256,
        reference,
        metadata
      )
    } catch {
      return fail()
    }
  }
}
