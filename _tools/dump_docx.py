import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph

path = sys.argv[1]
doc = Document(path)

body = doc.element.body
out = []
for child in body.iterchildren():
    tag = child.tag.split('}')[-1]
    if tag == 'p':
        p = Paragraph(child, doc)
        txt = p.text.rstrip()
        style = p.style.name if p.style is not None else ''
        if txt:
            out.append(f"[{style}] {txt}")
    elif tag == 'tbl':
        t = Table(child, doc)
        out.append("=== TABLE ===")
        for row in t.rows:
            cells = [c.text.replace('\n', ' / ').strip() for c in row.cells]
            out.append(" | ".join(cells))
        out.append("=== END TABLE ===")

print("\n".join(out))
