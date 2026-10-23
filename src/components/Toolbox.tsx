import Link from "next/link"
import {
  ArrowUpRight,
  LayoutTemplate,
  PenTool,
  ShoppingBag,
  Wand2,
} from "lucide-react"
import type { ToolboxContent } from "@/lib/content/contracts"

/** 装饰性图标：按位置与工具条目配对，数量不要求一一对应。 */
const TOOL_ICONS = [ShoppingBag, LayoutTemplate, PenTool, Wand2]

export function Toolbox({ toolbox }: { toolbox: ToolboxContent }) {
  return (
    <section className="bg-[#e9ede2] px-4 py-20">
      <div className="container mx-auto max-w-6xl">
        <div className="mb-4 flex items-center gap-3">
          <span className="h-px w-8 bg-primary" />
          <span className="text-sm font-semibold tracking-wide text-primary">
            {toolbox.eyebrow}
          </span>
        </div>
        <h2 className="mb-4 text-3xl font-bold tracking-tight md:text-4xl">
          {toolbox.title}
        </h2>
        <p className="mb-12 max-w-2xl text-lg text-muted-foreground">
          {toolbox.description}
        </p>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {toolbox.items.map((item, index) => {
            const Icon = TOOL_ICONS[index % TOOL_ICONS.length]
            return (
              <Link
                key={item.title}
                href={item.href}
                className="group flex flex-col rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary/40"
              >
                <div className="app-icon-surface mb-5 flex h-11 w-11 items-center justify-center rounded-xl">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mb-2 text-xl font-semibold">{item.title}</h3>
                <p className="mb-5 leading-relaxed text-muted-foreground">
                  {item.description}
                </p>
                <div className="mb-6 flex flex-wrap gap-2">
                  {item.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="mt-auto flex items-center justify-between border-t border-border pt-4">
                  <span className="text-sm font-semibold">{item.cta}</span>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </section>
  )
}
