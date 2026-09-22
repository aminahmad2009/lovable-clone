const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'server', 'index.js');
let content = fs.readFileSync(filePath, 'utf8');

// Step 1: Replace the getSkills function and add the MCP factory functions.
// We'll replace from the comment "// Skills factory: dynamic fetch from GitHub with fallback to curated list"
// to the end of the getSkills function (the closing brace) and then insert the MCP factory functions after that.

const startComment = '// Skills factory: dynamic fetch from GitHub with fallback to curated list';
const startIndex = content.indexOf(startComment);
if (startIndex === -1) {
  console.error('ERROR: Could not find the skills factory comment');
  process.exit(1);
}

// Find the end of the getSkills function (the closing brace of the function) after the startComment.
// We'll look for the pattern: '}\n\nconst MIME = {' after the startComment.
const endPattern = '\\n}\\n\\nconst MIME = {';
const endIndex = content.indexOf(endPattern, startIndex);
if (endIndex === -1) {
  console.error('ERROR: Could not find the end of the getSkills function');
  process.exit(1);
}

// The endIndex is the index of the newline before the closing brace? Actually, the pattern includes the newline before the brace.
// We want to replace from startIndex to the end of the getSkills function, which is the index of the closing brace plus one.
// Let's find the closing brace of the getSkills function.

// We'll get the substring from startIndex to the index of 'const MIME = {'
const mimeIndex = content.indexOf('const MIME = {', startIndex);
if (mimeIndex === -1) {
  console.error('ERROR: Could not find the MIME constant');
  process.exit(1);
}

// Get the substring from startIndex to mimeIndex
const substring = content.substring(startIndex, mimeIndex);
// Find the last '}' in this substring
const lastBraceIndex = substring.lastIndexOf('}');
if (lastBraceIndex === -1) {
  console.error('ERROR: Could not find the closing brace of the getSkills function');
  process.exit(1);
// The absolute index of the closing brace is startIndex + lastBraceIndex
const braceAbsoluteIndex = startIndex + lastBraceIndex;

// Now, we want to replace from startIndex to braceAbsoluteIndex + 1 (to include the closing brace)
const newGetSkillsFunction = `
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

// Local MCP factory: load from local_mcp_repo
let mcpServersCache = null;
let mcpServersCacheTimestamp = 0;
const MCP_SERVERS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function loadMcpServersFromLocalRepo() {
  try {
    const localRepoPath = join(process.cwd(), 'local_mcp_repo');
    const categories = await fs.readdir(localRepoPath);
    const servers = [];

    for (const category of categories) {
      const categoryPath = join(localRepoPath, category);
      const stats = await fs.stat(categoryPath);
      if (stats.isDirectory()) {
        const top50Path = join(categoryPath, 'top_50.json');
        try {
          await fs.access(top50Path);
          const data = await fs.readFile(top50Path, 'utf8');
          const categoryServers = JSON.parse(data);
          servers.push(...categoryServers);
        } catch (err) {
          console.warn(\`Could not load top_50.json for category \${category}: \${err.message}\`);
        }
      }
    }

    return servers;
  } catch (err) {
    console.error('Failed to load MCP servers from local repository:', err);
    return null;
  }
}

async function getMcpServers() {
  const now = Date.now();
  if (mcpServersCache && (now - mcpServersCacheTimestamp) < MCP_SERVERS_CACHE_TTL) {
    return mcpServersCache;
  }
  const fetchedServers = await loadMcpServersFromLocalRepo();
  if (fetchedServers) {
    mcpServersCache = fetchedServers;
    mcpServersCacheTimestamp = now;
    return mcpServersCache;
  }
  // Fallback to curated list
  return CURATED_MCP_SERVERS;
}

const newContent = content.substring(0, startIndex) + newGetSkillsFunction + mcpFactoryFunctions + content.substring(braceAbsoluteIndex + 1);
content = newContent;

// Step 2: Insert the skills factory routes after the skills section (after the DELETE /api/skills/:skillId route).
// Find the end of the DELETE /api/skills/:skillId route.
const skillsSectionEndPattern = /route\('DELETE', '\/api\/skills\/:skillId'/;
const skillsSectionEndMatch = content.match(skillsSectionEndPattern);
if (!skillsSectionEndMatch) {
  console.error('ERROR: Could not find the end of the skills section');
  process.exit(1);
}

// Find the index of the match
const skillsSectionEndIndex = skillsSectionEndMatch.index;
// Now, find the end of this route (the closing brace of the function and the semicolon)
let braceCount = 0;
let inRoute = false;
let i = skillsSectionEndIndex;
while (i < content.length) {
  if (content.substring(i, i + 12) === '=> {') {
    inRoute = true;
    i += 12;
    continue;
  }
  if (inRoute) {
    if (content[i] === '{') braceCount++;
    if (content[i] === '}') braceCount--;
    if (braceCount === 0 && i > skillsSectionEndIndex) {
      // We found the end of the route handler function
      // Now, find the end of the route statement (semicolon)
      let j = i + 1;
      while (j < content.length && /\s/.test(content[j])) {
        j++;
      }
      if (j < content.length && content[j] === ';') {
        // We found the semicolon
        skillsSectionEndIndex = j; // update to the semicolon
      }
      break;
    }
  }
  i++;
}

// Now, we want to insert the skills factory routes after this semicolon.
const insertAfterIndex = skillsSectionEndIndex + 1;

const skillsFactoryRoutes = `

/* skills factory */

route('GET', '/api/skills-factory/search', async (_req, res, _params, query) => {
  const q = (query.get('q') || '').toLowerCase()
  const page = Number(query.get('page')) || 1
  const perPage = Number(query.get('per_page')) || 20
  const agent = query.get('agent') || ''
  const topic = query.get('topic') || ''
  
  // Get skills (from local repository)
  let skills = (await getSkills()).filter(s => {
    if (q && ![s.name, s.description, ...(s.tags || [])].join(' ').toLowerCase().includes(q)) return false
    if (topic && !(s.tags || []).includes(topic)) return false
    return true
  })
  
  // Pagination
  const start = (page - 1) * perPage
  const paginated = skills.slice(start, start + perPage)
  
  sendJson(_req, res, 200, { 
    skills: paginated,
    page,
    per_page: perPage,
    total: skills.length
  })
})

route('GET', '/api/skills-factory/skill/:id', async (_req, res, params) => {
  const skill = (await getSkills()).find(s => s.id === params.id)
  if (!skill) return sendError(_req, res, 404, 'Skill not found')
  sendJson(_req, res, 200, skill)
})

route('POST', '/api/skills-factory/import', async (_req, res, _params, query) => {
  const skillId = query.get('skillId')
  if (!skillId) return sendError(_req, res, 400, 'skillId query parameter is required')
  const skillData = (await getSkills()).find(s => s.id === skillId)
  if (!skillData) return sendError(_req, res, 404, 'Skill not found')
  
  // Check if skill is already installed
  const { projectId } = await readBody(_req)
  const project = await requireProject(_req, res, projectId)
  if (!project) return
  
  const hasSkill = project.skillIds?.includes(skillId) || false
  if (hasSkill) {
    return sendJson(_req, res, 200, { installed: false, reason: 'Skill already installed' })
  }
  
  // Install the skill
  const updated = await addProjectUsage(project.id, skillId)
  emit(project.id, 'skill:installed', { skillId })
  sendJson(_req, res, 200, { installed: true, skillId })
})

route('GET', '/api/skills-factory/leaderboard', async (_req, res, _params, query) => {
  const limit = Number(query.get('limit')) || 10
  
  // Return top skills by installs
  const skills = [...(await getSkills())].filter(s => s.installs > 0).sort((a, b) => b.installs - a.installs).slice(0, limit)
  
  sendJson(_req, res, 200, { skills })
}
`;

// Insert the skills factory routes after the skills section end.
content = content.substring(0, insertAfterIndex) + skillsFactoryRoutes + content.substring(insertAfterIndex);

// Step 3: Insert the MCP factory routes after the skills factory routes.
// We'll find the end of the skills factory routes (the last route we inserted) and insert after that.
// We'll look for the last route we inserted: the leaderboard route for skills factory.
// We'll look for the pattern: 'route('GET', '/api/skills-factory/leaderboard''
// and then find the end of that route.

const leaderboardPattern = /route\('GET', '\/api\/skills-factory\/leaderboard'/;
const leaderboardMatch = content.match(leaderboardPattern);
if (!leaderboardMatch) {
  console.error('ERROR: Could not find the leaderboard route');
  process.exit(1);
}

// Find the index of the match
const leaderboardIndex = leaderboardMatch.index;
// Now, find the end of the route handler function.
braceCount = 0;
inRoute = false;
let k = leaderboardIndex;
while (k < content.length) {
  if (content.substring(k, k + 12) === '=> {') {
    inRoute = true;
    k += 12;
    continue;
  }
  if (inRoute) {
    if (content[k] === '{') braceCount++;
    if (content[k] === '}') braceCount--;
    if (braceCount === 0 && k > leaderboardIndex) {
      // We found the end of the route handler function
      // Now, find the end of the route statement (semicolon)
      let l = k + 1;
      while (l < content.length && /\s/.test(content[l])) {
        l++;
      }
      if (l < content.length && content[l] === ';') {
        // We found the semicolon
        const leaderboardEndIndex = l; // index of the semicolon
        // Now, we want to insert the MCP factory routes after this semicolon.
        const mcpFactoryRoutes = `

/* mcp factory */

route('GET', '/api/mcp-factory/search', async (_req, res, _params, query) => {
  const q = (query.get('q') || '').toLowerCase()
  const page = Number(query.get('page')) || 1
  const perPage = Number(query.get('per_page')) || 20
  const agent = query.get('agent') || ''
  const topic = query.get('topic') || ''
  
  // Get MCP servers (from local repository)
  let servers = (await getMcpServers()).filter(s => {
    if (q && ![s.name, s.description, ...(s.tags || [])].join(' ').toLowerCase().includes(q)) return false
    if (topic && !(s.tags || []).includes(topic)) return false
    return true
  })
  
  // Pagination
  const start = (page - 1) * perPage
  const paginated = servers.slice(start, start + perPage)
  
  sendJson(_req, res, 200, { 
    servers: paginated:
    page,
    per_page: perPage,
    total: servers.length
  })
})

route('GET', '/api/mcp-factory/server/:id', async (_req, res, params) => {
  const server = (await getMcpServers()).find(s => s.id === params.id)
  if (!server) return sendError(_req, res, 404, 'MCP server not found')
  sendJson(_req, res, 200, server)
})

route('POST', '/api/mcp-factory/import', async (_req, res, _params, query) => {
  const serverId = query.get('serverId')
  if (!serverId) return sendError(_req, res, 400, 'serverId query parameter is required')
  const serverData = (await getMcpServers()).find(s => s.id === serverId)
  if (!serverData) return sendError(_req, res, 404, 'MCP server not found')
  
  // Check if server is already added to project
  const { projectId } = await readBody(_req)
  const project = await requireProject(_req, res, projectId)
  if (!project) return
  
  const hasServer = project.mcpServerIds?.includes(serverId) || false
  if (hasServer) {
    return sendJson(_req, res, 200, { added: false, reason: 'MCP server already added' })
  }
  
  // Add the MCP server to the project
  const updated = await addProjectMcpServer(project.id, serverId)
  emit(project.id, 'mcp:server:added', { serverId })
  sendJson(_req, res, 200, { added: true, serverId })
})

route('GET', '/api/mcp-factory/leaderboard', async (_req, res, _params, query) => {
  const limit = Number(query.get('limit')) || 10
  
  // Return top MCP servers by stars
  const servers = [...(await getMcpServers())].filter(s => s.stars > 0).sort((a, b) => b.stars - a.stars).slice(0, limit)
  
  sendJson(_req, res, 200, { servers })
}
`;

      // Insert the MCP factory routes after the leaderboard route.
      content = content.substring(0, leaderboardEndIndex + 1) + mcpFactoryRoutes + content.substring(leaderboardEndIndex + 1);
      break;
    }
  }
  l++;
}

// Write the updated content back to the file.
fs.writeFileSync(filePath, content, 'utf8');
console.log('SUCCESS: Updated server/index.js with local skills and MCP factory.');