import { describe, it, expect } from 'vitest'
import { innerBox } from '@/lib/viewerLayout'

// §4: Fit-Width rechnet gegen (Client-Box - Innenabstand). contentRect == innere Box; die
// initiale Fallback-Messung muss dasselbe liefern, sonst Horizontal-Scrollbar im ersten Frame.

describe('innerBox (§4 Gutter)', () => {
  it('zieht Innenabstand ab und klemmt auf 0', () => {
    expect(innerBox(1000, 800, 48, 48)).toEqual({ w: 952, h: 752 })
    expect(innerBox(1000, 800, 0, 0)).toEqual({ w: 1000, h: 800 })
    expect(innerBox(20, 20, 48, 48)).toEqual({ w: 0, h: 0 })
  })
  it('hat die gleiche Semantik wie ResizeObserver.contentRect (Box minus Padding)', () => {
    const client = 800
    const pad = 24 * 2
    const contentLike = client - pad
    expect(innerBox(client, client, pad, pad).w).toBe(contentLike)
  })
})
