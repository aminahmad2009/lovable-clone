# Changelog

All notable changes to **Lovable Local** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

- **Product ID:** `codewoxy-lovable-local`
- **Built by:** CodeWoxy
- **Version source of truth:** `package.json` → `version`, surfaced at runtime by
  `server/config.js` (`APP_VERSION`, `PRODUCT_ID`), by `GET /api/health`, and by the
  version chip in the sidebar (click it for the About panel).

---

## [Unreleased]

### Added
- **Local Skills Repository**: Created `local_skills_repo/` directory with top 50 skills per category, fetched from the curated skills catalog and organized by category
- **Dynamic Skills Factory**: Modified `/api/skills-factory/*` endpoints to load skills from the local repository instead of hardcoded lists, with fallback to curated list
- **Skills Factory Update Scripts**: Added `generate_local_skills.mjs` and `update_skills_factory.mjs` to automate skills repository generation and factory updates
- **MCP Factory Preparation**: Laid groundwork for similar local-first approach for MCP servers (to be implemented)

### Changed
- **Skills Factory Endpoints**: Updated `/api/skills-factory/search`, `/api/skills-factory/skill/:id`, `/api/skills-factory/import`, and `/api/skills-factory/leaderboard` to use dynamic loading from local repository
- **Import Statements**: Added necessary `fs/promises` imports for directory and file operations in server/index.js

---

## [0.2.0] — 2026-09-22