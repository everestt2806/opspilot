export interface ProjectItem {
  id: string
  name: string
  framework: string
  currentVersion: string
  vpsHost: string
  status: 'online' | 'offline' | 'deploying'
  lastDeployedAt: string
}

export type StepKey =
  'PRECHECK' | 'UPLOAD' | 'RENDER' | 'BUILD' | 'DEPLOY' | 'HEALTHCHECK' | 'RECORD'

export type StepStatus = 'completed' | 'in_progress' | 'error' | 'pending'

export interface PipelineStep {
  key: StepKey
  durationSec?: number
  status: StepStatus
  errorMessage?: string
}

export interface AnomalyAlert {
  id: string
  timestamp: string
  methodKey: 'rule' | 'zscore_ewma' | 'iforest' | 'ocsvm' | 'ensemble'
  methodName: string
  metricName: string
  anomalyScore: number
  feedback?: 'correct' | 'wrong'
}

export const mockProjects: ProjectItem[] = [
  {
    id: 'proj-1',
    name: 'e-commerce-backend',
    framework: 'Node.js / Express',
    currentVersion: 'v2.1.0',
    vpsHost: '192.168.1.10',
    status: 'online',
    lastDeployedAt: '10 minutes ago'
  },
  {
    id: 'proj-2',
    name: 'react-admin-dashboard',
    framework: 'React / Vite',
    currentVersion: 'v1.4.2',
    vpsHost: '192.168.1.10',
    status: 'online',
    lastDeployedAt: '2 hours ago'
  },
  {
    id: 'proj-3',
    name: 'python-ml-analytics',
    framework: 'Python / FastApi',
    currentVersion: 'v0.9.1',
    vpsHost: '192.168.1.12',
    status: 'offline',
    lastDeployedAt: '1 day ago'
  }
]

// Pipeline Mock State 1: SUCCESS Scenario (Building & Successfully Done)
export const mockPipelineSuccess: PipelineStep[] = [
  { key: 'PRECHECK', durationSec: 2, status: 'completed' },
  { key: 'UPLOAD', durationSec: 12, status: 'completed' },
  { key: 'RENDER', durationSec: 4, status: 'completed' },
  { key: 'BUILD', durationSec: 45, status: 'completed' },
  { key: 'DEPLOY', durationSec: 8, status: 'completed' },
  { key: 'HEALTHCHECK', durationSec: 3, status: 'completed' },
  { key: 'RECORD', durationSec: 1, status: 'completed' }
]

// Pipeline Mock State 2: IN PROGRESS Scenario (Currently Building)
export const mockPipelineInProgress: PipelineStep[] = [
  { key: 'PRECHECK', durationSec: 2, status: 'completed' },
  { key: 'UPLOAD', durationSec: 12, status: 'completed' },
  { key: 'RENDER', durationSec: 4, status: 'completed' },
  { key: 'BUILD', status: 'in_progress' },
  { key: 'DEPLOY', status: 'pending' },
  { key: 'HEALTHCHECK', status: 'pending' },
  { key: 'RECORD', status: 'pending' }
]

// Pipeline Mock State 3: ERROR Scenario (Failed at BUILD stage)
export const mockPipelineError: PipelineStep[] = [
  { key: 'PRECHECK', durationSec: 2, status: 'completed' },
  { key: 'UPLOAD', durationSec: 12, status: 'completed' },
  { key: 'RENDER', durationSec: 4, status: 'completed' },
  {
    key: 'BUILD',
    status: 'error',
    errorMessage: 'Docker build failed: Error compiling TypeScript source files in step 4/9.'
  },
  { key: 'DEPLOY', status: 'pending' },
  { key: 'HEALTHCHECK', status: 'pending' },
  { key: 'RECORD', status: 'pending' }
]

export const mockTerminalLogs = `[2026-08-13 16:30:01] INFO: Initiating deployment pipeline for project: e-commerce-backend (v2.1.0)...
[2026-08-13 16:30:02] SUCCESS: Step [PRECHECK] completed. RAM available: 2.8GB/4GB (OK), Disk: 34GB (OK), Port 3000 (OK).
[2026-08-13 16:30:14] SUCCESS: Step [UPLOAD] completed. Transferred 14.2 MB archive to /opt/opspilot/apps/e-commerce-backend in 12s.
[2026-08-13 16:30:18] SUCCESS: Step [RENDER] completed. Dockerfile template generated successfully.
[2026-08-13 16:30:19] INFO: Executing [BUILD] step: docker build -t opspilot/e-commerce-backend:v2.1.0 .
[2026-08-13 16:30:22] Step 1/8 : FROM node:20-alpine AS builder
[2026-08-13 16:30:25] Step 2/8 : WORKDIR /app
[2026-08-13 16:30:28] Step 3/8 : COPY package*.json ./
[2026-08-13 16:30:35] Step 4/8 : RUN npm ci --omit=dev
[2026-08-13 16:30:45] Step 5/8 : COPY . .
[2026-08-13 16:30:52] Step 6/8 : EXPOSE 3000
[2026-08-13 16:31:00] Step 7/8 : CMD ["node", "dist/main.js"]
[2026-08-13 16:31:04] SUCCESS: Successfully built image opspilot/e-commerce-backend:v2.1.0.
[2026-08-13 16:31:12] SUCCESS: Step [DEPLOY] completed. Container started on port 3000.
[2026-08-13 16:31:15] SUCCESS: Step [HEALTHCHECK] completed. HTTP 200 OK from http://192.168.1.10:3000/health.
[2026-08-13 16:31:16] SUCCESS: Step [RECORD] completed. Version v2.1.0 recorded in SQLite deployment history.`

export const mockDashboardTimeSeries = Array.from({ length: 15 }, (_, i) => {
  const timeLabel = `${16 + Math.floor(i / 60)}:${(i * 2) % 60 < 10 ? '0' : ''}${(i * 2) % 60}`
  const isAnomalyPoint = i === 11
  return {
    time: timeLabel,
    cpu: isAnomalyPoint ? 88.4 : 32 + Math.floor(Math.sin(i) * 10),
    ram: isAnomalyPoint ? 3420 : 1420 + i * 45,
    latency: isAnomalyPoint ? 340 : 42 + (i % 3) * 5,
    // Colored event markers for the ML methods triggered at specific timestamps
    anomalyEvent: isAnomalyPoint ? 'ocsvm' : i === 7 ? 'iforest' : i === 5 ? 'zscore_ewma' : null
  }
})

export const mockDetectionMethods = [
  {
    key: 'rule',
    name: 'Rule Baseline',
    color: '#9AA3B2',
    score: 0.12,
    status: 'Normal',
    isTrusted: false
  },
  {
    key: 'zscore_ewma',
    name: 'Z-Score EWMA',
    color: '#60A5FA',
    score: 0.45,
    status: 'Normal',
    isTrusted: false
  },
  {
    key: 'iforest',
    name: 'Isolation Forest',
    color: '#A78BFA',
    score: 0.88,
    status: '⚠ ANOMALY',
    isTrusted: true
  },
  {
    key: 'ocsvm',
    name: 'One-Class SVM',
    color: '#F472B6',
    score: 0.79,
    status: '⚠ ANOMALY',
    isTrusted: false
  },
  {
    key: 'ensemble',
    name: 'Ensemble Method',
    color: '#34D399',
    score: 0.82,
    status: '⚠ ANOMALY',
    isTrusted: true
  }
]

export const mockInitialAlerts: AnomalyAlert[] = [
  {
    id: 'alt-101',
    timestamp: '2 minutes ago',
    methodKey: 'iforest',
    methodName: 'Isolation Forest',
    metricName: 'RAM Spike (3,420 MB > Threshold)',
    anomalyScore: 0.88
  },
  {
    id: 'alt-102',
    timestamp: '14 minutes ago',
    methodKey: 'ocsvm',
    methodName: 'One-Class SVM',
    metricName: 'Latency Anomaly (340 ms)',
    anomalyScore: 0.79
  },
  {
    id: 'alt-103',
    timestamp: '28 minutes ago',
    methodKey: 'zscore_ewma',
    methodName: 'Z-Score EWMA',
    metricName: 'CPU Usage Jump (88.4%)',
    anomalyScore: 0.65
  }
]
