export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type Snapshot = {
  limits: Limit[]
  sessionUsd: number | null
  todayUsd: number
}

export type Tokens = { input: number; output: number; cacheRead: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { snapshot: Snapshot | null; lastSessionUsd: number; tokens: Tokens }
  }
}
