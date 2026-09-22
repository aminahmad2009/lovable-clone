const { readFile, writeFile } = require('node:fs/promises');
const filePath = 'server/index.js';
async function modify() {
  let content = await readFile(filePath, 'utf8');

  // 1. Add the getSkills function if not present
  if (!content.includes('// Skills factory: dynamic fetch from GitHub with fallback to curated list')) {
    const importIdx = content.indexOf('import { CURATED_MCP_SERVERS, MCP_CATEGORIES } from \'./curated-mcp.js\';');
    if (importIdx !== -1) {
      const insertPoint = importIdx + 'import { CURATED_MCP_SERVERS, MCP_CATEGORIES } from \'./curated-mcp.js\';'.length;
      const toInsert = `\n\n// Skills factory: dynamic fetch from GitHub with fallback to curated list\nlet skillsCache = null\nlet skillsCacheTimestamp = 0\nconst SKILLS_CACHE_TTL = 5 * 60 * 1000 // 5 minutes\n\nasync function fetchSkillsFromGitHub() {\n  try {\n    // Fetch the list of skills directories\n    const response = await fetch('https://api.github.com/repos/vercel-labs/skills/contents/skills')\n    if (!response.ok) throw new Error(\`GitHub API error: \${response.status}\`)\n    const skillsDirs = await response.json()\n\n    // Fetch each skill's skill.json\n    const skillsPromises = skillsDirs\n      .filter(dir => dir.type === 'dir')\n      .map(async dir => {\n        try {\n          const skillResponse = await fetch(\`https://raw.githubusercontent.com/vercel-labs/skills/main/skills/\${dir.name}/skill.json\`)\n          if (!skillResponse.ok) {\n            console.warn(\`Failed to fetch skill.json for \${dir.name}: \${skillResponse.status}\`)\n            return null\n          }\n          const skillData = await skillResponse.json()\n          return {\n            id: dir.name,\n            name: skillData.name || dir.name,\n            icon: '🧩', // Default icon, skill.json doesn't have icon\n            description: skillData.description || '',\n            tags: skillData.tags || [],\n            brief: skillData.brief || '',\n            source: 'skills.sh',\n            installs: skillData.installs || 0,\n            weeklyInstalls: skillData.weeklyInstalls || [],\n            isOfficial: skillData.isOfficial || false\n          }\n        } catch (err) {\n          console.error(\`Error processing skill \${dir.name}:\`, err)\n          return null\n        }\n      })\n\n    const skills = (await Promise.all(skillsPromises)).filter(Boolean)\n    return skills\n  } catch (err) {\n    console.error('Failed to fetch skills from GitHub, falling back to curated list:', err)\n    return null\n  }\n}\n\nasync function getSkills() {\n  const now = Date.now()\n  if (skillsCache && (now - skillsCacheTimestamp) < SKILLS_CACHE_TTL) {\n    return skillsCache\n  }\n  const fetchedSkills = await fetchSkillsFromGitHub()\n  if (fetchedSkills) {\n    skillsCache = fetchedSkills\n    skillsCacheTimestamp = now\n    return skillsCache\n  }\n  // Fallback to curated list\n  return CURATED_SKILLS\n}\n`;
      content = content.slice(0, insertPoint) + toInsert + content.slice(insertPoint);
    }
  }

  // 2. Replace in skills factory search route
  const searchReplace = content.replace(
    /\/\/ Filter curated skills\n\s+let skills = CURATED_SKILLS\.filter\(s => \{/,
    `// Filter skills (dynamic or curated)\n  let skills = (await getSkills()).filter(s => {`
  );
  if (searchReplace !== content) {
    content = searchReplace;
  }

  // 3. Replace in skill detail route
  const detailReplace = content.replace(
    /const skill = CURATED_SKILLS\.find\(s => s\.id === params\.id\)/,
    `const skill = (await getSkills()).find(s => s.id === params.id)`
  );
  if (detailReplace !== content) {
    content = detailReplace;
  }

  // 4. Replace in import route
  const importReplace = content.replace(
    /const skillData = CURATED_SKILLS\.find\(s => s\.id === skillId\)/,
    `const skillData = (await getSkills()).find(s => s.id === skillId)`
  );
  if (importReplace !== content) {
    content = importReplace;
  }

  // 5. Replace in leaderboard route
  const leaderboardReplace = content.replace(
    /const skills = \[\]\.\w+CURATED_SKILLS\]/,
    `const skills = [...(await getSkills())]`
  );
  if (leaderboardReplace !== content) {
    content = leaderboardReplace;
  } else {
    // More precise pattern for leaderboard
    const leaderboardReplace2 = content.replace(
      /const skills = \[\]\.\w+CURATED_SKILLS\]\s*\.\s*filter\(s => s\.installs > 0\)\s*\.\s*sort\(\(a, b\) => b\.installs - a\.installs\)\s*\.\s*slice\(0, limit\)/,
      `const skills = [...(await getSkills())].filter(s => s.installs > 0).sort((a, b) => b.installs - a.installs).slice(0, limit)`
    );
    if (leaderboardReplace2 !== content) {
      content = leaderboardReplace2;
    }
  }

  await writeFile(filePath, content, 'utf8');
  console.log('File updated successfully');
}
modify().catch(console.error);
