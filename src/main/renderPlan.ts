// R75: Render-Modus (GPU vs. Software) als reine Entscheidung.
//
// Nutzerwunsch: "er soll selber entscheiden ob gpu oder sw rendering besser funktioniert, in den
// einstellungen waehlbar". Das Modell laeuft VOR app.whenReady und muss deshalb ohne Electron
// testbar sein: aus Modus + gezaehlten GPU-Abstuerzen entsteht ein Plan (Hardware-Beschleunigung
// aus? welche Schalter?).
export type RenderMode = 'auto' | 'gpu' | 'software'

export interface RenderPlan {
  /** Effektiv genutzter Modus (bei 'auto' das Ergebnis der Auswertung). */
  effective: 'gpu' | 'software'
  disableHardwareAcceleration: boolean
  switches: string[]
  reason: string
}

/** Ab so vielen GPU-Prozess-Abstuerzen schaltet 'auto' auf Software-Rendering um. */
export const GPU_FAILURE_THRESHOLD = 3

/** Nach so vielen Minuten stabilen Betriebs wird der Zaehler zurueckgesetzt (transiente Treiber). */
export const GPU_FAILURE_RESET_MINUTES = 10

export function planRender(mode: RenderMode, gpuFailures: number): RenderPlan {
  const failures = Number.isFinite(gpuFailures) && gpuFailures > 0 ? Math.floor(gpuFailures) : 0
  if (mode === 'software') {
    return {
      effective: 'software',
      disableHardwareAcceleration: true,
      switches: ['disable-gpu', 'disable-gpu-compositing'],
      reason: 'Einstellung: Software-Rendering erzwungen'
    }
  }
  if (mode === 'gpu') {
    return {
      effective: 'gpu',
      disableHardwareAcceleration: false,
      switches: [],
      reason: 'Einstellung: GPU erzwungen'
    }
  }
  if (failures >= GPU_FAILURE_THRESHOLD) {
    return {
      effective: 'software',
      disableHardwareAcceleration: true,
      switches: ['disable-gpu', 'disable-gpu-compositing'],
      reason: `Automatik: ${failures} GPU-Abstuerze erkannt — Software-Rendering ist stabiler`
    }
  }
  return {
    effective: 'gpu',
    disableHardwareAcceleration: false,
    switches: [],
    reason: failures === 0 ? 'Automatik: GPU (keine Ausfaelle bekannt)' : `Automatik: GPU (${failures} Ausfaelle, unter der Schwelle)`
  }
}

/** true, wenn dieser Absturz das GPU-Rendering betrifft (Electron: child-process-gone, type GPU). */
export function isGpuFailure(type: string | undefined, reason: string | undefined): boolean {
  if (type !== 'GPU') return false
  // 'clean-exit' ist kein Ausfall (z.B. regulaerer Prozesswechsel beim Herunterfahren).
  return reason !== 'clean-exit'
}
