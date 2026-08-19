import type { DetectionResult, DetectionSignal, Detector, FrameworkId, SourceTree } from './types'

import { expressDetector } from './express'

/**
 * Lát cắt TK-A13 chỉ có detector express (đủ cho demo express-api).
 * nextjs/static-spa/flask bổ sung ở TK-A7 (M3 đầy đủ) — thêm 1 file + 1 dòng vào mảng.
 */
export const DETECTORS: Detector[] = [expressDetector]

const EMPTY_SIGNALS: Record<FrameworkId, DetectionSignal[]> = {
  nextjs: [],
  express: [],
  'static-spa': [],
  flask: []
}

export function detectFramework(tree: SourceTree): DetectionResult {
  const ordered = [...DETECTORS].sort((left, right) => right.priority - left.priority)
  let matched: Detector | undefined

  for (const detector of ordered) {
    if (detector.detect(tree)) {
      matched = detector
      break
    }
  }

  if (matched) {
    const alternatives = ordered
      .filter((detector) => detector !== matched && detector.detect(tree))
      .map((detector) => detector.id)

    return {
      matched: true,
      detector: matched.id,
      displayName: matched.displayName,
      plan: matched.buildPlan(tree),
      alternatives
    }
  }

  const signals: Record<FrameworkId, DetectionSignal[]> = { ...EMPTY_SIGNALS }
  for (const detector of ordered) {
    signals[detector.id] = detector.explain(tree)
  }

  return {
    matched: false,
    signals,
    hint:
      'Không nhận diện được framework. Thư mục cần package.json có dependency next/vite/express ' +
      '(hoặc requirements.txt có flask). Xem dấu hiệu đã kiểm tra ở từng detector.'
  }
}
