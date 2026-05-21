import { create } from 'zustand'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  streaming?: boolean
  status?: 'sending' | 'sent' | 'error'
}

interface MessageStore {
  messages: Message[]
  currentStreamId: string | null
  activeConversationId: string | null
  isStreaming: boolean
  setStreamId: (id: string | null) => void
  setConversation: (id: string | null) => void
  setStreaming: (streaming: boolean) => void
  addMessage: (msg: Omit<Message, 'id' | 'timestamp'>) => string
  appendContent: (id: string, delta: string) => void
  finalizeMessage: (id: string) => void
  updateMessageStatus: (id: string, status: Message['status']) => void
  loadHistory: (messages: Message[]) => void
  clearAll: () => void
}

export const useMessageStore = create<MessageStore>((set) => ({
  messages: [],
  currentStreamId: null,
  activeConversationId: null,
  isStreaming: false,

  setStreamId: (id) => set({ currentStreamId: id }),

  setConversation: (id) => set({ activeConversationId: id }),

  setStreaming: (streaming) => set({ isStreaming: streaming }),

  addMessage: (msg) => {
    const id = crypto.randomUUID()
    const timestamp = Date.now()
    const message: Message = {
      id,
      timestamp,
      ...msg,
    }
    set((state) => ({
      messages: [...state.messages, message],
    }))
    return id
  },

  appendContent: (id, delta) => {
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === id
          ? { ...msg, content: msg.content + delta }
          : msg
      ),
    }))
  },

  finalizeMessage: (id) => {
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === id
          ? { ...msg, streaming: false }
          : msg
      ),
    }))
  },

  updateMessageStatus: (id, status) => {
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === id
          ? { ...msg, status }
          : msg
      ),
    }))
  },

  loadHistory: (messages) => {
    set({ messages })
  },

  clearAll: () => {
    set({
      messages: [],
      currentStreamId: null,
      activeConversationId: null,
      isStreaming: false,
    })
  },
}))
