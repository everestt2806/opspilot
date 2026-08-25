import { useEffect, useRef, useState } from 'react'
import { CopyOutlined, SearchOutlined, VerticalAlignBottomOutlined } from '@ant-design/icons'
import { Button, Input, Space, Typography } from 'antd'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'

import { strings } from '../strings'
import type { DeployStep } from '@shared/ipc'

interface DeployTerminalProps {
  buffer: string
  activeStep?: DeployStep
  completedSteps: number
  status: 'streaming' | 'success' | 'failed'
}

export function DeployTerminal({
  buffer,
  activeStep,
  completedSteps,
  status
}: DeployTerminalProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const writtenRef = useRef(0)
  const scrolledUpRef = useRef(false)
  const [scrolledUp, setScrolledUp] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchText, setSearchText] = useState('')

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const term = new Terminal({
      disableStdin: true,
      cursorBlink: false,
      convertEol: true,
      fontSize: 12,
      fontFamily: "Consolas, 'Courier New', monospace",
      lineHeight: 1.25,
      scrollback: 5000,
      theme: {
        background: '#0B0E14',
        foreground: '#D7DBE4',
        cursor: '#60A5FA'
      }
    })
    const fit = new FitAddon()
    const search = new SearchAddon()
    term.loadAddon(fit)
    term.loadAddon(search)
    term.open(container)
    fit.fit()
    termRef.current = term
    searchRef.current = search

    const viewport = container.querySelector<HTMLElement>('.xterm-viewport')
    function handleScroll(): void {
      const el = viewport
      if (!el) return
      const up = el.scrollTop + el.clientHeight < el.scrollHeight - 24
      scrolledUpRef.current = up
      setScrolledUp(up)
    }
    viewport?.addEventListener('scroll', handleScroll)
    function handleResize(): void {
      fit.fit()
    }
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => fit.fit())
    resizeObserver?.observe(container)
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      resizeObserver?.disconnect()
      viewport?.removeEventListener('scroll', handleScroll)
      term.dispose()
      termRef.current = null
      searchRef.current = null
    }
  }, [])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    if (buffer.length > writtenRef.current) {
      term.write(buffer.slice(writtenRef.current))
      writtenRef.current = buffer.length
    }
    if (!scrolledUpRef.current) term.scrollToBottom()
  }, [buffer])

  function handleCopy(): void {
    const selection = termRef.current?.getSelection()
    const text = selection && selection.length > 0 ? selection : buffer
    if (navigator.clipboard) void navigator.clipboard.writeText(text)
  }

  function handleSearch(): void {
    if (!searchText) return
    searchRef.current?.findNext(searchText, { caseSensitive: false })
  }

  function handleScrollDown(): void {
    termRef.current?.scrollToBottom()
  }

  return (
    <div className="deploy-terminal-wrap">
      <div className="deploy-terminal-toolbar">
        <div className="deploy-terminal-heading">
          <span
            className={`deploy-terminal-live-dot deploy-terminal-live-dot-${status}`}
            aria-hidden="true"
          />
          <span className="deploy-terminal-title">{strings.deploy.log.liveOutput}</span>
          <span className="deploy-terminal-progress">
            {activeStep ?? strings.deploy.log.finished} · {completedSteps}/7
          </span>
        </div>
        <Space size={4} className="deploy-terminal-actions">
          <Button size="small" icon={<CopyOutlined />} onClick={handleCopy}>
            {strings.deploy.log.toolbar.copy}
          </Button>
          <Button
            size="small"
            type={searchOpen ? 'primary' : 'default'}
            icon={<SearchOutlined />}
            onClick={() => setSearchOpen((open) => !open)}
          >
            {strings.deploy.log.toolbar.search}
          </Button>
          {searchOpen && (
            <Input
              size="small"
              autoFocus
              allowClear
              placeholder={strings.deploy.log.toolbar.searchPlaceholder}
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              onPressEnter={handleSearch}
            />
          )}
        </Space>
      </div>
      <div className="deploy-terminal-xterm" ref={containerRef} />
      {buffer.length === 0 && (
        <Typography.Text type="secondary" className="deploy-terminal-empty">
          {strings.deploy.log.empty}
        </Typography.Text>
      )}
      {scrolledUp && (
        <Button
          size="small"
          className="deploy-terminal-scrolldown"
          icon={<VerticalAlignBottomOutlined />}
          onClick={handleScrollDown}
        >
          {strings.deploy.log.scrollDown}
        </Button>
      )}
    </div>
  )
}
