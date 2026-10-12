import type { FeaturesContent } from "@/lib/content/contracts"

interface Feature {
  icon: string
  title: string
  description: string
}

/** 装饰性图标：按位置与文案条目配对，数量不要求一一对应。 */
const FEATURE_ICONS = [
  "https://ext.same-assets.com/3508820607/3170004912.svg",
  "https://ext.same-assets.com/3508820607/3939565216.svg",
  "https://ext.same-assets.com/3508820607/2059979464.svg",
  "https://ext.same-assets.com/3508820607/403100032.svg",
  "https://ext.same-assets.com/3508820607/1573002659.svg",
  "https://ext.same-assets.com/3508820607/4162928580.svg",
]

export function KeyFeatures({ features }: { features: FeaturesContent }) {
  // 遍历**文案**而不是按固定下标取用：条目个数由产品决定，
  // 写死 `items[5]` 等于要求每个产品都提供 6 条特性，否则整页 SSR 直接抛错。
  const featureCards: Feature[] = features.items.map((item, index) => ({
    icon: FEATURE_ICONS[index % FEATURE_ICONS.length],
    title: item.title,
    description: item.description,
  }))

  return (
    <section className="py-16 px-4">
      <div className="container mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            {features.title}
          </h2>
          <p className="text-muted-foreground text-lg max-w-3xl mx-auto">
            {features.description}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {featureCards.map((feature, index) => (
            <div key={`feature-${feature.title.replace(/\s+/g, '-').toLowerCase()}`} className="group">
              <div className="app-surface-card app-surface-card--interactive h-full rounded-2xl p-6">
                <div className="mb-4">
                  <div className="app-icon-surface mb-4 flex h-12 w-12 items-center justify-center rounded-xl">
                    <img
                      src={feature.icon}
                      alt={`${feature.title} - Feature Icon`}
                      className="w-6 h-6 filter brightness-0 invert opacity-80"
                      style={{
                        filter: 'brightness(0) saturate(100%) invert(54%) sepia(91%) saturate(2046%) hue-rotate(191deg) brightness(101%) contrast(103%)'
                      }}
                      loading="lazy"
                      width="24"
                      height="24"
                    />
                  </div>
                  <h3 className="text-xl font-semibold mb-3 text-foreground group-hover:text-primary transition-colors">
                    {feature.title}
                  </h3>
                  <p className="text-muted-foreground leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
