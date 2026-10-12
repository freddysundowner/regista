// Build-time only: renders the public landing page to static HTML so crawlers get full content
// without running JavaScript. The client app replaces this markup when it boots.
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { LandingPage, FAQ } from "@/pages/landing";
import ManualPage, { MANUAL_TITLE, MANUAL_DESCRIPTION } from "@/pages/manual";
import LegalPage from "@/pages/legal";
import { LEGAL } from "@/lib/legal";

export function renderLanding() {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
  return renderToString(
    <QueryClientProvider client={client}>
      <Router ssrPath="/"><LandingPage /></Router>
    </QueryClientProvider>,
  );
}
export const faq = FAQ;
export function renderManual() {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
  return renderToString(
    <QueryClientProvider client={client}>
      <Router ssrPath="/manual"><ManualPage /></Router>
    </QueryClientProvider>,
  );
}
export const manual = { title: MANUAL_TITLE, description: MANUAL_DESCRIPTION };
export function renderLegal(slug: "terms" | "privacy") {
  return renderToString(<Router ssrPath={`/${slug}`}><LegalPage doc={slug} /></Router>);
}
export const legal = (["terms", "privacy"] as const).map((slug) => ({ slug, title: LEGAL[slug].title, description: LEGAL[slug].description }));
