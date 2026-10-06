// The configurator: a control for each of the model's parameters, the price the part comes to, and
// the order. Every change goes to the model (engine.request); the engine rebuilds the part and the
// price follows its volume.
import { useEffect, useRef, useState } from 'react'
import { useShop } from '../store'
import { release, request } from '../engine'
import { BORES, FINISHES, PARAMS, RANGE, chf, finishOf, maxVanes, minDiameter, priceOf, sound } from '../design'

// a control's change: a click goes to the engine at once, a drag after a moment
const change = (key, value, now = true) => {
  const want = { ...useShop.getState().want, [key]: value }
  useShop.setState({ want, touch: { key, at: performance.now() } })
  request(want, { now })
}

// a row is red for a moment after it was changed
function useHot(key) {
  const touch = useShop(s => s.touch)
  const [hot, setHot] = useState(false)
  useEffect(() => {
    if (touch?.key !== key) return
    setHot(true)
    const t = setTimeout(() => setHot(false), 900)
    return () => clearTimeout(t)
  }, [touch, key])
  return hot
}

function Row({ k, name, value, children, className = '' }) {
  const hot = useHot(k)
  return (
    <div className={`crow ${className}${hot ? ' hot' : ''}`}>
      <div className="name">{name}</div>
      <div className="val">{value}</div>
      {children}
    </div>
  )
}

// a slider. `lo`: below it the configuration does not go (the track is candy-striped there);
// `building`: the engine is still building this value (the fill's stripes run)
function Slider({ value, min, max, lo = min, step = 1, onChange, disabled, label, building }) {
  const ref = useRef()
  const k = (value - min) / (max - min)
  const set = (v, drag = false) => {
    v = Math.max(lo, Math.min(max, Math.round(v / step) * step))
    if (v !== value) onChange(v, drag)
  }
  const from = (e, drag) => {
    const r = ref.current.getBoundingClientRect()
    set(min + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (max - min), drag)
  }
  return (
    <div
      ref={ref}
      className={'track' + (disabled ? ' off' : '') + (building ? ' building' : '')}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={lo}
      aria-valuemax={max}
      aria-valuenow={value}
      onPointerDown={e => {
        if (disabled) return
        e.currentTarget.setPointerCapture(e.pointerId)
        from(e, true)
      }}
      onPointerMove={e => e.currentTarget.hasPointerCapture(e.pointerId) && from(e, true)}
      onPointerUp={release}
      onPointerCancel={release}
      onKeyDown={e => {
        const d = (e.shiftKey ? 10 : 1) * step
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') set(value + d)
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') set(value - d)
        else return
        e.preventDefault()
      }}>
      {lo > min && <i className="lo" style={{ width: `${((lo - min) / (max - min)) * 100}%` }} title="Too small for these vanes and this curve" />}
      <i className="fill" style={{ width: `${k * 100}%` }} />
      <b className="knob" style={{ left: `${k * 100}%` }} />
    </div>
  )
}

// the vane curve, small: its middle line as bowed and swept
function MiniCurve({ wrap, bow }) {
  const w = (wrap * Math.PI) / 180
  let A = [6, 25], B = [6 + 52 * Math.sin(w * 0.75), 25 - 22 * Math.sin(Math.min(w * 0.9, Math.PI / 2)) ** 0.5]
  const M = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2]
  const nx = -(B[1] - A[1]), ny = B[0] - A[0], L = Math.hypot(nx, ny) || 1
  let q = [M[0] + (nx / L) * bow * 2 * 34, M[1] + (ny / L) * bow * 2 * 34]
  // (it stays inside its 64×30, dots and all: a curve bowed and swept far is drawn smaller, and moved
  // in only as far as it has to be, so that it never jumps)
  const on = t => [0, 1].map(i => (1 - t) ** 2 * A[i] + 2 * t * (1 - t) * q[i] + t * t * B[i])
  const turns = [0, 1].map(i => (A[i] - q[i]) / (A[i] - 2 * q[i] + B[i])).filter(t => t > 0 && t < 1)
  const pts = [A, B, ...turns.map(on)]
  const lo = [0, 1].map(i => Math.min(...pts.map(p => p[i]))), hi = [0, 1].map(i => Math.max(...pts.map(p => p[i])))
  const P = 4, box = [64, 30]
  const s = Math.min(1, ...[0, 1].map(i => (box[i] - 2 * P) / (hi[i] - lo[i] || 1)))
  const c = [0, 1].map(i => (lo[i] + hi[i]) / 2)
  const shift = [0, 1].map(i => {
    const a = c[i] + (lo[i] - c[i]) * s, b = c[i] + (hi[i] - c[i]) * s
    return a < P ? P - a : b > box[i] - P ? box[i] - P - b : 0
  })
  const fit = p => [0, 1].map(i => c[i] + (p[i] - c[i]) * s + shift[i])
  ;[A, B, q] = [fit(A), fit(B), fit(q)]
  return (
    <svg viewBox="0 0 64 30" width="64" height="30">
      <path d={`M${A.map(v => v.toFixed(1)).join(' ')}Q${q.map(v => v.toFixed(1)).join(' ')} ${B.map(v => v.toFixed(1)).join(' ')}`} fill="none" stroke="#e7000b" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx={A[0].toFixed(1)} cy={A[1].toFixed(1)} r="2.6" fill="#0f1320" />
      <circle cx={B[0].toFixed(1)} cy={B[1].toFixed(1)} r="2.6" fill="#0f1320" />
    </svg>
  )
}

function Order() {
  const status = useShop(s => s.status)
  const [state, setState] = useState('idle')
  const [press, setPress] = useState(false)
  const order = () => {
    if (state !== 'idle' || status !== 'ready') return
    setState('busy')
    // when the engine has caught up with what the controls show, the part goes in the cart as built
    const add = () => {
      const s = useShop.getState()
      if (s.busy || PARAMS.some(k => s.want[k] !== s.solved?.[k]) || s.volume == null) return setTimeout(add, 120)
      s.addToCart({ key: JSON.stringify([PARAMS.map(k => s.solved[k]), s.finish]), config: { ...s.solved }, finish: s.finish, volume: s.volume, price: priceOf(s.volume, s.finish) })
      setState('done')
      setTimeout(() => useShop.getState().openCart(true), 650)
      setTimeout(() => setState('idle'), 2000)
    }
    setTimeout(add, 300)
  }
  return (
    <button
      className={'order ' + state + (press ? ' press' : '')}
      disabled={status !== 'ready'}
      onPointerDown={() => setPress(true)}
      onPointerUp={() => setPress(false)}
      onPointerLeave={() => setPress(false)}
      onClick={order}>
      <span>{state === 'busy' ? 'Ordering…' : state === 'done' ? 'In your cart' : 'Order'}</span>
      <i>{state === 'done' ? '✓' : state === 'busy' ? '' : '→'}</i>
    </button>
  )
}

export function Card() {
  const want = useShop(s => s.want)
  const status = useShop(s => s.status)
  const busy = useShop(s => s.busy)
  const finish = useShop(s => s.finish)
  const volume = useShop(s => s.volume)
  const solved = useShop(s => s.solved)
  const sketchOpen = useShop(s => s.sketchOpen)
  const error = useShop(s => s.error)
  const ready = status === 'ready'
  const lo = minDiameter(want)
  const most = maxVanes(want)
  const price = volume != null ? priceOf(volume, finish) : null
  // (the price is red for a moment when it moves)
  const [priceHot, setPriceHot] = useState(false)
  const shown = useRef(price)
  useEffect(() => {
    if (price == null || shown.current === price) return
    shown.current = price
    setPriceHot(true)
    const t = setTimeout(() => setPriceHot(false), 700)
    return () => clearTimeout(t)
  }, [price])
  const f = finishOf(finish)
  return (
    <aside className={'card' + (ready ? '' : ' wait')} id="configure">
      <div className="chead">
        <span>Configure</span>
        <i className={'live' + (busy ? ' busy' : '')} />
        <small>{!ready ? (status === 'error' ? 'offline' : 'starting') : busy ? 'rebuilding' : 'live'}</small>
      </div>
      <Row k="diameter" name="Diameter" value={<><b>Ø {want.diameter}</b> mm</>} className="r-slider">
        <Slider label="Diameter" value={want.diameter} min={RANGE.diameter[0]} max={RANGE.diameter[1]} lo={lo} disabled={!ready} building={busy && solved?.diameter !== want.diameter} onChange={(v, drag) => change('diameter', v, !drag)} />
      </Row>
      <Row k="vanes" name="Vanes" value={<b>{want.vanes}</b>} className="r-vanes">
        <div className="stepper">
          <button className="b" disabled={!ready || want.vanes <= RANGE.vanes[0]} onClick={() => change('vanes', want.vanes - 1)} aria-label="Fewer vanes">−</button>
          <span className="num">{want.vanes}</span>
          <button className="b" disabled={!ready || want.vanes >= most} onClick={() => change('vanes', want.vanes + 1)} aria-label="More vanes" title={want.vanes >= most ? 'As many as this diameter takes' : undefined}>+</button>
        </div>
        <div className="dots">
          {Array.from({ length: RANGE.vanes[1] }, (_, i) => (
            <i key={i} className={i < want.vanes ? 'on' : i >= most ? 'no' : ''} />
          ))}
        </div>
      </Row>
      <Row k="vaneHeight" name="Vane height" value={<><b>{want.vaneHeight}</b> mm</>} className="r-slider">
        <Slider label="Vane height" value={want.vaneHeight} min={RANGE.vaneHeight[0]} max={RANGE.vaneHeight[1]} disabled={!ready} building={busy && solved?.vaneHeight !== want.vaneHeight} onChange={(v, drag) => change('vaneHeight', v, !drag)} />
      </Row>
      <Row k="bore" name="Bore" value={<><b>Ø {want.bore}</b> mm</>} className="r-bore">
        <div className="chips">
          {BORES.map(b => (
            <button key={b} className={'chip' + (b === want.bore ? ' on' : '')} disabled={!ready || !sound({ ...want, bore: b })} onClick={() => change('bore', b)}>
              {b}
            </button>
          ))}
        </div>
      </Row>
      <Row k="wrap" name="Vane curve" value={<><b>{Math.round(want.wrap)}°</b> sweep</>} className="r-curve">
        <button className={'edit' + (sketchOpen ? ' on' : '')} disabled={!ready} onClick={() => useShop.getState().openSketch(!sketchOpen)}>
          <MiniCurve wrap={want.wrap} bow={want.bow} />
          <span>{sketchOpen ? 'Back to the part' : 'Edit the sketch'}</span>
        </button>
      </Row>
      <Row k="finish" name="Finish" value={<><b>{f.label}</b> anodized</>} className="r-finish">
        <div className="swatches">
          {FINISHES.map(x => (
            <button key={x.key} className={'sw' + (x.key === finish ? ' on' : '')} onClick={() => useShop.getState().setFinish(x.key)} aria-label={x.word} title={x.word}>
              <i style={{ background: x.swatch }} />
            </button>
          ))}
        </div>
      </Row>
      <div className="buybar">
        <div className={'price' + (busy ? ' pending' : '') + (priceHot ? ' hot' : '')}>
          <span className="cur">CHF</span>
          {price != null ? <b>{chf(price)}</b> : <b className="skel" aria-label="The price, once the part is built" />}
          <small>incl. machining, ships in 3 days</small>
        </div>
        <Order />
      </div>
      {error && ready && <div className="err">{error}</div>}
    </aside>
  )
}
