import type { FeaturesContent } from "@/lib/content/contracts"
import { Type, Wand2, Layers, Sparkles, Frame, Download } from "lucide-react"

interface Feature {
  icon: typeof Type
  title: string
  description: string
}

/** 装饰性图标：按位置与文案条目配对，数量不要求一一对应。 */
const FEATURE_ICONS = [Type, Wand2, Layers, Sparkles, Frame, Download]

export function KeyFeatures({ features }: { features: FeaturesContent }) {
  // 遍历**文案**而不是按固定下标取用：条目个数由产品决定，
  // 写死 `items[5]` 等于要求每个产品都提供 6 条特性，否则整页 SSR 直接抛错。
  const featureCards: Feature[] = features.items.map((item, index) => ({
    icon: FEATURE_ICONS[index % FEATURE_ICONS.length],
    title: item.title,
    description: item.description,
  }))

  return (
    <section className="px-4 py-20">
      <div className="container mx-auto max-w-6xl">
        <div className="mb-12">
          <div className="mb-4 flex items-center gap-3">
            <span className="h-px w-8 bg-primary" />
            <span className="text-sm font-semibold tracking-wide text-primary">
              {features.title}
            </span>
          </div>
          <p className="max-w-2xl text-lg text-muted-foreground">
            {features.description}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {featureCards.map((feature) => {
            const Icon = feature.icon
            return (
              <div
                key={`feature-${feature.title.replace(/\s+/g, '-').toLowerCase()}`}
                className="app-surface-card app-surface-card--interactive h-full rounded-2xl p-6"
              >
                <div className="app-icon-surface mb-5 flex h-11 w-11 items-center justify-center rounded-xl">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mb-2 text-lg font-semibold">{feature.title}</h3>
                <p className="leading-relaxed text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
