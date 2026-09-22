---
name: feature-plan-before-build
description: Use /feature-plan-before-build when you are planning a new feature before implementation in a Lovable project. It helps Lovable review and plan new features without changing app behaviour. The goal is to plan new features without changing visible functionality.
license: Complete terms in LICENSE.txt
---

# feature-plan-before-build

Use this skill when planning a new feature before implementation in a Lovable project.

Before editing:
1. Explain the current problem in plain English.
2. Identify the affected feature, route, component, table, function, or integration.
3. Review recent changes where relevant.
4. Produce a short fix or implementation plan before making changes.

What to check:
- Define goal/user/story.
- Map routes/components/data.
- Add states and acceptance criteria.
- Recommend first build prompt.

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
