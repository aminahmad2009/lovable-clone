/* MCP (Model Context Protocol) client integration */
/* Supports stdio and SSE transports for connecting to MCP servers */

import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'

const MCP_TIMEOUT = 30000

/** MCP Client for stdio transport */
export class StdioMCPClient extends EventEmitter {
  constructor(command, args = [], env = {}) {
    super()
    this.command = command
    this.args = args
    this.env = { ...process.env, ...env }
    this.process = null
    this.requestId = 0
    this.pending = new Map()
    this.buffer = ''
    this.initialized = false
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.process = spawn(this.command, this.args, {
        env: this.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      this.process.stdout.on('data', (data) => {
        this.buffer += data.toString()
        this.processBuffer()
      })

      this.process.stderr.on('data', (data) => {
        console.error(`[MCP stderr] ${data}`)
      })

      this.process.on('error', (err) => {
        this.emit('error', err)
        if (!this.initialized) reject(err)
      })

      this.process.on('close', (code) => {
        this.emit('close', code)
        if (!this.initialized && code !== 0) {
          reject(new Error(`MCP process exited with code ${code}`))
        }
      })

      // Send initialize request
      this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'lovable-local', version: '0.2.0' },
      }).then((result) => {
        this.initialized = true
        this.sendNotification('notifications/initialized', {})
        resolve(result)
      }).catch(reject)

      // Timeout
      setTimeout(() => {
        if (!this.initialized) {
          reject(new Error('MCP connection timeout'))
        }
      }, MCP_TIMEOUT)
    })
  }

  processBuffer() {
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() || ''
    
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const message = JSON.parse(line)
        this.handleMessage(message)
      } catch (err) {
        console.error('[MCP] Failed to parse message:', line, err)
      }
    }
  }

  handleMessage(message) {
    // Response to a request
    if (message.id !== undefined && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id)
      this.pending.delete(message.id)
      if (message.error) {
        reject(new Error(message.error.message || 'MCP error'))
      } else {
        resolve(message.result)
      }
      return
    }

    // Notification or request from server
    this.emit('message', message)
  }

  sendRequest(method, params = {}) {
    const id = ++this.requestId
    const message = { jsonrpc: '2.0', id, method, params }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.send(message)
      
      // Timeout
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`MCP request timeout: ${method}`))
        }
      }, MCP_TIMEOUT)
    })
  }

  sendNotification(method, params = {}) {
    const message = { jsonrpc: '2.0', method, params }
    this.send(message)
  }

  send(message) {
    if (this.process && this.process.stdin.writable) {
      this.process.stdin.write(JSON.stringify(message) + '\n')
    }
  }

  async listTools() {
    const result = await this.sendRequest('tools/list', {})
    return result.tools || []
  }

  async callTool(name, args = {}) {
    const result = await this.sendRequest('tools/call', { name, arguments: args })
    return result
  }

  async close() {
    if (this.process) {
      this.process.kill()
      this.process = null
    }
  }
}

/** MCP Client for SSE transport (remote servers) */
export class SSEMCPClient extends EventEmitter {
  constructor(url, headers = {}) {
    super()
    this.url = url
    this.headers = headers
    this.eventSource = null
    this.requestId = 0
    this.pending = new Map()
    this.initialized = false
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.eventSource = new EventSource(this.url, { headers: this.headers })

      this.eventSource.onopen = async () => {
        try {
          const result = await this.sendRequest('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'lovable-local', version: '0.2.0' },
          })
          this.initialized = true
          await this.sendNotification('notifications/initialized', {})
          resolve(result)
        } catch (err) {
          reject(err)
        }
      }

      this.eventSource.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)
          this.handleMessage(message)
        } catch (err) {
          console.error('[MCP SSE] Failed to parse message:', err)
        }
      }

      this.eventSource.onerror = (err) => {
        this.emit('error', err)
        if (!this.initialized) reject(new Error('SSE connection failed'))
      }

      setTimeout(() => {
        if (!this.initialized) {
          reject(new Error('MCP SSE connection timeout'))
        }
      }, MCP_TIMEOUT)
    })
  }

  handleMessage(message) {
    if (message.id !== undefined && this.pending.has(message.id)) {
      const { resolve, reject } = this.pending.get(message.id)
      this.pending.delete(message.id)
      if (message.error) {
        reject(new Error(message.error.message || 'MCP error'))
      } else {
        resolve(message.result)
      }
      return
    }
    this.emit('message', message)
  }

  async sendRequest(method, params = {}) {
    const id = ++this.requestId
    const message = { jsonrpc: '2.0', id, method, params }
    
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      
      // Send via POST to the SSE endpoint
      fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.headers },
        body: JSON.stringify(message),
      }).catch(reject)
      
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`MCP request timeout: ${method}`))
        }
      }, MCP_TIMEOUT)
    })
  }

  async sendNotification(method, params = {}) {
    const message = { jsonrpc: '2.0', method, params }
    await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.headers },
      body: JSON.stringify(message),
    })
  }

  async listTools() {
    const result = await this.sendRequest('tools/list', {})
    return result.tools || []
  }

  async callTool(name, args = {}) {
    const result = await this.sendRequest('tools/call', { name, arguments: args })
    return result
  }

  async close() {
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }
  }
}

/** Factory function to create appropriate MCP client */
export async function createMCPClient(config) {
  const { transport = 'stdio', command, args, env, url, headers } = config
  
  if (transport === 'stdio' && command) {
    const client = new StdioMCPClient(command, args, env)
    await client.connect()
    return client
  } else if (transport === 'sse' && url) {
    const client = new SSEMCPClient(url, headers)
    await client.connect()
    return client
  } else {
    throw new Error(`Invalid MCP config: transport=${transport}`)
  }
}

/** Convert MCP tool schema to our tool definition format */
export function mcpToolToDefinition(mcpTool, serverId) {
  return {
    name: `mcp_${serverId}_${mcpTool.name}`,
    description: `[MCP:${serverId}] ${mcpTool.description || ''}`,
    parameters: mcpTool.inputSchema || { type: 'object', properties: {} },
  }
}

/** Execute MCP tool through client */
export async function executeMCPTool(client, toolName, args) {
  return await client.callTool(toolName, args)
}