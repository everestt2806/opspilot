// Trang 1/2: trang chủ — danh sách bài viết từ dữ liệu tĩnh.
import Link from 'next/link'
import { listPosts } from '../lib/posts'

export default function HomePage() {
  const posts = listPosts()
  return (
    <section>
      <p>Demo Next.js 14 (App Router) — 2 trang đọc dữ liệu tĩnh, dùng để demo OpsPilot deploy.</p>
      <ul>
        {posts.map((post) => (
          <li key={post.slug}>
            <Link href={`/bai-viet/${post.slug}`}>{post.title}</Link> — {post.excerpt}
          </li>
        ))}
      </ul>
    </section>
  )
}
