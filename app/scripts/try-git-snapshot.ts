import { createGitSnapshot } from '../src/main/git/snapshot'

const [repositoryUrl, ref = 'main', root = '.'] = process.argv.slice(2)
if (!repositoryUrl) {
  console.error('Cách dùng: pnpm try:git-snapshot <GitHub-HTTPS-URL> [ref] [root]')
  process.exitCode = 2
} else {
  void main(repositoryUrl, ref, root)
}

async function main(repositoryUrl: string, ref: string, root: string): Promise<void> {
  const controller = new AbortController()
  const cancel = (): void => controller.abort()
  process.once('SIGINT', cancel)
  try {
    const snapshot = await createGitSnapshot({
      repositoryUrl,
      ref,
      root,
      signal: controller.signal
    })
    try {
      console.log(
        JSON.stringify(
          {
            repository_url: snapshot.repositoryUrl,
            commit_sha: snapshot.commitSha,
            root_directory: snapshot.rootDirectory
          },
          null,
          2
        )
      )
    } finally {
      snapshot.cleanup()
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Không thể lấy snapshot Git.')
    process.exitCode = 1
  } finally {
    process.removeListener('SIGINT', cancel)
  }
}
