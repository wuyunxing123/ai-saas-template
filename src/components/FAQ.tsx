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
    <section className="app-section-shell px-4 py-16">
      <div className="container mx-auto max-w-4xl">
        <FAQSchema faqs={faq.items} />
        
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-4 gradient-text">
            {faq.title}
          </h2>
          <p className="text-muted-foreground text-lg">
            {faq.description}
          </p>
        </div>

        <Accordion type="single" collapsible className="space-y-4">
          {faq.items.map((item, index) => (
            <AccordionItem
              key={`faq-${item.question.slice(0, 20).replace(/\s+/g, '-')}`}
              value={`item-${index}`}
              className="app-surface-card app-surface-card--interactive rounded-2xl px-6 data-[state=open]:border-primary/50"
            >
              <AccordionTrigger className="text-left hover:no-underline hover:text-primary py-6">
                <span className="text-lg font-semibold">{item.question}</span>
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground pb-6 leading-relaxed">
                {item.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  )
}
