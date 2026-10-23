import Link from "next/link"
import { Button } from "@/components/ui/button"
import type { FinalCtaContent } from "@/lib/content/contracts"

export function FinalCta({ finalCta }: { finalCta: FinalCtaContent }) {
  return (
    <section className="bg-[#ece7fa] px-4 py-24">
      <div className="container mx-auto max-w-3xl text-center">
        <h2 className="mb-4 text-3xl font-bold tracking-tight md:text-4xl">
          {finalCta.title}
        </h2>
        <p className="mb-10 text-lg text-muted-foreground">
          {finalCta.description}
        </p>
        <Link href="/generate">
          <Button
            size="lg"
            className="rounded-full bg-foreground px-8 py-3 text-base text-background transition-colors hover:bg-foreground/90"
          >
            {finalCta.button}
          </Button>
        </Link>
      </div>
    </section>
  )
}
