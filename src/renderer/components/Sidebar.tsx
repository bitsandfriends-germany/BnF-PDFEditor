import { useState } from 'react'
import { Layers , Info , FileText , PenTool , ShieldCheck , Sparkles , Plus , ListTree , MessageSquareText } from 'lucide-react'
import { useT } from '@/i18n'
import { Tooltip } from '@/components/Tooltip'
import { shellTooltipKey } from '@/lib/tooltips'
import { useAppStore } from '@/store/useAppStore'
import { useUiStore, type SidebarTab, type SelectMode } from '@/store/useUiStore'
import { ThumbnailList } from '@/components/ThumbnailList'
import { PagesToolbar } from '@/components/PagesToolbar'
import { PagesDialogs } from '@/components/PagesDialogs'
import { MetadataPanel } from '@/components/MetadataPanel'
import { PropertiesPanel } from '@/components/PropertiesPanel'
import { OutlinePanel } from '@/components/OutlinePanel'
import { AnnotationListPanel } from '@/components/AnnotationListPanel'
import { FormPanel } from '@/components/FormPanel'
import { SignaturePanel } from '@/components/SignaturePanel'
import { CertificatePanel } from '@/components/CertificatePanel'
import { AiPanel } from '@/components/AiPanel'
import { mergePdf, reorderPages } from '@/lib/documents'
import type { PDFDocumentProxy } from '@/lib/pdfjs'

const TABS: { id: SidebarTab; icon: typeof Layers }[] = [
  { id: 'thumbnails', icon: Layers },
  { id: 'outline', icon: ListTree },
  { id: 'annotations', icon: MessageSquareText },
  { id: 'forms', icon: FileText },
  { id: 'metadata', icon: Info },
  { id: 'properties', icon: FileText },
  { id: 'signatures', icon: PenTool },
  { id: 'certificates', icon: ShieldCheck },
  { id: 'ai', icon: Sparkles }
]

const ITEM_HEIGHT = 168
const THUMB_WIDTH = 128

export function Sidebar({ doc }: { doc: PDFDocumentProxy | null }): JSX.Element {
  const t = useT()

  // R75: Hilfetext des Tabs (testid -> tip.shell.*, Fallback: Tab-Label).
  const tabTip = (id: string): string => {
    const key = shellTooltipKey(`sidebar-tab-${id}`)
    return key === '' ? t(`sidebar.tab.${id}`) : t(key)
  }
  const activeTab = useUiStore((s) => s.activeTab)
  const setActiveTab = useUiStore((s) => s.setActiveTab)
  const docOpen = useAppStore((s) => s.docOpen)
  const readOnly = useAppStore((s) => s.readOnly)
  const pageCount = useAppStore((s) => s.pageCount)
  const currentPage = useAppStore((s) => s.currentPage)
  const setCurrentPage = useAppStore((s) => s.setCurrentPage)
  const selected = useUiStore((s) => s.selected)
  const selectPage = useUiStore((s) => s.selectPage)
  const selectAllPages = useUiStore((s) => s.selectAllPages)
  const [busy, setBusy] = useState(false)

  const onThumbSelect = (index: number, mode: SelectMode): void => {
    selectPage(index + 1, mode, pageCount)
    setCurrentPage(index + 1)
  }

  const onAppend = async (): Promise<void> => {
    const path = await window.pdfEditor.openPdfDialog()
    if (!path) return
    setBusy(true)
    try {
      await mergePdf(path)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full">
      <div className="flex w-12 flex-col items-center gap-1 border-r border-slate-200 bg-slate-50 py-2" role="tablist" aria-orientation="vertical">
        {TABS.map(({ id, icon: Icon }) => (
          <Tooltip text={tabTip(id)} testid={`tip-sidebar-tab-${id}`}>
            <button data-testid={`sidebar-tab-${id}`}
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            aria-label={t(`sidebar.tab.${id}`)}
            onClick={() => setActiveTab(id)}
            className={`rounded-md p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 ${activeTab === id ? 'bg-sky-100 text-sky-700' : 'text-slate-500 hover:bg-slate-200'}`}
          >
            <Icon size={18} />
          </button>
          </Tooltip>
        ))}
      </div>

      <div className="min-w-0 flex-1 overflow-hidden">
        {activeTab === 'thumbnails' ? (
          <div className="flex h-full flex-col">
            <div className="border-b border-slate-200 p-2">
              <button data-testid="sidebar-append"
                type="button"
                title={t('sidebar.append')}
                aria-label={t('sidebar.append')}
                onClick={() => void onAppend()}
                disabled={!docOpen || readOnly || busy}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-300 px-2 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
              >
                <Plus size={16} /> {t('sidebar.append')}
              </button>
            </div>
            {docOpen && doc ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <PagesToolbar />
                <div className="min-h-0 flex-1">
                  <ThumbnailList
                    doc={doc}
                    pageCount={pageCount}
                    itemHeight={ITEM_HEIGHT}
                    targetWidth={THUMB_WIDTH}
                    selectedIndex={currentPage - 1}
                    selected={selected.map((p) => p - 1)}
                    onSelect={onThumbSelect}
                    onSelectAll={() => selectAllPages(pageCount)}
                    onReorder={(order) => { void reorderPages(order) }}
                  />
                </div>
              </div>
            ) : (
              <p className="p-3 text-sm text-slate-500">{t('sidebar.empty')}</p>
            )}
          </div>
        ) : activeTab === 'forms' ? (
          <FormPanel />
        ) : activeTab === 'annotations' ? (
          <AnnotationListPanel />
        ) : activeTab === 'outline' ? (
          <OutlinePanel />
        ) : activeTab === 'metadata' ? (
          <MetadataPanel />
        ) : activeTab === 'properties' ? (
          <PropertiesPanel />
        ) : activeTab === 'signatures' ? (
          <SignaturePanel />
        ) : activeTab === 'certificates' ? (
          <CertificatePanel />
        ) : (
          <AiPanel />
        )}
      </div>
      <PagesDialogs />
    </div>
  )
}
