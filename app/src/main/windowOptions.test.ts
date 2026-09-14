import { describe, expect, it } from 'vitest'

import { getMainWindowOptions } from './windowOptions'

describe('native Windows window options', () => {
  it('uses native overlay and Mica on Windows', () => {
    const options = getMainWindowOptions('preload.js', 'icon.png', 'win32')

    expect(options.frame).toBeUndefined()
    expect(options.titleBarStyle).toBe('hidden')
    expect(options.titleBarOverlay).toEqual({
      color: '#181818',
      symbolColor: '#CCCCCC',
      height: 34
    })
    expect(options.backgroundMaterial).toBe('mica')
    expect(options.backgroundColor).toBe('#1E1E1E')
  })

  it('keeps a safe non-Windows fallback', () => {
    const options = getMainWindowOptions('preload.js', 'icon.png', 'linux')

    expect(options.titleBarOverlay).toBe(false)
    expect(options.backgroundMaterial).toBe('none')
  })
})
