import { Dialog, DialogContent } from '@/components/ui/dialog'
import { X } from 'lucide-react'

interface ImagePreviewProps {
  src: string
  open: boolean
  onClose: () => void
}

export function ImagePreview({ src, open, onClose }: ImagePreviewProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[90vw] max-h-[90vh] p-0 bg-transparent border-none shadow-none">
        <button
          onClick={onClose}
          className="absolute top-2 right-2 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
        <img
          src={src}
          alt="Preview"
          className="w-full h-full object-contain rounded-lg"
        />
      </DialogContent>
    </Dialog>
  )
}