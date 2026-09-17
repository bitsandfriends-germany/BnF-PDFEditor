/// <reference types="vite/client" />
import type { PdfEditorBridge } from '@shared/ipc'

declare global {
  interface Window {
    pdfEditor: PdfEditorBridge
  }
}

export {}
