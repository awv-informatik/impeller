// The vane sketch, seen down the part's axis: the part's outline in ink, the vanes in red as the
// engine solved the sketch (and patterned it round), and the three handles of the curve they are
// drawn about. The end handle sweeps the vane round the rim (the model's `wrap`), the middle one bows
// it (its `bow`). Every move is a change of those two parameters; the engine re-solves the sketch.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useShop } from '../store'
import { refreshSketch, release, request } from '../engine'
import { RANGE, design, middle, sound } from '../design'

const change = patch => {
  const want = { ...useShop.getState().want, ...patch }
  if (!sound(want)) return false
  useShop.setState({ want, touch: { key: Object.keys(patch)[0], at: performance.now() } })
  request(want, { now: false })
  return true
}
const rot = ([x, y], a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]
const f = v => v.toFixed(2)

// an arc of the sketch, as points: the short way round from its start to its end
function arcPts(a, n = 28) {
  const c = a.center
  const s = Math.atan2(a.start[1] - c[1], a.start[0] - c[0])
  let e = Math.atan2(a.end[1] - c[1], a.end[0] - c[0])
  while (e - s > Math.PI) e -= 2 * Math.PI
  while (e - s < -Math.PI) e += 2 * Math.PI
  const r = Math.hypot(a.start[0] - c[0], a.start[1] - c[1])
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = s + ((e - s) * i) / n
    return [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]
  })
}

export function Sketch() {
  const want = useShop(s => s.want)
  const solved = useShop(s => s.solved)
  const sketch = useShop(s => s.sketch)
  const body = useShop(s => s.body)
  const busy = useShop(s => s.busy)
  const svg = useRef()
  const sheet = useRef()
  const dim = useRef()
  const side = useRef(-1)
  const held = useRef(null)
  const [drag, setDrag] = useState(null)
  useEffect(() => {
    refreshSketch()
  }, [])
  // the sheet's extent: the part's, and a margin (it only grows while a handle is held)
  const [R, setR] = useState(() => want.diameter / 2 + 18)
  useEffect(() => {
    if (!drag) setR(want.diameter / 2 + 18)
  }, [want.diameter, drag])

  const d = design(want)
  // the part's outline from above: all its edges, flattened
  const outline = useMemo(() => {
    if (!body) return ''
    const e = body.edges
    let p = ''
    for (let i = 0; i < e.length; i += 6) p += `M${f(e[i])} ${f(e[i + 1])}L${f(e[i + 3])} ${f(e[i + 4])}`
    return p
  }, [body])
  // the vane as the engine solved it, and round
  const fresh = sketch && solved && sketch.for === JSON.stringify(solved)
  const vanes = useMemo(() => {
    if (!fresh || !sketch?.outer || !sketch?.inner) return []
    const loop = [...arcPts(sketch.outer), ...arcPts(sketch.inner)]
    const pitch = (2 * Math.PI) / solved.vanes
    return Array.from({ length: solved.vanes }, (_, k) => 'M' + loop.map(p => rot(p, k * pitch).map(f).join(' ')).join('L') + 'Z')
  }, [sketch, solved, fresh])
  const holes = useMemo(() => {
    if (!fresh || !sketch?.hole) return []
    const pitch = (2 * Math.PI) / solved.vanes
    return Array.from({ length: solved.vanes }, (_, k) => rot(sketch.hole, k * pitch))
  }, [sketch, solved, fresh])
  // the curve the vanes are drawn about, as wanted (it leads; the engine's vanes follow it)
  const mid = 'M' + middle(d, 48).map(p => p.map(f).join(' ')).join('L')

  const toModel = e => {
    const pt = svg.current.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const p = pt.matrixTransform(svg.current.getScreenCTM().inverse())
    return [p.x, -p.y]
  }
  const move = (k, e) => {
    const [x, y] = toModel(e)
    if (k === 'end') {
      let deg = (Math.atan2(y, x) * 180) / Math.PI
      if (deg < -90) deg += 360
      const wrap = Math.round(Math.max(RANGE.wrap[0], Math.min(RANGE.wrap[1], deg)) * 2) / 2
      if (wrap !== want.wrap) change({ wrap })
    } else {
      // the bow: how far the middle handle is off the chord, of the chord's length
      const nx = -(d.B[1] - d.A[1]) / d.chord, ny = (d.B[0] - d.A[0]) / d.chord
      const M = [(d.A[0] + d.B[0]) / 2, (d.A[1] + d.B[1]) / 2]
      const sag = (x - M[0]) * nx + (y - M[1]) * ny
      const bow = Math.round(Math.max(RANGE.bow[0], Math.min(RANGE.bow[1], sag / d.chord)) * 1000) / 1000
      if (bow !== want.bow) change({ bow })
    }
  }
  const at = p => ({ left: `${50 + (p[0] / (2 * R)) * 100}%`, top: `${50 - (p[1] / (2 * R)) * 100}%` })
  // the readout of the sweep and the bow: by the end handle, on the side of it away from the part,
  // wherever it is clear of all three handles (and of the sketch's title and its button, which on a
  // phone stand over the sheet) and inside the sheet; where there is no room by it, in a corner of
  // the sheet, where no handle goes. (It keeps its place while that still fits, so that it does not
  // hop about under the hand.)
  const place = () => {
    const el = dim.current, sh = sheet.current
    if (!el || !sh) return
    const S = sh.clientWidth, w = el.offsetWidth, h = el.offsetHeight
    const px = p => [(0.5 + p[0] / (2 * R)) * S, (0.5 - p[1] / (2 * R)) * S]
    const [bx, by] = px(d.B), knobs = [d.A, d.apex, d.B].map(px)
    const g = 26, k = g * 0.7, m = 6, clear = 22
    const spots = [
      [bx + g, by - h / 2], [bx - g - w, by - h / 2], [bx - w / 2, by - g - h], [bx - w / 2, by + g],
      [bx + k, by - k - h], [bx - k - w, by - k - h], [bx + k, by + k], [bx - k - w, by + k],
      [m, m], [S - m - w, m], [m, S - m - h], [S - m - w, S - m - h],
    ]
    const sr = sh.getBoundingClientRect()
    const over = [...sh.parentNode.querySelectorAll('.sk-head > *, .sk-done')].map(e => e.getBoundingClientRect()).map(r => [r.left - sr.left - 4, r.top - sr.top - 4, r.right - sr.left + 4, r.bottom - sr.top + 4])
    const ox = bx - S / 2, oy = by - S / 2, ol = Math.hypot(ox, oy) || 1
    // (each spot as it would stand, moved into the sheet where it sticks out of it)
    const fit = ([x, y]) => [Math.max(m, Math.min(S - m - w, x)), Math.max(m, Math.min(S - m - h, y))]
    const score = (p, i) => {
      const [x, y] = fit(p)
      const cx = x + w / 2 - bx, cy = y + h / 2 - by
      let v = (cx * ox + cy * oy) / (ol * (Math.hypot(cx, cy) || 1))
      for (const [kx, ky] of knobs) if (Math.hypot(Math.max(x - kx, 0, kx - x - w), Math.max(y - ky, 0, ky - y - h)) < clear) v -= 10
      for (const [l, t, r, b] of over) if (x < r && x + w > l && y < b && y + h > t) v -= 10
      v -= 0.01 * Math.hypot(x - p[0], y - p[1])
      v -= 0.004 * Math.max(0, Math.hypot(Math.max(x - bx, 0, bx - x - w), Math.max(y - by, 0, by - y - h)) - g)
      return i === side.current ? v + 0.35 : v
    }
    let best = 0
    spots.forEach((p, i) => score(p, i) > score(spots[best], best) && (best = i))
    side.current = best
    const [x, y] = fit(spots[best])
    el.style.left = `${x.toFixed(1)}px`
    el.style.top = `${y.toFixed(1)}px`
  }
  const placeNow = useRef(place)
  placeNow.current = place
  useLayoutEffect(place)
  useEffect(() => {
    const ro = new ResizeObserver(() => placeNow.current())
    ro.observe(sheet.current)
    return () => ro.disconnect()
  }, [])
  const handle = (k, p) => (
    <div
      className={'sk-handle' + (k ? ' grab' : ' fixed') + (drag === k && k ? ' on' : '')}
      style={at(p)}
      title={k === 'end' ? 'Sweep' : k === 'mid' ? 'Bow' : 'On the hub'}
      onPointerDown={e => {
        if (!k) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        held.current = k
        setDrag(k)
      }}
      onPointerMove={e => k && held.current === k && move(k, e)}
      onPointerUp={() => {
        held.current = null
        setDrag(null)
        release()
      }}
      onPointerCancel={() => {
        held.current = null
        setDrag(null)
        release()
      }}
    />
  )
  return (
    <div className="sketch">
      <div className="sheet" ref={sheet}>
        <svg ref={svg} viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`}>
          <defs>
            <pattern id="minor" width="5" height="5" patternUnits="userSpaceOnUse">
              <path d="M5 0H0V5" fill="none" stroke="#eef0f3" strokeWidth="0.3" />
            </pattern>
            <pattern id="major" width="25" height="25" patternUnits="userSpaceOnUse">
              <rect width="25" height="25" fill="url(#minor)" />
              <path d="M25 0H0V25" fill="none" stroke="#e1e4ea" strokeWidth="0.4" />
            </pattern>
            <radialGradient id="fade">
              <stop offset="0.6" stopColor="#fff" />
              <stop offset="1" stopColor="#000" />
            </radialGradient>
            <mask id="paper">
              <rect x={-R} y={-R} width={2 * R} height={2 * R} fill="url(#fade)" />
            </mask>
            {/* (inside the hub the vanes run into it: the hub covers them) */}
            <mask id="hub">
              <rect x={-R} y={-R} width={2 * R} height={2 * R} fill="#fff" />
              <circle r={(solved ? design(solved).hub : d.hub) / 2} fill="#000" />
            </mask>
          </defs>
          <rect x={-R} y={-R} width={2 * R} height={2 * R} fill="url(#major)" mask="url(#paper)" />
          <g transform="scale(1,-1)">
            <path d={outline} className="outline" />
            <g mask="url(#hub)">
              {vanes.map((p, i) => (
                <path key={i} d={p} className={'vane' + (i === 0 ? ' first' : '')} />
              ))}
            </g>
            {holes.map((h, i) => (
              <circle key={i} cx={h[0]} cy={h[1]} r="3.5" className="hole" />
            ))}
            <path d={mid} className={'mid' + (busy ? ' busy' : '')} />
          </g>
        </svg>
        {handle(null, d.A)}
        {handle('mid', d.apex)}
        {handle('end', d.B)}
        <div ref={dim} className="sk-dim">
          <b>{Math.round(want.wrap)}°</b> sweep · bow {d.sag.toFixed(1)}
        </div>
      </div>
      <div className="sk-head">
        <b>Vane sketch</b>
        <span>Drag the end handle round the rim to sweep the vanes, the middle one to bow them.</span>
      </div>
      <button className="sk-done" onClick={() => useShop.getState().openSketch(false)}>
        Back to the part
      </button>
    </div>
  )
}
