import type Database from 'better-sqlite3'
import type { ProductDesktopControllerBindingIntent } from '../../../../docs/contracts/product-controller-api'
import { canonicalH2Json } from './productH2Proof'

/** Only follow explicit append-only local rebind receipts; never infer identity from an IP. */
export function bindingAtAuthority(
  db: Database.Database,
  original: ProductDesktopControllerBindingIntent,
  revision: number
): ProductDesktopControllerBindingIntent {
  if (!original.installation || revision < original.installation.authority_revision)
    throw Error('AUTHORITY_CHAIN_INVALID')
  let value = original
  while (value.installation!.authority_revision < revision) {
    const row = db
      .prepare(
        `SELECT previous_authority_json,next_authority_json FROM desktop_controller_authority_rebind
      WHERE installation_request_key=? AND from_revision=?`
      )
      .get(value.installation!.request_key, value.installation!.authority_revision) as
      { previous_authority_json: string; next_authority_json: string } | undefined
    if (!row) throw Error('AUTHORITY_CHAIN_INVALID')
    const before = JSON.parse(row.previous_authority_json),
      next = JSON.parse(row.next_authority_json),
      reference = value.installation!
    if (
      before.installation_request_key !== reference.request_key ||
      before.controller_id !== value.controller_id ||
      before.vps_id !== value.vps_id ||
      before.authority_revision !== reference.authority_revision ||
      before.ssh_security_revision !== value.ssh_security_revision ||
      canonicalH2Json(before.principal) !== canonicalH2Json(value.principal) ||
      before.release_sha256 !== reference.release_sha256 ||
      before.installer_sha256 !== reference.installer_sha256 ||
      before.runtime_uid !== reference.runtime_uid ||
      before.data_directory !== value.data_directory ||
      next.authority_revision !== before.authority_revision + 1 ||
      next.installation_request_key !== before.installation_request_key ||
      next.controller_id !== before.controller_id ||
      next.release_sha256 !== before.release_sha256 ||
      next.installer_sha256 !== before.installer_sha256 ||
      next.runtime_uid !== before.runtime_uid ||
      next.data_directory !== before.data_directory
    )
      throw Error('AUTHORITY_CHAIN_INVALID')
    value = {
      ...value,
      vps_id: next.vps_id,
      ssh_security_revision: next.ssh_security_revision,
      principal: next.principal,
      installation: { ...reference, authority_revision: next.authority_revision },
      ...(value.upgrade
        ? { upgrade: { ...value.upgrade, authority_revision: next.authority_revision } }
        : {})
    }
  }
  return value
}
