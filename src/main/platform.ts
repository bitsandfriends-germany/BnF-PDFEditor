// Wayland-/Ozone-Flag-Ableitung, rein, damit ohne Electron instanziierbar und testbar.
// Regeln aus Section 1:
//  - Standard-Flags: --ozone-platform-hint=auto, --enable-features=WaylandWindowDecorations
//  - Ein vom User gesetztes ELECTRON_OZONE_PLATFORM_HINT wird respektiert, nicht ueberschrieben.
//  - PDF_EDITOR_DISABLE_WAYLAND=1 erzwingt X11 (evaluate hauptsaechlich das Wrapper-Script in Step 12,
//    hier zusätzlich verteidigt, damit auch ein direkter Start ohne Wrapper korrekt faellt).

export interface FlagEnv {
  ELECTRON_OZONE_PLATFORM_HINT?: string
  PDF_EDITOR_DISABLE_WAYLAND?: string
  XDG_SESSION_TYPE?: string
  WAYLAND_DISPLAY?: string
}

export interface ChromiumLaunchPlan {
  switches: string[] // Paare fur app.commandLine.appendSwitch(name, value)
  extraFeatures: string[]
  waylandForcedOff: boolean
}

function truthy(v: string | undefined): boolean {
  return v === '1' || v === 'true' || v === 'yes'
}

export function planChromiumLaunch(env: FlagEnv): ChromiumLaunchPlan {
  const disableWayland = truthy(env.PDF_EDITOR_DISABLE_WAYLAND)
  const userHint = env.ELECTRON_OZONE_PLATFORM_HINT

  const switchPairs: string[] = []
  const extraFeatures: string[] = ['WaylandWindowDecorations']

  let effectiveHint: string
  if (disableWayland) {
    effectiveHint = 'x11'
  } else if (userHint && userHint.trim() !== '') {
    effectiveHint = userHint.trim()
  } else {
    effectiveHint = 'auto'
  }

  switchPairs.push('ozone-platform-hint', effectiveHint)

  // WaylandWindowDecorations nur sinnvoll, wenn nicht explizit X11 erzwungen.
  if (effectiveHint === 'x11') {
    return {
      switches: toSwitchArgv(switchPairs),
      extraFeatures: [],
      waylandForcedOff: true
    }
  }

  return {
    switches: toSwitchArgv(switchPairs),
    extraFeatures,
    waylandForcedOff: false
  }
}

// wandelt [name, value, name, value] in argv-Form --name=value um
function toSwitchArgv(pairs: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < pairs.length; i += 2) {
    const name = pairs[i] as string
    const value = pairs[i + 1] as string
    out.push(`--${name}=${value}`)
  }
  return out
}

export function detectWayland(env: FlagEnv): boolean {
  if (truthy(env.PDF_EDITOR_DISABLE_WAYLAND)) return false
  return Boolean(env.WAYLAND_DISPLAY) || env.XDG_SESSION_TYPE === 'wayland'
}
