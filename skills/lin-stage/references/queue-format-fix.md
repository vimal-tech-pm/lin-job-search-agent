# Queue Format Fix — co_slug/job_slug at Top Level

## Problem

`lin-promote-evaluations.mjs` reads `role.co_slug` and `role.job_slug` where `role` is
the ENTIRE queue entry object. If the queue stores the `role` field as a string (e.g.
`"Sr Product Manager"`) and `co_slug`/`job_slug` are missing or None at the top level,
`path.join(VAULT, "companies", undefined, "jobs", undefined)` crashes with:

```
Fatal: The "path" argument must be of type string. Received undefined
```

This affects ~807 historical queue entries scored before the co_slug/job_slug fields
were added to the queue format.

## Fix

Run this Python script against `data/evaluation-queue.json`:

```python
import json, re
from pathlib import Path

qp = Path('data/evaluation-queue.json')
q = json.loads(qp.read_text())
roles = q.get('roles', [])
fixed = 0
for r in roles:
    role_field = r.get('role')
    if isinstance(role_field, dict):
        # Was incorrectly converted to object — flatten back to string + top-level slugs
        role_str = role_field.get('role', '')
        co_slug = role_field.get('co_slug', '')
        job_slug = role_field.get('job_slug', '')
        r['role'] = role_str
        r['co_slug'] = co_slug
        r['job_slug'] = job_slug
        fixed += 1
    elif isinstance(role_field, str) and not r.get('co_slug'):
        # Original format: role is string, no slugs
        co = r.get('company', '') or ''
        co_slug = re.sub(r'[^a-z0-9]+', '-', co.lower()).strip('-')
        job_slug = re.sub(r'[^a-z0-9]+', '-', role_field.lower()).strip('-')
        r['co_slug'] = co_slug
        r['job_slug'] = job_slug
        fixed += 1

q['roles'] = roles
qp.write_text(json.dumps(q, indent=2))
print(f'Fixed {fixed} entries')
```

## Also: Missing source_url

Some entries have `source_url: None` even though the candidate list shows a real URL.
Fix by mapping candidate URLs into the queue:

```python
import json
cand_data = json.load(open('/tmp/lin-candidates.json'))
cands = cand_data.get('candidates', cand_data) if isinstance(cand_data, dict) else cand_data
url_map = {str(c.get('id', '')): c.get('source_url', '') for c in cands if c.get('source_url', '').startswith('http')}

qp = Path('data/evaluation-queue.json')
q = json.loads(qp.read_text())
for r in q.get('roles', []):
    rid = str(r.get('id', ''))
    if rid in url_map and not r.get('source_url'):
        r['source_url'] = url_map[rid]
q['roles'] = roles
qp.write_text(json.dumps(q, indent=2))
```

## Also: Completely empty entries

Some LinkedIn-sourced entries have `company: None`, `role: None`, `co_slug: None`,
`job_slug: None`. Reconstruct from the URL slug:

```python
# Example: product-owner-ai-agents-and-platform-at-jerry-4426437208
# → company=Jerry, role=Product Owner, AI Agents and Platform
url = r.get('source_url', '')
if 'product-owner-ai-agents-and-platform' in url and 'jerry' in url:
    r['company'] = 'Jerry'
    r['role'] = 'Product Owner, AI Agents and Platform'
    r['co_slug'] = 'jerry'
    r['job_slug'] = 'product-owner-ai-agents-and-platform'
```

## Verification

After fixing, verify the promote script no longer crashes:
```bash
cd ~/.hermes/profiles/lin/lin
HOME=~ node scripts/lin-promote-evaluations.mjs --auto --liveness-file=/tmp/lin-liveness-stage.json 2>&1 | grep -c '\[stage\]'
```

Verified 2026-06-20: 12 roles staged successfully after applying all three fixes.