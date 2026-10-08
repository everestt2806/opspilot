import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3'

import type { App, Vps } from '@shared/ipc'
import { closeDatabase, initializeDatabase } from '../db'
import type { ExposureManager, ExposureResult } from '../deploy/exposure'
import type { SshManager } from '../ssh/manager'
import { DoctorFixService, type DoctorFixOptions } from './fix'
import { DoctorRepository } from './repository'

describe('DoctorFixService & DoctorRepository', () => {
  let testDirectory: string | null = null
  let db: Database.Database
  let doctorRepo: DoctorRepository

  const mockVps: Vps = {
    id: 1,
    name: 'test-vps',
    host: '1.2.3.4',
    port: 22,
    host_fingerprint: null,
    username: 'root',
    auth_type: 'password',
    provider: 'lab',
    region: 'test',
    docker_version: '24.0.5',
    last_status: 'online',
    last_seen_at: null,
    created_at: '2026-09-28T00:00:00Z'
  }

  const mockApp: App = {
    id: 1,
    vps_id: 1,
    name: 'my-app',
    framework: 'express',
    host_port: 3000,
    container_port: 3000,
    healthcheck_path: '/',
    needs_db: 0,
    current_deployment_id: 1,
    url: 'http://1.2.3.4:3000'
  }

  const defaultTestOptions: DoctorFixOptions = {
    checkInternalHealth: vi.fn().mockResolvedValue(true),
    checkExternalProbe: vi.fn().mockResolvedValue('unreachable' as const)
  }

  function createPendingRun(
    deploymentId = 1,
    overrides?: {
      diagnosis_code?:
        | 'DISK_FULL'
        | 'RUNTIME_OOM'
        | 'PORT_MISMATCH'
        | 'HEALTHCHECK_PATH'
        | 'DATABASE_NOT_READY'
        | 'MISSING_ENV'
        | 'DEPENDENCY_LOCK'
        | 'RUNTIME_CRASH'
        | 'PORT_BLOCKED_EXTERNAL'
        | 'DNS_PUBLISH_FAILED'
        | 'DOCKER_UNAVAILABLE'
        | 'SSH_TRANSIENT'
        | 'UNKNOWN'
      selected_fix?: string | null
      evidence?: Record<string, unknown>
      outcome?: 'pending' | 'fixed' | 'verified' | 'failed' | 'abstained'
      started_at?: string
    }
  ): number {
    const runId = doctorRepo.create({
      deploymentId,
      trigger: 'manual',
      evidence: (overrides?.evidence as never) ?? {
        step: 'HEALTHCHECK',
        externalProbe: 'unreachable',
        containerState: { status: 'running' }
      },
      diagnosis: {
        code: overrides?.diagnosis_code ?? 'PORT_BLOCKED_EXTERNAL',
        title: 'App healthy nội bộ nhưng bị chặn từ Internet',
        confidence: 'high',
        evidence: ['manual probe test'],
        fixId:
          overrides?.selected_fix !== undefined ? overrides.selected_fix : 'reconcile_firewall',
        verifyProbe: 'external_http',
        safeToAutoFix: true,
        abstained: overrides?.outcome === 'abstained'
      }
    })
    if (overrides?.started_at) {
      db.prepare('UPDATE doctor_run SET started_at = ? WHERE id = ?').run(
        overrides.started_at,
        runId
      )
    }
    if (
      overrides?.outcome &&
      overrides.outcome !== 'pending' &&
      overrides.outcome !== 'abstained'
    ) {
      doctorRepo.finish(runId, overrides.outcome)
    }
    return runId
  }

  beforeEach(() => {
    testDirectory = mkdtempSync(join(tmpdir(), 'doctor-fix-test-'))
    db = initializeDatabase(testDirectory)
    doctorRepo = new DoctorRepository(db)

    // Chuẩn bị dữ liệu mẫu trong DB
    db.prepare(
      `INSERT INTO vps (id, name, host, username, auth_type, encrypted_secret)
       VALUES (1, 'test-vps', '1.2.3.4', 'root', 'password', 'secret')`
    ).run()

    db.prepare(
      `INSERT INTO app (id, vps_id, name, framework, host_port, container_port)
       VALUES (1, 1, 'my-app', 'express', 3000, 3000)`
    ).run()

    db.prepare(
      `INSERT INTO deployment (id, app_id, version, image_tag, status)
       VALUES (1, 1, 1, 'my-app:v1', 'running')`
    ).run()
  })

  afterEach(() => {
    closeDatabase()
    if (testDirectory) {
      rmSync(testDirectory, { recursive: true, force: true })
      testDirectory = null
    }
  })

  describe('Fix ID validation & manual fix rejection', () => {
    it('từ chối tự sửa đối với các fixId không thuộc allowlist (redeploy_correct_port, restart_docker...)', async () => {
      const service = new DoctorFixService({} as SshManager, db, undefined, defaultTestOptions)
      const result = await service.execute({
        fixId: 'redeploy_correct_port',
        deploymentId: 1,
        app: mockApp,
        vps: mockVps
      })

      expect(result.status).toBe('manual')
      expect(result.message).toContain('Doctor không tự sửa')
    })
  })

  describe('Doctor run existence and diagnosis validation', () => {
    it('thất bại khi thiếu Doctor run pending (chưa từng chạy diagnose hoặc run đã finish)', async () => {
      const service = new DoctorFixService({} as SshManager, db, undefined, defaultTestOptions)

      // Chưa có run nào
      const resultNoRun = await service.execute({
        fixId: 'reconcile_firewall',
        deploymentId: 1,
        app: mockApp,
        vps: mockVps
      })
      expect(resultNoRun.status).toBe('failed')
      expect(resultNoRun.message).toContain('Không tìm thấy Doctor run đang chờ xử lý')

      // Có run nhưng đã ở trạng thái verified
      createPendingRun(1, { outcome: 'verified' })
      const resultFinishedRun = await service.execute({
        fixId: 'reconcile_firewall',
        deploymentId: 1,
        app: mockApp,
        vps: mockVps
      })
      expect(resultFinishedRun.status).toBe('failed')
      expect(resultFinishedRun.message).toContain('Không tìm thấy Doctor run đang chờ xử lý')
    })

    it('thất bại khi Doctor run có diagnosis sai (không phải PORT_BLOCKED_EXTERNAL) hoặc sai selected_fix', async () => {
      createPendingRun(1, {
        diagnosis_code: 'RUNTIME_OOM',
        selected_fix: null
      })

      const service = new DoctorFixService({} as SshManager, db, undefined, defaultTestOptions)
      const result = await service.execute({
        fixId: 'reconcile_firewall',
        deploymentId: 1,
        app: mockApp,
        vps: mockVps
      })

      expect(result.status).toBe('failed')
      expect(result.message).toContain('Doctor run không khớp điều kiện sửa')
    })

    it('thất bại khi evidence trong Doctor run không phù hợp với PORT_BLOCKED_EXTERNAL (ví dụ: probe đã reachable)', async () => {
      createPendingRun(1, {
        diagnosis_code: 'PORT_BLOCKED_EXTERNAL',
        selected_fix: 'reconcile_firewall',
        evidence: {
          step: 'HEALTHCHECK',
          externalProbe: 'reachable',
          containerState: { status: 'running' }
        }
      })

      const service = new DoctorFixService({} as SshManager, db, undefined, defaultTestOptions)
      const result = await service.execute({
        fixId: 'reconcile_firewall',
        deploymentId: 1,
        app: mockApp,
        vps: mockVps
      })

      expect(result.status).toBe('failed')
      expect(result.message).toContain('Bằng chứng trong Doctor run không phù hợp')
    })

    it('thất bại khi bằng chứng trong Doctor run đã quá hạn / cũ (stale evidence)', async () => {
      // Run đã được tạo cách đây 30 phút (> 15 phút)
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()
      createPendingRun(1, {
        started_at: thirtyMinutesAgo
      })

      const mockExposureManager: ExposureManager = {
        reconcile: vi.fn()
      }
      const service = new DoctorFixService(
        {} as SshManager,
        db,
        mockExposureManager,
        defaultTestOptions
      )
      const result = await service.execute({
        fixId: 'reconcile_firewall',
        deploymentId: 1,
        app: mockApp,
        vps: mockVps
      })

      expect(result.status).toBe('failed')
      expect(result.message).toContain('Bằng chứng trong Doctor run đã quá hạn (cũ)')
      expect(mockExposureManager.reconcile).not.toHaveBeenCalled()
    })

    it('thất bại khi bằng chứng là thông tin tự khai / chưa qua probe thực tế (self-reported hoặc not_run)', async () => {
      createPendingRun(1, {
        evidence: {
          step: 'HEALTHCHECK',
          externalProbe: 'not_run',
          selfReported: true,
          containerState: { status: 'running' }
        }
      })

      const mockExposureManager: ExposureManager = {
        reconcile: vi.fn()
      }
      const service = new DoctorFixService(
        {} as SshManager,
        db,
        mockExposureManager,
        defaultTestOptions
      )
      const result = await service.execute({
        fixId: 'reconcile_firewall',
        deploymentId: 1,
        app: mockApp,
        vps: mockVps
      })

      expect(result.status).toBe('failed')
      expect(result.message).toContain('thông tin tự khai chưa qua kiểm chứng')
      expect(mockExposureManager.reconcile).not.toHaveBeenCalled()
    })
  })

  describe('Deployment - App - VPS relation checks', () => {
    it('thất bại và ghi action failed khi deployment.app_id không khớp app.id', async () => {
      const runId = createPendingRun(1)
      const mismatchedApp = { ...mockApp, id: 999 }

      const service = new DoctorFixService({} as SshManager, db, undefined, defaultTestOptions)
      const result = await service.execute({
        fixId: 'reconcile_firewall',
        deploymentId: 1,
        app: mismatchedApp,
        vps: mockVps
      })

      expect(result.status).toBe('failed')
      expect(result.message).toContain('Thông tin deployment, app và VPS không khớp nhau')

      const run = doctorRepo.getRun(runId)
      expect(run!.outcome).toBe('failed')

      const action = doctorRepo.latestActionForRun(runId)
      expect(action).not.toBeNull()
      expect(action!.status).toBe('failed')
      expect(action!.precondition_json).toContain('DEPLOYMENT_APP_VPS_MISMATCH')
    })

    it('thất bại và ghi action failed khi app.vps_id không khớp vps.id', async () => {
      const runId = createPendingRun(1)
      const mismatchedVps = { ...mockVps, id: 888 }

      const service = new DoctorFixService({} as SshManager, db, undefined, defaultTestOptions)
      const result = await service.execute({
        fixId: 'reconcile_firewall',
        deploymentId: 1,
        app: mockApp,
        vps: mismatchedVps
      })

      expect(result.status).toBe('failed')
      expect(result.message).toContain('Thông tin deployment, app và VPS không khớp nhau')

      const run = doctorRepo.getRun(runId)
      expect(run!.outcome).toBe('failed')

      const action = doctorRepo.latestActionForRun(runId)
      expect(action!.status).toBe('failed')
    })
  })

  describe('Precondition validation & Pre-fix Probing (Internal Health & External Reachability)', () => {
    it('thất bại khi deployment không ở trạng thái running', async () => {
      createPendingRun(1)
      // Đổi trạng thái deployment thành 'failed'
      db.prepare("UPDATE deployment SET status = 'failed' WHERE id = 1").run()

      const service = new DoctorFixService({} as SshManager, db, undefined, defaultTestOptions)
      const result = await service.execute({
        fixId: 'reconcile_firewall',
        deploymentId: 1,
        app: mockApp,
        vps: mockVps
      })

      expect(result.status).toBe('failed')
      expect(result.message).toContain('Điều kiện tiên quyết không đạt')

      // Kiểm tra doctor_run và doctor_action được lưu
      const latestRun = doctorRepo.latestForDeployment(1)
      expect(latestRun).not.toBeNull()
      expect(latestRun!.outcome).toBe('failed')

      const actions = doctorRepo.actionsForRun(latestRun!.id)
      expect(actions).toHaveLength(1)
      expect(actions[0].action_type).toBe('reconcile_firewall')
      expect(actions[0].status).toBe('failed')
      expect(actions[0].finished_at).not.toBeNull()

      const precondition = JSON.parse(actions[0].precondition_json!)
      expect(precondition.passed).toBe(false)
      expect(precondition.deployment_status).toBe('failed')
    })

    it('thất bại khi host_port không hợp lệ (ví dụ: port <= 0 hoặc > 65535)', async () => {
      createPendingRun(1)
      const service = new DoctorFixService({} as SshManager, db, undefined, defaultTestOptions)
      const invalidApp = { ...mockApp, host_port: 70000 }

      const result = await service.execute({
        fixId: 'reconcile_firewall',
        deploymentId: 1,
        app: invalidApp,
        vps: mockVps
      })

      expect(result.status).toBe('failed')
      expect(result.message).toContain('Điều kiện tiên quyết không đạt')

      const latestRun = doctorRepo.latestForDeployment(1)
      expect(latestRun!.outcome).toBe('failed')

      const actions = doctorRepo.actionsForRun(latestRun!.id)
      expect(actions[0].status).toBe('failed')
      const precondition = JSON.parse(actions[0].precondition_json!)
      expect(precondition.passed).toBe(false)
      expect(precondition.host_port).toBe(70000)
    })

    it('trước khi mở firewall: fail closed khi thiếu SSH capability và không có custom healthcheck probe', async () => {
      createPendingRun(1)
      const mockExposureManager: ExposureManager = {
        reconcile: vi.fn()
      }
      // ssh rỗng không có exec, options không có checkInternalHealth
      const service = new DoctorFixService({} as SshManager, db, mockExposureManager)

      const result = await service.execute({
        fixId: 'reconcile_firewall',
        deploymentId: 1,
        app: mockApp,
        vps: mockVps
      })

      expect(result.status).toBe('failed')
      expect(result.message).toContain('Thiếu SSH capability')
      expect(mockExposureManager.reconcile).not.toHaveBeenCalled()

      const run = doctorRepo.latestForDeployment(1)
      expect(run!.outcome).toBe('failed')

      const action = doctorRepo.latestActionForRun(run!.id)
      expect(action!.status).toBe('failed')
      expect(action!.result_json).toContain('Thiếu SSH capability')
    })

    it('trước khi mở firewall: fail closed và che secret khi internal health probe ném lỗi', async () => {
      createPendingRun(1)
      const mockExposureManager: ExposureManager = {
        reconcile: vi.fn()
      }
      const service = new DoctorFixService({} as SshManager, db, mockExposureManager, {
        checkInternalHealth: vi
          .fn()
          .mockRejectedValue(
            new Error('SSH loopback failed with token=secret_token_12345 and password=mySecretPass')
          ),
        checkExternalProbe: vi.fn().mockResolvedValue('unreachable')
      })

      const result = await service.execute({
        fixId: 'reconcile_firewall',
        deploymentId: 1,
        app: mockApp,
        vps: mockVps
      })

      expect(result.status).toBe('failed')
      expect(result.message).not.toContain('secret_token_12345')
      expect(result.message).not.toContain('mySecretPass')
      expect(result.message).toContain('token=***')
      expect(result.message).toContain('password=***')
      expect(mockExposureManager.reconcile).not.toHaveBeenCalled()

      const run = doctorRepo.latestForDeployment(1)
      expect(run!.outcome).toBe('failed')

      const action = doctorRepo.latestActionForRun(run!.id)
      expect(action!.status).toBe('failed')
      expect(action!.result_json).not.toContain('secret_token_12345')
      expect(action!.result_json).not.toContain('mySecretPass')
      expect(action!.result_json).toContain('token=***')
    })

    it('trước khi mở firewall: fail closed và che secret khi external probe ném lỗi có URL chứa mật khẩu', async () => {
      createPendingRun(1)
      const mockExposureManager: ExposureManager = {
        reconcile: vi.fn()
      }
      const service = new DoctorFixService({} as SshManager, db, mockExposureManager, {
        checkInternalHealth: vi.fn().mockResolvedValue(true),
        checkExternalProbe: vi
          .fn()
          .mockRejectedValue(
            new Error('DNS failure querying http://probe_admin:secretPassword999@api.test.com:3000')
          )
      })

      const result = await service.execute({
        fixId: 'reconcile_firewall',
        deploymentId: 1,
        app: mockApp,
        vps: mockVps
      })

      expect(result.status).toBe('failed')
      expect(result.message).not.toContain('secretPassword999')
      expect(result.message).toContain('http://probe_admin:***@api.test.com:3000')
      expect(mockExposureManager.reconcile).not.toHaveBeenCalled()

      const run = doctorRepo.latestForDeployment(1)
      expect(run!.outcome).toBe('failed')

      const action = doctorRepo.latestActionForRun(run!.id)
      expect(action!.status).toBe('failed')
      expect(action!.result_json).not.toContain('secretPassword999')
      expect(action!.result_json).toContain('http://probe_admin:***@api.test.com:3000')
    })

    it('trước khi mở firewall: hủy thao tác và ghi failed nếu app không còn healthy nội bộ', async () => {
      createPendingRun(1)
      const mockExposureManager: ExposureManager = {
        reconcile: vi.fn()
      }
      const service = new DoctorFixService({} as SshManager, db, mockExposureManager, {
        checkInternalHealth: vi.fn().mockResolvedValue(false), // app nội bộ chết
        checkExternalProbe: vi.fn().mockResolvedValue('unreachable')
      })

      const result = await service.execute({
        fixId: 'reconcile_firewall',
        deploymentId: 1,
        app: mockApp,
        vps: mockVps
      })

      expect(result.status).toBe('failed')
      expect(result.message).toContain('App không còn healthy nội bộ; hủy thao tác mở firewall')
      expect(mockExposureManager.reconcile).not.toHaveBeenCalled()

      const run = doctorRepo.latestForDeployment(1)
      expect(run!.outcome).toBe('failed')

      const action = doctorRepo.latestActionForRun(run!.id)
      expect(action!.status).toBe('failed')
    })

    it('trước khi mở firewall: xóa exposure_evidence_json cũ (null) và giữ verify_json khi external probe đã reachable (evidence cũ đầy đủ trường)', async () => {
      createPendingRun(1)
      // Trước đó deployment có evidence cũ degraded với diagnosis PORT_BLOCKED_EXTERNAL
      db.prepare(
        `UPDATE deployment SET exposure_status = 'degraded', exposure_evidence_json = ? WHERE id = 1`
      ).run(
        JSON.stringify({
          status: 'degraded',
          url: 'http://1.2.3.4:3000',
          external_probe: 'unreachable',
          ufw_state: 'inactive',
          ufw_reconciled: false,
          cloud_firewall: 'not_configured',
          diagnosis: 'PORT_BLOCKED_EXTERNAL',
          checked_at: new Date().toISOString()
        })
      )

      const mockExposureManager: ExposureManager = {
        reconcile: vi.fn()
      }
      const service = new DoctorFixService({} as SshManager, db, mockExposureManager, {
        checkInternalHealth: vi.fn().mockResolvedValue(true),
        checkExternalProbe: vi.fn().mockResolvedValue('reachable') // bên ngoài đã vào được
      })

      const result = await service.execute({
        fixId: 'reconcile_firewall',
        deploymentId: 1,
        app: mockApp,
        vps: mockVps
      })

      expect(result.status).toBe('verified')
      expect(result.message).toContain(
        'App đã có thể truy cập được từ bên ngoài; không cần mở lại firewall'
      )
      expect(mockExposureManager.reconcile).not.toHaveBeenCalled()

      const run = doctorRepo.latestForDeployment(1)
      expect(run!.outcome).toBe('verified')

      const action = doctorRepo.latestActionForRun(run!.id)
      expect(action!.status).toBe('skipped')
      // Phải giữ bằng chứng probe mới trong verify_json
      expect(action!.verify_json).not.toBeNull()
      const verify = JSON.parse(action!.verify_json!)
      expect(verify.verified).toBe(true)
      expect(verify.external_probe).toBe('reachable')
      expect(verify.reason).toBe('already_reachable')

      // Xác nhận DB: xóa exposure_evidence_json cũ (null), exposure_status = reachable, không còn diagnosis cũ
      const updatedDeployment = db
        .prepare('SELECT exposure_status, exposure_evidence_json FROM deployment WHERE id = 1')
        .get() as { exposure_status: string; exposure_evidence_json: string | null }
      expect(updatedDeployment.exposure_status).toBe('reachable')
      expect(updatedDeployment.exposure_evidence_json).toBeNull()
    })

    it('trước khi mở firewall: giữ exposure_evidence_json là null và lưu verify_json khi evidence cũ là null', async () => {
      createPendingRun(1)
      // Evidence cũ ban đầu là null
      db.prepare(
        `UPDATE deployment SET exposure_status = 'degraded', exposure_evidence_json = NULL WHERE id = 1`
      ).run()

      const mockExposureManager: ExposureManager = {
        reconcile: vi.fn()
      }
      const service = new DoctorFixService({} as SshManager, db, mockExposureManager, {
        checkInternalHealth: vi.fn().mockResolvedValue(true),
        checkExternalProbe: vi.fn().mockResolvedValue('reachable')
      })

      const result = await service.execute({
        fixId: 'reconcile_firewall',
        deploymentId: 1,
        app: mockApp,
        vps: mockVps
      })

      expect(result.status).toBe('verified')
      expect(mockExposureManager.reconcile).not.toHaveBeenCalled()

      const run = doctorRepo.latestForDeployment(1)
      expect(run!.outcome).toBe('verified')

      const action = doctorRepo.latestActionForRun(run!.id)
      expect(action!.status).toBe('skipped')
      expect(action!.verify_json).not.toBeNull()
      const verify = JSON.parse(action!.verify_json!)
      expect(verify.verified).toBe(true)
      expect(verify.external_probe).toBe('reachable')

      // Xác nhận DB: exposure_status = reachable, exposure_evidence_json = null (không chứa JSON sai contract)
      const updatedDeployment = db
        .prepare('SELECT exposure_status, exposure_evidence_json FROM deployment WHERE id = 1')
        .get() as { exposure_status: string; exposure_evidence_json: string | null }
      expect(updatedDeployment.exposure_status).toBe('reachable')
      expect(updatedDeployment.exposure_evidence_json).toBeNull()
    })

    it('trước khi mở firewall: xóa exposure_evidence_json cũ (null) khi evidence cũ thiếu trường và có diagnosis cũ', async () => {
      createPendingRun(1)
      // Evidence cũ thiếu các trường contract bắt buộc (url, external_probe, ufw_state...) và có diagnosis cũ
      db.prepare(
        `UPDATE deployment SET exposure_status = 'degraded', exposure_evidence_json = ? WHERE id = 1`
      ).run(
        JSON.stringify({
          status: 'degraded',
          diagnosis: 'PORT_BLOCKED_EXTERNAL'
        })
      )

      const mockExposureManager: ExposureManager = {
        reconcile: vi.fn()
      }
      const service = new DoctorFixService({} as SshManager, db, mockExposureManager, {
        checkInternalHealth: vi.fn().mockResolvedValue(true),
        checkExternalProbe: vi.fn().mockResolvedValue('reachable')
      })

      const result = await service.execute({
        fixId: 'reconcile_firewall',
        deploymentId: 1,
        app: mockApp,
        vps: mockVps
      })

      expect(result.status).toBe('verified')
      expect(mockExposureManager.reconcile).not.toHaveBeenCalled()

      const run = doctorRepo.latestForDeployment(1)
      expect(run!.outcome).toBe('verified')

      const action = doctorRepo.latestActionForRun(run!.id)
      expect(action!.status).toBe('skipped')
      expect(action!.verify_json).not.toBeNull()
      const verify = JSON.parse(action!.verify_json!)
      expect(verify.verified).toBe(true)
      expect(verify.external_probe).toBe('reachable')

      // Xác nhận DB: exposure_status = reachable, evidence cũ bị xóa (null) -> không chứa JSON thiếu trường/sai contract và không còn diagnosis cũ
      const updatedDeployment = db
        .prepare('SELECT exposure_status, exposure_evidence_json FROM deployment WHERE id = 1')
        .get() as { exposure_status: string; exposure_evidence_json: string | null }
      expect(updatedDeployment.exposure_status).toBe('reachable')
      expect(updatedDeployment.exposure_evidence_json).toBeNull()
    })
  })

  describe('Safe Fix Execution & Verification', () => {
    it('thực hiện safe fix thành công, ghi doctor_action running -> success, verified outcome và cập nhật deployment', async () => {
      createPendingRun(1)
      const mockResult: ExposureResult = {
        status: 'reachable',
        url: 'http://1.2.3.4:3000',
        external_probe: 'reachable',
        ufw_state: 'active',
        ufw_reconciled: true,
        cloud_firewall: 'reconciled',
        diagnosis: null,
        checked_at: new Date().toISOString()
      }
      const mockExposureManager: ExposureManager = {
        reconcile: vi.fn().mockResolvedValue(mockResult)
      }

      const service = new DoctorFixService(
        {} as SshManager,
        db,
        mockExposureManager,
        defaultTestOptions
      )
      const result = await service.execute({
        fixId: 'reconcile_firewall',
        deploymentId: 1,
        app: mockApp,
        vps: mockVps
      })

      expect(result.status).toBe('verified')
      expect(result.exposure_status).toBe('reachable')
      expect(mockExposureManager.reconcile).toHaveBeenCalledWith({
        app: mockApp,
        vps: mockVps
      })

      // Kiểm tra doctor_run outcome = 'verified'
      const run = doctorRepo.latestForDeployment(1)
      expect(run).not.toBeNull()
      expect(run!.outcome).toBe('verified')

      // Kiểm tra doctor_action
      const actions = doctorRepo.actionsForRun(run!.id)
      expect(actions).toHaveLength(1)
      expect(actions[0].action_type).toBe('reconcile_firewall')
      expect(actions[0].status).toBe('success')
      expect(actions[0].finished_at).not.toBeNull()

      const precondition = JSON.parse(actions[0].precondition_json!)
      expect(precondition.passed).toBe(true)

      const verify = JSON.parse(actions[0].verify_json!)
      expect(verify.verified).toBe(true)
      expect(verify.exposure_status).toBe('reachable')

      // Kiểm tra cập nhật bảng deployment
      const updatedDeployment = db
        .prepare('SELECT exposure_status, exposure_evidence_json FROM deployment WHERE id = 1')
        .get() as { exposure_status: string; exposure_evidence_json: string }
      expect(updatedDeployment.exposure_status).toBe('reachable')
      expect(JSON.parse(updatedDeployment.exposure_evidence_json).status).toBe('reachable')
    })

    it('thực hiện safe fix nhưng verify thất bại (reconcile trả degraded): ghi action failed, run failed', async () => {
      createPendingRun(1)
      const mockResult: ExposureResult = {
        status: 'degraded',
        url: 'http://1.2.3.4:3000',
        external_probe: 'unreachable',
        ufw_state: 'active',
        ufw_reconciled: true,
        cloud_firewall: 'reconciled',
        diagnosis: {
          code: 'PORT_BLOCKED_EXTERNAL',
          title: 'Port bị chặn từ ngoài',
          cause: 'External probe không thể kết nối',
          fixes: ['Kiểm tra security group']
        },
        checked_at: new Date().toISOString()
      }
      const mockExposureManager: ExposureManager = {
        reconcile: vi.fn().mockResolvedValue(mockResult)
      }

      const service = new DoctorFixService(
        {} as SshManager,
        db,
        mockExposureManager,
        defaultTestOptions
      )
      const result = await service.execute({
        fixId: 'reconcile_firewall',
        deploymentId: 1,
        app: mockApp,
        vps: mockVps
      })

      expect(result.status).toBe('failed')
      expect(result.exposure_status).toBe('degraded')

      const run = doctorRepo.latestForDeployment(1)
      expect(run!.outcome).toBe('failed')

      const actions = doctorRepo.actionsForRun(run!.id)
      expect(actions[0].status).toBe('failed')
      const verify = JSON.parse(actions[0].verify_json!)
      expect(verify.verified).toBe(false)
      expect(verify.exposure_status).toBe('degraded')
    })

    it('che lỗi bằng cả maskSecrets và redactText khi lỗi chứa URL có mật khẩu và Bearer token', async () => {
      createPendingRun(1)
      const rawSecretUrl = 'http://api_admin:superSecretPassword123@internal.cloud.com:8443/v1'
      const rawBearerToken = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secretpayload.sig'
      const mockExposureManager: ExposureManager = {
        reconcile: vi
          .fn()
          .mockRejectedValue(
            new Error(`Failed request to ${rawSecretUrl} with Authorization: ${rawBearerToken}`)
          )
      }

      const service = new DoctorFixService(
        {} as SshManager,
        db,
        mockExposureManager,
        defaultTestOptions
      )
      const result = await service.execute({
        fixId: 'reconcile_firewall',
        deploymentId: 1,
        app: mockApp,
        vps: mockVps
      })

      expect(result.status).toBe('failed')

      // IPC message phải che cả password trong URL và Bearer token
      expect(result.message).not.toContain('superSecretPassword123')
      expect(result.message).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')
      expect(result.message).toContain('http://api_admin:***@internal.cloud.com:8443/v1')
      expect(result.message).toContain('Authorization: Bearer ***')

      const run = doctorRepo.latestForDeployment(1)
      expect(run!.outcome).toBe('failed')

      // DB action result_json phải che cả hai loại secret
      const actions = doctorRepo.actionsForRun(run!.id)
      expect(actions[0].status).toBe('failed')
      const errorResult = JSON.parse(actions[0].result_json!)
      expect(errorResult.error).not.toContain('superSecretPassword123')
      expect(errorResult.error).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')
      expect(errorResult.error).toContain('http://api_admin:***@internal.cloud.com:8443/v1')
      expect(errorResult.error).toContain('Authorization: Bearer ***')
    })
  })

  describe('DoctorRepository action methods', () => {
    it('lưu trữ và truy vấn chuỗi action qua actionsForRun và latestActionForRun', () => {
      const runId = doctorRepo.create({
        deploymentId: 1,
        trigger: 'manual',
        evidence: { step: 'HEALTHCHECK' },
        diagnosis: {
          code: 'PORT_BLOCKED_EXTERNAL',
          title: 'Firewall block',
          confidence: 'high',
          evidence: [],
          fixId: 'reconcile_firewall',
          verifyProbe: 'external_http',
          safeToAutoFix: true,
          abstained: false
        }
      })

      const actionId1 = doctorRepo.createAction({
        doctorRunId: runId,
        actionType: 'check_precondition',
        status: 'running'
      })
      doctorRepo.updateAction(actionId1, {
        status: 'success',
        resultJson: JSON.stringify({ passed: true }),
        finishedAt: new Date().toISOString()
      })

      const actionId2 = doctorRepo.createAction({
        doctorRunId: runId,
        actionType: 'reconcile_firewall',
        status: 'planned'
      })

      const actions = doctorRepo.actionsForRun(runId)
      expect(actions).toHaveLength(2)
      expect(actions[0].id).toBe(actionId1)
      expect(actions[0].status).toBe('success')
      expect(actions[1].id).toBe(actionId2)
      expect(actions[1].status).toBe('planned')

      const latestAction = doctorRepo.latestActionForRun(runId)
      expect(latestAction).not.toBeNull()
      expect(latestAction!.id).toBe(actionId2)
    })
  })
})
