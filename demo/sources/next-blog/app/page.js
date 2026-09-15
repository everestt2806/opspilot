// Trang 1/2: trang chủ — danh sách bài viết từ dữ liệu tĩnh.
import Link from 'next/link'
import { formatDate, listPosts } from '../lib/posts'

export default function HomePage() {
  const posts = listPosts()
  return (
    <section>
      <div className="page-heading">
        <h1>Bài viết</h1>
        <p>
          Blog tĩnh dùng để demo OpsPilot deploy Next.js: hai trang được render sẵn lúc build, không
          cần nguồn dữ liệu ngoài.
        </p>
      </div>

      <ul className="post-list">
        {posts.map((post) => (
          <li key={post.slug} className="post-item">
            <Link className="post-title" href={`/bai-viet/${post.slug}`}>
              {post.title}
            </Link>
            <p className="post-excerpt">{post.excerpt}</p>
            <div className="post-meta">
              <time dateTime={post.date}>{formatDate(post.date)}</time>
              <span aria-hidden="true">·</span>
              <span>{post.body.length} đoạn</span>
              <span aria-hidden="true">·</span>
              <Link className="post-read" href={`/bai-viet/${post.slug}`}>
                Đọc tiếp →
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
