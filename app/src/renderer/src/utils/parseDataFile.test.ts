// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { exportTableCsv, parseCsvImport, parseJsonImport } from './parseDataFile'

describe('parseDataFile', () => {
  it('parse JSON array of objects', () => {
    const tables = parseJsonImport('[{"id":1,"name":"a"},{"id":2,"name":"b"}]', 'users')
    expect(tables[0].name).toBe('users')
    expect(tables[0].columns).toEqual(['id', 'name'])
    expect(tables[0].rows).toHaveLength(2)
  })

  it('parse CSV with header', () => {
    const tables = parseCsvImport('id,name\n1,foo\n2,bar')
    expect(tables[0].rows).toHaveLength(2)
    expect(exportTableCsv(tables[0])).toContain('foo')
  })
})
