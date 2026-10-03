export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Context = {
  tokens?: number
  window: number
  percent?: number
  // Tokens a los que se compacta automáticamente; ausente si está desactivado.
  compactAt?: number
}

export type Snapshot = {
  limits: Limit[]
  context: Context | null
  sessionUsd: number | null
  todayUsd: number
}

export type Tokens = { input: number; output: number; cacheRead: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': {
      snapshot: Snapshot | null
      lastSessionUsd: number
      tokens: Tokens
      contextWarned: boolean
    }
  }
}
