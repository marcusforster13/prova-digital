import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Prova Digital — Captura Certificada',
  description:
    'Capture prints e fotos com hash, metadados e carimbo de tempo verificável.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
