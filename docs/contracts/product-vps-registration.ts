import type { ProductControllerVpsEnrollmentInput } from './product-controller-bootstrap'

/** Fixed Linux admin CLI register-vps. Secret chỉ memory/stdin trên verified SSH;
 * không public HTTP endpoint hoặc copy Desktop ciphertext/key sang controller. */
export interface ProductVpsRegistrationInput extends ProductControllerVpsEnrollmentInput {
  request_key: string
}
export interface ProductVpsRegistrationResult {
  state: 'registered'
  request_key: string
  controller_id: string
  vps_id: number
  ssh_security_revision: number
  profile: ProductControllerVpsEnrollmentInput['profile']
  created_at: string
}
/** Receipt namespace(controller,Unix admin,UUID), profile-only body/hash, kết quả
 * metadata và revision. Cùng transaction với VPS/encrypted credential. Replay kiểm
 * lại SSH/current profile/credential bằng base enrollment; không overwrite/rotate.
 * Samekey khác profile, secret hoặc target revision => conflict. Không plaintext
 * hoặc password hash trong receipt. Không install/helper/app/job/deployment. */
