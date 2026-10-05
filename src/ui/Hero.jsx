// The headline: three lines down the left on a wide screen, a banner across the top on narrower
// ones. While a hand is on the controls, on a wide screen, it steps aside for what is being changed.
import { useShop } from '../store'
import { Giant, useTouched } from './Giant'

export function Hero() {
  const want = useShop(s => s.want)
  const touched = useTouched()
  const specs = [
    [want.diameter, 'Ø'],
    [want.vanes, 'vanes'],
    [want.vaneHeight, 'high'],
    [want.bore, 'bore'],
  ]
  return (
    <section className={'hero' + (touched ? ' quiet' : '')}>
      <Giant k={touched} />
      <div className="copy">
        <div className="kick">Pump impeller · made to order</div>
        <div className="lines">
          {['Set it', 'Bend it', 'Order it'].map(l => (
            <h1 className="h" key={l}>
              {l}
              <em>.</em>
            </h1>
          ))}
        </div>
        <p className="sub">Every number is yours, and so is the curve of its vanes. Machined from your own model, in your mailbox within the week.</p>
        <div className="spec">
          {specs.map(([v, k]) => (
            <div key={k}>
              <b>{Math.round(v)}</b>
              <span>{k}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
