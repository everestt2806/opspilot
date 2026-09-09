// Dữ liệu tĩnh cho demo blog (M12) — không phụ thuộc dịch vụ ngoài.
const POSTS = [
  { slug: 'ops-pilot-la-gi', title: 'OpsPilot là gì', excerpt: 'Đồ án tốt nghiệp: deploy web app lên VPS qua SSH kèm ML phát hiện suy giảm.' },
  { slug: 'deploy-qua-ssh', title: 'Deploy qua SSH', excerpt: 'Mọi lệnh trên VPS đi qua ssh exec: không agent, không mở thêm port.' },
  { slug: 'phat-hien-suy-giam', title: 'Phát hiện suy giảm', excerpt: '3 model + ensemble chấm điểm từ 5 metric thu thập mỗi 10 giây.' },
  { slug: 'tu-dong-rollback', title: 'Tự động rollback', excerpt: 'Khi trusted_method triggered 3 lần liên tiếp, tool quay về image cũ.' }
]

export function listPosts() {
  return POSTS
}

export function getPost(slug) {
  return POSTS.find((p) => p.slug === slug) || null
}
