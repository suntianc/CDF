import { ChatGPTThread } from './assistant-ui'

export function ChatPanel() {
  return (
    <div className="flex-1 w-full h-full flex flex-col bg-transparent relative min-w-0 overflow-hidden">
      <ChatGPTThread />
    </div>
  )
}
