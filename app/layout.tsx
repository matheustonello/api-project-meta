import type { ReactNode } from 'react'

export const metadata = {
  title: 'Previna API',
  description: 'Webhook backend para integração com Meta Lead Ads',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  )
}
