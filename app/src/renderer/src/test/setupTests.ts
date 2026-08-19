// Polyfill các API trình duyệt mà antd cần trong jsdom — chỉ cho component test
// renderer. Chạy trong mọi test file (kể cả node) nên phải guard `window`.
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// vitest đang để `globals: false` nên RTL không tự đăng ký auto-cleanup.
if (typeof document !== 'undefined') {
  afterEach(cleanup)
}

if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string): MediaQueryList =>
        ({
          matches: false,
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false
        }) as MediaQueryList
    })
  }

  if (!window.ResizeObserver) {
    const resizeObserverStub = class {
      observe = (): void => undefined
      unobserve = (): void => undefined
      disconnect = (): void => undefined
    }
    Object.defineProperty(window, 'ResizeObserver', { writable: true, value: resizeObserverStub })
  }

  if (!window.getComputedStyle) {
    Object.defineProperty(window, 'getComputedStyle', {
      writable: true,
      value: () => ({}) as CSSStyleDeclaration
    })
  }
}
