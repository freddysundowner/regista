/**
 * Turns on-screen A4 sheets into one PDF and downloads it. Each element becomes one page.
 * The libraries load only when someone downloads, so they never weigh on other pages.
 */
export async function downloadSheetsPdf(pages: HTMLElement[], filename: string) {
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import("jspdf"), import("html2canvas-pro")]);
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  for (const [i, page] of pages.entries()) {
    // Render at true A4 width whatever the screen size, without the on-screen shadow.
    const canvas = await html2canvas(page, {
      scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false,
      onclone: (_doc, el) => { el.style.width = "210mm"; el.style.maxWidth = "210mm"; el.style.boxShadow = "none"; },
    });
    const height = Math.min(297, (canvas.height * 210) / canvas.width);
    if (i > 0) pdf.addPage();
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 210, height);
  }
  pdf.save(filename.replace(/[\\/:*?"<>|]+/g, "-"));
}
