import type { TestimonialsContent } from "@/lib/content/contracts"

export function Testimonials({
  testimonials,
}: {
  testimonials: TestimonialsContent
}) {
  return (
    <section className="px-4 py-20">
      <div className="container mx-auto max-w-6xl">
        <div className="mb-4 flex items-center gap-3">
          <span className="h-px w-8 bg-primary" />
          <span className="text-sm font-semibold tracking-wide text-primary">
            {testimonials.eyebrow}
          </span>
        </div>
        <h2 className="mb-4 text-3xl font-bold tracking-tight md:text-4xl">
          {testimonials.title}
        </h2>
        <p className="mb-12 max-w-2xl text-lg text-muted-foreground">
          {testimonials.description}
        </p>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {testimonials.items.map((item) => (
            <figure
              key={item.name}
              className="flex flex-col rounded-2xl border border-border bg-card p-6"
            >
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#8b5cf6] to-[#d946ef] text-lg font-bold text-white">
                  {item.avatar}
                </div>
                <div>
                  <div className="font-semibold">{item.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {item.role}
                  </div>
                </div>
              </div>
              <div className="mb-3 text-4xl leading-none text-primary/30">
                &ldquo;
              </div>
              <blockquote className="mb-6 leading-relaxed text-foreground/80">
                {item.quote}
              </blockquote>
              <div className="mt-auto flex flex-wrap gap-2">
                {item.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </figure>
          ))}
        </div>
      </div>
    </section>
  )
}
