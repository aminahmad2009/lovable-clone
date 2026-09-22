#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Function to extract frontmatter from a markdown file
function extractFrontmatter(content) {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!frontmatterMatch) return null;
  
  const frontmatterText = frontmatterMatch[1];
  const frontmatter = {};
  
  frontmatterText.split('\n').forEach(line => {
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (match) {
      const key = match[1];
      const value = match[2].trim();
      
      // Try to parse as JSON if it looks like an array or object
      if (value.startsWith('[') || value.startsWith('{')) {
        try {
          frontmatter[key] = JSON.parse(value);
        } catch (e) {
          frontmatter[key] = value;
        }
      } else {
        // Remove quotes if present
        if (value.startsWith('"') && value.endsWith('"')) {
          frontmatter[key] = value.slice(1, -1);
        } else if (value.startsWith("'") && value.endsWith("'")) {
          frontmatter[key] = value.slice(1, -1);
        } else {
          frontmatter[key] = value;
        }
      }
    }
  });
  
  return frontmatter;
}

// Function to extract skill information from a SKILL.md file
function extractSkillInfo(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const frontmatter = extractFrontmatter(content);
    
    if (!frontmatter) {
      return null;
    }
    
    // Extract the skill ID from the file path
    // The path should be something like: local_skills_repo/category/skill-name/SKILL.md
    const parts = filePath.split(path.sep);
    let skillId = null;
    let category = null;
    
    // Find the index of 'local_skills_repo' in the path
    const localSkillsIndex = parts.indexOf('local_skills_repo');
    if (localSkillsIndex !== -1 && parts.length > localSkillsIndex + 2) {
      category = parts[localSkillsIndex + 1];
      skillId = parts[localSkillsIndex + 2];
    }
    
    if (!skillId) {
      // Fallback: use the filename without extension
      skillId = path.basename(filePath, '.md');
    }
    
    // Build the skill object
    const skill = {
      id: skillId || frontmatter.id || 'unknown',
      name: frontmatter.name || frontmatter.title || skillId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      icon: frontmatter.icon || '🧩',
      description: frontmatter.description || `A skill for ${skillId}`,
      tags: frontmatter.tags || [category || 'unknown'],
      brief: frontmatter.brief || `Skill: ${skill.name.toUpperCase()}. ${frontmatter.description || 'A skill for ' + skillId}`,
      source: frontmatter.source || 'local',
      installs: frontmatter.installs || 100,
      weeklyInstalls: frontmatter.weeklyInstalls || [10, 12, 8, 15, 10],
      isOfficial: frontmatter.source === 'builtin' || false,
      url: `https://example.com/public/skills/${skillId}.json`,
      filePath: path.relative(process.cwd(), filePath).replace('SKILL.md', `${skillId}.json`),
      version: frontmatter.version || '1.0.0',
      author: frontmatter.author || 'Local Skills Repository',
      license: frontmatter.license || 'MIT',
      repository: {
        type: 'git',
        url: `https://github.com/lovable-local/${skillId}-skill.git`
      },
      keywords: [...(frontmatter.tags || []), 'skill', 'ai', 'agent', 'lovable'],
      dependencies: frontmatter.dependencies || {},
      devDependencies: frontmatter.devDependencies || {},
      peerDependencies: frontmatter.peerDependencies || {},
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

// Main function to scan local_skills_repo and update skills.json
function updateSkillsJson() {
  const localSkillsRepoPath = path.join(__dirname, 'local_skills_repo');
  
  if (!fs.existsSync(localSkillsRepoPath)) {
    console.error('local_skills_repo directory not found');
    return;
  }
  
  // Find all SKILL.md files in the local_skills_repo directory
  const skillFiles = [];
  
  function findSkillFiles(dir) {
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const itemPath = path.join(dir, item);
      const stat = fs.statSync(itemPath);
      
      if (stat.isDirectory()) {
        findSkillFiles(itemPath);
      } else if (item === 'SKILL.md') {
        skillFiles.push(itemPath);
      }
    }
  }
  
  findSkillFiles(localSkillsRepoPath);
  
  console.log(`Found ${skillFiles.length} SKILL.md files`);
  
  // Extract skill information from each file
  const skills = [];
  for (const file of skillFiles) {
    const skill = extractSkillInfo(file);
    if (skill) {
      skills.push(skill);
      console.log(`✓ Processed: ${skill.id}`);
    } else {
      console.log(`✗ Failed to process: ${file}`);
    }
  }
  
  // Sort skills by id for consistency
  skills.sort((a, b) => a.id.localeCompare(b.id));
  
  // Write to skills.json
  const skillsJsonPath = path.join(localSkillsRepoPath, 'skills.json');
  fs.writeFileSync(skillsJsonPath, JSON.stringify(skills, null, 2));
  
  console.log(`\n✅ Updated ${skillsJsonPath} with ${skills.length} skills`);
  
  // Print a summary
  console.log('\nSkill Summary:');
  const categories = {};
  skills.forEach(skill => {
    const category = skill.tags[0] || 'unknown';
    if (!categories[category]) {
      categories[category] = 0;
    }
    categories[category]++;
  });
  
  for (const [category, count] of Object.entries(categories)) {
    console.log(`  ${category}: ${count} skills`);
  }
}

// Run the update
updateSkillsJson();