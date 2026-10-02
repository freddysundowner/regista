from pathlib import Path
import fitz

source = Path("attached_assets/SCHOOL_SYSTEM_TECHNICAL_SPEC.md_1790916356512.pdf")
output = Path(".agents/outputs/school-spec-pages")
output.mkdir(parents=True, exist_ok=True)

document = fitz.open(source)
print(f"Pages: {document.page_count}")
for number, page in enumerate(document, start=1):
    image = page.get_pixmap(matrix=fitz.Matrix(1.4, 1.4), alpha=False)
    destination = output / f"page-{number:02}.png"
    image.save(destination)
    print(destination)