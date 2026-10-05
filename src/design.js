// The impeller's design, as its model (public/impeller.ofb) computes it in its own expressions. The
// engine is what builds the part; this is only for what the page knows before the engine answers:
// where the sketch's handles are while they are dragged, which configurations the controls allow,
// and what an order costs.

export const PLATE = 6, T = 3.6, HOLE = 7, FRAC = 0.25

// the shop's first part is the first film's: Ø120, nine vanes 32 high, a 16 bore, the vane swept 62°
// round and bowed by 0.1555 of its chord
export const BASE = { diameter: 120, vanes: 9, vaneHeight: 32, bore: 16, wrap: 62, bow: 0.1555 }
export const PARAMS = ['diameter', 'vanes', 'vaneHeight', 'bore', 'wrap', 'bow']
export const RANGE = { diameter: [80, 200], vanes: [3, 12], vaneHeight: [16, 48], wrap: [30, 120], bow: [0.04, 0.45] }
export const BORES = [12, 16, 20, 25]

// the finishes, as the part is drawn in each (and as its swatch shows it); `word`, as a sentence says it
export const FINISHES = [
  { key: 'raw', label: 'Raw', word: 'raw', color: '#c9ced6', swatch: '#b9bec7' },
  { key: 'black', label: 'Black', word: 'black', color: '#4b4f58', swatch: '#2a2c31' },
  { key: 'red', label: 'Red', word: 'red', color: '#d8434b', swatch: '#c8141e' },
  { key: 'fde', label: 'FDE', word: 'flat dark earth', color: '#ad9472', swatch: '#8b7355' },
]
// (a finish the shop once had, for what is still in a cart)
const FORMER = [{ key: 'blue', label: 'Blue', word: 'blue', color: '#4472d4', swatch: '#2a5fb0' }]
export const finishOf = key => FINISHES.find(f => f.key === key) ?? FORMER.find(f => f.key === key) ?? FINISHES[0]

// the price follows the part: machining by the volume of what is left, anodizing in a colour extra
export const priceOf = (volume, finish) => 24 + (0.95 * volume) / 1000 + (finish === 'raw' ? 0 : 14)
export const chf = v => v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

// the vane's middle line: an arc from A (on the hub, R1 out on the x axis) to B (on the rim, R2 out,
// `wrap` round), bowed off its chord by `bow` of the chord's length; its centre C; the balance hole
export function design(c) {
  const hub = Math.max(32, c.bore + 16), R1 = hub / 2 - 3, R2 = c.diameter / 2 - 3, W = (c.wrap * Math.PI) / 180
  const B = [R2 * Math.cos(W), R2 * Math.sin(W)], A = [R1, 0]
  const chord = Math.hypot(B[0] - R1, B[1]), psi = Math.acos((B[0] - R1) / chord)
  const theta = 4 * Math.atan(2 * c.bow), RC = chord / (2 * Math.sin(theta / 2))
  const a0 = psi + Math.PI / 2 + theta / 2, a1 = a0 - theta, am = psi + Math.PI / 2
  const C = [R1 - RC * Math.cos(a0), -RC * Math.sin(a0)]
  const dC = Math.hypot(C[0], C[1]), phiC = Math.atan2(C[1], C[0])
  const holeR = hub / 2 + FRAC * (c.diameter / 2 - hub / 2)
  const alpha = Math.acos(Math.max(-1, Math.min(1, (holeR * holeR + dC * dC - RC * RC) / (2 * holeR * dC))))
  const holeAng = phiC + alpha + Math.PI / c.vanes
  const on = (R, a) => [C[0] + R * Math.cos(a), C[1] + R * Math.sin(a)]
  const apex = on(RC, am)
  const sag = c.bow * chord
  return { hub, R1, R2, W, A, B, chord, theta, RC, a0, a1, am, C, holeR, holeAng, on, apex, sag, pitch: (2 * Math.PI) / c.vanes }
}

// points along the middle line, from A to B
export function middle(d, n = 40) {
  return Array.from({ length: n + 1 }, (_, i) => d.on(d.RC, d.a0 - (d.theta * i) / n))
}

const rot = ([x, y], a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]
const segDist = (q, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1
  const u = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L))
  return Math.hypot(q[0] - a[0] - u * dx, q[1] - a[1] - u * dy)
}

// is a configuration a part one would machine: the balance holes clear of the vanes, of the hub and
// of the rim, the vanes clear of each other
export function sound(c) {
  const d = design(c)
  if (!Number.isFinite(d.holeAng) || !Number.isFinite(d.RC)) return false
  const m = middle(d, 30)
  const H = [d.holeR * Math.cos(d.holeAng), d.holeR * Math.sin(d.holeAng)]
  let holeGap = Infinity
  for (let k = 0; k < c.vanes; k++) {
    const r = m.map(p => rot(p, k * d.pitch))
    for (let i = 0; i + 1 < r.length; i++) holeGap = Math.min(holeGap, segDist(H, r[i], r[i + 1]))
  }
  if (holeGap - HOLE / 2 - T / 2 < 1) return false
  if (d.holeR - HOLE / 2 - d.hub / 2 < 1 || c.diameter / 2 - d.holeR - HOLE / 2 < 2) return false
  const m0 = m.filter(p => Math.hypot(p[0], p[1]) > d.hub / 2 + 1), m1 = m0.map(p => rot(p, d.pitch))
  let vaneGap = Infinity
  for (const p of m0) for (let i = 0; i + 1 < m1.length; i++) vaneGap = Math.min(vaneGap, segDist(p, m1[i], m1[i + 1]))
  return vaneGap - T >= 2
}

// the most vanes a configuration takes; the smallest diameter it takes
export function maxVanes(c) {
  for (let n = RANGE.vanes[1]; n > RANGE.vanes[0]; n--) if (sound({ ...c, vanes: n })) return n
  return RANGE.vanes[0]
}
export function minDiameter(c) {
  for (let D = RANGE.diameter[0]; D < RANGE.diameter[1]; D++) if (sound({ ...c, diameter: D })) return D
  return RANGE.diameter[1]
}

// a configuration in a few words
export const describe = c => `Ø${c.diameter} · ${c.vanes} vanes · ${c.vaneHeight} high · bore ${c.bore} · ${Math.round(c.wrap)}° sweep`
