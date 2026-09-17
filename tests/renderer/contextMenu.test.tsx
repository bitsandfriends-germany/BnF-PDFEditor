import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// §6: Kontextmenü aus der Registry. DOM-seitig geprüft: omit-not-grey, Shortcut rechts,
// Zerstörerisches nach Separator, Tastatur (Pfeile/Enter/Esc), Scope-Header, leeres Menü.

const post = vi.fn()
class ApiError extends Error { code: string; constructor(c: string, m: string) { super(m); this.name = 'ApiError'; this.code = c } }
vi.mock('@/lib/apiClient', () => ({ api: { get: vi.fn().mockResolvedValue({ open: true }), post, del: vi.fn(), getBytes: vi.fn() }, ApiError, sseStream: vi.fn() }))

const { setLang } = await import('@/i18n')
const { ContextMenu } = await import('@/components/ContextMenu')
import type { CommandContext, CommandDef } from '@/lib/commands'

beforeEach(() => { setLang('en'); vi.clearAllMocks() })

function ctx(over: Partial<CommandContext> = {}): CommandContext {
  return { docOpen: true, readOnly: false, mutationLock: false, currentPage: 2, pageCount: 5, selected: [], textSelected: false, stamping: false, ...over }
}

function menuItems(container: HTMLElement): string[] {
  // Haupt-Ebene nur (R55: 2 Ebenen): direkte Kinder des Hauptmenues; Gruppen-Buttons
  // sitzen in einem Wrapper-div, ihr testid Praefix bleibt erhalten.
  const root = container.querySelector('[data-testid="context-menu"]')
  if (root === null) return []
  const out: string[] = []
  for (const el of Array.from(root.querySelectorAll('[role="menuitem"]'))) {
    if (el.closest('[role="menu"]') !== root) continue
    out.push(el.getAttribute('data-testid') ?? '')
  }
  return out.filter((x) => x !== '')
}
function openGroup(container: HTMLElement, group: string): void {
  const btn = container.querySelector(`[data-testid="ctx-group-${group}"]`) as HTMLElement
  fireEvent.click(btn)
}

function allItems(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[role="menuitem"]')).map((el) => el.getAttribute('data-testid') ?? '').filter((x) => x !== '')
}

describe('ContextMenu (§6)', () => {
  it('Scope-Header + Seiten-Ops + Ansicht-Aktionen (canvas)', () => {
    const { container } = render(<ContextMenu target="canvas" ctx={ctx()} x={0} y={0} scopeLabel="Seite 2" onClose={() => {}} onRun={() => {}} />)
    expect(screen.getByTestId('ctx-scope')).toHaveTextContent('Seite 2')
    // 2 Ebenen (R55): Gruppen-Flyouts vorhanden, Inhalt nach Klick darauf.
    expect(allItems(container)).toContain('ctx-group-grp.pdf')
    expect(allItems(container)).toContain('ctx-group-grp.view')
    openGroup(container, 'grp.pdf')
    expect(allItems(container)).toContain('ctx-pg-rot-right')
    expect(allItems(container)).toContain('ctx-pg-dup')
    openGroup(container, 'grp.view')
    expect(allItems(container)).toContain('ctx-view-fit-width')
  })

  it('Shortcut rechtsbündig bei Befehl mit Bindung', () => {
    const { container } = render(<ContextMenu target="canvas" ctx={ctx()} x={0} y={0} scopeLabel="S" onClose={() => {}} onRun={() => {}} />)
    openGroup(container, 'grp.view')
    expect(screen.getByTestId('ctx-shortcut-view-fit-width')).toHaveTextContent('Strg+2')
  })

  it('zerstörerisches Löschen zuletzt, nach Separator', () => {
    const { container } = render(<ContextMenu target="canvas" ctx={ctx()} x={0} y={0} scopeLabel="S" onClose={() => {}} onRun={() => {}} />)
    const items = menuItems(container)
    expect(items[items.length - 1]).toBe('ctx-pg-del')
    expect(screen.getByTestId('ctx-destructive-separator')).toBeInTheDocument()
  })

  it('nicht zutreffende Einträge werden weggelassen (readOnly)', () => {
    const { container } = render(<ContextMenu target="thumbnail" ctx={ctx({ readOnly: true })} x={0} y={0} scopeLabel="S" onClose={() => {}} onRun={() => {}} />)
    const items = menuItems(container)
    expect(items).toContain('ctx-group-grp.pdf') // enthaelt nur noch lesbares (extract)
    expect(items).not.toContain('ctx-pg-del')
    openGroup(container, 'grp.pdf')
    expect(allItems(container)).toContain('ctx-pg-extract') // nur-lesen bleibt
    expect(container.querySelector('[data-testid="ctx-destructive-separator"]')).toBeNull()
  })

  it('kein Dokument -> kein Menü', () => {
    const { container } = render(<ContextMenu target="thumbnail" ctx={ctx({ docOpen: false })} x={0} y={0} scopeLabel="S" onClose={() => {}} onRun={() => {}} />)
    expect(screen.queryByTestId('context-menu')).toBeNull()
    expect(container.querySelector('[role="menu"]')).toBeNull()
  })

  it('Tastatur: Pfeil bewegt Auswahl, Enter führt aus, Esc schließt', () => {
    const onRun = vi.fn()
    const onClose = vi.fn()
    render(<ContextMenu target="thumbnail" ctx={ctx()} x={0} y={0} scopeLabel="S" onClose={onClose} onRun={onRun} />)
    const menu = screen.getByTestId('context-menu')
    // R55 2.Ebene: Enter auf einem Gruppen-Fluegel oeffnet sein Untermenue (kein run).
    // Haupt-Ebene Reihenfolge: primary (pg.selectAll) dann Gruppen. 2x Down -> grp.insert.
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    fireEvent.keyDown(menu, { key: 'Enter' })     // oeffnet Gruppe, fuehrt NICHTS aus
    expect(onRun).not.toHaveBeenCalled()
    // jetzt im Untermenue: Enter fuehrt ersten Befehl aus
    fireEvent.keyDown(menu, { key: 'Enter' })
    expect(onRun).toHaveBeenCalledTimes(1)
    // Esc (neues Menü) schließt ohne Ausführung
    const onRun2 = vi.fn()
    const onClose2 = vi.fn()
    render(<ContextMenu target="thumbnail" ctx={ctx()} x={0} y={0} scopeLabel="S" onClose={onClose2} onRun={onRun2} />)
    fireEvent.keyDown(screen.getAllByTestId('context-menu')[1]!, { key: 'Escape' })
    expect(onClose2).toHaveBeenCalledTimes(1)
    expect(onRun2).not.toHaveBeenCalled()
  })

  it('Klick führt Befehl über onRun aus', () => {
    const onRun = vi.fn()
    const { container } = render(<ContextMenu target="thumbnail" ctx={ctx()} x={0} y={0} scopeLabel="S" onClose={() => {}} onRun={onRun} />)
    openGroup(container, 'grp.pdf')
    fireEvent.click(screen.getByTestId('ctx-pg-rot-right'))
    expect((onRun.mock.calls[0]?.[0] as CommandDef).id).toBe('pg.rotRight')
  })
})
