"""Application configuration."""

# LLM Context Limits
MAX_HISTORY_MESSAGES = 10    # cap by count first
MAX_HISTORY_TOKENS   = 4000  # then by tokens (small free models - half of the 8k production reference)
SUMMARY_THRESHOLD    = 20    # messages in thread before summarization kicks in
KEEP_RECENT          = 8     # messages always kept verbatim

# Web search (Tavily) — used by the web_search agent tool. The API key is read
# from the TAVILY_API_KEY env var at call time (see agent/tools.py).
TAVILY_URL          = "https://api.tavily.com/search"
TAVILY_MAX_RESULTS  = 5      # results requested per query
TAVILY_SEARCH_DEPTH = "basic"  # "basic" (fast) or "advanced" (deeper, slower)
TAVILY_TIMEOUT      = 10.0   # seconds before we give up on the search
TAVILY_MAX_CHARS    = 4000   # cap the formatted results fed back to the model

# Resume analysis (skill extraction / ATS report / LaTeX resume). Centralised so
# nothing is hard-coded at the call sites — tune the whole pipeline from here.
RESUME_PROMPT_MAX_CHARS = 15000   # how much resume text we feed an LLM prompt
ATS_REPORT_MAX_CHARS    = 5000    # cap on ATS-report JSON injected into the LaTeX prompt
LLM_REPORT_TIMEOUT      = 45.0    # hard ceiling (s) on a single report LLM call
ROLE_MAX_CHARS          = 120     # max length of a target-role string (validation)
SKILLS_TOP_N            = 12      # how many extracted skills we keep (by confidence)

# GitHub profile enrichment for the ATS report (Developer Profile Review). Reads
# the candidate's GitHub from links in their resume. GITHUB_TOKEN (env, optional)
# lifts the rate limit 60→5000/hr AND unlocks the contribution streak (GraphQL).
GITHUB_API           = "https://api.github.com"
GITHUB_GRAPHQL       = "https://api.github.com/graphql"
GITHUB_TIMEOUT       = 12.0       # seconds per GitHub request
GITHUB_TOP_REPOS     = 6          # how many top repos (by stars, non-fork) to surface
GITHUB_TOP_LANGUAGES = 6          # how many languages to surface
GITHUB_ACTIVE_DAYS   = 90         # last push within N days ⇒ "active" (recruiter lens)
# Deep enrichment so the review is grounded in the candidate's ACTUAL repos.
GITHUB_ALL_REPOS_MAX    = 40      # full repo inventory size handed to the model
GITHUB_README_CHECK_MAX = 25      # per-repo README probes (each is 1 API call; needs a token at scale)
GITHUB_RECENT_COMMITS   = 15      # recent commit messages pulled from public events
