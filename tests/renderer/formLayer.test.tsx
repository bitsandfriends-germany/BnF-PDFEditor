import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const { setLang } = await import('@/i18n')
const { FormLayer } = await import('@/components/FormLayer')
import type { FormField } from '@/lib/documents'

const f = (o: Partial<FormField>): FormField => ({
  name: 'f', page: 1, type: 'Text', value: '', options: [], required: false, readOnly: false,
  multiline: false, fontSize: 0, maxLen: 0, rect: { x: 72, y: 700, width: 100, height: 20 }, ...o
})

beforeEach(() => setLang('de'))

describe('FormLayer (Section 11)', () => {
  it('rendert Text/Checkbox/Select je Feldtyp', () => {
    const commit = vi.fn()
    render(<FormLayer fields={[f({ name: 'name' }), f({ name: 'ok', type: 'CheckBox' }), f({ name: 'land', type: 'ComboBox', options: ['DE', 'FR'] })]} pageWidth={612} pageHeight={792} scale={1} rotation={0} highlight readOnly={false} onCommit={commit} />)
    expect(screen.getByTestId('form-field-name').tagName).toBe('INPUT')
    expect(screen.getByTestId('form-field-ok').querySelector('input[type=checkbox]')).not.toBeNull()
    const sel = screen.getByTestId('form-field-land') as HTMLSelectElement
    expect(sel.tagName).toBe('SELECT')
    expect(Array.from(sel.options).map((o) => o.value)).toEqual(['', 'DE', 'FR'])
  })

  it('committ Text beim Verlassen und Checkbox sofort', () => {
    const commit = vi.fn()
    render(<FormLayer fields={[f({ name: 'name' }), f({ name: 'ok', type: 'CheckBox' })]} pageWidth={612} pageHeight={792} scale={1} rotation={0} highlight readOnly={false} onCommit={commit} />)
    const input = screen.getByTestId('form-field-name') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Anna' } })
    fireEvent.blur(input)
    expect(commit).toHaveBeenCalledWith('name', 'Anna')
    const cb = screen.getByTestId('form-field-ok').querySelector('input[type=checkbox]') as HTMLInputElement
    fireEvent.click(cb)
    expect(commit).toHaveBeenCalledWith('ok', true)
  })

  it('leere Feldliste rendert nichts', () => {
    const { container } = render(<FormLayer fields={[]} pageWidth={612} pageHeight={792} scale={1} rotation={0} highlight readOnly={false} onCommit={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('readOnly deaktiviert die Controls', () => {
    render(<FormLayer fields={[f({ name: 'name' })]} pageWidth={612} pageHeight={792} scale={1} rotation={0} highlight readOnly onCommit={() => {}} />)
    expect(screen.getByTestId('form-field-name')).toBeDisabled()
  })
})
