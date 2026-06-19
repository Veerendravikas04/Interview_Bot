"""GitHub profile enrichment.

Fetches a candidate's PUBLIC GitHub signals (repos, languages, recent activity,
contribution streak) so both the ATS report AND the chat agent can review them the
way a recruiter would: "last push 8 months ago — reads as inactive", "top repo X
has 240 stars", "142-day streak". All numbers are FACTUAL (straight from the
GitHub API); the LLM only writes prose around them.

This module is SYNC (httpx.Client) so the LangGraph tool node (sync) can call it
directly; the async ATS path calls it via asyncio.to_thread so the event loop
stays free. GITHUB_TOKEN (env, optional) lifts the 60→5000/hr rate limit and
unlocks the streak via GraphQL. Every failure logs and returns None — GitHub is
enrichment, never a hard dependency.
"""
import os
import re
import time
from datetime import datetime, timezone

import httpx
import structlog

from app.core import config as cfg

logger = structlog.get_logger(__name__)

_GITHUB_RESERVED = {
    "orgs", "sponsors", "marketplace", "topics", "collections", "trending",
    "settings", "notifications", "explore", "about", "pricing", "features",
    "enterprise", "login", "join", "search", "apps", "dashboard",
}
_GITHUB_URL_RE = re.compile(r"github\.com/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))", re.IGNORECASE)
_USERNAME_RE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$")


def extract_github_username(text: str) -> str | None:
    """Pull a GitHub username from free text — a github.com URL, or a bare handle."""
    if not text:
        return None
    for m in _GITHUB_URL_RE.finditer(text):
        if m.group(1).lower() not in _GITHUB_RESERVED:
            return m.group(1)
    # Bare single-token handle (e.g. the LLM passes just "octocat" or "@octocat").
    token = text.strip().split()[0].lstrip("@").rstrip("/").split("/")[-1] if text.strip() else ""
    if _USERNAME_RE.match(token) and token.lower() not in _GITHUB_RESERVED:
        return token
    return None


def _headers() -> dict:
    h = {"Accept": "application/vnd.github+json", "User-Agent": "Caliber-ATS"}
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def _days_since(iso_ts: str | None) -> int | None:
    if not iso_ts:
        return None
    try:
        dt = datetime.fromisoformat(iso_ts.replace("Z", "+00:00"))
        return max(0, (datetime.now(timezone.utc) - dt).days)
    except Exception:
        return None


def _fetch_streak(client: httpx.Client, username: str) -> dict:
    """Contribution streak via GraphQL — needs a token. Returns {} otherwise."""
    if "Authorization" not in _headers():
        return {}
    query = (
        "query($login:String!){user(login:$login){contributionsCollection{"
        "contributionCalendar{totalContributions weeks{contributionDays{date contributionCount}}}}}}"
    )
    try:
        resp = client.post(cfg.GITHUB_GRAPHQL, headers=_headers(),
                           json={"query": query, "variables": {"login": username}})
        if resp.status_code != 200:
            return {}
        cal = (resp.json().get("data", {}).get("user", {}) or {}).get(
            "contributionsCollection", {}).get("contributionCalendar", {})
        days = [d for w in cal.get("weeks", []) for d in w.get("contributionDays", [])]
        days.sort(key=lambda d: d.get("date", ""))
        current = 0
        for d in reversed(days):
            if d.get("contributionCount", 0) > 0:
                current += 1
            elif current == 0:
                continue
            else:
                break
        longest = run = 0
        for d in days:
            run = run + 1 if d.get("contributionCount", 0) > 0 else 0
            longest = max(longest, run)
        return {
            "total_contributions_last_year": cal.get("totalContributions", 0),
            "current_streak": current,
            "longest_streak": longest,
        }
    except Exception as e:
        logger.warning("github_streak_failed", username=username, error=str(e))
        return {}


def _has_readme(client: httpx.Client, owner: str, repo: str) -> bool | None:
    """True/False if a repo has a README; None if we couldn't tell (rate-limited)."""
    try:
        resp = client.get(f"{cfg.GITHUB_API}/repos/{owner}/{repo}/readme", headers=_headers())
        if resp.status_code == 200:
            return True
        if resp.status_code == 404:
            return False
        return None
    except Exception:
        return None


def _recent_commits(client: httpx.Client, username: str) -> list[dict]:
    """Recent commit messages from the user's public push events (last ~90 days)."""
    try:
        resp = client.get(f"{cfg.GITHUB_API}/users/{username}/events/public",
                          headers=_headers(), params={"per_page": 100})
        if resp.status_code != 200:
            return []
        out = []
        for ev in resp.json():
            if ev.get("type") != "PushEvent":
                continue
            repo = (ev.get("repo", {}) or {}).get("name", "")
            when = ev.get("created_at")
            for cm in (ev.get("payload", {}) or {}).get("commits", []) or []:
                msg = (cm.get("message") or "").splitlines()[0][:120]
                if msg:
                    out.append({"repo": repo.split("/")[-1], "message": msg, "date": when})
                if len(out) >= cfg.GITHUB_RECENT_COMMITS:
                    return out
        return out
    except Exception:
        return []


def fetch_github_profile(username: str) -> dict | None:
    """Fetch the FULL factual public picture for a username: profile, every owned
    repo (with README/description gaps), recent commits, languages, streak,
    profile-README. None on failure. SYNC. (A GITHUB_TOKEN avoids rate limits.)"""
    if not username:
        return None
    started = time.monotonic()
    logger.info("github_fetch_started", username=username, authed="Authorization" in _headers())
    try:
        with httpx.Client(timeout=cfg.GITHUB_TIMEOUT) as client:
            user_resp = client.get(f"{cfg.GITHUB_API}/users/{username}", headers=_headers())
            if user_resp.status_code == 404:
                logger.info("github_user_not_found", username=username)
                return None
            if user_resp.status_code == 403:
                logger.warning("github_rate_limited", username=username)
                return None
            if user_resp.status_code != 200:
                logger.warning("github_fetch_failed", username=username, status=user_resp.status_code)
                return None
            user = user_resp.json()

            repos_resp = client.get(
                f"{cfg.GITHUB_API}/users/{username}/repos",
                headers=_headers(), params={"sort": "pushed", "per_page": 100, "type": "owner"},
            )
            repos = repos_resp.json() if repos_resp.status_code == 200 else []
            if not isinstance(repos, list):
                repos = []

            own = [r for r in repos if not r.get("fork")]
            lang_counts: dict[str, int] = {}
            for r in own:
                if r.get("language"):
                    lang_counts[r["language"]] = lang_counts.get(r["language"], 0) + 1
            languages = [l for l, _ in sorted(lang_counts.items(), key=lambda x: x[1], reverse=True)][: cfg.GITHUB_TOP_LANGUAGES]

            # Full inventory (most-recently-pushed first), README-probed up to the cap.
            ordered = sorted(own, key=lambda r: (r.get("stargazers_count", 0), r.get("pushed_at") or ""), reverse=True)
            inventory = []
            for i, r in enumerate(ordered[: cfg.GITHUB_ALL_REPOS_MAX]):
                name = r.get("name")
                has_readme = _has_readme(client, username, name) if i < cfg.GITHUB_README_CHECK_MAX else None
                inventory.append({
                    "name": name,
                    "description": (r.get("description") or "").strip() or None,
                    "language": r.get("language"),
                    "stars": r.get("stargazers_count", 0),
                    "forks": r.get("forks_count", 0),
                    "has_readme": has_readme,
                    "last_push": r.get("pushed_at"),
                    "url": r.get("html_url"),
                })

            top_repos = inventory[: cfg.GITHUB_TOP_REPOS]
            recent_commits = _recent_commits(client, username)
            # Profile README = a repo named exactly like the user with a README.
            has_profile_readme = any(
                (r.get("name") or "").lower() == username.lower() for r in own
            ) and (_has_readme(client, username, username) is True)

            last_push = max((r.get("pushed_at") or "" for r in own), default="") or None
            days_since = _days_since(last_push)
            streak = _fetch_streak(client, username)

        checked = [r for r in inventory if r["has_readme"] is not None]
        no_readme = [r["name"] for r in checked if r["has_readme"] is False]
        no_desc = [r["name"] for r in inventory if not r["description"]]

        profile = {
            "username": username,
            "name": user.get("name"),
            "bio": user.get("bio"),
            "profile_url": user.get("html_url"),
            "public_repos": user.get("public_repos", 0),
            "owned_repos": len(own),
            "followers": user.get("followers", 0),
            "account_created": user.get("created_at"),
            "account_age_years": (_days_since(user.get("created_at")) or 0) // 365,
            "languages": languages,
            "top_repos": top_repos,
            "all_repos": inventory,
            "recent_commits": recent_commits,
            "repos_without_readme": no_readme,
            "repos_without_description": no_desc,
            "has_profile_readme": has_profile_readme,
            "total_stars": sum(r.get("stargazers_count", 0) for r in own),
            "last_push": last_push,
            "days_since_active": days_since,
            "active": (days_since is not None and days_since <= cfg.GITHUB_ACTIVE_DAYS),
            **streak,
        }
        logger.info("github_fetch_ok", username=username, owned_repos=len(own),
                    inventory=len(inventory), recent_commits=len(recent_commits),
                    no_readme=len(no_readme), has_profile_readme=has_profile_readme,
                    days_since_active=days_since, active=profile["active"],
                    streak=streak.get("current_streak"),
                    latency_ms=int((time.monotonic() - started) * 1000))
        return profile
    except httpx.TimeoutException:
        logger.warning("github_fetch_failed", username=username, reason="timeout")
        return None
    except Exception as e:
        logger.warning("github_fetch_failed", username=username, reason="exception", error=str(e))
        return None


def format_profile_summary(p: dict) -> str:
    """The FULL factual picture for the chat agent to ground its review in.

    Lists every owned repo with its real gaps (README/description/stars), recent
    commits, languages and streak — so the model reviews the candidate's ACTUAL
    GitHub by name and never invents repos, metrics, or 'no README' assumptions.
    """
    L = [f"GitHub profile @{p['username']} — FACTUAL DATA. Base your entire review on this; "
         "reference repos by their REAL names; never invent repos, stars, or commits."]
    if p.get("name"):
        L.append(f"Name: {p['name']}")
    if p.get("bio"):
        L.append(f"Bio: {p['bio']}")
    L.append(f"Public repos: {p['public_repos']} (owned non-fork: {p['owned_repos']}) · "
             f"Followers: {p['followers']} · Total stars: {p['total_stars']} · Account age: ~{p.get('account_age_years', 0)}y")
    if p.get("languages"):
        L.append(f"Languages: {', '.join(p['languages'])}")
    if p.get("current_streak") is not None:
        L.append(f"Streak: {p['current_streak']}d current / {p.get('longest_streak')}d longest · "
                 f"{p.get('total_contributions_last_year')} contributions last year")
    if p.get("days_since_active") is not None:
        L.append(f"Last push: {p['days_since_active']}d ago → {'ACTIVE' if p['active'] else 'INACTIVE'}")
    L.append(f"Profile README (github.com/{p['username']}/{p['username']}): "
             f"{'PRESENT' if p.get('has_profile_readme') else 'MISSING'}")

    repos = p.get("all_repos") or []
    if repos:
        L.append(f"\nALL REPOSITORIES ({len(repos)} shown):")
        for r in repos:
            bits = [f"{r['stars']}★"]
            if r.get("language"):
                bits.append(r["language"])
            if r.get("has_readme") is False:
                bits.append("NO README")
            elif r.get("has_readme") is True:
                bits.append("has README")
            if not r.get("description"):
                bits.append("NO description")
            L.append(f"  • {r['name']} ({', '.join(bits)})" + (f" — {r['description']}" if r.get("description") else ""))
    if p.get("repos_without_readme"):
        L.append(f"\nRepos missing a README: {', '.join(p['repos_without_readme'])}")
    if p.get("repos_without_description"):
        L.append(f"Repos missing a description: {', '.join(p['repos_without_description'][:15])}")

    if p.get("recent_commits"):
        L.append("\nRECENT COMMITS (most recent first):")
        for c in p["recent_commits"]:
            L.append(f"  • [{c['repo']}] {c['message']}")
    else:
        L.append("\nRECENT COMMITS: none visible via the public events API — the candidate's recent pushes "
                 "may be in PRIVATE repos. Do NOT invent commit messages; if you mention commits, say recent "
                 "activity isn't publicly visible.")
    if p.get("total_stars", 0) == 0:
        L.append("Note: 0 public stars (this is real — say so plainly; it's normal for early-career devs).")
    return "\n".join(L)
