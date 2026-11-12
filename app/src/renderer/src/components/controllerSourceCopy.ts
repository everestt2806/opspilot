import type { LocaleMode } from '../store/uiState'
const vi = {
  open: 'Kiểm tra source',
  title: 'Xác minh mã nguồn',
  run: 'Xác minh source',
  retry: 'Kiểm tra lại',
  close: 'Đóng',
  intro: 'Controller tải và kiểm tra mã nguồn Git. Bước này không build hoặc deploy ứng dụng.',
  pending: 'Đang tải và kiểm tra source. Có thể mất tối đa hai phút.',
  verified: 'Đã xác minh source tại thời điểm kiểm tra.',
  remaining:
    'Chưa deploy. Còn cần chuẩn bị target và kiểm tra runtime trước khi gửi yêu cầu deploy. Nhánh Git có thể thay đổi sau thời điểm kiểm tra.',
  failure: 'Chưa xác minh được source. Kiểm tra kết nối hoặc cấu hình rồi thử lại.',
  unsupported:
    'Source chưa phù hợp với luồng Product hiện tại: Express hoặc Vite SPA không dùng database hoặc biến môi trường bắt buộc.',
  changed:
    'Cấu hình, quyền quản lý hoặc VPS đã thay đổi. Tải lại dự án và kiểm tra cấu hình trước khi tiếp tục.',
  blocked:
    'Dự án phải tạm dừng tự deploy và không có công việc hoặc kết quả runtime đang chờ xử lý.',
  fetch:
    'Không tải được repo, nhánh hoặc thư mục dự án. Kiểm tra repository GitHub công khai và kết nối trên controller.',
  limit: 'Source vượt giới hạn dung lượng hoặc số file được hỗ trợ.',
  timeout:
    'Kiểm tra quá thời gian cho phép. Có thể kiểm tra lại; thao tác này không tạo deployment.',
  permission: 'Kết nối cần quyền deploy và thay đổi chính sách để xác minh dự án.',
  repo: 'Repository',
  branch: 'Nhánh',
  root: 'Thư mục dự án',
  app: 'Ứng dụng',
  target: 'VPS đích',
  sha: 'Commit SHA đầy đủ',
  checked: 'Thời điểm kiểm tra',
  files: 'File source và collector',
  bytes: 'Dung lượng (byte)',
  ports: 'Cổng cấu hình / cổng phát hiện',
  portHint: 'Hai cổng khác nhau. Cần xem lại cổng ứng dụng trước khi deploy.',
  sourceOnly: 'Chỉ xác minh source'
}
type Copy = { [K in keyof typeof vi]: string }
const en: Copy = {
  open: 'Check source',
  title: 'Source verification',
  run: 'Verify source',
  retry: 'Check again',
  close: 'Close',
  intro:
    'The controller downloads and checks the Git source. This does not build or deploy the application.',
  pending: 'Downloading and checking source. This may take up to two minutes.',
  verified: 'Source verified at the time shown below.',
  remaining:
    'Not deployed. Target preparation and runtime checks are still required before requesting deployment. The Git branch may change after this check.',
  failure:
    'Source verification could not be confirmed. Check the connection or configuration and try again.',
  unsupported:
    'This source is outside the current Product runtime: Express or Vite SPA without a database or required environment variables.',
  changed:
    'Configuration, ownership or target metadata changed. Refresh the project and review its configuration before continuing.',
  blocked:
    'Pause auto deploy and resolve any pending work or uncertain runtime outcomes before checking this project.',
  fetch:
    'Could not fetch the repository, branch or project directory. Check the public GitHub source and controller connectivity.',
  limit: 'Source exceeds the supported size or file-count limits.',
  timeout:
    'Verification exceeded its time limit. You may check again; this operation does not create a deployment.',
  permission: 'This connection needs deployment and policy permissions to verify the project.',
  repo: 'Repository',
  branch: 'Branch',
  root: 'Project directory',
  app: 'Application',
  target: 'Target VPS',
  sha: 'Full commit SHA',
  checked: 'Checked at',
  files: 'Source and collector files',
  bytes: 'Size (bytes)',
  ports: 'Configured / detected container port',
  portHint: 'These ports differ. Review the application port before deployment.',
  sourceOnly: 'Source check only'
}
const cn: Copy = {
  open: '检查源码',
  title: '源码验证',
  run: '验证源码',
  retry: '重新检查',
  close: '关闭',
  intro: '控制器下载并检查 Git 源码。此步骤不会构建或部署应用。',
  pending: '正在下载并检查源码，最多可能需要两分钟。',
  verified: '已在下方显示的时间验证源码。',
  remaining: '尚未部署。请求部署前仍需准备目标并检查运行环境。Git 分支可能在检查后发生变化。',
  failure: '未能确认源码验证结果。请检查连接或配置后重试。',
  unsupported:
    '此源码超出当前 Product 支持范围：不依赖数据库或必需环境变量的 Express 或 Vite SPA 应用。',
  changed: '配置、管理权限或目标信息已变化。请刷新项目并检查配置。',
  blocked: '请暂停自动部署，并处理待执行任务或不确定的运行结果后再检查。',
  fetch: '无法获取仓库、分支或项目目录。请检查公开 GitHub 源码和控制器网络。',
  limit: '源码超过支持的大小或文件数量限制。',
  timeout: '验证超时。可以重新检查；此操作不会创建部署。',
  permission: '此连接需要部署和策略权限才能验证项目。',
  repo: '仓库',
  branch: '分支',
  root: '项目目录',
  app: '应用',
  target: '目标 VPS',
  sha: '完整提交 SHA',
  checked: '检查时间',
  files: '源码及采集器文件',
  bytes: '大小（字节）',
  ports: '配置端口 / 检测到的容器端口',
  portHint: '两个端口不同。部署前请确认应用端口。',
  sourceOnly: '仅检查源码'
}
const jp: Copy = {
  open: 'ソースを確認',
  title: 'ソース検証',
  run: 'ソースを検証',
  retry: '再確認',
  close: '閉じる',
  intro: 'コントローラーが Git ソースを取得して確認します。ビルドやデプロイは行いません。',
  pending: 'ソースを取得して確認しています。最大2分かかる場合があります。',
  verified: '下記の時刻にソースを検証しました。',
  remaining:
    '未デプロイです。デプロイ要求前にターゲット準備とランタイム確認が必要です。確認後に Git ブランチが変わる場合があります。',
  failure: 'ソース検証を確認できませんでした。接続や設定を確認して再試行してください。',
  unsupported:
    '現在の Product 対応範囲は、DB や必須環境変数を使わない Express または Vite SPA です。',
  changed:
    '設定、管理権限、またはターゲットが変更されました。プロジェクトを更新して設定を確認してください。',
  blocked:
    '自動デプロイを一時停止し、保留中のタスクや不明な実行結果を解決してから確認してください。',
  fetch:
    'リポジトリ、ブランチ、またはプロジェクトディレクトリを取得できません。公開 GitHub ソースとコントローラーの接続を確認してください。',
  limit: 'ソースの容量またはファイル数が上限を超えています。',
  timeout: '検証がタイムアウトしました。再確認できます。この操作はデプロイを作成しません。',
  permission: 'プロジェクトの検証にはデプロイとポリシーの権限が必要です。',
  repo: 'リポジトリ',
  branch: 'ブランチ',
  root: 'プロジェクトディレクトリ',
  app: 'アプリ',
  target: 'ターゲット VPS',
  sha: '完全なコミット SHA',
  checked: '確認時刻',
  files: 'ソースとコレクターファイル',
  bytes: 'サイズ（バイト）',
  ports: '設定 / 検出コンテナポート',
  portHint: 'ポートが異なります。デプロイ前にアプリのポートを確認してください。',
  sourceOnly: 'ソース確認のみ'
}
export const CONTROLLER_SOURCE_COPY: Record<LocaleMode, Copy> = { vi, en, cn, jp }
