import type { HowToContent } from "@/lib/content/contracts"

export function HowToSteps({ howTo }: { howTo: HowToContent }) {
  // 遍历**文案**而不是按固定下标取用：步骤条数由产品决定，
  // 写死 `steps[3]` 等于要求每个产品都提供 4 步，否则整页 SSR 直接抛错。
  const steps = howTo.steps.map((step) => ({
    number: String(Number(step.number)).padStart(2, "0"),
    title: step.title,
    description: step.description,
  }))

  return (
    <section className="bg-[#26251d] px-4 py-20 text-[#f4f2ea]">
      <div className="container mx-auto max-w-6xl">
        <h2 className="mb-4 text-3xl font-bold tracking-tight md:text-4xl">
          {howTo.alternativeTitle}
        </h2>
        <p className="mb-14 max-w-2xl text-lg text-[#f4f2ea]/60">
          {howTo.alternativeDescription}
        </p>

        <div className="grid grid-cols-1 gap-10 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((step) => (
            <div
              key={`step-${step.number}-${step.title.replace(/\s+/g, '-').toLowerCase()}`}
              className="border-t border-[#f4f2ea]/20 pt-6"
            >
              <div className="mb-6 text-sm font-semibold tracking-widest text-[#a99cf8]">
                {step.number}
              </div>
              <h3 className="mb-3 text-xl font-semibold">{step.title}</h3>
              <p className="leading-relaxed text-[#f4f2ea]/60">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
