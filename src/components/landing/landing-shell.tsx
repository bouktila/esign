"use client";

import { Brand } from "@/components/layout/brand";
import { PublicLegalFooter } from "@/components/layout/public-legal-links";
import { PublicSessionMenu } from "@/components/layout/public-session-menu";
import {
  LandingSessionLoginAction,
  LandingSessionPrimaryAction,
} from "@/components/landing/landing-session-actions";

const exampleDocuments = [
  {
    detail: "Elena Varlowe. 5,550,000 ordinary shares.",
    title: "Ordinary share certificate",
  },
  {
    detail: "Allotment of 100,000 ordinary shares at €2.50.",
    title: "Written resolution",
  },
  {
    detail: "Appointment of Tomás Ferrity as director.",
    title: "Board minute",
  },
] as const;

const steps = [
  {
    body: "The certificate or resolution you already have.",
    title: "Bring the PDF",
  },
  {
    body: "A signature, a date, a name. Each one belongs to one person.",
    title: "Mark where to sign",
  },
  {
    body: "They open it, sign, and everyone keeps the sealed copy.",
    title: "Send the link",
  },
] as const;

export function LandingShell() {
  return (
    <div className="flex min-h-screen flex-col text-(--fg)">
      <header className="sticky top-0 z-30 border-b border-(--border) bg-[color-mix(in_srgb,var(--page)_88%,transparent)] backdrop-blur-md">
        <div className="page-width flex items-center justify-between gap-3 py-3">
          <Brand href="/" />
          <PublicSessionMenu>
            <nav aria-label="Public navigation" className="flex items-center">
              <LandingSessionLoginAction className="min-h-10 px-3" />
            </nav>
          </PublicSessionMenu>
        </div>
      </header>

      <main className="flex-1">
        <section className="page-width pb-10 pt-10">
          <h1 className="max-w-[14ch] text-[2.125rem] font-semibold leading-[1.12] tracking-[-0.03em]">
            Sign the company papers.
          </h1>
          <p className="mt-4 max-w-[28rem] text-[1.0625rem] leading-relaxed text-(--secondary)">
            Share certificates, written resolutions and the other documents that
            follow a change in who owns what.
          </p>
          <div className="mt-7">
            <LandingSessionPrimaryAction />
          </div>
          <p className="mt-6 text-sm leading-6 text-(--tertiary)">
            Part of{" "}
            <a
              className="underline decoration-(--border-strong) underline-offset-4 hover:text-(--fg)"
              href="https://www.equity-on.com"
            >
              Equity-On
            </a>
            . Your equity, always on.
          </p>
        </section>

        <section className="page-width pb-12">
          <h2 className="text-lg font-semibold tracking-[-0.02em]">
            Glasvane Ltd
          </h2>
          <p className="mt-1 text-sm leading-6 text-(--secondary)">
            An example company. The names and numbers are made up.
          </p>
          <ul className="mt-4 border-y border-(--border)">
            {exampleDocuments.map((document) => (
              <li
                className="border-b border-(--border) py-4 last:border-b-0"
                key={document.title}
              >
                <p className="font-medium">{document.title}</p>
                <p className="mt-1 text-sm leading-6 text-(--secondary)">
                  {document.detail}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="page-width pb-16">
          <h2 className="text-lg font-semibold tracking-[-0.02em]">
            How a document gets signed
          </h2>
          <ol className="mt-5 space-y-5">
            {steps.map((step, index) => (
              <li className="flex gap-4" key={step.title}>
                <span className="w-4 shrink-0 pt-0.5 text-sm font-medium text-(--tertiary)">
                  {index + 1}
                </span>
                <div>
                  <p className="font-medium">{step.title}</p>
                  <p className="mt-1 text-sm leading-6 text-(--secondary)">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </main>

      <PublicLegalFooter />
    </div>
  );
}
