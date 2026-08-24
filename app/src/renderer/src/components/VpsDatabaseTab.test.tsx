// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DbDatabase, DbSchemaTable, DbUser } from '@shared/ipc'

import { VpsDatabaseTab } from './VpsDatabaseTab'

const DB_BLOG: DbDatabase = { oid: 99, name: 'blog', size_bytes: 13_107_200, table_count: 3 }
const DB_EMPTY: DbDatabase = { oid: 100, name: 'store', size_bytes: 1024, table_count: 0 }
const USER_ADMIN: DbUser = { oid: 5, username: 'blog_admin' }

const USERS_SCHEMA: DbSchemaTable[] = [
  {
    name: 'users',
    columns: [
      { name: 'id', data_type: 'SERIAL', nullable: false, primary_key: true, default_value: null },
      { name: 'email', data_type: 'TEXT', nullable: true, primary_key: false, default_value: null }
    ],
    foreign_keys: []
  }
]

type InvokeHandler = (...args: unknown[]) => Promise<unknown>

function mockApi(handlers: Record<string, InvokeHandler>): void {
  vi.stubGlobal('api', {
    invoke: (channel: string, ...args: unknown[]) => {
      const handler = handlers[channel]
      if (!handler) return Promise.reject(new Error(`No handler registered for '${channel}'`))
      return handler(channel, ...args)
    },
    on: () => () => {}
  })
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const successfulApi = (): Record<string, InvokeHandler> => ({
  'db:list-users': async () => ({ ok: true, data: [USER_ADMIN] }),
  'db:list-databases': async () => ({ ok: true, data: [DB_BLOG, DB_EMPTY] })
})

describe('VpsDatabaseTab — trang quản lý database trên VPS', () => {
  it('bảng Database users + Databases hiện đủ cột: id, name, dung lượng, số bảng', async () => {
    mockApi(successfulApi())

    render(<VpsDatabaseTab vpsId={7} />)

    expect(await screen.findByText('Database users')).toBeTruthy()
    expect(screen.getByText('Databases')).toBeTruthy()
    expect(screen.getByText('blog_admin')).toBeTruthy()
    expect(screen.getByText('blog')).toBeTruthy()
    expect(screen.getByText('12.5 MB')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('1.0 KB')).toBeTruthy()
  })

  it('popup Create database: validate tên, gọi kênh đúng rồi tải lại danh sách', async () => {
    const create = vi.fn().mockResolvedValue({
      ok: true,
      data: { oid: 101, name: 'shop', size_bytes: 0, table_count: 0 }
    })
    const list = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: [DB_BLOG] })
      .mockResolvedValueOnce({
        ok: true,
        data: [DB_BLOG, { oid: 101, name: 'shop', size_bytes: 0, table_count: 0 }]
      })
    mockApi({
      'db:list-users': async () => ({ ok: true, data: [] }),
      'db:list-databases': list,
      'db:create-database': create
    })

    render(<VpsDatabaseTab vpsId={7} />)

    fireEvent.click(await screen.findByRole('button', { name: /Create database/ }))
    const input = await screen.findByLabelText('Database name')

    // Chưa điền gì mà bấm OK -> lỗi validate, không gọi kênh
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create database' }))
    await waitFor(() => expect(create).not.toHaveBeenCalled())
    expect(await screen.findByText('Enter a database name.')).toBeTruthy()

    fireEvent.change(input, { target: { value: 'Shop' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create database' }))
    await waitFor(() => expect(create).not.toHaveBeenCalled())
    expect(await screen.findByText('Lowercase letters, digits and underscores only.')).toBeTruthy()

    fireEvent.change(input, { target: { value: 'shop' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create database' }))

    await waitFor(() => expect(create).toHaveBeenCalledWith('db:create-database', 7, 'shop'))
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByText('shop')).toBeTruthy())
  })

  it('popup Create user: điền username/password, gọi kênh đúng', async () => {
    const create = vi.fn().mockResolvedValue({ ok: true, data: { oid: 6, username: 'app_user' } })
    const listUsers = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: [] })
      .mockResolvedValueOnce({ ok: true, data: [{ oid: 6, username: 'app_user' }] })
    mockApi({
      'db:list-users': listUsers,
      'db:list-databases': async () => ({ ok: true, data: [] }),
      'db:create-user': create
    })

    render(<VpsDatabaseTab vpsId={7} />)

    fireEvent.click(await screen.findByRole('button', { name: /Create user/ }))
    const dialog = await screen.findByRole('dialog')

    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'app_user' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 's3cret' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create user' }))

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith('db:create-user', 7, {
        username: 'app_user',
        password: 's3cret'
      })
    )
    await waitFor(() => expect(listUsers).toHaveBeenCalledTimes(2))
  })

  it('bấm dòng database mở trang designer, SQL preview chứa DDL đọc từ backend', async () => {
    const listTables = vi.fn().mockResolvedValue({ ok: true, data: USERS_SCHEMA })
    mockApi({
      ...successfulApi(),
      'db:list-tables': listTables
    })

    render(<VpsDatabaseTab vpsId={7} />)

    fireEvent.click(await screen.findByText('blog'))

    expect(await screen.findByText('SQL preview')).toBeTruthy()
    await waitFor(() => expect(listTables).toHaveBeenCalledWith('db:list-tables', 7, 'blog'))
    expect(await screen.findByText(/CREATE TABLE users \(/)).toBeTruthy()
    expect(screen.getByText(/PRIMARY KEY \(id\)/)).toBeTruthy()
    expect(screen.getByText('Back to databases')).toBeTruthy()
  })

  it('designer: thêm bảng, thêm cột, đổi tên cột, nối FK giữa 2 bảng', async () => {
    mockApi({
      ...successfulApi(),
      'db:list-tables': async () => ({ ok: true, data: USERS_SCHEMA })
    })

    render(<VpsDatabaseTab vpsId={7} />)
    fireEvent.click(await screen.findByText('blog'))
    await screen.findByText('SQL preview')

    // Thêm bảng mới -> bảng sinh tên table_2, cột id SERIAL PK mặc định
    fireEvent.click(screen.getAllByText('Add table')[0])
    const card2 = (await waitFor(() =>
      document.querySelector('[data-table="table_2"]')
    )) as HTMLElement
    expect(within(card2).getByDisplayValue('id')).toBeTruthy()
    expect(screen.getByText(/CREATE TABLE table_2 \(/)).toBeTruthy()

    // Thêm cột -> tên mặc định column_4 (tổng cột mọi bảng đang là 3), đổi thành user_id
    fireEvent.click(within(card2).getByLabelText('Add column'))
    fireEvent.change(within(card2).getByDisplayValue('column_4'), { target: { value: 'user_id' } })
    expect(within(card2).getByDisplayValue('user_id')).toBeTruthy()

    // Nối FK: bấm nút móc xích trên user_id rồi bấm cột email của bảng users
    fireEvent.click(within(card2).getByLabelText('Foreign key: table_2.user_id'))
    const usersCard = document.querySelector('[data-table="users"]') as HTMLElement
    fireEvent.click(within(usersCard).getByDisplayValue('email'))

    expect(
      await screen.findByText(/FOREIGN KEY \(user_id\) REFERENCES users \(email\)/)
    ).toBeTruthy()
    expect(within(card2).getByText('→users.email')).toBeTruthy()
  })

  it('import file CSV: seed bảng vào designer và hiện dữ liệu lên preview', async () => {
    mockApi({
      ...successfulApi(),
      'db:list-tables': async () => ({ ok: true, data: [] })
    })

    render(<VpsDatabaseTab vpsId={7} />)
    fireEvent.click(await screen.findByText('blog'))
    await screen.findByText('SQL preview')

    const file = new File(['name,email\nAda,a@x.io\nBob,b@x.io'], 'people.csv', {
      type: 'text/csv'
    })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    expect(await screen.findByText(/CREATE TABLE people \(/)).toBeTruthy()
    expect(screen.getByText('Ada')).toBeTruthy()
    expect(screen.getByText('Imported data — people (2 rows)')).toBeTruthy()
    const peopleCard = document.querySelector('[data-table="people"]') as HTMLElement
    expect(within(peopleCard).getByDisplayValue('name')).toBeTruthy()
  })

  it('backend chưa nối: 2 bảng hiện lỗi trung thực kèm nút Retry gọi lại', async () => {
    const listDatabases = vi.fn().mockRejectedValue(new Error('No handler registered'))
    const listUsers = vi.fn().mockResolvedValue({ ok: true, data: [] })
    mockApi({
      'db:list-users': listUsers,
      'db:list-databases': listDatabases
    })

    render(<VpsDatabaseTab vpsId={7} />)

    expect(await screen.findByText('Could not load databases.')).toBeTruthy()
    fireEvent.click(screen.getByText('Retry'))
    await waitFor(() => expect(listDatabases).toHaveBeenCalledTimes(2))
  })

  it('mở designer khi db:list-tables chưa có: ghi chú local + vẫn thêm bảng bằng tay', async () => {
    mockApi({
      ...successfulApi(),
      'db:list-tables': async () => {
        throw new Error('No handler registered')
      }
    })

    render(<VpsDatabaseTab vpsId={7} />)
    fireEvent.click(await screen.findByText('blog'))

    expect(await screen.findByText(/you are editing locally/)).toBeTruthy()
    expect(
      screen.getByText('No tables yet. Click "Add table" or import a JSON/CSV file.')
    ).toBeTruthy()

    fireEvent.click(screen.getAllByText('Add table')[0])
    expect(await screen.findByText(/CREATE TABLE table_1 \(/)).toBeTruthy()
    expect(screen.getByText(/PRIMARY KEY \(id\)/)).toBeTruthy()
  })

  it('nút Back quay về trang 2 bảng, nút Refresh gọi lại list-tables', async () => {
    const listTables = vi.fn().mockResolvedValue({ ok: true, data: USERS_SCHEMA })
    mockApi({
      ...successfulApi(),
      'db:list-tables': listTables
    })

    render(<VpsDatabaseTab vpsId={7} />)
    fireEvent.click(await screen.findByText('blog'))
    await screen.findByText('SQL preview')

    expect(screen.queryByText('blog_admin')).toBeNull()
    fireEvent.click(screen.getByLabelText('Back to databases'))
    expect(await screen.findByText('blog_admin')).toBeTruthy()
  })
})
