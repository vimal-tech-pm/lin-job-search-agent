#!/usr/bin/env python3
# Inject the 9 Lin cron jobs (8 LLM + the no_agent lin-track), created PAUSED.
# 1) Edit YOUR_TELEGRAM_CHAT_ID below (and models/providers for your setup).
# 2) Stop the gateway:  hermes -p lin gateway stop
# 3) Run:               python3 cron/inject-jobs.py
# 4) Restart gateway and resume jobs when ready: hermes -p lin cron resume <id>
# Kept for audit; idempotent (skips existing ids). Design: LIN-REARCHITECTURE-DESIGN.md §4.
import json
import copy

P = os.path.expanduser("~/.hermes/profiles/lin/cron/jobs.json")
d = json.load(open(P))
ids = {j["id"] for j in d["jobs"]}

BASE = {
    "base_url": None, "context_from": None, "repeat": {"times": None, "completed": 0},
    "enabled": False, "state": "paused", "paused_at": None,
    "paused_reason": "rearch cutover pending", "created_at": "2026-06-10T00:00:00-04:00",
    "next_run_at": None, "last_run_at": None, "last_status": None, "last_error": None,
    "last_delivery_error": None, "deliver": "telegram",
    "origin": {"platform": "telegram", "chat_id": "YOUR_TELEGRAM_CHAT_ID", "chat_name": "YOUR_CHAT", "thread_id": None},
    "workdir": os.path.expanduser("~/.hermes/profiles/lin/lin"), "profile": "lin",
    "no_agent": False, "script": None,
}

def job(id, name, skill, prompt, model, provider, sched, script=None, tools=None, extra_skills=None):
    j = copy.deepcopy(BASE)
    j.update({
        "id": id, "name": name, "skills": [skill] + (extra_skills or []), "skill": skill,
        "prompt": prompt, "model": model, "provider": provider, "script": script,
        "schedule": {"kind": "cron", "expr": sched, "display": sched}, "schedule_display": sched,
        "enabled_toolsets": tools,
    })
    return j

NEW = [
    job("lin-scan", "🔍 Lin scan", "lin-scan",
        'Run the lin-scan skill, verb "all", per its SKILL.md. Deliver the digest defined there.',
        "deepseek-v4-flash", "opencode-go", "30 8,20 * * *", "ensure_chrome_cdp.py",
        ["file", "web", "delegation", "terminal", "browser"]),
    job("lin-status", "📬 Lin status", "lin-status",
        'Run the lin-status skill, verb "check", per its SKILL.md. Deliver the digest defined there.',
        "deepseek-v4-flash", "opencode-go", "50 8,20 * * *", None,
        ["file", "terminal"], ["himalaya"]),
    job("lin-score", "🧮 Lin score", "lin-score",
        'Run the lin-score skill, verb "all", per its SKILL.md. Obey caps in career-profile/pipeline-config.json. Deliver the digest defined there.',
        "deepseek-v4-flash", "opencode-go", "15 9,21 * * *", None,
        ["file", "web", "delegation", "terminal"]),
    job("lin-stage", "🎯 Lin stage", "lin-stage",
        'Run the lin-stage skill, verb "auto", per its SKILL.md. Deliver the digest defined there.',
        "deepseek-v4-flash", "opencode-go", "0 10,22 * * *", "ensure_chrome_cdp.py",
        ["file", "web", "terminal", "browser"]),
    job("lin-build", "🛠️ Lin build", "lin-build",
        'Run the lin-build skill, verb "batch", per its SKILL.md. Deliver the digest defined there, naming the model that built each role.',
        "gpt-5.5", "openai-codex", "30 10,22 * * *", None,
        ["file", "web", "terminal"]),
    job("lin-finalize", "📦 Lin finalize", "lin-finalize",
        'Run the lin-finalize skill, verb "batch", per its SKILL.md. Deliver the digest defined there.',
        "deepseek-v4-flash", "opencode-go", "15 11,23 * * *", None,
        ["file", "web", "terminal"]),
    job("lin-deep-prep", "🧠 Lin deep-prep", "lin-deep-prep",
        'Run the lin-deep-prep skill, verb "run", per its SKILL.md. Deliver the digest defined there.',
        "mimo-v2.5", "opencode-go", "45 11,23 * * *", None,
        ["file", "web", "terminal"]),
    job("lin-followups", "🔁 Lin follow-ups", "lin-status",
        'Run the lin-status skill, verb "followups", per its SKILL.md. Deliver the digest defined there.',
        "deepseek-v4-pro", "opencode-go", "0 15 * * 1-5", None,
        ["file"]),
]

tr = copy.deepcopy(BASE)
tr.update({
    "id": "lin-track", "name": "📊 Lin track (no_agent)", "skills": [], "skill": None,
    "prompt": "", "model": None, "provider": None, "no_agent": True,
    "script": "lin-track-digest.sh",
    "schedule": {"kind": "cron", "expr": "10 12,0 * * *", "display": "10 12,0 * * *"},
    "schedule_display": "10 12,0 * * *", "enabled_toolsets": None, "workdir": None,
})
NEW.append(tr)

for j in NEW:
    if j["id"] in ids:
        print("SKIP exists:", j["id"])
        continue
    d["jobs"].append(j)
    print("ADD:", j["id"])

json.dump(d, open(P, "w"), indent=2, ensure_ascii=False)
print("total jobs:", len(d["jobs"]))
