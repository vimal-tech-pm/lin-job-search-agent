#!/usr/bin/env python3
"""Convert cover letter markdown to HTML, then render to PDF via generate-pdf.mjs."""
import sys, os, re, subprocess, tempfile

BASE = str(Path(__file__).resolve().parents[1])
PDF_SCRIPT = os.path.join(BASE, "engines/pathfinder/generate-pdf.mjs")

def md_to_html(md_path):
    with open(md_path) as f:
        md = f.read()
    
    # Extract content after the first heading (title line)
    lines = md.split('\n')
    body_lines = []
    in_body = False
    for line in lines:
        if line.startswith('>'):
            # strip leading '>' and one optional following space.
            # Handles both '> text' and bare '>' (blank separator) lines;
            # bare '>' becomes '' so paragraph breaks are preserved.
            stripped = line[1:]
            if stripped.startswith(' '):
                stripped = stripped[1:]
            body_lines.append(stripped)
            in_body = True
        elif in_body and line.strip() == '':
            body_lines.append('')
    
    body = '\n'.join(body_lines)
    
    # Build clean HTML for a one-page cover letter
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  body {{
    font-family: 'Georgia', 'Times New Roman', serif;
    font-size: 11.5pt;
    line-height: 1.6;
    color: #222;
    max-width: 6.5in;
    margin: 0.75in auto;
    padding: 0 0.2in;
  }}
  p {{ margin: 0 0 0.85em 0; }}
  .salutation {{ margin-top: 0; }}
  .closing {{ margin-top: 1.2em; }}
  .signature {{ margin-top: 2.5em; }}
  .signature p {{ margin: 0.15em 0; }}
  a {{ color: #1a73e8; text-decoration: none; }}
</style>
</head>
<body>
"""
    def md_links(text):
        # Convert markdown links [text](url) -> <a href="url">text</a>
        return re.sub(r'\[(.*?)\]\((.*?)\)', r'<a href="\2">\1</a>', text)

    # Split into paragraphs
    for para in body.strip().split('\n\n'):
        para = para.strip()
        if not para:
            continue
        if para.startswith('Dear '):
            html += f'<p class="salutation">{md_links(para)}</p>\n'
        elif para.startswith('Sincerely'):
            # The signature block is a single paragraph of consecutive lines:
            # "Sincerely," then name, then contact lines. Render the closing as
            # its own paragraph and the remaining lines inside the signature div.
            sig_lines = para.split('\n')
            html += f'<p class="closing">{md_links(sig_lines[0])}</p>\n'
            html += '<div class="signature">\n'
            for sig in sig_lines[1:]:
                sig = sig.strip()
                if not sig:
                    continue
                if sig.startswith('Alex Morgan'):
                    html += f'<p><strong>{sig}</strong></p>\n'
                else:
                    html += f'<p>{md_links(sig)}</p>\n'
            html += '</div>\n'
        else:
            # Preserve intra-paragraph line breaks as <br>
            html += f'<p>{md_links(para).replace(chr(10), "<br>")}</p>\n'
    
    html += '</body>\n</html>'
    return html

def render_pdf(md_path, pdf_path):
    html = md_to_html(md_path)
    html_path = pdf_path.replace('.pdf', '.html')
    with open(html_path, 'w') as f:
        f.write(html)
    
    result = subprocess.run(
        ['node', PDF_SCRIPT, html_path, pdf_path, '--format=letter'],
        cwd=BASE, capture_output=True, text=True, timeout=30,
        env={**os.environ, 'HOME': os.environ.get('LIN_REAL_HOME', os.environ['HOME'])}
    )
    if result.returncode != 0:
        print(f"ERROR rendering {pdf_path}: {result.stderr}")
        return False
    # Clean up temp HTML
    os.unlink(html_path)
    return True

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python cover-to-pdf.py <cover.md> [cover.md ...]")
        sys.exit(1)
    
    for md_path in sys.argv[1:]:
        pdf_path = md_path.replace('.md', '.pdf')
        print(f"{md_path} → {pdf_path}", end=' ')
        if render_pdf(md_path, pdf_path):
            print("✓")
        else:
            print("✗")
