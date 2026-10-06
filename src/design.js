// The shop's own rules for the impeller, in the same math as the expressions of its model
// (public/impeller.ofb). ClassCAD builds the part; this is only what the page must know before ClassCAD
// answers: which configurations the controls allow, where the balance holes will go while a handle is
// held, the price, and the small drawings of a part from its numbers (the loader, the cart).

export const T = 3.6 // the vanes' thickness (mm)
export const HOLE = 7 // the balance holes' diameter (mm)
export const FRAC = 0.25 // where the balance holes sit, of the way from the hub to the rim

// The model's parameters, as the shop starts them: Ø120, nine vanes 32 high, a 16 bore, the vanes
// swept 62° round and bowed by 0.1555 of their chord.
export const BASE = { diameter: 120, vanes: 9, vaneHeight: 32, bore: 16, wrap: 62, bow: 0.1555 }
export const PARAMS = Object.keys(BASE)
export const RANGE = { diameter: [80, 200], vanes: [3, 12], vaneHeight: [16, 48], wrap: [30, 120], bow: [0.04, 0.45] }
export const BORES = [12, 16, 20, 25]

// The finishes: the part's colour in each, its swatch, and how a sentence says it.
export const FINISHES = [
  { key: 'raw', label: 'Raw', word: 'raw', color: '#c9ced6', swatch: '#b9bec7' },
  { key: 'black', label: 'Black', word: 'black', color: '#4b4f58', swatch: '#2a2c31' },
  { key: 'red', label: 'Red', word: 'red', color: '#d8434b', swatch: '#c8141e' },
  { key: 'fde', label: 'FDE', word: 'flat dark earth', color: '#ad9472', swatch: '#8b7355' },
]
export const finishOf = key => FINISHES.find(f => f.key === key) ?? FINISHES[0]

// The price follows the part: the machining by the volume that is left, a colour's anodizing extra.
export const priceOf = (volume, finish) => 24 + (0.95 * volume) / 1000 + (finish === 'raw' ? 0 : 14)
export const chf = v => v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

const clamp1 = v => Math.max(-1, Math.min(1, v))

// The vane, as the model draws it: about its middle line, an arc from A (on the hub, on the x axis) to
// B (on the rim, `wrap` round), bowed off its chord by `bow` of the chord's length. The arc's centre is
// C, its radius RC; a0 and am are the angles its start and its middle are seen at from C. And the
// balance hole: holeR out, half a pitch round from where the middle line crosses that circle.
export function design(c) {
  const hub = Math.max(32, c.bore + 16) // the hub's diameter
  const R1 = hub / 2 - 3 // the vane starts a little inside the hub's rim
  const R2 = c.diameter / 2 - 3 // and ends a little inside the plate's
  const W = (c.wrap * Math.PI) / 180
  const A = [R1, 0]
  const B = [R2 * Math.cos(W), R2 * Math.sin(W)]
  const chord = Math.hypot(B[0] - R1, B[1])
  const psi = Math.acos((B[0] - R1) / chord) // the chord's direction
  const theta = 4 * Math.atan(2 * c.bow) // the arc's angle, for a bow of `bow` chords
  const RC = chord / (2 * Math.sin(theta / 2))
  const a0 = psi + Math.PI / 2 + theta / 2
  const am = psi + Math.PI / 2
  const C = [R1 - RC * Math.cos(a0), -RC * Math.sin(a0)]
  const on = (R, a) => [C[0] + R * Math.cos(a), C[1] + R * Math.sin(a)]
  // (where the middle line crosses the circle holeR: the law of cosines in the triangle O, C, crossing)
  const pitch = (2 * Math.PI) / c.vanes
  const holeR = hub / 2 + FRAC * (c.diameter / 2 - hub / 2)
  const dC = Math.hypot(C[0], C[1])
  const cross = Math.acos(clamp1((holeR * holeR + dC * dC - RC * RC) / (2 * holeR * dC)))
  const holeAng = Math.atan2(C[1], C[0]) + cross + pitch / 2
  return { hub, A, B, C, RC, a0, theta, on, chord, pitch, holeR, holeAng, apex: on(RC, am), sag: c.bow * chord }
}

// Points along the middle line, from A to B.
export function middle(d, n = 40) {
  return Array.from({ length: n + 1 }, (_, i) => d.on(d.RC, d.a0 - (d.theta * i) / n))
}

const rot = ([x, y], a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]

// how far the point q is from the segment a–b
function segDist(q, a, b) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const u = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(q[0] - a[0] - u * dx, q[1] - a[1] - u * dy)
}

// Is a configuration a part one would machine? The balance holes clear of the vanes, of the hub and of
// the rim; the vanes clear of each other.
export function sound(c) {
  const d = design(c)
  if (!Number.isFinite(d.holeAng) || !Number.isFinite(d.RC)) return false
  const line = middle(d, 30)
  const hole = [d.holeR * Math.cos(d.holeAng), d.holeR * Math.sin(d.holeAng)]
  let holeGap = Infinity
  for (let k = 0; k < c.vanes; k++) {
    const vane = line.map(p => rot(p, k * d.pitch))
    for (let i = 0; i + 1 < vane.length; i++) holeGap = Math.min(holeGap, segDist(hole, vane[i], vane[i + 1]))
  }
  if (holeGap - HOLE / 2 - T / 2 < 1) return false
  if (d.holeR - HOLE / 2 - d.hub / 2 < 1 || c.diameter / 2 - d.holeR - HOLE / 2 < 2) return false
  // (a vane against the next one round, outside the hub)
  const out = line.filter(p => Math.hypot(p[0], p[1]) > d.hub / 2 + 1)
  const next = out.map(p => rot(p, d.pitch))
  let vaneGap = Infinity
  for (const p of out)
    for (let i = 0; i + 1 < next.length; i++) vaneGap = Math.min(vaneGap, segDist(p, next[i], next[i + 1]))
  return vaneGap - T >= 2
}

// The most vanes a configuration takes, and the smallest diameter it takes.
export function maxVanes(c) {
  for (let n = RANGE.vanes[1]; n > RANGE.vanes[0]; n--) if (sound({ ...c, vanes: n })) return n
  return RANGE.vanes[0]
}
export function minDiameter(c) {
  for (let D = RANGE.diameter[0]; D < RANGE.diameter[1]; D++) if (sound({ ...c, diameter: D })) return D
  return RANGE.diameter[1]
}
