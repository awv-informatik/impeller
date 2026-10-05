// The cart: what was ordered, each part as configured, and the way to buy them (not open yet: the
// button only shakes its head).
import { useState } from 'react'
import { useShop } from '../store'
import { chf, design, finishOf, middle } from '../design'

// a part, small, seen from above, in its finish
function Thumb({ config, finish }) {
  const d = design(config)
  const R = config.diameter / 2
  const m = 'M' + middle(d, 24).map(p => p.map(v => v.toFixed(1)).join(' ')).join('L')
  const color = finishOf(finish).color
  return (
    <svg viewBox={`${-R - 4} ${-R - 4} ${2 * R + 8} ${2 * R + 8}`} className="thumb">
      <g transform="scale(1,-1)">
        <circle r={R} fill={color} stroke="#0f1320" strokeWidth={R / 40} />
        {Array.from({ length: config.vanes }, (_, k) => (
          <path key={k} d={m} transform={`rotate(${(k * 360) / config.vanes})`} fill="none" stroke="#0f1320" strokeWidth={R / 14} strokeLinecap="round" opacity="0.85" />
        ))}
        <circle r={d.hub / 2} fill={color} stroke="#0f1320" strokeWidth={R / 40} />
        <circle r={config.bore / 2} fill="#fff" stroke="#0f1320" strokeWidth={R / 40} />
      </g>
    </svg>
  )
}

function Buy({ disabled }) {
  const [shake, setShake] = useState(0)
  return (
    <button key={shake} className={'buy' + (shake ? ' shake' : '')} disabled={disabled} onClick={() => setShake(n => n + 1)}>
      <span>Buy</span>
      <i>→</i>
    </button>
  )
}

export function Cart() {
  const open = useShop(s => s.cartOpen)
  const cart = useShop(s => s.cart)
  const setQty = useShop(s => s.setQty)
  const close = () => useShop.getState().openCart(false)
  const count = cart.reduce((a, i) => a + i.qty, 0)
  const total = cart.reduce((a, i) => a + i.qty * i.price, 0)
  return (
    <div className={'cart-layer' + (open ? ' open' : '')} aria-hidden={!open}>
      <div className="scrim" onClick={close} />
      <aside className="drawer" role="dialog" aria-label="Cart">
        <header>
          <b>Cart</b>
          <small>
            {count} {count === 1 ? 'part' : 'parts'}
          </small>
          <button className="x" onClick={close} aria-label="Close the cart">
            ×
          </button>
        </header>
        {cart.length === 0 ? (
          <div className="empty">
            <b>Nothing in it yet.</b>
            <span>Set one, bend one, order one.</span>
          </div>
        ) : (
          <ul className="items">
            {cart.map(i => (
              <li key={i.key}>
                <Thumb config={i.config} finish={i.finish} />
                <div className="what">
                  <b>Pump impeller</b>
                  <span>
                    Ø{i.config.diameter} · {i.config.vanes} vanes · {i.config.vaneHeight} high
                  </span>
                  <span>
                    bore {i.config.bore} · swept {Math.round(i.config.wrap)}° · {finishOf(i.finish).label.toLowerCase()} anodized
                  </span>
                  <div className="qty">
                    <button onClick={() => setQty(i.key, i.qty - 1)} aria-label="One less">
                      −
                    </button>
                    <span>{i.qty}</span>
                    <button onClick={() => setQty(i.key, i.qty + 1)} aria-label="One more">
                      +
                    </button>
                  </div>
                </div>
                <div className="sum">
                  <b>{chf(i.qty * i.price)}</b>
                  <button className="rm" onClick={() => setQty(i.key, 0)}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <footer>
          <div className="line">
            <span>Shipping</span>
            <span>free</span>
          </div>
          <div className="line total">
            <span>Total</span>
            <span>
              <small>CHF</small> <b>{chf(total)}</b>
            </span>
          </div>
          <Buy disabled={!cart.length} />
          <small className="note">Each part is machined from your own configuration of impeller.ofb.</small>
        </footer>
      </aside>
    </div>
  )
}
