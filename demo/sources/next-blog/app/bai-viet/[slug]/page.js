// Trang 2/2: chi tiết bài viết — render tĩnh lúc build (generateStaticParams).
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatDate, getPost, listPosts } from '../../../lib/posts'

export function generateStaticParams() {
  return listPosts().map((post) => ({ slug: post.slug }))
}

export default function PostPage({ params }) {
  const post = getPost(params.slug)
  if (!post) notFound()
  return (
    <article className="post-article">
      <Link className="post-back" href="/">
        ← Danh sách bài viết
      </Link>
      <h1>{post.title}</h1>
      <div className="post-meta post-article-meta">
        <time dateTime={post.date}>{formatDate(post.date)}</time>
      </div>
      {post.body.map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </article>
  )
}
