import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ClientBody from "./ClientBody";
import { Analytics } from "@/components/Analytics";
import SessionProvider from "@/components/providers/SessionProvider";
import { GoogleOneTap } from "@/components/GoogleOneTap";
import { GoogleOneTapTrigger } from "@/components/GoogleOneTapTrigger";
import { StructuredData } from "@/components/StructuredData";
import { siteConfig } from "@/lib/site-config";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// 品牌名来自 `siteConfig`（env: NEXT_PUBLIC_PROJECT_NAME），不硬编码具体产品
export const metadata: Metadata = {
  title: {
    default: `${siteConfig.projectName} - AI Image Generation Platform | Professional AI Art Creator`,
    template: `%s | ${siteConfig.projectName}`
  },
  description: "Professional AI image generation platform. Create stunning images from text descriptions with advanced AI technology. Free AI art generator.",
  keywords: [
    "ai image generator",
    "text to image ai",
    "ai art generator",
    "image generation ai",
    "ai art creator",
    "professional ai images",
    "ai image creation"
  ],
  authors: [{ name: `${siteConfig.projectName} Team` }],
  creator: siteConfig.projectName,
  publisher: siteConfig.projectName,
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  metadataBase: new URL(siteConfig.siteUrl),
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <StructuredData />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <SessionProvider>
          <ClientBody>
            {children}
          </ClientBody>
          <GoogleOneTap />
          <GoogleOneTapTrigger />
          <Analytics />
        </SessionProvider>
      </body>
    </html>
  );
}
