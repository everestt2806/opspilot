import { createHash, createHmac, randomBytes } from 'node:crypto'
import type Database from 'better-sqlite3'
import type {
  ProductPostgresReference,
  ResolvedProductPostgres
} from '../../../../docs/contracts/product-postgres'
import { PRODUCT_POSTGRES_TRANSFER_PREFIX } from '../../../../docs/contracts/product-postgres'
import type { ProductClaimToken } from '../../../../docs/contracts/product-auto-deploy'
import type { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import type { ProductDeployRepository } from '../db/productDeployRepository'
import { ProductPostgresRepository } from '../db/productPostgresRepository'
import { canonicalH2Json } from './productH2Proof'
import { ProductPostgresError } from './productPostgres'
import { readProductPostgresSourceBinding } from './productSourceBindings'
import {
  readProductSourceConfiguration,
  type ProductSourceBasis
} from './productSourceConfiguration'

/** Chỉ controller giữ claim hiện hành và runtime key mới được giải mã/transfer. */
export class ProductPostgresRuntime {
  private readonly claim: ProductClaimToken
  private readonly vault: ProductPostgresRepository
  constructor(
    private readonly db: Database.Database,
    private readonly repository: ProductDeployRepository,
    cipher: AesGcmCredentialCipher,
    claim: ProductClaimToken,
    private readonly runtimeKey: (claim: ProductClaimToken) => Buffer
  ) {
    this.claim = structuredClone(claim)
    this.vault = new ProductPostgresRepository(db, cipher)
  }

  resolve(deploymentId?: number): ResolvedProductPostgres | null {
    if (this.db.inTransaction) throw new ProductPostgresError('PRODUCT_POSTGRES_INPUT_INVALID')
    try {
      const target = this.authority(deploymentId),
        app = this.db
          .prepare(
            'SELECT framework,host_port,container_port,healthcheck_path,needs_db FROM app WHERE id=?'
          )
          .get(this.claim.app_id) as ProductSourceBasis,
        source = this.db
          .prepare(
            'SELECT deploy_config_json,config_sha256 FROM product_source_config WHERE app_id=? AND source_generation=?'
          )
          .get(this.claim.app_id, this.claim.source_generation) as
          { deploy_config_json: string; config_sha256: string } | undefined
      if (
        !source ||
        source.config_sha256 !== this.claim.source_config_sha256 ||
        createHash('sha256').update(source.deploy_config_json).digest('hex') !==
          source.config_sha256
      )
        throw Error()
      const raw = JSON.parse(source.deploy_config_json)
      if (!Object.hasOwn(raw, 'database')) {
        if (app.needs_db !== 0) throw Error()
        this.authority(deploymentId)
        return null
      }
      const config = readProductSourceConfiguration(app, source.deploy_config_json)
      if (!config.database) throw Error()
      const reference: ProductPostgresReference = config.database,
        scope = {
          controller_id: this.claim.controller_id,
          app_id: this.claim.app_id,
          ownership_generation: this.claim.ownership_generation,
          target
        }
      readProductPostgresSourceBinding(
        this.db,
        scope,
        this.claim.source_generation,
        source.config_sha256,
        reference
      )
      const metadata = this.vault.state({ format: 1, scope }),
        credentials = this.vault.readCredentials(scope, reference.database_id)
      if (
        !metadata ||
        metadata.database_id !== reference.database_id ||
        metadata.framework !== config.framework ||
        canonicalH2Json(this.authority(deploymentId)) !== canonicalH2Json(target)
      )
        throw Error()
      return {
        claim: structuredClone(this.claim),
        target,
        reference,
        metadata,
        credentials,
        signRuntime: (payload: string): string => {
          let rawKey: Buffer | undefined, key: Buffer | undefined
          try {
            this.authority(deploymentId)
            rawKey = this.runtimeKey(structuredClone(this.claim))
            if (rawKey.length !== 32) throw Error()
            key = createHmac('sha256', rawKey).update('opspilot-postgres-transfer-key-v1').digest()
            return createHmac('sha256', key)
              .update('opspilot-postgres-transfer-v1\n')
              .update(payload, 'utf8')
              .digest('hex')
          } catch {
            throw new ProductPostgresError('PRODUCT_POSTGRES_UNAVAILABLE')
          } finally {
            rawKey?.fill(0)
            key?.fill(0)
          }
        }
      }
    } catch {
      throw new ProductPostgresError('PRODUCT_POSTGRES_UNAVAILABLE')
    }
  }

  private authority(deploymentId?: number): ResolvedProductPostgres['target'] {
    const target = this.repository.readGitDispatchTargetBinding(this.claim, deploymentId)
    if (
      target.state !== 'ready' ||
      (deploymentId === undefined
        ? this.repository.readGitSnapshotAuthority(this.claim).state !== 'ready'
        : this.repository.readGitDispatchSessionAuthority(this.claim, deploymentId) !== 'ready')
    )
      throw Error()
    return target.binding
  }
}

/** Nonce làm mù hash transfer; password chỉ nằm trong comment file0600 và RAM target. */
export function renderProductPostgresTransfer(database: ResolvedProductPostgres): string {
  const payload = {
      format: 1,
      claim: database.claim,
      target: database.target,
      reference: database.reference,
      image: database.metadata.image,
      nonce: randomBytes(32).toString('hex'),
      credentials: database.credentials
    },
    content = canonicalH2Json(payload),
    signature = database.signRuntime(content)
  if (!/^[a-f0-9]{64}$/.test(signature))
    throw new ProductPostgresError('PRODUCT_POSTGRES_UNAVAILABLE')
  return PRODUCT_POSTGRES_TRANSFER_PREFIX + canonicalH2Json({ payload, signature }) + '\n'
}
