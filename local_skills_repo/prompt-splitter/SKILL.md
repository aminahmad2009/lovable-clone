---
name: prompt-splitter
description: Use /prompt-splitter when you have large, messy, multi-part, or risky requests in a Lovable project. It helps Lovable review and split large prompts into smaller, safer, and more testable prompts. The goal is to break down complex requests into manageable parts without changing visible functionality.
license: Complete terms in LICENSE.txt
---


# prompt-splitter

Use this skill when large, messy, multi-part, or risky requests in a Lovable project.

Before editing:
1. Explain the current problem in plain English.
2. Identify the affected feature, route, component, table, function, or integration.
3. Review recent changes where relevant.
4. Produce a short fix or implementation plan before making changes.

What to check:
- Identify separate tasks.
- Find dependencies.
- Convert to smaller prompts.
- Add a test point after each step.

Rules:
- Do not redesign unrelated parts of the app.
- Do not rewrite unrelated components.
- Do not change database schema unless clearly required.
- Do not expose private data or secrets.
- Prefer the smallest safe change.

Implementation:
1. Apply the smallest safe change first.
2. Keep each change narrow and testable.
3. Preserve existing working behaviour.
4. Add or recommend test scenarios.

Final output:
- Problem summary.
- Root cause or best diagnosis.
- Changes applied or recommended.
- Files, routes, tables, functions, or integrations affected.
- Risk level.
- Test checklist.
- Next recommended step.
