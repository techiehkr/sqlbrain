import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'SQLBrain — Local AI Database Assistant',
  description: 'AI-powered SQL assistant that runs locally. Never sends your data outside.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
