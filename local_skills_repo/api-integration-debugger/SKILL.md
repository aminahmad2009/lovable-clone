---
name: api-integration-debugger
description: Use /api-integration-debugger when you have external API integration failures in a Lovable project. It helps Lovable review and resolve issues related to these integrations.
license: Complete terms in LICENSE.txt
---

# /api-integration-debugger

Use this skill when external API integration failures in a Lovable project.

Before editing:
1. Explain the current problem in plain English.
2. Identify the affected feature, route, component, table, function, or integration.
3. Review recent changes where relevant.
4. Produce a short fix or implementation plan before making changes.

What to check:
- Identify service and endpoint.
- Check auth method, headers, and body.
- Avoid exposing keys.
- Improve safe error handling.

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
