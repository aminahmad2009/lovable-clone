import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const filePath = join(process.cwd(), 'server', 'index.js');
let content = await readFile(filePath, 'utf8');

// We'll replace the entire skills factory section (from the import of skillCatalog to the MIME constant)
// with a new section that includes our local repository loading function.

// First, let's find the line where we import skillCatalog
const importSkillCatalogIdx = content.indexOf("import { skillCatalog, getSkill, createSkill, updateSkill, deleteSkill } from './skills.js'");
if (importSkillCatalogIdx === -1) {
  console.error("Could not find skillCatalog import");
  process.exit(1);
}

// We'll insert our local repository loading function right after the skillCatalog import.
// We'll also remove any previous GitHub fetching code that might have been inserted.

// Let's construct the new block to insert:
const newBlock = `

// Local skills factory: load from local_skills_repo
let skillsCache = null;
let skillsCacheTimestamp = 0;
const SKILLS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function loadSkillsFromLocalRepo() {
  try {
    const localRepoPath = join(process.cwd(), 'local_skills_repo');
    const categories = await fs.readdir(localRepoPath);
    const skills = [];

    for (const category of categories) {
      const categoryPath = join(localRepoPath, category);
      const stats = await fs.stat(categoryPath);
      if (stats.isDirectory()) {
        const top50Path = join(categoryPath, 'top_50.json');
        try {
          await fs.access(top50Path);
          const data = await fs.readFile(top50Path, 'utf8');
          const categorySkills = JSON.parse(data);
          skills.push(...categorySkills);
        } catch (err) {
          console.warn(\`Could not load top_50.json for category \${category}: \${err.message}\`);
        }
      }
    }

    return skills;
  } catch (err) {
    console.error('Failed to load skills from local repository:', err);
    return null;
  }
}

async function getSkills() {
  const now = Date.now();
  if (skillsCache && (now - skillsCacheTimestamp) < SKILLS_CACHE_TTL) {
    return skillsCache;
  }
  const fetchedSkills = await loadSkillsFromLocalRepo();
  if (fetchedSkills) {
    skillsCache = fetchedSkills;
    skillsCacheTimestamp = now;
    return skillsCache;
  }
  // Fallback to curated list
  return CURATED_SKILLS;
}
`;

// We need to import fs and path at the top of the file if not already present.
// Let's check if we have 'import { readdir, stat, access, readFile } from 'node:fs/promises'' or similar.
// We'll add the necessary imports at the top of the file after the existing imports.

// First, let's add the necessary imports for fs and path if they are not already imported.
// We'll look for the import statements at the top of the file.

// We'll split the content into lines to manipulate the imports.
const lines = content.split('\n');
let importSectionEnd = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].startsWith('import ') || lines[i].startsWith('export ')) {
    importSectionEnd = i + 1;
  } else if (lines[i].trim() === '' && importSectionEnd > 0) {
    // We'll stop at the first empty line after the import section
    break;
  }
}

// We'll insert the necessary imports for fs and path at the end of the import section.
// But note: we already have 'import path from 'node:path'' and 'import { readFile } from 'node:fs/promises''.
// Let's check what we have and add if missing.

// We'll do a simpler approach: just add the imports we need at the top if they are not present.
// We'll check for the strings we need.

// We need: 
//   import { readdir, stat, access, readFile } from 'node:fs/promises'
//   import { join } from 'node:path' (we already have path, but we use join)

// We already have:
//   import path from 'node:path'
//   import { readFile } from 'node:fs/promises'

// So we need to add: readdir, stat, access from 'node:fs/promises'

// Let's check if we already have them in the existing readFile import.
// We can change the existing readFile import to include the others.

// We'll look for the line that imports readFile from 'node:fs/promises' and update it.

const readFileImportIdx = content.indexOf("import { readFile } from 'node:fs/promises'");
if (readFileImportIdx !== -1) {
  // Replace that line with: import { readdir, stat, access, readFile } from 'node:fs/promises'
  const oldImport = "import { readFile } from 'node:fs/promises'";
  const newImport = "import { readdir, stat, access, readFile } from 'node:fs/promises'";
  content = content.replace(oldImport, newImport);
} else {
  // If we don't find it, we'll add it after the path import.
  const pathImportIdx = content.indexOf("import path from 'node:path'");
  if (pathImportIdx !== -1) {
    const insertPoint = pathImportIdx + "import path from 'node:path'".length;
    content = content.slice(0, insertPoint) + "\nimport { readdir, stat, access, readFile } from 'node:fs/promises'" + content.slice(insertPoint);
  }
}

// Now, we need to insert the newBlock after the skillCatalog import.
// We'll find the end of the importSkillCatalogIdx line and insert after that.
const importSkillCatalogLineEnd = content.indexOf('\n', importSkillCatalogIdx);
if (importSkillCatalogLineEnd === -1) {
  console.error("Could not find end of line for skillCatalog import");
  process.exit(1);
}

// Insert the newBlock right after that line.
content = content.slice(0, importSkillCatalogLineEnd + 1) + newBlock + content.slice(importSkillCatalogLineEnd + 1);

// Now, we need to update the skills factory routes to use getSkills() instead of CURATED_SKILLS.
// We'll do three replacements:

// 1. In the skills factory search route: replace "let skills = CURATED_SKILLS.filter" with "let skills = (await getSkills()).filter"
content = content.replace(
  /\/\/ Filter curated skills\n\s+let skills = CURATED_SKILLS\.filter\(s => \{/,
  `// Filter skills (from local repository)\n  let skills = (await getSkills()).filter(s => {`
);

// 2. In the skill detail route: replace "const skill = CURATED_SKILLS.find" with "const skill = (await getSkills()).find"
content = content.replace(
  /const skill = CURATED_SKILLS\.find\(s => s\.id === params\.id\)/,
  `const skill = (await getSkills()).find(s => s.id === params.id)`
);

// 3. In the import route: replace "const skillData = CURATED_SKILLS.find" with "const skillData = (await getSkills()).find"
content = content.replace(
  /const skillData = CURATED_SKILLS\.find\(s => s\.id === skillId\)/,
  `const skillData = (await getSkills()).find(s => s.id === skillId)`
);

// 4. In the leaderboard route: we need to replace the line that starts with "const skills = " and uses CURATED_SKILLS.
// We'll look for a line that has "const skills = " and then something with CURATED_SKILLS.
// We'll replace it with: const skills = [...(await getSkills())]
// But note: the leaderboard route might have a more complex expression. We'll try to match the pattern we saw before.
// We'll do a more general replacement: look for "const skills = " and then until the semicolon, and replace if it contains CURATED_SKILLS.

// We'll split by lines and process the leaderboard route.
// However, to keep it simple, we'll assume the leaderboard route is the one that returns top skills by installs.
// We'll look for the line that has "const skills = " and then a method chain that ends with .slice(0, limit)
// and replace the initial part.

// We'll use a regex to find the leaderboard route's skills initialization.
// We know the leaderboard route is at: route('GET', 
