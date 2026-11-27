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

export interface ProductEnvironmentReference {
  controller_id: string
  ownership_generation: number
  revision: number
}
export interface ProductEnvironmentSelectionResult {
  state: 'selected' | 'already_selected'
  request_key: string
  controller_id: string
  app_id: number
  ownership_generation: number
  source_generation: number
  source_config_sha256: string
  environment: ProductEnvironmentReference
  auto_deploy_paused: true
  deployment_started: false
  execution: 'requires_environment_runtime'
}
