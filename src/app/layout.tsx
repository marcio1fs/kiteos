import type { Metadata } from "next";
// Local fonts (npm package `geist`, woff2 files shipped with it) instead of
// `next/font/google`, which fetched from fonts.gstatic.com on EVERY build and
// broke offline/air-gapped builds — `next build` failed outright with
// "Failed to fetch `Geist` from Google Fonts".
// The package exposes the very same CSS variables globals.css already consumes.
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "KiteOS - Sistema de Gestão para Oficinas Mecânicas",
  description: "Plataforma SaaS completa para gestão de oficinas mecânicas. Ordens de serviço, estoque, financeiro, NF-e, IA assistente e muito mais.",
  keywords: ["KiteOS", "oficina mecânica", "gestão", "SaaS", "ordem de serviço", "estoque", "NF-e", "financeiro"],
  authors: [{ name: "KiteOS" }],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "KiteOS - Gestão de Oficinas",
    description: "Plataforma SaaS completa para gestão de oficinas mecânicas",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
