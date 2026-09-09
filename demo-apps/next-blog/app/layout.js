import './globals.css'

const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || 'OpsPilot Demo Blog'

export const metadata = {
  title: SITE_NAME,
  description: 'Demo blog Next.js — đối tượng deploy/thí nghiệm của OpsPilot (M12)'
}

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>
        <header>
          <h1>{SITE_NAME}</h1>
        </header>
        <main>{children}</main>
      </body>
    </html>
  )
}
