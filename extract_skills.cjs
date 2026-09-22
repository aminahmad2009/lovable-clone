const fs = require('fs');
const path = require('path');

// Simple function to extract YAML frontmatter from markdown
function extractFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return {};
  
  const frontmatter = {};
  const lines = match[1].split('\n');
  
  for (const line of lines) {
    const [key, ...valueParts] = line.split(':');
    if (!key) continue;
    
    const value = valueParts.join(':').trim();
    
    // Handle different types
    if (value.startsWith('[') && value.endsWith(']')) {
      // Array
      try {
        frontmatter[key.trim()] = JSON.parse(value);
      } catch (e) {
        frontmatter[key.trim()] = value;
      }
    } else if (value.startsWith('{') && value.endsWith('}')) {
      // Object
      try {
        frontmatter[key.trim()] = JSON.parse(value);
      } catch (e) {
        frontmatter[key.trim()] = value;
      }
    } else if (value === 'true' || value === 'false') {
      // Boolean
      frontmatter[key.trim()] = value === 'true';
    } else if (!isNaN(value) && value !== '') {
      // Number
      frontmatter[key.trim()] = parseFloat(value);
    } else {
      // String - remove quotes
      let cleanValue = value;
      if ((cleanValue.startsWith('"') && cleanValue.endsWith('"')) ||
          (cleanValue.startsWith("'") && cleanValue.endsWith("'"))) {
        cleanValue = cleanValue.slice(1, -1);
      }
      frontmatter[key.trim()] = cleanValue;
    }
  }
  
  return frontmatter;
}

// Function to create a skill object from a SKILL.md file
function createSkillFromFile(filePath, repoRoot) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const frontmatter = extractFrontmatter(content);
    
    // Get the relative path from repo root
    const relativePath = path.relative(repoRoot, filePath);
    const parts = relativePath.split(path.sep);
    
    // Extract skill ID and category from path
    // Expected format: local_skills_repo/category/skill-name/SKILL.md
    let skillId = null;
    let category = null;
    
    const localSkillsIndex = parts.indexOf('local_skills_repo');
    if (localSkillsIndex !== -1 && parts.length > localSkillsIndex + 2) {
      category = parts[localSkillsIndex + 1];
      skillId = parts[localSkillsIndex + 2];
    }
    
    // Fallbacks
    if (!skillId) {
      skillId = frontmatter.slug || frontmatter.id || path.basename(filePath, '.md');
    }
    if (!category) {
      category = frontmatter.category || 'general';
    }
    
    // Build skill object
    const skill = {
      id: skillId,
      name: frontmatter.name || skillId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      icon: frontmatter.icon || '🧩',
      description: frontmatter.description || `A skill for ${skillId}`,
      tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [category, frontmatter.tags].filter(Boolean).flat(),
      brief: frontmatter.brief || 
            `Skill: ${skill.name.toUpperCase()}. ${frontmatter.description || 'A skill for ' + skillId}`,
      source: frontmatter.source || 'local',
      installs: frontmatter.installs || 100,
      weeklyInstalls: Array.isArray(frontmatter.weeklyInstalls) ? frontmatter.weeklyInstalls : 
                     [10, 12, 8, 15, 10],
      isOfficial: frontmatter.source === 'builtin',
      url: `https://example.com/public/skills/${skillId}.json`,
      filePath: `local_skills_repo/${category}/${skillId}.json`,
      version: frontmatter.version || '1.0.0',
      author: frontmatter.author || 'Local Skills Repository',
      license: frontmatter.license || 'MIT',
      repository: {
        type: 'git',
        url: `https://github.com/lovable-local/${skillId}-skill.git`
      },
      keywords: [...(Array.isArray(frontmatter.tags) ? frontmatter.tags : [category, frontmatter.tags].filter(Boolean).flat()), 
                'skill', 'ai', 'agent', 'lovable'],
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
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error.message);
    return null;
  }
}

// Main function
function updateSkillsJson() {
  const localSkillsRepoPath = path.join(__dirname, 'local_skills_repo');
  
  if (!fs.existsSync(localSkillsRepoPath)) {
    console.error('local_skills_repo directory not found');
    return;
  }
  
  // Find all SKILL.md files
  const skillFiles = [];
  
  function findSkillFiles(dir) {
    try {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const itemPath = path.join(dir, item);
        try {
          const stat = fs.statSync(itemPath);
          if (stat.isDirectory()) {
            findSkillFiles(itemPath);
          } else if (item === 'SKILL.md') {
            skillFiles.push(itemPath);
          }
        } catch (e) {
          // Skip files we can't stat
        }
      }
    } catch (e) {
      // Skip directories we can't read
    }
  }
  
  findSkillFiles(localSkillsRepoPath);
  
  console.log(`Found ${skillFiles.length} SKILL.md files`);
  
  // Process each file
  const skills = [];
  let successCount = 0;
  
  for (const file of skillFiles) {
    const skill = createSkillFromFile(file, localSkillsRepoPath);
    if (skill) {
      skills.push(skill);
      successCount++;
      if (successCount % 20 === 0) {
        console.log(`Processed ${successCount} skills...`);
      }
    }
  }
  
  // Sort by id
  skills.sort((a, b) => a.id.localeCompare(b.id));
  
  // Write to file
  const skillsJsonPath = path.join(localSkillsRepoPath, 'skills.json');
  fs.writeFileSync(skillsJsonPath, JSON.stringify(skills, null, 2));
  
  console.log(`\n✅ Updated skills.json with ${skills.length} skills`);
  
  // Show summary
  const categories = {};
  skills.forEach(skill => {
    const category = skill.tags[0] || 'unknown';
    categories[category] = (categories[category] || 0) + 1;
  });
  
  console.log('\nTop 10 categories:');
  const sortedCategories = Object.entries(categories)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10);
  
  for (const [category, count] of sortedCategories) {
    console.log(`  ${category}: ${count} skills`);
  }
}

// Run it
updateSkillsJson();