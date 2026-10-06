// The vane sketch, seen down the part's axis: the part's outline in ink, the vanes in red as the
// engine solved the sketch (and patterned it round), and the three handles of the curve they are
// drawn about. The end handle sweeps the vane round the rim (the model's `wrap`), the middle one bows
// it (its `bow`). Every move is a change of those two parameters; the engine re-solves the sketch.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useShop } from '../store'
import { refreshSketch, release, request } from '../engine'
import { RANGE, design, middle, sound } from '../design'
import { placeReadout } from './placeReadout'

// a handle's move: a change of the model's parameters, if the part would still be one to machine
function change(patch) {
  const want = { ...useShop.getState().want, ...patch }
  if (!sound(want)) return
  useShop.setState({ want, touch: { key: Object.keys(patch)[0], at: performance.now() } })
  request(want)
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const rot = ([x, y], a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]
const xy = p => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`
const pathOf = (points, closed) => `M${points.map(xy).join('L')}${closed ? 'Z' : ''}`

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
  const readout = useRef()
  const readoutPlace = useRef(-1)
  const held = useRef(null) // (the handle in hand: a ref, as pointer moves can come before React renders)
  const [drag, setDrag] = useState(null)
  useEffect(() => void refreshSketch(), [])

  // the sheet's extent: the part's, and a margin (it keeps still while a handle is held)
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
    for (let i = 0; i < e.length; i += 6) p += `M${xy([e[i], e[i + 1]])}L${xy([e[i + 3], e[i + 4]])}`
    return p
  }, [body])
  // the vanes and the balance holes, as the engine solved the sketch for what is built, patterned round
  const fresh = sketch && solved && sketch.for === JSON.stringify(solved)
  const vanes = useMemo(() => {
    if (!fresh || !sketch.outer || !sketch.inner) return []
    const loop = [...arcPts(sketch.outer), ...arcPts(sketch.inner)]
    const pitch = (2 * Math.PI) / solved.vanes
    return Array.from({ length: solved.vanes }, (_, k) =>
      pathOf(
        loop.map(p => rot(p, k * pitch)),
        true,
      ),
    )
  }, [sketch, solved, fresh])
  const holes = useMemo(() => {
    if (!fresh || !sketch.hole) return []
    const pitch = (2 * Math.PI) / solved.vanes
    return Array.from({ length: solved.vanes }, (_, k) => rot(sketch.hole, k * pitch))
  }, [sketch, solved, fresh])
  // the curve the vanes are drawn about, as wanted (it leads; the engine's vanes follow it)
  const mid = pathOf(middle(d, 48))

  // a pointer, in the sketch's own millimetres (y up)
  const toModel = e => {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.current.getScreenCTM().inverse())
    return [p.x, -p.y]
  }
  const move = (handle, e) => {
    const [x, y] = toModel(e)
    if (handle === 'end') {
      // the sweep: the handle's angle round the part, to half a degree
      let deg = (Math.atan2(y, x) * 180) / Math.PI
      if (deg < -90) deg += 360
      const wrap = Math.round(clamp(deg, ...RANGE.wrap) * 2) / 2
      if (wrap !== want.wrap) change({ wrap })
    } else {
      // the bow: how far the middle handle is off the chord, of the chord's length
      const n = [(d.A[1] - d.B[1]) / d.chord, (d.B[0] - d.A[0]) / d.chord]
      const sag = (x - (d.A[0] + d.B[0]) / 2) * n[0] + (y - (d.A[1] + d.B[1]) / 2) * n[1]
      const bow = Math.round(clamp(sag / d.chord, ...RANGE.bow) * 1000) / 1000
      if (bow !== want.bow) change({ bow })
    }
  }
  const letGo = () => {
    held.current = null
    setDrag(null)
    release()
  }
  const grab = handle => ({
    onPointerDown: e => {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      held.current = handle
      setDrag(handle)
    },
    onPointerMove: e => held.current === handle && move(handle, e),
    onPointerUp: letGo,
    onPointerCancel: letGo,
  })
  const at = p => ({ left: `${50 + (p[0] / (2 * R)) * 100}%`, top: `${50 - (p[1] / (2 * R)) * 100}%` })

  // The readout is placed (placeReadout.js) once the page has laid it out, and again whenever the sheet
  // changes size. On a phone, the sketch's title and its button stand over the sheet: it keeps clear.
  const placeTheReadout = () => {
    const el = readout.current
    const sh = sheet.current
    if (!el || !sh) return
    const S = sh.clientWidth
    const px = p => [(0.5 + p[0] / (2 * R)) * S, (0.5 - p[1] / (2 * R)) * S]
    const s = sh.getBoundingClientRect()
    const over = [...sh.parentNode.querySelectorAll('.sk-head > *, .sk-done')].map(e => {
      const r = e.getBoundingClientRect()
      return [r.left - s.left - 4, r.top - s.top - 4, r.right - s.left + 4, r.bottom - s.top + 4]
    })
    const { x, y, place } = placeReadout({
      sheet: S,
      box: [el.offsetWidth, el.offsetHeight],
      handle: px(d.B),
      knobs: [d.A, d.apex, d.B].map(px),
      over,
      last: readoutPlace.current,
    })
    readoutPlace.current = place
    el.style.left = `${x.toFixed(1)}px`
    el.style.top = `${y.toFixed(1)}px`
  }
  const latest = useRef(placeTheReadout)
  latest.current = placeTheReadout
  useLayoutEffect(placeTheReadout)
  useEffect(() => {
    const observer = new ResizeObserver(() => latest.current())
    observer.observe(sheet.current)
    return () => observer.disconnect()
  }, [])

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
        <div className="sk-handle fixed" style={at(d.A)} title="On the hub" />
        <div
          className={'sk-handle grab' + (drag === 'mid' ? ' on' : '')}
          style={at(d.apex)}
          title="Bow"
          {...grab('mid')}
        />
        <div
          className={'sk-handle grab' + (drag === 'end' ? ' on' : '')}
          style={at(d.B)}
          title="Sweep"
          {...grab('end')}
        />
        <div ref={readout} className="sk-dim">
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
