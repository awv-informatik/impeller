// What a hand is changing, as large as the page, for a moment: the film's flourish. On a wide screen
// it stands where the headline was (the headline steps aside); on narrower ones it stands behind the
// part, in its room.
import { useEffect, useState } from 'react'
import { useShop } from '../store'
import { finishOf } from '../design'

export function useTouched(ms = 1500) {
  const touch = useShop(s => s.touch)
  const sketchOpen = useShop(s => s.sketchOpen)
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (!touch) return
    setOn(true)
    const t = setTimeout(() => setOn(false), ms)
    return () => clearTimeout(t)
  }, [touch, ms])
  return on && !sketchOpen ? touch.key : null
}

export function Giant({ k }) {
  const want = useShop(s => s.want)
  const finish = useShop(s => s.finish)
  const [last, setLast] = useState(null)
  useEffect(() => {
    if (k) setLast(k)
  }, [k])
  const say = {
    diameter: ['Diameter', <><s>Ø</s>{want.diameter}</>],
    vanes: ['Vanes', <><s>×</s>{want.vanes}</>],
    vaneHeight: ['Vane height', <>{want.vaneHeight}<s>mm</s></>],
    bore: ['Bore', <><s>Ø</s>{want.bore}</>],
    finish: ['Finish', <s className="r">{finishOf(finish).label}</s>],
  }[k ?? last]
  if (!say) return null
  return (
    <div className={'giant' + (k ? ' on' : '')} aria-hidden>
      <div className="gl">{say[0]}</div>
      <div className="gn">{say[1]}</div>
    </div>
  )
}
