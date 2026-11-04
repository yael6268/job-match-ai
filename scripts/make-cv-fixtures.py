"""Generates synthetic CV fixtures (tests/fixtures/sample-cv.docx, sample-cv.pdf). Stdlib only."""
import sys, zipfile
from pathlib import Path

out = Path(sys.argv[1])
paras = [
    "Sample User - QA Engineer",
    "sample.user@example.com | 050-0000000",
    "Experience: QA Automation at Acme, 2019-2023. Selenium, Python, Jira.",
    "בודקת תוכנה עם ניסיון באוטומציה",
]

def esc(s): return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

body = "".join(f'<w:p><w:r><w:t xml:space="preserve">{esc(p)}</w:t></w:r></w:p>' for p in paras)
files = {
    "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels": '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": f'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{body}</w:body></w:document>',
}
with zipfile.ZipFile(out / "sample-cv.docx", "w", zipfile.ZIP_DEFLATED) as z:
    for name, data in files.items():
        z.writestr(name, data)

# Minimal PDF, Latin text only (standard Helvetica font, no embedding).
lines = [paras[0], paras[1], paras[2]]
stream = "BT /F1 12 Tf 50 750 Td 16 TL " + " ".join(f"({l.replace('(', '').replace(')', '')}) Tj T*" for l in lines) + " ET"
objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
]
pdf = b"%PDF-1.4\n"
offsets = []
for i, o in enumerate(objs, 1):
    offsets.append(len(pdf))
    pdf += f"{i} 0 obj\n{o}\nendobj\n".encode("latin-1")
xref = len(pdf)
pdf += f"xref\n0 {len(objs)+1}\n0000000000 65535 f \n".encode()
for off in offsets:
    pdf += f"{off:010d} 00000 n \n".encode()
pdf += f"trailer\n<< /Size {len(objs)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
(out / "sample-cv.pdf").write_bytes(pdf)
print("ok")
