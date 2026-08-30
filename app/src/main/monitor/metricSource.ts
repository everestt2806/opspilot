import { readFile, stat } from 'node:fs/promises'

import type { SshManager } from '../ssh/manager'

export interface MetricSource {
  size(): Promise<number>
  tail(fromByte: number): Promise<string>
}

export class LocalMetricSource implements MetricSource {
  constructor(private readonly filePath: string) {}
  async size(): Promise<number> {
    return (await stat(this.filePath)).size
  }
  async tail(fromByte: number): Promise<string> {
    const content = await readFile(this.filePath)
    return content.subarray(Math.max(0, fromByte - 1)).toString('utf8')
  }
}

export class SshMetricSource implements MetricSource {
  constructor(
    private readonly ssh: SshManager,
    private readonly vpsId: number,
    private readonly remotePath: string
  ) {}
  size(): Promise<number> {
    return this.ssh.fileSize(this.vpsId, this.remotePath)
  }
  async tail(fromByte: number): Promise<string> {
    return (await this.ssh.readFileTail(this.vpsId, this.remotePath, fromByte)).content
  }
}
