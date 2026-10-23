import type { Metadata } from "next";
import { Navigation } from "@/components/Navigation";
import { Footer } from "@/components/Footer";
import { productContent } from "@/app/product-content";
import { FluxKontextGenerator } from "@/components/FluxKontextGenerator";
import { generateMultilingualMetadata } from "@/lib/seo/metadata-generator";

export const metadata: Metadata = generateMultilingualMetadata({
  title: "AI 图像生成器 - Flux Kontext | 生成专业图像",
  description:
    "用 Flux Kontext AI 生成与编辑专业图像：文字生成图像、自然语言修图、多图批量处理。",
  keywords: [
    "ai 图像生成器",
    "flux kontext",
    "文字生成图像",
    "ai 修图",
    "ai 艺术",
    "专业图像",
    "图像生成 ai",
    "ai 创作工具",
  ],
  path: "/generate",
  images: ["/og-generate.png"],
});

export default function GeneratePage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background">
      <Navigation />

      <main className="container mx-auto px-4 pb-20 pt-24">
        <FluxKontextGenerator />
      </main>

      <Footer footer={productContent.home.footer} />
    </div>
  );
}
