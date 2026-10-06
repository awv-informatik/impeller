// The model, in the page: ClassCAD runs here as WebAssembly (buerli.io), loads impeller.ofb, and every
// change on the page is a change of the model's own parameters. The engine rebuilds the part, and
// the page reads back what it built: the solid as it tessellated it, the vane sketch as it solved
// it, and the volume the price is made of.
//
// Changes are queued: while the engine rebuilds, only the latest wish waits; when it is done it goes
// on with that one. So a slider can be dragged as fast as a hand likes.
//
// The session is buerli's (useBuerliCadFacade, in Session.jsx). Should it ever die (its drawing
// destroyed, its engine gone), the engine opens a session of its own, loads the model into it and
// builds the latest wish there: the page goes on where it was. A wish is never thrown away.
import { BuerliCadFacade } from '@buerli.io/classcad'
import { useShop } from './store'
import { PARAMS } from './design'
import { makeBody } from './three/body'

let session = null // { api, facade, drawingId, part }
let generation = 0 // the session the engine's work belongs to
let loaded = false // the model is in the session
let built = null // the configuration the session's model has (the page shows the one it last read back)
let running = false
let next = null
let final = false // the wish waiting is one a hand has let go of (or a click): the one to show

const set = s => useShop.setState(s)
// (how a dead session answers: it is not connected, its drawing is gone)
const lost = e => /not connected|drawing id not set|connect\(\)|destroyed|reading 'api'|reading 'drawingId'/i.test(String(e?.message ?? e))

// (while developing: a change here reloads the page)
if (import.meta.hot) import.meta.hot.decline()

// the session to work in: the model is loaded into it, and the latest wish built in it. (While the
// engine has a live session with the model in it, it keeps it.)
export function attach(cadApi, cadFacade, drawingId) {
  if (!drawingId || session?.drawingId === drawingId) return
  if (session && (loaded || recovering)) return
  session = { api: cadApi.v1, facade: cadFacade, drawingId, part: null }
  load(session)
}

// a dead session is replaced by one of the engine's own
let recovering = false
async function recover() {
  if (recovering) return
  recovering = true
  loaded = false
  set({ busy: true })
  console.warn('ClassCAD session lost: opening a new one')
  try {
    const facade = new BuerliCadFacade()
    await facade.connect('impeller-' + Date.now().toString(36))
    session = { api: facade.api.v1, facade, drawingId: facade.drawingId, part: null }
    await load(session)
  } catch (e) {
    console.error(e)
    set({ busy: false, error: `ClassCAD lost its session: ${e?.message ?? e}` })
  } finally {
    recovering = false
  }
}

async function load(s) {
  const gen = ++generation
  loaded = false
  const first = !useShop.getState().solved
  try {
    set(first ? { status: 'loading', note: 'Starting ClassCAD' } : { busy: true })
    const res = await fetch('/impeller.ofb')
    if (!res.ok) throw new Error(`impeller.ofb could not be fetched (${res.status})`)
    const data = await res.arrayBuffer()
    if (first) set({ note: 'Loading impeller.ofb' })
    const got = await s.api.common.load({ data, format: 'OFB', doClear: true })
    if (gen !== generation) return
    s.part = got?.id ?? got
    // the model's own parameters, as the file has them
    const solved = {}
    for (const name of PARAMS) solved[name] = (await s.api.part.getExpression({ id: s.part, name })).value
    built = solved
    if (first) {
      // the controls start where the model is
      set({ note: 'Building the part' })
      const r = await read(s, true)
      if (gen !== generation) return
      r.sketch = stamp(r.sketch, solved)
      loaded = true
      set({ status: 'ready', want: solved, solved, ...r, error: null })
      if (next) run()
    } else {
      // the page goes on showing what it showed; the latest wish is built in the new session
      loaded = true
      next = next ?? useShop.getState().want
      run()
    }
  } catch (e) {
    if (gen !== generation) return
    console.error(e)
    if (lost(e) && !recovering) return recover()
    set(first ? { status: 'error', error: e?.message ?? String(e) } : { busy: false, error: `ClassCAD lost its session: ${e?.message ?? e}` })
  }
}

// a wish: the controls' configuration. The engine catches up with the latest one. A click goes at
// once (`now`); a drag waits a moment (QUICK ms from its first move, however many follow) so that a
// slider swept across its track is a handful of rebuilds, not a hundred.
const QUICK = 70
let timer = null
export function request(want, { now = false } = {}) {
  next = want
  final = now
  if (!loaded || running) return
  if (now) {
    clearTimeout(timer)
    timer = null
    run()
  } else if (!timer) {
    timer = setTimeout(() => {
      timer = null
      if (loaded && !running && next) run()
    }, QUICK)
  }
}
const pause = ms => new Promise(r => setTimeout(r, ms))

// a hand lets go: where it let go is final. A rebuild the engine is still busy with is out of date
// by then, and is not shown; the final one is built at once, so the part changes once, to it
export function release() {
  if (!next) return
  final = true
  if (!loaded || running) return
  clearTimeout(timer)
  timer = null
  run()
}

async function run() {
  if (running || !loaded) return
  running = true
  const s = session, gen = generation
  set({ busy: true })
  while (next && gen === generation) {
    const want = next
    next = null
    const toUpdate = PARAMS.filter(k => want[k] !== built[k]).map(k => ({ name: k, value: want[k] }))
    if (!toUpdate.length) continue
    try {
      await s.api.part.updateExpression({ id: s.part, toUpdate })
      built = { ...want }
      // (a hand has let go of a newer one meanwhile: this one is out of date, not read back nor shown)
      if (next && final) continue
      const r = await read(s, useShop.getState().sketchOpen)
      if (gen !== generation) break
      if (next && final) continue
      if (r.sketch) r.sketch = stamp(r.sketch, want)
      set({ solved: { ...want }, ...r, error: null })
    } catch (e) {
      console.error(e)
      if (lost(e)) {
        // the session is gone: the wish waits for a new one
        next = next ?? want
        loaded = false
        running = false
        recover()
        return
      }
      // the engine would not build it. While the hand is still moving, the next wish is tried; once it
      // has let go, the controls go back to what the engine last built
      if (!next) set({ want: { ...useShop.getState().solved }, error: `ClassCAD couldn't build that one: ${e?.message ?? e}` })
    }
    // (while a hand is still moving, a breath between rebuilds, for the latest wish to arrive)
    if (next) await pause(QUICK / 2)
  }
  running = false
  set({ busy: false })
  // (a wish that came in while the last one was being read back)
  if (next && loaded && gen === generation) run()
}

// what the engine built: the current solid (its faces and edges), its volume, the vane sketch
async function read(s, withSketch) {
  const tree = await s.facade.tree({ refresh: true })
  const nodes = Object.values(tree)
  const ids = new Set(nodes.filter(n => n.class === 'CC_Solid' && !n.members?.consumed?.value).flatMap(n => n.geometryIdList ?? []))
  const graphic = await s.facade.graphic()
  const containers = (graphic?.containers ?? []).filter(c => ids.has(c.id))
  if (import.meta.env.DEV) window.containers = containers
  const body = containers.length ? makeBody(containers) : null
  const mass = await s.api.part.calculateMassProperties({ id: s.part })
  const out = { body, volume: mass?.volume ?? null }
  if (withSketch) out.sketch = await readSketch(s, tree)
  return out
}

// the vane sketch as the engine solved it: its two arcs, its two caps, the balance hole
async function readSketch(s, tree) {
  const nodes = Object.values(tree)
  const sk = nodes.find(n => n.name === 'Vane sketch')
  if (!sk) return null
  const geo = await s.api.sketch.getGeometry({ id: sk.id })
  const name = id => tree[id]?.name
  const pos = async id => s.api.sketch.getPositions({ id })
  const xy = p => [p.x, p.y]
  const arcs = {}
  for (const id of geo.arcs ?? []) {
    const p = await pos(id)
    arcs[name(id)] = { start: xy(p.startPos), end: xy(p.endPos), center: xy(p.centerPos) }
  }
  const lines = {}
  for (const id of geo.lines ?? []) {
    const n = name(id)
    if (n !== 'Line7' && n !== 'Line8') continue
    const p = await pos(id)
    lines[n] = { start: xy(p.startPos), end: xy(p.endPos) }
  }
  let hole = null
  for (const id of geo.circles ?? []) {
    const pts = await s.api.sketch.getPoints({ id })
    const p = await pos(pts.centerId)
    hole = xy(p.pos)
  }
  return { outer: arcs.Arc, inner: arcs.Arc0, capA: lines.Line7, capB: lines.Line8, hole }
}
// (a sketch read is marked with the configuration it was solved for)
const stamp = (sketch, solved) => sketch && { ...sketch, for: JSON.stringify(solved) }

// the sketch is read when it is opened
export async function refreshSketch() {
  if (!loaded || running) return
  const s = session, solved = useShop.getState().solved
  try {
    const sketch = stamp(await readSketch(s, await s.facade.tree()), solved)
    if (!running && s === session && useShop.getState().solved === solved) set({ sketch })
  } catch (e) {
    console.error(e)
  }
}
