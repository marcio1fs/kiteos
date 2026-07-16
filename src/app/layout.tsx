import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "KiteOS - Sistema de Gestão para Oficinas Mecânicas",
  description: "Plataforma SaaS completa para gestão de oficinas mecânicas. Ordens de serviço, estoque, financeiro, NF-e, IA assistente e muito mais.",
  keywords: ["KiteOS", "oficina mecânica", "gestão", "SaaS", "ordem de serviço", "estoque", "NF-e", "financeiro"],
  authors: [{ name: "KiteOS" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
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
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
