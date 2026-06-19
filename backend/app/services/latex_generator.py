import time
import json
import asyncio
import structlog
from typing import Optional

from app.core.llm import get_llm
from app.core import config as cfg
from app.db.client import get_db
from langchain_core.messages import HumanMessage

logger = structlog.get_logger(__name__)


def _clean_role(role: Optional[str]) -> Optional[str]:
    if not role:
        return None
    return " ".join(role.split())[: cfg.ROLE_MAX_CHARS].strip() or None


# Standard "Jake's Resume" preamble + macros. Raw string so backslashes are literal.
LATEX_TEMPLATE = r"""\documentclass[letterpaper,11pt]{article}

\usepackage{latexsym}
\usepackage[empty]{fullpage}
\usepackage{titlesec}
\usepackage{marvosym}
\usepackage[usenames,dvipsnames]{color}
\usepackage{verbatim}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\usepackage{fancyhdr}
\usepackage[english]{babel}
\usepackage{tabularx}

\pagestyle{fancy}
\fancyhf{}
\fancyfoot{}
\renewcommand{\headrulewidth}{0pt}
\renewcommand{\footrulewidth}{0pt}

\addtolength{\oddsidemargin}{-0.5in}
\addtolength{\evensidemargin}{-0.5in}
\addtolength{\textwidth}{1in}
\addtolength{\topmargin}{-0.5in}
\addtolength{\textheight}{1.0in}

\urlstyle{same}
\raggedbottom
\raggedright
\setlength{\tabcolsep}{0in}

\titleformat{\section}{
  \vspace{-4pt}\scshape\raggedright\large
}{}{0em}{}[\color{black}\titlerule \vspace{-5pt}]

\newcommand{\resumeItem}[1]{\item\small{{#1 \vspace{-2pt}}}}
\newcommand{\resumeSubheading}[4]{
  \vspace{-2pt}\item
    \begin{tabular*}{0.97\textwidth}[t]{l@{\extracolsep{\fill}}r}
      \textbf{#1} & #2 \\
      \textit{\small#3} & \textit{\small #4} \\
    \end{tabular*}\vspace{-7pt}
}
\newcommand{\resumeProjectHeading}[2]{
    \item
    \begin{tabular*}{0.97\textwidth}{l@{\extracolsep{\fill}}r}
      \small#1 & #2 \\
    \end{tabular*}\vspace{-7pt}
}
\newcommand{\resumeSubItem}[1]{\resumeItem{#1}\vspace{-4pt}}
\renewcommand\labelitemii{$\vcenter{\hbox{\tiny$\bullet$}}$}
\newcommand{\resumeSubHeadingListStart}{\begin{itemize}[leftmargin=0.15in, label={}]}
\newcommand{\resumeSubHeadingListEnd}{\end{itemize}}
\newcommand{\resumeItemListStart}{\begin{itemize}}
\newcommand{\resumeItemListEnd}{\end{itemize}\vspace{-5pt}}

\begin{document}
\section{Education}
  \resumeSubHeadingListStart
    \resumeSubheading{University Name}{City, State}{Degree Name}{Month Year}
  \resumeSubHeadingListEnd
\section{Experience}
  \resumeSubHeadingListStart
    \resumeSubheading{Company Name}{Month Year -- Month Year}{Job Title}{City, State}
      \resumeItemListStart
        \resumeItem{Bullet point...}
      \resumeItemListEnd
  \resumeSubHeadingListEnd
\section{Projects}
  \resumeSubHeadingListStart
    \resumeProjectHeading{\textbf{Project Name} $|$ \emph{Tech Stack}}{Month Year}
      \resumeItemListStart
        \resumeItem{Bullet point...}
      \resumeItemListEnd
  \resumeSubHeadingListEnd
\section{Technical Skills}
 \begin{itemize}[leftmargin=0.15in, label={}]
    \small{\item{\textbf{Languages}{: ...} \\ \textbf{Frameworks}{: ...} \\ \textbf{Tools}{: ...}}}
 \end{itemize}
\end{document}
"""


def _is_valid_latex(code: str) -> bool:
    """Structural sanity check — a usable resume must be a complete document."""
    return bool(code) and "\\documentclass" in code and "\\end{document}" in code


async def generate_latex_resume(resume_id: str, user_id: str, role: str = None) -> str:
    db = get_db()
    resume = db.resumes.find_one({"_id": resume_id, "user_id": user_id})
    if not resume:
        raise ValueError("Resume not found")

    role = _clean_role(role)

    # Cached LaTeX wins unless the caller asked for a specific (new) role.
    cached = resume.get("latex_resume")
    if cached and not role:
        logger.info("latex_cache_hit", resume_id=resume_id)
        return cached

    resume_text = resume.get("extracted_text", "")
    if not resume_text:
        raise ValueError("Resume text is empty. Cannot generate LaTeX resume.")

    # Reuse the cached ATS report (generate_ats_report only re-runs if role changed).
    from app.services.ats_report import generate_ats_report
    ats_report = await generate_ats_report(resume_id, user_id, role)

    prompt_str = rf"""
You are an elite Resume Writer and LaTeX Expert.
Rewrite the candidate's raw resume into a professional, COMPILE-READY LaTeX document.
Incorporate the ATS analysis: add missing keywords naturally, fix weaknesses, use the improved bullets.

CANDIDATE'S ORIGINAL RAW RESUME:
{resume_text[:cfg.RESUME_PROMPT_MAX_CHARS]}

ATS ANALYSIS FEEDBACK TO INCORPORATE:
{json.dumps(ats_report)[:cfg.ATS_REPORT_MAX_CHARS]}

REQUIREMENTS:
1. Use the EXACT preamble and custom macros from the template below. DO NOT change the preamble.
2. Use \resumeSubheading for Education and Experience, and \resumeProjectHeading for Projects.
3. Use \resumeItemListStart and \resumeItem{{}} for bullet points.
4. ESCAPE all LaTeX special characters that appear in literal text: & % $ # _ {{ }} ~ ^ \
   (e.g. write "C\#", "20\% growth", "Node\_JS"). Never leave a raw % or & in body text — it breaks compilation.
5. ONLY output raw LaTeX, starting with \documentclass and ending with \end{{document}}. No markdown, no commentary.

=== REQUIRED LATEX TEMPLATE TO USE ===
{LATEX_TEMPLATE}
=== END LATEX TEMPLATE ===

Fill the template with the candidate's actual enhanced data. Output the LaTeX code and nothing else.
"""

    started = time.monotonic()
    logger.info("latex_started", resume_id=resume_id, role=role, chars=len(resume_text))
    response = await asyncio.wait_for(
        get_llm().ainvoke([HumanMessage(content=prompt_str)]),
        timeout=cfg.LLM_REPORT_TIMEOUT,
    )
    content = response.content

    # Strip markdown fences if the model wrapped the code.
    if "```latex" in content:
        content = content.split("```latex")[1].split("```")[0]
    elif "```tex" in content:
        content = content.split("```tex")[1].split("```")[0]
    elif "```" in content:
        content = content.split("```")[1]
    content = content.strip()

    if not _is_valid_latex(content):
        logger.warning("latex_invalid_output", resume_id=resume_id, chars=len(content))
        raise ValueError("Generated LaTeX was incomplete. Please try again.")

    db.resumes.update_one({"_id": resume_id, "user_id": user_id}, {"$set": {"latex_resume": content}})
    logger.info("latex_ok", resume_id=resume_id, chars=len(content),
                latency_ms=int((time.monotonic() - started) * 1000))
    return content
