import fs from 'fs/promises'
import path from 'path'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  streaming?: boolean
  status?: 'sending' | 'sent' | 'error'
}

interface ConversationMeta {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

interface ConversationFile {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  messages: Message[]
}

export class ChatHistoryManager {
  private baseDir(workspacePath: string): string {
    return path.join(workspacePath, '.pi', 'conversations')
  }

  private async ensureDir(workspacePath: string): Promise<void> {
    const dir = this.baseDir(workspacePath)
    await fs.mkdir(dir, { recursive: true })
  }

  async createConversation(workspacePath: string, name?: string): Promise<{ id: string; path: string }> {
    await this.ensureDir(workspacePath)
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const conversation: ConversationFile = {
      id,
      name: name || '新对话',
      createdAt: now,
      updatedAt: now,
      messages: []
    }
    const filePath = path.join(this.baseDir(workspacePath), `${id}.json`)
    await fs.writeFile(filePath, JSON.stringify(conversation, null, 2))
    return { id, path: filePath }
  }

  async listConversations(workspacePath: string): Promise<ConversationMeta[]> {
    await this.ensureDir(workspacePath)
    const dir = this.baseDir(workspacePath)
    const files = await fs.readdir(dir)
    const metas: ConversationMeta[] = []

    for (const file of files.filter(f => f.endsWith('.json'))) {
      const content = await fs.readFile(path.join(dir, file), 'utf-8')
      const conv: ConversationFile = JSON.parse(content)
      metas.push({
        id: conv.id,
        name: conv.name,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        messageCount: conv.messages.length
      })
    }

    return metas.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
  }

  async loadConversation(filePath: string, offset = 0, limit = 50): Promise<Message[]> {
    const content = await fs.readFile(filePath, 'utf-8')
    const conv: ConversationFile = JSON.parse(content)
    // Return messages from offset, limited to limit
    return conv.messages.slice(offset, offset + limit)
  }

  async saveConversation(filePath: string, messages: Message[]): Promise<void> {
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })
    // Read existing to preserve metadata
    let conv: ConversationFile
    try {
      const existing = await fs.readFile(filePath, 'utf-8')
      conv = JSON.parse(existing)
    } catch {
      conv = {
        id: crypto.randomUUID(),
        name: '新对话',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: []
      }
    }
    conv.messages = messages
    conv.updatedAt = new Date().toISOString()
    await fs.writeFile(filePath, JSON.stringify(conv, null, 2))
  }

  async appendMessage(filePath: string, message: Message): Promise<void> {
    const content = await fs.readFile(filePath, 'utf-8')
    const conv: ConversationFile = JSON.parse(content)
    conv.messages.push(message)
    conv.updatedAt = new Date().toISOString()
    // Auto-name from first user message if still "新对话"
    if (conv.name === '新对话' && message.role === 'user') {
      conv.name = message.content.slice(0, 50) + (message.content.length > 50 ? '...' : '')
    }
    await fs.writeFile(filePath, JSON.stringify(conv, null, 2))
  }

  async deleteConversation(filePath: string): Promise<void> {
    await fs.unlink(filePath)
  }

  async updateConversationMeta(filePath: string, meta: Partial<ConversationMeta>): Promise<void> {
    const content = await fs.readFile(filePath, 'utf-8')
    const conv: ConversationFile = JSON.parse(content)
    if (meta.name !== undefined) conv.name = meta.name
    conv.updatedAt = new Date().toISOString()
    await fs.writeFile(filePath, JSON.stringify(conv, null, 2))
  }
}

export const chatHistoryManager = new ChatHistoryManager()