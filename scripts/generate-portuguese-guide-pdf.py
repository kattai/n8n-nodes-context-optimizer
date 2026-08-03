from __future__ import annotations

import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from xml.sax.saxutils import escape


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "pt-BR" / "GUIA_COMPLETO.md"
OUTPUT = ROOT / "output" / "pdf" / "context-saver-1.0-guia-completo-pt-br.pdf"

BLUE = colors.HexColor("#263F78")
ORANGE = colors.HexColor("#F16C4A")
INK = colors.HexColor("#252833")
MUTED = colors.HexColor("#687083")
PALE = colors.HexColor("#F2F5FA")
LINE = colors.HexColor("#D9DFEA")


def register_fonts() -> tuple[str, str]:
    regular = Path("C:/Windows/Fonts/arial.ttf")
    bold = Path("C:/Windows/Fonts/arialbd.ttf")
    if regular.exists() and bold.exists():
        pdfmetrics.registerFont(TTFont("GuideSans", str(regular)))
        pdfmetrics.registerFont(TTFont("GuideSans-Bold", str(bold)))
        return "GuideSans", "GuideSans-Bold"
    return "Helvetica", "Helvetica-Bold"


FONT, FONT_BOLD = register_fonts()


def inline(text: str) -> str:
    value = escape(text.strip())
    value = re.sub(r"`([^`]+)`", r'<font name="Courier">\1</font>', value)
    value = re.sub(r"\*\*([^*]+)\*\*", rf'<font name="{FONT_BOLD}">\1</font>', value)
    return value


styles = getSampleStyleSheet()
TITLE = ParagraphStyle(
    "Title",
    parent=styles["Title"],
    fontName=FONT_BOLD,
    fontSize=25,
    leading=29,
    textColor=BLUE,
    alignment=TA_LEFT,
    spaceAfter=8 * mm,
)
H1 = ParagraphStyle(
    "H1",
    parent=styles["Heading1"],
    fontName=FONT_BOLD,
    fontSize=16,
    leading=20,
    textColor=BLUE,
    spaceBefore=7 * mm,
    spaceAfter=3 * mm,
)
H2 = ParagraphStyle(
    "H2",
    parent=styles["Heading2"],
    fontName=FONT_BOLD,
    fontSize=12,
    leading=15,
    textColor=ORANGE,
    spaceBefore=4 * mm,
    spaceAfter=2 * mm,
)
H3 = ParagraphStyle(
    "H3",
    parent=styles["Heading3"],
    fontName=FONT_BOLD,
    fontSize=10.5,
    leading=13,
    textColor=INK,
    spaceBefore=3 * mm,
    spaceAfter=1.5 * mm,
)
BODY = ParagraphStyle(
    "Body",
    parent=styles["BodyText"],
    fontName=FONT,
    fontSize=9.3,
    leading=13.2,
    textColor=INK,
    spaceAfter=2.2 * mm,
)
BULLET = ParagraphStyle(
    "Bullet",
    parent=BODY,
    leftIndent=5 * mm,
    firstLineIndent=-3 * mm,
    bulletIndent=1.5 * mm,
    spaceAfter=1.2 * mm,
)
CODE = ParagraphStyle(
    "Code",
    parent=BODY,
    fontName="Courier",
    fontSize=7.5,
    leading=10,
    leftIndent=4 * mm,
    rightIndent=4 * mm,
    borderColor=LINE,
    borderWidth=0.6,
    borderPadding=3 * mm,
    backColor=PALE,
    spaceBefore=1.5 * mm,
    spaceAfter=3 * mm,
)
TABLE_HEADER = ParagraphStyle(
    "TableHeader",
    parent=BODY,
    fontName=FONT_BOLD,
    fontSize=7.8,
    leading=10,
    textColor=colors.white,
    alignment=TA_LEFT,
)
TABLE_BODY = ParagraphStyle(
    "TableBody",
    parent=BODY,
    fontSize=7.5,
    leading=9.5,
    spaceAfter=0,
)


class GuideDoc(BaseDocTemplate):
    def __init__(self, filename: str):
        super().__init__(
            filename,
            pagesize=A4,
            leftMargin=17 * mm,
            rightMargin=17 * mm,
            topMargin=19 * mm,
            bottomMargin=17 * mm,
            title="Context Saver 1.0 - Guia completo",
            author="Casa do Construtor",
        )
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="content")
        self.addPageTemplates(PageTemplate(id="guide", frames=[frame], onPage=self.draw_page))

    def draw_page(self, canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.5)
        canvas.line(self.leftMargin, A4[1] - 12 * mm, A4[0] - self.rightMargin, A4[1] - 12 * mm)
        canvas.setFont(FONT_BOLD, 7.5)
        canvas.setFillColor(BLUE)
        canvas.drawString(self.leftMargin, A4[1] - 9.5 * mm, "CONTEXT SAVER 1.0")
        canvas.setFont(FONT, 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawRightString(A4[0] - self.rightMargin, 9 * mm, f"Página {doc.page}")
        canvas.restoreState()


def markdown_table(lines: list[str], width: float) -> Table:
    rows = []
    for index, line in enumerate(lines):
        if index == 1:
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        style = TABLE_HEADER if index == 0 else TABLE_BODY
        rows.append([Paragraph(inline(cell), style) for cell in cells])
    columns = len(rows[0])
    if columns == 2:
        col_widths = [width * 0.31, width * 0.69]
    elif columns == 3:
        col_widths = [width * 0.27, width * 0.22, width * 0.51]
    else:
        col_widths = [width / columns] * columns
    table = Table(rows, colWidths=col_widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), BLUE),
                ("GRID", (0, 0), (-1, -1), 0.45, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALE]),
            ]
        )
    )
    return table


def build_story(markdown: str, width: float):
    story = []
    lines = markdown.replace("\u2011", "-").splitlines()
    i = 0
    first_title = True
    while i < len(lines):
        line = lines[i].rstrip()
        if not line:
            i += 1
            continue
        if line.startswith("```"):
            language = line[3:].strip()
            i += 1
            block = []
            while i < len(lines) and not lines[i].startswith("```"):
                block.append(lines[i])
                i += 1
            label = f"{language}\n" if language else ""
            story.append(Paragraph(escape(label + "\n".join(block)).replace("\n", "<br/>"), CODE))
            i += 1
            continue
        if line.startswith("|") and i + 1 < len(lines) and re.match(r"^\|?\s*:?-+", lines[i + 1]):
            table_lines = [line, lines[i + 1]]
            i += 2
            while i < len(lines) and lines[i].startswith("|"):
                table_lines.append(lines[i])
                i += 1
            story.extend([Spacer(1, 1.5 * mm), markdown_table(table_lines, width), Spacer(1, 3 * mm)])
            continue
        if line.startswith("# "):
            if not first_title:
                story.append(PageBreak())
            story.append(Paragraph(inline(line[2:]), TITLE))
            first_title = False
        elif line.startswith("## "):
            story.append(Paragraph(inline(line[3:]), H1))
        elif line.startswith("### "):
            story.append(Paragraph(inline(line[4:]), H2))
        elif line.startswith("#### "):
            story.append(Paragraph(inline(line[5:]), H3))
        elif line.startswith("- "):
            story.append(Paragraph(inline(line[2:]), BULLET, bulletText="•"))
        else:
            paragraph = [line]
            i += 1
            while i < len(lines) and lines[i].strip() and not re.match(r"^(#{1,4} |-|\||```)", lines[i]):
                paragraph.append(lines[i].strip())
                i += 1
            story.append(Paragraph(inline(" ".join(paragraph)), BODY))
            continue
        i += 1
    return story


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = GuideDoc(str(OUTPUT))
    story = build_story(SOURCE.read_text(encoding="utf-8"), doc.width)
    story.insert(
        1,
        KeepTogether(
            [
                Paragraph("Documentação técnica e operacional", H2),
                Paragraph(
                    "Nós provider-neutral para reduzir contexto, preservar fatos críticos e recuperar detalhes exatos sob demanda.",
                    BODY,
                ),
                Spacer(1, 3 * mm),
            ]
        ),
    )
    doc.build(story)
    print(OUTPUT)


if __name__ == "__main__":
    main()
