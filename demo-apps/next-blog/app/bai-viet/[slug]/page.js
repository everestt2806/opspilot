// Trang 2/2: chi tiết bài viết — render tĩnh lúc build (generateStaticParams).
import { notFound } from 'next/navigation'
import { getPost, listPosts } from '../../../lib/posts'

export function generateStaticParams() {
  return listPosts().map((post) => ({ slug: post.slug }))
}

export default function PostPage({ params }) {
  const post = getPost(params.slug)
  if (!post) notFound()
  return (
    <article>
      <h2>{post.title}</h2>
      <p>{post.excerpt}</p>
      <p>Nội dung demo tĩnh — phục vụ kiểm tra deploy, không cần nguồn dữ liệu ngoài.</p>
    </article>
  )
}
