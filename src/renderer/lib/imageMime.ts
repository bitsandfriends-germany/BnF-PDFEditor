// Browser-Dekodierung braucht den korrekten MIME-Typ im data: — ein als png etikettierter
// JPEG-Stream schlägt fehl (Nutzerbefund Signatur-Vorschau).
const MAP: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', svg: 'image/svg+xml',
}
export function imageMimeFor(nameOrExt: string): string {
  const ext = nameOrExt.includes('.') ? (nameOrExt.split('.').pop() ?? '').toLowerCase() : nameOrExt.toLowerCase()
  return MAP[ext] ?? 'image/png'
}
export function imageDataUrl(b64: string, nameOrExt: string): string {
  return `data:${imageMimeFor(nameOrExt)};base64,${b64}`
}
