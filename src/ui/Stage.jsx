// The part's room: the part (or its sketch), and, on narrower screens, behind it, what is being
// changed. On phones and tablets it stays at the top of the screen while the controls scroll under it.
import { useShop } from '../store'
import { Giant, useTouched } from './Giant'
import { View } from '../three/View'
import { Sketch } from './Sketch'

function Status() {
  const status = useShop(s => s.status)
  const note = useShop(s => s.note)
  const error = useShop(s => s.error)
  if (status === 'ready') return null
  if (status === 'error')
    return (
      <div className="status err">
        <b>ClassCAD couldn't start</b>
        <span>{error}</span>
        <small>The engine's key is only issued on impeller.classcad.ch and on localhost.</small>
      </div>
    )
  return (
    <div className="status">
      <i className="spin" />
      <b>{note}…</b>
      <small>ClassCAD runs in your browser. The first start downloads the engine.</small>
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
      <div className="room">{sketchOpen ? <Sketch /> : <View />}</div>
      <Status />
      {ready && !sketchOpen && <div className="hint">Drag to turn it</div>}
    </section>
  )
}
