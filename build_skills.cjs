const fs = require('fs');
const path = require('path');

const localSkillsRepoPath = path.join(__dirname, 'local_skills_repo');

// Function to extract frontmatter (simplistic)
function extractFrontmatter(content) {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!frontmatterMatch) return {};
  const text = frontmatterMatch[1];
  const obj = {};
  text.split('\n').forEach(line => {
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (match) {
      let key = match[1];
      let value = match[2].trim();
      // Remove surrounding quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      // Try to parse as number
      if (!isNaN(value) && value !== '') {
        value = Number(value);
      }
      // Try to parse as boolean
      if (value === 'true') value = true;
      if (value === 'false') value = false;
      // Try to parse as array (if starts with [ and ends with ])
      if (value.startsWith('[') && value.endsWith(']')) {
        try {
          value = JSON.parse(value);
        } catch (e) {
          // keep as string
        }
      }
      obj[key] = value;
    }
  });
  return obj;
}

// Walk the directory to find all SKILL.md files
function getSkillFiles(dir) {
  const files = [];
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...getSkillFiles(fullPath));
    } else if (item === 'SKILL.md') {
      files.push(fullPath);
    }
  }
  return files;
}

// Build skill object from frontmatter and file path
function buildSkill(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const fm = extractFrontmatter(content);
  
  // Determine skill id and category from path
  const relativePath = path.relative(localSkillsRepoPath, filePath);
  const parts = relativePath.split(path.sep);
  // Expect: local_skills_repo/category/skill-name/SKILL.md
  let skillId = null;
  let category = null;
  if (parts.length >= 3 && parts[0] === 'local_skills_repo') {
    category = parts[1];
    skillId = parts[2];
  }
  // Fallbacks
  if (!skillId) {
    skillId = fm.slug || fm.id || path.basename(filePath, '.md');
  }
  if (!category) {
    category = fm.category || 'general';
  }
  
  // Build skill object
  const skill = {
    id: skillId,
    name: fm.name || skillId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    icon: fm.icon || '🧩',
    description: fm.description || `A skill for ${skillId}`,
    tags: Array.isArray(fm.tags) ? fm.tags : [category, fm.tags].filter(Boolean).flat(),
    brief: fm.brief || `Skill: ${skill.name.toUpperCase()}. ${fm.description || 'A skill for ' + skillId}`,
    source: fm.source || 'local',
    installs: fm.installs || 100,
    weeklyInstalls: Array.isArray(fm.weeklyInstalls) ? fm.weeklyInstalls : [10, 12, 8, 15, 10],
    isOfficial: fm.source === 'builtin',
    url: `https://example.com/public/skills/${skillId}.json`,
    filePath: `local_skills_repo/${category}/${skillId}.json`,
    version: fm.version || '1.0.0',
    author: fm.author || 'Local Skills Repository',
    license: fm.license || 'MIT',
    repository: {
      type: 'git',
      url: `https://github.com/lovable-local/${skillId}-skill.git`
    },
    keywords: [...(Array.isArray(fm.tags) ? fm.tags : [category, fm.tags].filter(Boolean).flat()), 'skill', 'ai', 'agent', 'lovable'],
    dependencies: {},
    devDependencies: {},
    peerDependencies: {},
    engines: {
      node: ">=14.0.0"
    },
    scripts: {
      test: "echo \"Error: no test specified\" && exit 1"
    }
  };
  return skill;
}

console.log('Scanning for SKILL.md files...');
const skillFiles = getSkillFiles(localSkillsRepoPath);
console.log(`Found ${skillFiles.length} SKILL.md files`);

const skills = [];
let errors = 0;
for (const file of skillFiles) {
  try {
    const skill = buildSkill(file);
    skills.push(skill);
  } catch (e) {
    console.error(`Error processing ${file}:`, e.message);
    errors++;
  }
}

// Sort by id
skills.sort((a, b) => a.id.localeCompare(b.id));

// Write to skills.json
const outPath = path.join(localSkillsRepoPath, 'skills.json');
fs.writeFileSync(outPath, JSON.stringify(skills, null, 2));
console.log(`\nWrote ${skills.length} skills to ${outPath}`);
if (errors > 0) {
  console.log(`Encountered ${errors} errors`);
}

// Show a few examples
console.log('\nFirst 3 skills:');
skills.slice(0, 3).forEach(s => {
  console.log(`  ${s.id}: ${s.name}`);
});