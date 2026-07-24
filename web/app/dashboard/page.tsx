import type { Metadata } from "next";

import { Navbar } from "@/components/landing/navbar";
import { Footer } from "@/components/landing/footer";
import { DashboardView } from "@/components/dashboard/dashboard-view";

export const metadata: Metadata = {
  title: "Live dashboard — Spectre",
  description:
    "The deployed Spectre contract on Casper testnet, read live: settled dispatches with their full baseline-to-payout accounting, registered homes, and the raw on-chain event log.",
};

export default function DashboardPage() {
  return (
    <>
      <Navbar />
      <main className="flex-1 pt-16">
        <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
          <header className="mb-10 flex flex-col gap-3">
            <h1 className="text-3xl font-medium tracking-tighter sm:text-4xl">
              Live market
            </h1>
            <p className="max-w-2xl leading-relaxed text-muted-foreground">
              Read directly from the deployed contract. Each settled window shows the
              baseline the contract recomputed, the reduction it credited, and the
              payout — recomputable, by anyone, from the events below.
            </p>
          </header>
          <DashboardView />
        </div>
      </main>
      <Footer />
    </>
  );
}
