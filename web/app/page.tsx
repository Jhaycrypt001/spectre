import { Navbar } from "@/components/landing/navbar";
import { Footer } from "@/components/landing/footer";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { Steps } from "@/components/landing/steps";
import { LiveProofSection } from "@/components/landing/live-proof";
import { Guarantees } from "@/components/landing/guarantees";
import { Faq } from "@/components/landing/faq";
import { Cta } from "@/components/landing/cta";

/**
 * Landing page.
 *
 * Sections are stacked inside a `divide-y` main so each one is separated by a hairline
 * rule, matching the reference design system. The order argues a case: state the claim,
 * show the mechanism, walk the lifecycle, prove it against the live chain, list what the
 * contract enforces, answer the hard questions, then ask the reader to go check.
 */
export default function Home() {
  return (
    <>
      <Navbar />
      <main className="flex flex-col divide-y divide-border pt-16">
        <Hero />
        <HowItWorks />
        <Steps />
        <LiveProofSection />
        <Guarantees />
        <Faq />
        <Cta />
      </main>
      <Footer />
    </>
  );
}
