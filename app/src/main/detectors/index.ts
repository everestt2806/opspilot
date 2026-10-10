import type { DetectionResult, DetectionSignal, Detector, FrameworkId, SourceTree } from './types'

import { expressDetector } from './express'
import { nextjsDetector } from './nextjs'
import { staticSpaDetector } from './static-spa'

/**
 * Registry tĩnh giúp thêm template bằng một detector + fixture contract test. Flask vẫn giữ trong
 * contract để tương thích dữ liệu cũ nhưng chưa được công bố cho tới khi gate ML chính thức đạt.
 */
export const DETECTORS: Detector[] = [nextjsDetector, staticSpaDetector, expressDetector]

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
      'Không nhận diện được framework. Thư mục cần package.json có dependency next/vite/express. ' +
      'Xem dấu hiệu đã kiểm tra ở từng detector.'
  }
}
