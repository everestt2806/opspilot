import { useEffect, useRef, useState } from 'react'
import { Button, Checkbox, Empty, Input, Select, Space, Tooltip } from 'antd'
import {
  CloseOutlined,
  DeleteOutlined,
  KeyOutlined,
  LinkOutlined,
  PlusOutlined
} from '@ant-design/icons'

import type { DbSchemaColumn, DbSchemaForeignKey, DbSchemaTable } from '@shared/ipc'

import { strings } from '../strings'

const COLUMN_TYPE_OPTIONS = [
  { value: 'TEXT', label: 'TEXT' },
  { value: 'VARCHAR(255)', label: 'VARCHAR(255)' },
  { value: 'INTEGER', label: 'INTEGER' },
  { value: 'BIGINT', label: 'BIGINT' },
  { value: 'REAL', label: 'REAL' },
  { value: 'BOOLEAN', label: 'BOOLEAN' },
  { value: 'TIMESTAMP', label: 'TIMESTAMP' },
  { value: 'SERIAL', label: 'SERIAL' },
  { value: 'UUID', label: 'UUID' }
]

interface Position {
  x: number
  y: number
}

interface DbSchemaDesignerProps {
  tables: DbSchemaTable[]
  onChange: (tables: DbSchemaTable[]) => void
}

interface ConnectFrom {
  tableName: string
  columnName: string
}

const CARD_W = 260
const HEADER_H = 36
const ROW_H = 34

/** Canvas thiết kế schema: card bảng kéo-thả tự do trên vùng vẽ, cột chỉnh inline,
 *  nút chìa khoá bật PK, nút móc xích chọn FK (bấm cột nguồn rồi bấm cột đích bảng khác). */
export function DbSchemaDesigner({ tables, onChange }: DbSchemaDesignerProps): React.JSX.Element {
  const [positions, setPositions] = useState<Record<string, Position>>({})
  const [connectFrom, setConnectFrom] = useState<ConnectFrom | null>(null)
  const dragRef = useRef<{
    table: string
    startX: number
    startY: number
    origX: number
    origY: number
  } | null>(null)

  useEffect(() => {
    if (!connectFrom) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setConnectFrom(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [connectFrom])

  const cardIndex = (name: string): number =>
    Math.max(
      0,
      tables.findIndex((t) => t.name === name)
    )
  const defaultPos = (name: string): Position => {
    const i = cardIndex(name)
    return { x: 24 + (i % 3) * (CARD_W + 24), y: 24 + Math.floor(i / 3) * 170 }
  }
  const posOf = (name: string): Position => positions[name] ?? defaultPos(name)

  const uniqueName = (prefix: string): string => {
    let n = tables.length + 1
    while (tables.some((t) => t.name === `${prefix}_${n}`)) n += 1
    return `${prefix}_${n}`
  }

  const updateTable = (name: string, patch: Partial<DbSchemaTable>): void => {
    onChange(tables.map((t) => (t.name === name ? { ...t, ...patch } : t)))
  }

  const updateColumn = (
    tableName: string,
    colName: string,
    patch: Partial<DbSchemaColumn>
  ): void => {
    onChange(
      tables.map((t) =>
        t.name === tableName
          ? { ...t, columns: t.columns.map((c) => (c.name === colName ? { ...c, ...patch } : c)) }
          : t
      )
    )
  }

  const addTable = (): void => {
    const name = uniqueName('table')
    onChange([
      ...tables,
      {
        name,
        columns: [
          {
            name: 'id',
            data_type: 'SERIAL',
            nullable: false,
            primary_key: true,
            default_value: null
          }
        ],
        foreign_keys: []
      }
    ])
  }

  const removeTable = (name: string): void => {
    onChange(
      tables
        .filter((t) => t.name !== name)
        .map((t) => ({
          ...t,
          foreign_keys: t.foreign_keys.filter((fk) => fk.ref_table !== name)
        }))
    )
  }

  const addColumn = (tableName: string): void => {
    const existing = tables.reduce((sum, t) => sum + t.columns.length, 0)
    updateTable(tableName, {
      columns: [
        ...(tables.find((t) => t.name === tableName)?.columns ?? []),
        {
          name: `column_${existing + 1}`,
          data_type: 'TEXT',
          nullable: true,
          primary_key: false,
          default_value: null
        }
      ]
    })
  }

  const removeColumn = (tableName: string, colName: string): void => {
    onChange(
      tables.map((t) => {
        if (t.name !== tableName) {
          return {
            ...t,
            foreign_keys: t.foreign_keys.filter(
              (fk) => !(fk.ref_table === tableName && fk.ref_column === colName)
            )
          }
        }
        return { ...t, columns: t.columns.filter((c) => c.name !== colName) }
      })
    )
  }

  const toggleSource = (tableName: string, columnName: string): void => {
    setConnectFrom((prev) =>
      prev && prev.tableName === tableName && prev.columnName === columnName
        ? null
        : { tableName, columnName }
    )
  }

  const targetColumn = (tableName: string, columnName: string): void => {
    if (!connectFrom) return
    const source = connectFrom
    setConnectFrom(null)
    if (source.tableName === tableName && source.columnName === columnName) return
    onChange(
      tables.map((t) => {
        if (t.name !== source.tableName) return t
        const foreign_keys: DbSchemaForeignKey[] = [
          ...t.foreign_keys.filter((fk) => fk.column_name !== source.columnName),
          { column_name: source.columnName, ref_table: tableName, ref_column: columnName }
        ]
        return { ...t, foreign_keys }
      })
    )
  }

  const removeFk = (tableName: string, fk: DbSchemaForeignKey): void => {
    updateTable(tableName, {
      foreign_keys: tables
        .find((t) => t.name === tableName)
        ?.foreign_keys.filter((f) => f.column_name !== fk.column_name)
    })
  }

  const onHeadPointerDown = (event: React.PointerEvent<HTMLDivElement>, name: string): void => {
    if (event.button !== 0) return
    const orig = posOf(name)
    dragRef.current = {
      table: name,
      startX: event.clientX,
      startY: event.clientY,
      origX: orig.x,
      origY: orig.y
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const onHeadPointerMove = (event: React.PointerEvent<HTMLDivElement>, name: string): void => {
    const drag = dragRef.current
    if (!drag || drag.table !== name) return
    setPositions((prev) => ({
      ...prev,
      [name]: {
        x: drag.origX + event.clientX - drag.startX,
        y: drag.origY + event.clientY - drag.startY
      }
    }))
  }

  const onHeadPointerUp = (): void => {
    dragRef.current = null
  }

  const lines = tables
    .flatMap((table) => {
      const fromPos = posOf(table.name)
      return table.foreign_keys.map((fk) => {
        const sourceIdx = table.columns.findIndex((c) => c.name === fk.column_name)
        const targetTable = tables.find((t) => t.name === fk.ref_table)
        const targetIdx = targetTable?.columns.findIndex((c) => c.name === fk.ref_column) ?? -1
        if (sourceIdx < 0 || !targetTable || targetIdx < 0) return null
        const toPos = posOf(targetTable.name)
        return {
          key: `${table.name}.${fk.column_name}->${fk.ref_table}.${fk.ref_column}`,
          x1: fromPos.x + CARD_W,
          y1: fromPos.y + HEADER_H + sourceIdx * ROW_H + ROW_H / 2,
          x2: toPos.x,
          y2: toPos.y + HEADER_H + targetIdx * ROW_H + ROW_H / 2
        }
      })
    })
    .filter((line): line is NonNullable<typeof line> => line !== null)

  return (
    <div className="db-schema-wrap">
      <div className="db-tab-toolbar">
        <Button icon={<PlusOutlined />} onClick={addTable}>
          {strings.vpsControl.database.addTable}
        </Button>
        {connectFrom && (
          <Button type="link" onClick={() => setConnectFrom(null)}>
            {strings.vpsControl.database.connectCancel}
          </Button>
        )}
      </div>

      <div className="db-schema-canvas">
        <div className="db-schema-inner">
          <svg className="db-schema-lines" width={1000} height={640}>
            {lines.map((line) => (
              <line
                key={line.key}
                x1={line.x1}
                y1={line.y1}
                x2={line.x2}
                y2={line.y2}
                stroke="var(--info)"
                strokeWidth={1.5}
              />
            ))}
          </svg>

          {tables.length === 0 && (
            <Empty style={{ marginTop: 160 }} description={strings.vpsControl.database.noTables}>
              <Button type="primary" icon={<PlusOutlined />} onClick={addTable}>
                {strings.vpsControl.database.addTable}
              </Button>
            </Empty>
          )}

          {tables.map((table) => {
            const pos = posOf(table.name)
            return (
              <div
                key={table.name}
                className="db-schema-card"
                data-table={table.name}
                style={{ left: pos.x, top: pos.y }}
              >
                <div
                  className="db-schema-card-head"
                  onPointerDown={(event) => onHeadPointerDown(event, table.name)}
                  onPointerMove={(event) => onHeadPointerMove(event, table.name)}
                  onPointerUp={onHeadPointerUp}
                >
                  <span className="db-schema-table-name mono-text">{table.name}</span>
                  <Space size={2}>
                    <Tooltip title={strings.vpsControl.database.addColumn}>
                      <Button
                        size="small"
                        type="text"
                        icon={<PlusOutlined />}
                        aria-label={strings.vpsControl.database.addColumn}
                        onClick={() => addColumn(table.name)}
                      />
                    </Tooltip>
                    <Tooltip title={strings.vpsControl.database.deleteTable}>
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        aria-label={strings.vpsControl.database.deleteTable}
                        onClick={() => removeTable(table.name)}
                      />
                    </Tooltip>
                  </Space>
                </div>

                <div className="db-schema-cols">
                  {table.columns.map((col) => {
                    const fk = table.foreign_keys.find((f) => f.column_name === col.name)
                    const isSource =
                      connectFrom?.tableName === table.name && connectFrom.columnName === col.name
                    const isLinkable = connectFrom !== null && !isSource
                    return (
                      <div
                        key={col.name}
                        className={
                          'db-schema-col' +
                          (isLinkable ? ' db-schema-col-linkable' : '') +
                          (isSource ? ' db-schema-col-source' : '')
                        }
                        onClick={isLinkable ? () => targetColumn(table.name, col.name) : undefined}
                      >
                        <Tooltip title={strings.vpsControl.database.primaryKey}>
                          <Button
                            size="small"
                            type={col.primary_key ? 'primary' : 'text'}
                            icon={<KeyOutlined />}
                            aria-label={`${strings.vpsControl.database.primaryKey}: ${table.name}.${col.name}`}
                            onClick={(event) => {
                              event.stopPropagation()
                              updateColumn(table.name, col.name, { primary_key: !col.primary_key })
                            }}
                          />
                        </Tooltip>
                        <Input
                          size="small"
                          value={col.name}
                          aria-label={`${strings.vpsControl.database.columnName}: ${table.name}`}
                          onChange={(event) =>
                            updateColumn(table.name, col.name, { name: event.target.value })
                          }
                        />
                        <Select
                          size="small"
                          variant="borderless"
                          style={{ width: 84 }}
                          value={col.data_type}
                          options={COLUMN_TYPE_OPTIONS}
                          onChange={(value) =>
                            updateColumn(table.name, col.name, { data_type: value })
                          }
                        />
                        <Tooltip title={strings.vpsControl.database.nullable}>
                          <Checkbox
                            checked={col.nullable}
                            aria-label={strings.vpsControl.database.nullable}
                            onChange={(event) =>
                              updateColumn(table.name, col.name, { nullable: event.target.checked })
                            }
                          />
                        </Tooltip>
                        <Tooltip title={strings.vpsControl.database.foreignKey}>
                          <Button
                            size="small"
                            type={isSource ? 'primary' : 'text'}
                            icon={<LinkOutlined />}
                            aria-label={`${strings.vpsControl.database.foreignKey}: ${table.name}.${col.name}`}
                            onClick={(event) => {
                              event.stopPropagation()
                              toggleSource(table.name, col.name)
                            }}
                          />
                        </Tooltip>
                        <Tooltip title={strings.vpsControl.database.deleteColumn}>
                          <Button
                            size="small"
                            type="text"
                            danger
                            icon={<CloseOutlined />}
                            aria-label={strings.vpsControl.database.deleteColumn}
                            onClick={(event) => {
                              event.stopPropagation()
                              removeColumn(table.name, col.name)
                            }}
                          />
                        </Tooltip>
                        {fk && (
                          <span
                            className="db-fk-badge mono-text"
                            title={`${fk.ref_table}.${fk.ref_column}`}
                            onClick={(event) => {
                              event.stopPropagation()
                              removeFk(table.name, fk)
                            }}
                          >
                            →{fk.ref_table}.{fk.ref_column}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
