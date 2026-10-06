// impeller.parts: the shop from the film "Part to parcel.", for real. The page is the film's (the nav,
// the headline, the part, the configurator, the footer); the part is the real model, rebuilt by
// ClassCAD in the page at every change.
import { useEffect } from 'react'
import { Session } from './Session'
import { useShop } from './store'
import { Nav } from './ui/Nav'
import { Hero } from './ui/Hero'
import { Card } from './ui/Card'
import { Stage } from './ui/Stage'
import { Cart } from './ui/Cart'
import { GitHub, REPO } from './ui/GitHub'

export function App() {
  const cartOpen = useShop(s => s.cartOpen)
  // (no scrolling the page behind the open cart)
  useEffect(() => {
    document.body.style.overflow = cartOpen ? 'hidden' : ''
  }, [cartOpen])
  return (
    <div className="page">
      <Session />
      <Nav />
      <main className="main">
        <Hero />
        <div className="config">
          <Stage />
          <Card />
        </div>
      </main>
      <footer className="foot">
        <span className="ofb">
          <i className="cube" />
          impeller.ofb · 6 parameters · 1 sketch curve
        </span>
        <span className="made">
          Rebuilt live by{' '}
          <a href="https://classcad.ch" target="_blank" rel="noreferrer">
            ClassCAD
          </a>
          , in your browser
        </span>
        <a className="gh" href={REPO} target="_blank" rel="noreferrer">
          <GitHub />
          Source on GitHub
        </a>
      </footer>
      <Cart />
    </div>
  )
}
