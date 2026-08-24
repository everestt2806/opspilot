import { useState } from 'react'
import {
  AppstoreOutlined,
  CloudServerOutlined,
  PlusOutlined,
  RocketOutlined,
  SearchOutlined
} from '@ant-design/icons'
import { Button, Input, Space, Table, Tag, Typography } from 'antd'

import type { ProjectItem } from '../mockData'
import { strings } from '../strings'
import { fonts } from '../tokens'

interface ProjectListProps {
  projects: ProjectItem[]
  onSelectDeploy: (project: ProjectItem) => void
  onNewProject: () => void
}

export function ProjectList({
  projects,
  onSelectDeploy,
  onNewProject
}: ProjectListProps): React.JSX.Element {
  const [searchTerm, setSearchTerm] = useState('')

  const filteredProjects = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.framework.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const columns = [
    {
      title: 'Project name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => (
        <Space>
          <AppstoreOutlined style={{ fontSize: 18, color: 'var(--info)' }} />
          <Typography.Text strong style={{ fontSize: 15, color: 'var(--text-primary)' }}>
            {name}
          </Typography.Text>
        </Space>
      )
    },
    {
      title: 'Framework',
      dataIndex: 'framework',
      key: 'framework',
      render: (framework: string) => <Tag color="blue">{framework}</Tag>
    },
    {
      title: 'Current version',
      dataIndex: 'currentVersion',
      key: 'currentVersion',
      render: (ver: string) => (
        <Typography.Text code style={{ fontFamily: fonts.mono, color: 'var(--success)' }}>
          {ver}
        </Typography.Text>
      )
    },
    {
      title: 'VPS Host',
      dataIndex: 'vpsHost',
      key: 'vpsHost',
      render: (host: string) => (
        <Space>
          <CloudServerOutlined style={{ color: 'var(--text-muted)' }} />
          <Typography.Text code style={{ fontFamily: fonts.mono }}>
            {host}
          </Typography.Text>
        </Space>
      )
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: ProjectItem['status']) => (
        <Tag
          color={
            status === 'online' ? 'success' : status === 'deploying' ? 'processing' : 'default'
          }
        >
          ● {status.toUpperCase()}
        </Tag>
      )
    },
    {
      title: 'Last deploy',
      dataIndex: 'lastDeployedAt',
      key: 'lastDeployedAt',
      render: (last: string) => (
        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          {last}
        </Typography.Text>
      )
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 180,
      render: (_: unknown, project: ProjectItem) => (
        <Button type="primary" icon={<RocketOutlined />} onClick={() => onSelectDeploy(project)}>
          {strings.projects.deployNew}
        </Button>
      )
    }
  ]

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <Typography.Title level={2} style={{ color: 'var(--text-primary)', margin: 0 }}>
            {strings.projects.title}
          </Typography.Title>
          <Typography.Text type="secondary">{strings.projects.description}</Typography.Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={onNewProject} size="large">
          {strings.projects.newProject}
        </Button>
      </div>

      <div style={styles.toolbar}>
        <Input
          placeholder={strings.projects.searchPlaceholder}
          prefix={<SearchOutlined />}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{ maxWidth: 360 }}
          allowClear
        />
      </div>

      <Table<ProjectItem>
        rowKey="id"
        dataSource={filteredProjects}
        columns={columns}
        pagination={false}
      />
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: 24,
    minHeight: '100%'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20
  },
  toolbar: {
    marginBottom: 20
  }
}
