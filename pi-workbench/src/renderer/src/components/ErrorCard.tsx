import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertCircle, RefreshCw } from 'lucide-react'

interface ErrorCardProps {
  title?: string
  message: string
  onRetry?: () => void
}

export function ErrorCard({ title = '出错了', message, onRetry }: ErrorCardProps) {
  return (
    <Alert variant="destructive" className="my-2">
      <div className="flex items-start gap-2">
        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <AlertTitle className="text-sm font-medium">{title}</AlertTitle>
          <AlertDescription className="text-sm mt-1">
            {message}
          </AlertDescription>
          {onRetry && (
            <button
              onClick={onRetry}
              className="flex items-center gap-1 mt-2 text-xs font-medium hover:underline"
            >
              <RefreshCw className="w-3 h-3" />
              重试
            </button>
          )}
        </div>
      </div>
    </Alert>
  )
}