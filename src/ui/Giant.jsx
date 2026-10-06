// What a hand is changing, as large as the page, for a moment. On a wide screen it stands where the
// headline was (the headline steps aside); on narrower ones it stands behind the part, in its room.
import { useEffect, useState } from 'react'
import { useShop } from '../store'
import { finishOf } from '../design'

export function Giant({ k }) {
  const want = useShop(s => s.want)
  const finish = useShop(s => s.finish)
  const [last, setLast] = useState(null)
  useEffect(() => {
    if (k) setLast(k)
  }, [k])
  // [what it is, the sign before the number, the number, what it is counted in]
  const say = {
    diameter: ['Diameter', 'Ø', want.diameter, 'mm'],
    vanes: ['Vanes', '×', want.vanes, want.vanes === 1 ? 'vane' : 'vanes'],
    vaneHeight: ['Vane height', null, want.vaneHeight, 'mm'],
    bore: ['Bore', 'Ø', want.bore, 'mm'],
    finish: ['Finish', null, finishOf(finish).label, 'anodized'],
  }[k ?? last]
  if (!say) return null
  const [label, sign, value, unit] = say
  return (
    <div className={'giant' + (k ? ' on' : '') + (typeof value === 'string' ? ' word' : '')} aria-hidden>
      <div className="gl">
        <i />
        {label}
      </div>
      <div className="gn">
        {sign && <s>{sign}</s>}
        <span>{value}</span>
        <u>{unit}</u>
      </div>
    </div>
  )
}
