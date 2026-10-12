// Post-build SEO step: injects the pre-rendered landing page, structured data, canonical/Open Graph URLs,
// the social sharing image, sitemap.xml and the robots.txt sitemap line. Set SITE_URL (e.g. https://rejista.co.ke)
// for absolute URLs, and GOOGLE_SITE_VERIFICATION / BING_SITE_VERIFICATION to prove ownership to the search consoles.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { appName, rebrand, DEFAULT_NAME } from "../../../brand.config.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist/public");
const { renderLanding, renderManual, renderLegal, manual, legal, faq } = await import(pathToFileURL(join(root, "dist/ssr/prerender.js")).href);
const site = (process.env.SITE_URL ?? "").replace(/\/$/, "");
const absolute = /^https?:\/\//.test(site);

const name = appName();
// public/og-image.png, favicon.svg and apple-touch-icon.png are pictures of the default name. Under another name the
// link-preview image is left out and the icon becomes a plain initial, until BRAND_IMAGES_READY=true says they were replaced.
const ownImages = name === DEFAULT_NAME || process.env.BRAND_IMAGES_READY === "true";
const description = rebrand("Rejista runs admissions, fees, CBC assessments and attendance for Kenyan schools. M-Pesa payment matching and WhatsApp for parents.");
const graph = [
  { "@type": "Organization", "@id": `${site}/#organization`, name, ...(absolute ? { url: `${site}/`, logo: `${site}/apple-touch-icon.png` } : {}) },
  { "@type": "WebSite", "@id": `${site}/#website`, name, ...(absolute ? { url: `${site}/` } : {}), inLanguage: "en-KE", publisher: { "@id": `${site}/#organization` } },
  { "@type": "SoftwareApplication", name, applicationCategory: "EducationalApplication", applicationSubCategory: "School management system",
    operatingSystem: "Web browser, Android, iOS", description, inLanguage: "en-KE", areaServed: { "@type": "Country", name: "Kenya" },
    featureList: ["Learner and guardian records", "Fee invoices, receipts and statements", "M-Pesa and bank payment matching", "CBC assessments and report cards", "Attendance registers", "Expenses and purchasing", "School store and library", "WhatsApp for parents"],
    ...(absolute ? { url: `${site}/` } : {}), publisher: { "@id": `${site}/#organization` } },
  { "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
];
const jsonLd = `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c")}</script>`;
const urls = absolute ? [
  `<link rel="canonical" href="${site}/" />`,
  `<meta property="og:url" content="${site}/" />`,
  `<link rel="alternate" hreflang="en-KE" href="${site}/" />`,
  `<link rel="alternate" hreflang="x-default" href="${site}/" />`,
  // Link previews need an absolute image URL; 1200x630 is the size every network accepts.
  ...(ownImages ? [
    `<meta property="og:image" content="${site}/og-image.png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${name}: school management for Kenyan schools" />`,
    `<meta name="twitter:image" content="${site}/og-image.png" />`,
  ] : []),
].join("\n    ") : "";
// Ownership tags from Google Search Console and Bing Webmaster Tools, when the operator has them.
const token = (value) => (value ?? "").trim().replace(/[^A-Za-z0-9_-]/g, "");
const verification = [
  token(process.env.GOOGLE_SITE_VERIFICATION) && `<meta name="google-site-verification" content="${token(process.env.GOOGLE_SITE_VERIFICATION)}" />`,
  token(process.env.BING_SITE_VERIFICATION) && `<meta name="msvalidate.01" content="${token(process.env.BING_SITE_VERIFICATION)}" />`,
].filter(Boolean).join("\n    ");

const indexPath = join(out, "index.html");
let html = readFileSync(indexPath, "utf8");
if (!html.includes('<div id="root"></div>')) throw new Error("index.html root element not found");
// The manual is the same shell with its own title, description, address and pre-rendered text, served at /manual.
const escapeAttr = (text) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const page = (path, meta, body) => {
  const pageHtml = html
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeAttr(meta.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${escapeAttr(meta.description)}" />`)
    .replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${escapeAttr(meta.title)}" />`)
    .replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${escapeAttr(meta.description)}" />`)
    .replace('<div id="root"></div>', `<div id="root">${body}</div>`)
    .replace("</head>", `    ${[absolute ? `<link rel="canonical" href="${site}/${path}" />\n    <meta property="og:url" content="${site}/${path}" />` : "", verification].filter(Boolean).join("\n    ")}\n  </head>`);
  mkdirSync(join(out, path), { recursive: true });
  writeFileSync(join(out, path, "index.html"), pageHtml);
};
page("manual", manual, renderManual());
// The Terms and the Privacy Policy, the same way.
for (const doc of legal) page(doc.slug, doc, renderLegal(doc.slug));

html = html.replace('<div id="root"></div>', `<div id="root">${renderLanding()}</div>`)
  .replace("</head>", `    ${[urls, verification, jsonLd].filter(Boolean).join("\n    ")}\n  </head>`);
writeFileSync(indexPath, html);

// The landing page reads its price and chat questions from /api/public/, so crawlers that render the page may fetch those.
let robots = "User-agent: *\nAllow: /\nAllow: /api/public/\nDisallow: /api/\n";
if (absolute) {
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(join(out, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${site}/</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>\n  <url><loc>${site}/manual</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>\n${legal.map((d) => `  <url><loc>${site}/${d.slug}</loc><lastmod>${today}</lastmod><changefreq>yearly</changefreq><priority>0.3</priority></url>\n`).join("")}</urlset>\n`);
  robots += `\nSitemap: ${site}/sitemap.xml\n`;
} else {
  console.warn("SITE_URL not set: skipped canonical URL and sitemap.xml. Set SITE_URL=https://your-domain for production builds.");
}
writeFileSync(join(out, "robots.txt"), robots);
// The installable-app files carry the name too.
for (const file of ["manifest.webmanifest", "offline.html", "sw.js"]) writeFileSync(join(out, file), rebrand(readFileSync(join(out, file), "utf8"), name));
if (!ownImages) {
  const letter = name.charAt(0).toUpperCase();
  // The app icons are pictures of the default name as well: fall back to the plain-initial icon for the home screen.
  const manifestPath = join(out, "manifest.webmanifest"), appManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  appManifest.icons = [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }];
  writeFileSync(manifestPath, JSON.stringify(appManifest, null, 2));
  writeFileSync(join(out, "offline.html"), readFileSync(join(out, "offline.html"), "utf8").replace('<div class="mark">R</div>', `<div class="mark">${letter}</div>`));
  writeFileSync(join(out, "favicon.svg"), `<svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><title>${name}</title><rect width="64" height="64" rx="10" fill="#F2AD36"/><text x="32" y="46" text-anchor="middle" font-family="Georgia, serif" font-size="40" font-weight="700" fill="#173239">${letter}</text></svg>\n`);
  html = html.replace(/\s*<link rel="apple-touch-icon"[^>]*>/, "");
  writeFileSync(indexPath, html);
  console.warn(`APP_NAME is "${name}": the link-preview image was left out and the icon is a plain "${letter}". Replace public/og-image.png, favicon.svg, apple-touch-icon.png and the icon-*.png files, then set BRAND_IMAGES_READY=true.`);
}
console.log(`Pre-rendered landing page (${Math.round(html.length / 1024)} KB)${absolute ? ` for ${site}` : ""}.`);
