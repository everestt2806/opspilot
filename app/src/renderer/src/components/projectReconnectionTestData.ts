import type { DesktopControllerConnection, DesktopControllerApp } from '@shared/desktopController'
import type {
  DesktopProjectReconnection,
  DesktopProjectReconnectionReview
} from '@shared/desktopProjectReconnection'
import image from '../../../../control-plane-runtime/product-postgres-image.json'

/** DTO giả chỉ dùng test renderer; không ghi Main journal hoặc cấp authority. */
export function reconnectionTestData(): {
  binding: DesktopControllerConnection
  app: DesktopControllerApp
  review: DesktopProjectReconnectionReview
  confirmed: DesktopProjectReconnection
} {
  const binding: DesktopControllerConnection = {
    binding_id: '11111111-1111-4111-8111-111111111111',
    controller_id: 'controller-a',
    vps_id: 1,
    revision: 2,
    state: 'active',
    display_name: 'Controller',
    remote_client_id: '22222222-2222-4222-8222-222222222222',
    scopes: ['read', 'deploy:manual', 'policy:write'],
    credential_expires_at: '2030-01-01T00:00:00Z',
    updated_at: new Date().toISOString()
  }
  const app: DesktopControllerApp = {
    app_id: 42,
    ownership_generation: 1,
    source_generation: 2,
    app_name: 'Team notes',
    production_ref: 'main',
    desired_sha: null,
    auto_deploy_paused: true,
    reconciliation_state: 'paused',
    observed_at: null
  }
  const review: DesktopProjectReconnectionReview = {
    plan_id: '33333333-3333-4333-8333-333333333333',
    expires_at: new Date(Date.now() + 60000).toISOString(),
    binding_id: binding.binding_id,
    binding_revision: 2,
    context: {
      state: 'review_required',
      controller_id: binding.controller_id,
      app_id: 42,
      app_name: app.app_name,
      scope: {
        controller_id: binding.controller_id,
        app_id: 42,
        ownership_generation: 1,
        target: {
          vps_id: 77,
          host: 'target.test',
          port: 22,
          username: 'operator',
          auth_type: 'key',
          host_fingerprint: 'SHA256:' + 'A'.repeat(43),
          ssh_security_revision: 2
        }
      },
      source: {
        generation: 2,
        config_sha256: 'a'.repeat(64),
        repository_url: 'https://github.com/example/notes.git',
        production_ref: 'main',
        repository_root: '.',
        configuration: {
          framework: 'nextjs',
          host_port: 30000,
          container_port: 3000,
          healthcheck_path: '/',
          needs_db: true
        }
      },
      selected_environment: null,
      selected_database: {
        database_id: '44444444-4444-4444-8444-444444444444',
        controller_id: binding.controller_id,
        app_id: 42,
        ownership_generation: 1,
        framework: 'nextjs',
        engine: 'postgresql',
        major: 16,
        image: image.image,
        database_name: 'opspilot',
        application_user: 'opspilot',
        administrator_user: 'postgres',
        created_at: new Date().toISOString(),
        provisioning: 'prepared'
      },
      auto_deploy_paused: true,
      snapshot_sha256: 'b'.repeat(64),
      consent_required: true,
      desktop_authority: 'not_granted',
      runtime_status: 'not_checked'
    }
  }
  const confirmed: DesktopProjectReconnection = {
    request_key: '55555555-5555-4555-8555-555555555555',
    provenance: 'explicit_reconnection_v1',
    binding_id: binding.binding_id,
    binding_revision: 2,
    controller_id: binding.controller_id,
    app_id: 42,
    snapshot_sha256: review.context.snapshot_sha256,
    context: structuredClone(review.context),
    confirmed_at: new Date().toISOString(),
    execution: 'fresh_review_required'
  }
  return { binding, app, review, confirmed }
}
