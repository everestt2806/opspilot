// Dữ liệu tĩnh cho demo blog (M12) — không phụ thuộc dịch vụ ngoài.
const POSTS = [
  {
    slug: 'ops-pilot-la-gi',
    title: 'OpsPilot là gì',
    date: '2026-09-10',
    excerpt: 'Đồ án tốt nghiệp: deploy web app lên VPS qua SSH kèm ML phát hiện suy giảm.',
    body: [
      'OpsPilot là công cụ desktop giúp đưa source code từ máy phát triển lên VPS chỉ qua kết nối SSH: không cần cài agent trên server, không mở thêm port.',
      'Người dùng chọn thư mục source, công cụ tự nhận diện framework (Express, Next.js, Vite…), sinh Dockerfile và docker-compose, build image rồi khởi động container kèm healthcheck.',
      'Sau khi chạy, OpsPilot theo dõi metric định kỳ và dùng machine learning để phát hiện sớm dấu hiệu suy giảm — chủ đề của các bài viết dưới đây.'
    ]
  },
  {
    slug: 'deploy-qua-ssh',
    title: 'Deploy qua SSH',
    date: '2026-09-11',
    excerpt: 'Mọi lệnh trên VPS đi qua ssh exec: không agent, không mở thêm port.',
    body: [
      'Toàn bộ pipeline deploy chạy qua một kênh SSH duy nhất từ máy người dùng: upload source dạng tarball, render template Dockerfile, build image và điều khiển Docker Compose bằng lệnh từ xa.',
      'Nhờ vậy VPS không cần cài thêm phần mềm trung gian — chỉ cần Docker và SSH mở port 22 như mặc định.',
      'Kết quả mỗi lần deploy là một image được đánh version vN, một deployment record trong lịch sử và endpoint healthcheck để nghiệm thu.'
    ]
  },
  {
    slug: 'phat-hien-suy-giam',
    title: 'Phát hiện suy giảm',
    date: '2026-09-12',
    excerpt: '3 model + ensemble chấm điểm từ 5 metric thu thập mỗi 10 giây.',
    body: [
      'OpsPilot thu thập năm metric từ collector chạy cạnh app: CPU, RAM, latency, HTTP error rate và throughput.',
      'Ba model học máy cùng chấm điểm từng cửa sổ thời gian; kết quả ensemble cho ra một điểm suy giảm từ 0 đến 1, giúp phân biệt sự cố thật với nhiễu ngắn hạn.',
      'Khi điểm vượt ngưỡng, công cụ cảnh báo trên dashboard để người vận hành quyết định can thiệp.'
    ]
  },
  {
    slug: 'tu-dong-rollback',
    title: 'Tự động rollback',
    date: '2026-09-13',
    excerpt: 'Khi trusted_method triggered 3 lần liên tiếp, tool quay về image cũ.',
    body: [
      'Mỗi deployment giữ lại image phiên bản trước đó, nên việc quay về bản ổn định cuối cùng chỉ là một thao tác đổi tag trong Compose.',
      'Cơ chế hiện tại yêu cầu người dùng xác nhận trước khi rollback, ưu tiên an toàn dữ liệu trong môi trường demo.',
      'Phần tự động hóa hoàn toàn đang được hoàn thiện cùng với hành lang kiểm chứng bằng dữ liệu vận hành thật.'
    ]
  }
]

export function listPosts() {
  return POSTS
}

export function getPost(slug) {
  return POSTS.find((p) => p.slug === slug) || null
}

// Ngày hiển thị dạng 10/09/2026 cho cả trang chủ lẫn trang chi tiết.
export function formatDate(value) {
  return new Date(value).toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
}
