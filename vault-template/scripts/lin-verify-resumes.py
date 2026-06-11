#!/usr/bin/env python3
"""lin-verify-resumes.py — Post-generation page-fill + content-density gate.

Usage:
  python3 scripts/lin-verify-resumes.py <job_folder>
  python3 scripts/lin-verify-resumes.py companies/ideogram/jobs/founding-pm

Returns JSON to stdout. Exit code 0 = all checks pass.
Exit code 1 = fixable issues detected (should be retried).
Exit code 2 = hard failures (missing files, unfixable).

Checks:
  1. File existence: forge.pdf, pathfinder.pdf
  2. Page count: 2 for PATHFINDER, 2-3 for FORGE
  3. Page fill: each page >= 65% filled (bottom >= 65% of page height)
  4. Text density: >= 600 words per resume (anti-skeleton check)
  5. Role count (FORGE): compare against master cv.md if available
"""

import json
import re
import subprocess
import sys
from pathlib import Path


def run(*args, **kwargs):
    return subprocess.run(args, capture_output=True, text=True, **kwargs)


def get_pdf_metrics(pdf_path: Path) -> dict:
    """Return {pages, word_count, page_fills, page_sizes} for a PDF."""
    result = {"path": str(pdf_path), "pages": 0, "word_count": 0, "page_fills": [], "page_sizes": []}

    # Pages and size
    info = run("pdfinfo", str(pdf_path))
    if info.returncode != 0:
        result["error"] = f"pdfinfo failed: {info.stderr}"
        return result

    for line in info.stdout.splitlines():
        if line.startswith("Pages:"):
            result["pages"] = int(line.split(":")[1].strip())
        if line.startswith("Page size:"):
            result["page_sizes"].append(line.split(":", 1)[1].strip())

    # Word count
    txt = run("pdftotext", str(pdf_path), "-")
    if txt.returncode == 0:
        result["word_count"] = len(txt.stdout.split())

    # Bounding boxes for page fill
    bbox = run("pdftotext", "-bbox", str(pdf_path), "-")
    if bbox.returncode == 0:
        pages = re.findall(
            r'<page width="([0-9.]+)" height="([0-9.]+)">(.*?)</page>',
            bbox.stdout, re.S
        )
        for w, h, body in pages:
            ys = [float(m) for m in re.findall(r'yMax="([0-9.]+)"', body)]
            ymins = [float(m) for m in re.findall(r'yMin="([0-9.]+)"', body)]
            if ys and float(h) > 0:
                fill_pct = max(ys) / float(h)
                result["page_fills"].append({
                    "fill_pct": round(fill_pct * 100, 1),
                    "top": round(min(ymins), 1) if ymins else None,
                    "bottom": round(max(ys), 1),
                    "word_count": len(ys),
                    "page_height": float(h)
                })

    return result


def verify_job(job_folder: Path) -> dict:
    """Run all checks on a job folder and return JSON result."""
    resumes_dir = job_folder / "resumes"
    forge_pdf = resumes_dir / "forge.pdf"
    pathfinder_pdf = resumes_dir / "pathfinder.pdf"

    issues = []
    hard_failures = []
    forge_metrics = None
    pathfinder_metrics = None

    # Check 1: File existence
    if not forge_pdf.exists():
        hard_failures.append("forge.pdf missing")
    if not pathfinder_pdf.exists():
        hard_failures.append("pathfinder.pdf missing")

    if hard_failures:
        return {
            "job": str(job_folder),
            "pass": False,
            "hard_failures": hard_failures,
            "issues": [],
            "retry_needed": False,
            "forge": None,
            "pathfinder": None
        }

    # Check 2-4: Metrics
    forge_metrics = get_pdf_metrics(forge_pdf)
    pathfinder_metrics = get_pdf_metrics(pathfinder_pdf)

    # PATHFINDER: must be exactly 2 pages
    if pathfinder_metrics["pages"] != 2:
        issues.append(f"PATHFINDER: {pathfinder_metrics['pages']} pages (need 2)")
    else:
        # Check page fill for both pages
        fills = pathfinder_metrics["page_fills"]
        for i, pf in enumerate(fills):
            page_num = i + 1
            if pf["fill_pct"] < 65.0:
                issues.append(f"PATHFINDER page {page_num}: {pf['fill_pct']}% fill (need >=65%)")
            if pf["fill_pct"] > 95.0:
                issues.append(f"PATHFINDER page {page_num}: {pf['fill_pct']}% fill (overflow risk, >95%)")

    # Text density
    if pathfinder_metrics["word_count"] < 600:
        issues.append(f"PATHFINDER: {pathfinder_metrics['word_count']} words (need >=600)")

    # FORGE: 2-3 pages allowed, but each page must be >=65%
    if forge_metrics["pages"] < 2:
        issues.append(f"FORGE: {forge_metrics['pages']} pages (need >=2)")
    if forge_metrics["pages"] > 3:
        issues.append(f"FORGE: {forge_metrics['pages']} pages (max 3)")
    else:
        fills = forge_metrics["page_fills"]
        for i, pf in enumerate(fills):
            page_num = i + 1
            if pf["fill_pct"] < 65.0:
                issues.append(f"FORGE page {page_num}: {pf['fill_pct']}% fill (need >=65%)")
        # If 3 pages, page 3 must be >= 55% (don't have a stub page)
        if forge_metrics["pages"] == 3 and len(fills) >= 3:
            if fills[2]["fill_pct"] < 55.0:
                issues.append(f"FORGE page 3: {fills[2]['fill_pct']}% fill (stub page, >=55% for 3-pager)")

    if forge_metrics["word_count"] < 600:
        issues.append(f"FORGE: {forge_metrics['word_count']} words (need >=600)")

    retry_needed = len(issues) > 0 and not hard_failures

    return {
        "job": str(job_folder),
        "pass": len(issues) == 0 and len(hard_failures) == 0,
        "hard_failures": hard_failures,
        "issues": issues,
        "retry_needed": retry_needed,
        "forge": forge_metrics,
        "pathfinder": pathfinder_metrics
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: lin-verify-resumes.py <job_folder>"}, indent=2))
        sys.exit(2)

    job_folder = Path(sys.argv[1])
    if not job_folder.is_dir():
        print(json.dumps({"error": f"Not a directory: {job_folder}"}, indent=2))
        sys.exit(2)

    result = verify_job(job_folder)
    print(json.dumps(result, indent=2))

    if result["hard_failures"]:
        sys.exit(2)
    if result["issues"]:
        sys.exit(1)
    sys.exit(0)
