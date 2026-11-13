/** Metadata/value DTO copy từ docs/contracts/product-environment.ts.
 * Không chứa controller scope/transport; values chỉ đi theo chiều ghi.
 */
export interface ProductEnvironmentValues {
  runtime_env: Record<string, string>
  public_build_args: Record<string, string>
}
export interface ProductEnvironmentMetadata {
  controller_id: string
  app_id: number
  ownership_generation: number
  revision: number
  basis_source_generation: number
  basis_source_config_sha256: string
  framework: 'express' | 'static-spa' | 'nextjs'
  runtime_keys: string[]
  public_build_keys: string[]
  created_at: string
  activation: 'staged'
}
