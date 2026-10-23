import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { FAQSchema } from "@/components/StructuredData"
import type { FaqContent } from "@/lib/content/contracts"

export function FAQ({ faq }: { faq: FaqContent }) {
  return (
    <section className="app-section-shell px-4 py-20">
      <div className="container mx-auto max-w-4xl">
        <FAQSchema faqs={faq.items} />
        
        <div className="mb-12">
          <div className="mb-4 flex items-center gap-3">
            <span className="h-px w-8 bg-primary" />
            <span className="text-sm font-semibold tracking-wide text-primary">
              {faq.title}
            </span>
          </div>
          <p className="max-w-2xl text-lg text-muted-foreground">
            {faq.description}
          </p>
        </div>

        <Accordion type="single" collapsible className="space-y-3">
          {faq.items.map((item, index) => (
            <AccordionItem
              key={`faq-${item.question.slice(0, 20).replace(/\s+/g, '-')}`}
              value={`item-${index}`}
              className="app-surface-card rounded-2xl px-6 data-[state=open]:border-primary/50"
            >
              <AccordionTrigger className="text-left hover:no-underline hover:text-primary py-5">
                <span className="text-base font-semibold">{item.question}</span>
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground pb-5 leading-relaxed">
                {item.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  )
}
