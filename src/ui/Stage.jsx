// The part's room: the part (or its sketch), and, on narrower screens, behind it, what is being
// changed. On phones and tablets it stays at the top of the screen while the controls scroll under it.
// While the engine starts, the part's sketch draws itself here, and the engine's steps tick off.
import { useEffect, useMemo, useState } from 'react'
import { useShop } from '../store'
import { BASE, T, design, middle } from '../design'
import { Giant } from './Giant'
import { useTouched } from './touched'
import { View } from '../three/View'
import { Sketch } from './Sketch'

const STEPS = ['Starting ClassCAD', 'Loading impeller.ofb', 'Building the part']

// a line of the drawing: when it starts to be drawn, and how long it is (it is drawn in along its length)
const ln = (i, length) => {
  const len = length.toFixed(2)
  return { '--i': i, '--len': len, strokeDasharray: `${len} ${len}` }
}

// The shop's first part from above, as its sketch draws it: the plate, the hub, the bore, the vanes in
// red one after the other, the balance holes; over and over, turning slowly.
function Drawing() {
  const { d, vane, vaneLength, holes } = useMemo(() => {
    const d = design(BASE)
    // the vane's outline: its middle line, half its thickness out to either side (from the arc's centre)
    const line = middle(d, 40)
    const side = k =>
      line.map(([x, y]) => {
        const l = Math.hypot(x - d.C[0], y - d.C[1])
        return [x + ((x - d.C[0]) / l) * k, y + ((y - d.C[1]) / l) * k]
      })
    const loop = [...side(T / 2), ...side(-T / 2).reverse()]
    const vane = 'M' + loop.map(p => p.map(v => v.toFixed(2)).join(' ')).join('L') + 'Z'
    // (its length, for drawing it in: the outline's, round)
    let vaneLength = 0
    loop.forEach((p, i) => {
      const q = loop[(i + 1) % loop.length]
      vaneLength += Math.hypot(q[0] - p[0], q[1] - p[1])
    })
    const holes = Array.from({ length: BASE.vanes }, (_, k) => {
      const a = d.holeAng + k * d.pitch
      return [d.holeR * Math.cos(a), d.holeR * Math.sin(a)]
    })
    return { d, vane, vaneLength, holes }
  }, [])
  const R = BASE.diameter / 2
  return (
    <svg className="drawing" viewBox={`${-R - 6} ${-R - 6} ${2 * R + 12} ${2 * R + 12}`} aria-hidden>
      <g className="turn">
        <g transform="scale(1,-1)">
          <circle r={R} className="ln ink" style={ln(0, 2 * Math.PI * R)} />
          <circle r={d.hub / 2} className="ln ink" style={ln(1.2, Math.PI * d.hub)} />
          <circle r={BASE.bore / 2} className="ln ink" style={ln(1.8, Math.PI * BASE.bore)} />
          {Array.from({ length: BASE.vanes }, (_, k) => (
            <path
              key={k}
              d={vane}
              transform={`rotate(${(k * 360) / BASE.vanes})`}
              className="ln red"
              style={ln(2.6 + k * 0.42, vaneLength)}
            />
          ))}
          {holes.map(([x, y], k) => (
            <circle
              key={k}
              cx={x.toFixed(2)}
              cy={y.toFixed(2)}
              r="3.5"
              className="ln thin"
              style={ln(6.6 + k * 0.16, 7 * Math.PI)}
            />
          ))}
        </g>
      </g>
    </svg>
  )
}

function Loader() {
  const status = useShop(s => s.status)
  const note = useShop(s => s.note)
  const error = useShop(s => s.error)
  // (it fades away once the part is there)
  const [gone, setGone] = useState(false)
  useEffect(() => {
    if (status !== 'ready') return setGone(false)
    const t = setTimeout(() => setGone(true), 700)
    return () => clearTimeout(t)
  }, [status])
  if (gone) return null
  if (status === 'error') {
    return (
      <div className="status err">
        <b>ClassCAD couldn't start</b>
        <span>{error}</span>
        <small>The engine's key is only issued on impeller.classcad.ai and on localhost.</small>
      </div>
    )
  }
  const at = status === 'ready' ? STEPS.length : Math.max(0, STEPS.indexOf(note))
  return (
    <div className={'loader' + (status === 'ready' ? ' out' : '')}>
      <Drawing />
      <ol className="steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i < at ? 'done' : i === at ? 'on' : ''}>
            <i />
            {s}
          </li>
        ))}
      </ol>
      <small>ClassCAD runs right here in your browser. The first visit downloads the engine.</small>
    </div>
  )
}

export function Stage() {
  const sketchOpen = useShop(s => s.sketchOpen)
  const ready = useShop(s => s.status === 'ready')
  const touched = useTouched()
  return (
    <section className={'stage' + (sketchOpen ? ' sketching' : '')}>
      <Giant k={touched} />
      <div className={'room' + (ready ? ' in' : '')}>{sketchOpen ? <Sketch /> : <View />}</div>
      <Loader />
      {ready && !sketchOpen && <div className="hint">Drag to turn it</div>}
    </section>
  )
}
