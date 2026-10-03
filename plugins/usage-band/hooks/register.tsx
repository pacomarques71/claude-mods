import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Limit, Snapshot, Tokens } from '../types'

const snapshot = atom({ plugin: 'usage-band', key: 'snapshot' } as const, null)
const lastSessionUsd = atom({ plugin: 'usage-band', key: 'lastSessionUsd' } as const, -1)
const tokens = atom({ plugin: 'usage-band', key: 'tokens' } as const, { input: 0, output: 0, cacheRead: 0 })

const WINDOW_MS: Record<string, number> = { five_hour: 5 * 3600e3, seven_day: 7 * 86400e3 }
const LABEL: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: '$' }

// ---------- formato ----------

function dayKey(ms: number) {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `day:${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function usd(n: number) {
  return `$${n.toFixed(2)}`
}

function kfmt(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return String(n)
}

function untilReset(resetsAt: string | undefined, now: number) {
  if (!resetsAt) return ''
  const mins = Math.max(0, Math.round((Date.parse(resetsAt) - now) / 60000))
  if (mins >= 1440) return `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`
  return `${mins}m`
}

// Fracción del periodo ya transcurrida (la marca vertical de la barra).
function elapsed(l: Limit, now: number) {
  const win = WINDOW_MS[l.kind]
  if (!win || !l.resetsAt) return null
  const left = Date.parse(l.resetsAt) - now
  return Math.min(1, Math.max(0, 1 - left / win))
}

// ---------- medición ----------

async function measure($: EngineInterface, limits: Limit[], sessionCost: number | null) {
  const now = await $.clock.now()
  const key = dayKey(now)
  let today = Number((await $.store.get(key)) ?? 0)

  if (sessionCost !== null) {
    const prev = await read($, lastSessionUsd)
    // Primera medida de esta sesión: cuenta también lo gastado antes de cargar el mod.
    const delta = prev < 0 ? sessionCost : sessionCost - prev
    if (delta > 0) {
      today += delta
      await $.store.set(key, today)
    }
    await update($, lastSessionUsd, () => sessionCost)
  }

  const snap: Snapshot = { limits, sessionUsd: sessionCost, todayUsd: today }
  await update($, snapshot, () => snap)
}

// ---------- dibujo SVG ----------

type Piece =
  | { t: 'icon'; d: string }
  | { t: 'text'; s: string; bold?: boolean; dim?: boolean }
  | { t: 'bar'; pct: number; mark: number | null }
  | { t: 'sep' }

const CH = 7.6 // ancho aprox. de un carácter monoespaciado a 13px
const H = 28

const ICON = {
  gauge: 'M2.5 11a5.5 5.5 0 1 1 11 0M8 11l2.6-3.2',
  calendar: 'M3.5 3h9a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-8A1.5 1.5 0 0 1 3.5 3zM2 6.5h12M5 1.5v3M11 1.5v3',
  clock: 'M8 2.5a5.5 5.5 0 1 1-5.2 3.7M2.5 2.5v3.7h3.7M8 5v3l2 1.5',
  up: 'M8 10V2.5M5 5.5l3-3 3 3M2.5 10v3.5h11V10',
  down: 'M8 2.5V10M5 7l3 3 3-3M2.5 10v3.5h11V10',
  layers: 'M8 2l6 3-6 3-6-3zM2 8l6 3 6-3M2 11l6 3 6-3',
  coin: 'M8 2a6 6 0 1 1 0 12A6 6 0 0 1 8 2zM9.8 6.2C9.4 5.6 8.8 5.3 8 5.3c-1 0-1.7.5-1.7 1.3 0 1.8 3.6.9 3.6 2.8 0 .8-.8 1.3-1.9 1.3-.8 0-1.5-.3-1.9-.9M8 4.3v1M8 10.7v1',
}

function pieceWidth(p: Piece) {
  switch (p.t) {
    case 'icon': return 16
    case 'text': return p.s.length * CH
    case 'bar': return 52
    case 'sep': return 1
  }
}

function pill(x: number, cls: string, pieces: Piece[]) {
  const GAP = 8
  const PAD = 10
  const w = PAD * 2 + pieces.reduce((a, p) => a + pieceWidth(p), 0) + GAP * (pieces.length - 1)
  let cx = x + PAD
  let out = `<rect class="bg ${cls}" x="${x}" y="0" width="${w}" height="${H}" rx="${H / 2}"/>`
  for (const p of pieces) {
    const pw = pieceWidth(p)
    if (p.t === 'icon') {
      out += `<path class="ic ${cls}" transform="translate(${cx} ${(H - 16) / 2})" d="${p.d}"/>`
    } else if (p.t === 'text') {
      out += `<text x="${cx}" y="${H / 2 + 4.5}" class="${p.bold ? 'b' : ''}${p.dim ? ' dim' : ''}">${p.s}</text>`
    } else if (p.t === 'bar') {
      const y = H / 2 - 3
      const fill = Math.max(0, Math.min(1, p.pct / 100)) * pw
      out += `<rect class="track" x="${cx}" y="${y}" width="${pw}" height="6" rx="3"/>`
      out += `<rect class="fill ${p.pct >= 80 ? 'hot' : cls}" x="${cx}" y="${y}" width="${fill}" height="6" rx="3"/>`
      if (p.mark !== null) {
        out += `<rect class="mark" x="${cx + p.mark * pw - 1}" y="${H / 2 - 7}" width="2" height="14" rx="1"/>`
      }
    } else {
      out += `<rect class="sep" x="${cx}" y="7" width="1" height="${H - 14}"/>`
    }
    cx += pw + GAP
  }
  return { svg: out, w }
}

function buildSvg(snap: Snapshot, tok: Tokens, now: number) {
  const groups: { cls: string; pieces: Piece[] }[] = []

  for (const l of snap.limits) {
    const pct = Math.round(l.percentUsed)
    const reset = untilReset(l.resetsAt, now)
    const pieces: Piece[] = [
      { t: 'icon', d: l.kind === 'seven_day' ? ICON.calendar : ICON.gauge },
      { t: 'text', s: LABEL[l.kind] ?? l.kind, dim: true },
      { t: 'bar', pct, mark: elapsed(l, now) },
      { t: 'text', s: `${pct}%`, bold: true },
    ]
    if (reset) pieces.push({ t: 'sep' }, { t: 'icon', d: ICON.clock }, { t: 'text', s: reset, dim: true })
    groups.push({ cls: l.kind === 'seven_day' ? 'purple' : 'green', pieces })
  }

  groups.push({ cls: 'red', pieces: [{ t: 'icon', d: ICON.up }, { t: 'text', s: kfmt(tok.input) }] })
  groups.push({ cls: 'green', pieces: [{ t: 'icon', d: ICON.down }, { t: 'text', s: kfmt(tok.output) }] })
  groups.push({ cls: 'blue', pieces: [{ t: 'icon', d: ICON.layers }, { t: 'text', s: kfmt(tok.cacheRead) }] })
  groups.push({
    cls: 'yellow',
    pieces: [
      { t: 'icon', d: ICON.coin },
      { t: 'text', s: snap.sessionUsd === null ? '—' : usd(snap.sessionUsd) },
      { t: 'sep' },
      { t: 'text', s: `hoy ${usd(snap.todayUsd)}`, dim: true },
    ],
  })

  const style = `
    text{font:13px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;fill:#2b2b2b}
    .b{font-weight:700}.dim{fill:#5f5f5f}
    .ic{fill:none;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
    .track{fill:#00000014}.mark{fill:#333}.sep{fill:#00000022}
    .bg.green{fill:#dcebe2}.ic.green{stroke:#3f8a62}.fill.green{fill:#8fb87a}
    .bg.purple{fill:#e6e1f6}.ic.purple{stroke:#7a5bd6}.fill.purple{fill:#8fb87a}
    .bg.red{fill:#f4e0db}.ic.red{stroke:#c75a43}
    .bg.blue{fill:#dfe3f8}.ic.blue{stroke:#5a6ed6}
    .bg.yellow{fill:#f3e9d1}.ic.yellow{stroke:#b5862a}
    .fill.hot{fill:#d9694f}
    @media (prefers-color-scheme:dark){
      text{fill:#e8e8e8}.dim{fill:#a8a8a8}
      .track{fill:#ffffff1f}.mark{fill:#eee}.sep{fill:#ffffff2a}
      .bg.green{fill:#22382c}.bg.purple{fill:#302a48}.bg.red{fill:#43291f}
      .bg.blue{fill:#262d4a}.bg.yellow{fill:#3e3420}
      .ic.green{stroke:#7cc69c}.ic.purple{stroke:#a993f0}.ic.red{stroke:#ec8a74}
      .ic.blue{stroke:#8fa0f2}.ic.yellow{stroke:#e0b45a}
    }`

  // Una SVG por pastilla, para que la barra las reparta a lo ancho.
  return groups.map((g, i) => {
    const p = pill(0, g.cls, g.pieces)
    const width = Math.ceil(p.w)
    return {
      key: `pill-${i}`,
      width,
      source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}"><style>${style}</style>${p.svg}</svg>`,
    }
  })
}

// ---------- hooks ----------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // Corrección única: el total de hoy se contó sin el gasto previo a cargar el mod.
    // Se rehace desde cero; la siguiente medida suma el coste entero de la sesión.
    if (!(await $.store.get('fix:pre-load-cost'))) {
      await $.store.set('fix:pre-load-cost', true)
      await $.store.set(dayKey(await $.clock.now()), 0)
      await update($, lastSessionUsd, () => -1)
    }
    const u = await $.session.usage()
    await measure($, u.rateLimits, u.cost?.usd ?? null)
    return result
  })

  on('session.measure', async ($, e, next) => {
    await measure($, e.rateLimits, e.cost?.usd ?? null)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const u = e.usage
    if (u) {
      await update($, tokens, t => ({
        input: t.input + u.input_tokens + u.cache_creation_input_tokens,
        output: t.output + u.output_tokens,
        cacheRead: t.cacheRead + u.cache_read_input_tokens,
      }))
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snap = await read($, snapshot)
    if (e.props.hasSurvey || snap === null) {
      return next(e)
    }

    const tok = await read($, tokens)
    const now = await $.clock.now()

    if (e.surface !== 'terminal') {
      const { Box, Svg } = $.ui.resolve(e)
      const alts = snap.limits
        .map(l => `${LABEL[l.kind] ?? l.kind} ${Math.round(l.percentUsed)}% usado`)
        .concat(
          `tokens de entrada ${kfmt(tok.input)}`,
          `tokens de salida ${kfmt(tok.output)}`,
          `tokens de caché ${kfmt(tok.cacheRead)}`,
          `coste sesión ${snap.sessionUsd === null ? '—' : usd(snap.sessionUsd)}, hoy ${usd(snap.todayUsd)}`,
        )
      return (
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" flexGrow={1} width="100%">
          {buildSvg(snap, tok, now).map((p, i) => (
            <Svg key={p.key} source={p.source} alt={alts[i]} width={p.width} height={H} />
          ))}
        </Box>
      )
    }

    const { Box, Text } = $.ui.resolve(e)
    const limits = snap.limits.map(l => {
      const pct = Math.round(l.percentUsed)
      const filled = Math.round(pct / 10)
      const bar = '█'.repeat(filled) + '░'.repeat(10 - filled)
      const reset = untilReset(l.resetsAt, now)
      return (
        <Text key={l.kind} color={pct >= 80 ? 'red' : undefined}>
          {LABEL[l.kind] ?? l.kind} {bar} {pct}%{reset ? ` ⟳ ${reset}` : ''}
          {'   '}
        </Text>
      )
    })

    return (
      <Box flexDirection="row">
        {limits}
        <Text dimColor>
          ↑{kfmt(tok.input)} ↓{kfmt(tok.output)} ≋{kfmt(tok.cacheRead)}   {snap.sessionUsd === null ? '—' : usd(snap.sessionUsd)} · hoy {usd(snap.todayUsd)}
        </Text>
      </Box>
    )
  })
}
