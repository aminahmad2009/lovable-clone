import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

// Import the CURATED_SKILLS from the server/curated-skills.js
// Since we are in an ES module, we can use dynamic import
const { CURATED_SKILLS } = await import('./server/curated-skills.js');

// Group by category (first tag or 'general')
const grouped = {};
CURATED_SKILLS.forEach(skill => {
  const category = (skill.tags && skill.tags.length > 0) ? skill.tags[0] : 'general';
  if (!grouped[category]) grouped[category] = [];
  grouped[category].push(skill);
});

// For each category, sort by installs (descending) and take top 50
const localRepoPath = join(process.cwd(), 'local_skills_repo');
await mkdir(localRepoPath, { recursive: true });

for (const [category, skills] of Object.entries(grouped)) {
  const sorted = skills
    .sort((a, b) => (b.installs || 0) - (a.installs || 0))
    .slice(0, 50);
  
  const categoryDir = join(localRepoPath, category);
  await mkdir(categoryDir, { recursive: true });
  
  const filePath = join(categoryDir, 'top_50.json');
  await writeFile(filePath, JSON.stringify(sorted, null, 2), 'utf8');
  console.log(`Generated ${filePath} with ${sorted.length} skills`);
}

console.log('Local skills repository generated successfully.');
