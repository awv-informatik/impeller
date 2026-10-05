// The model, in the page: ClassCAD runs here as WebAssembly (buerli.io), loads impeller.ofb, and every
// change on the page is a change of the model's own parameters. The engine rebuilds the part, and
// the page reads back what it built: the solid as it tessellated it, the vane sketch as it solved
// it, and the volume the price is made of.
//
// Changes are queued: while the engine rebuilds, only the latest wish waits; when it is done it goes
// on with that one. So a slider can be dragged as fast as a hand likes.
import { useShop } from './store'
import { PARAMS } from './design'
import { makeBody } from './three/body'

let api = null
let facade = null
let part = null
let started = false
let running = false
let next = null

const set = s => useShop.setState(s)

// (while developing: a change here reloads the page; the engine's session cannot be taken over)
if (import.meta.hot) import.meta.hot.decline()

export async function boot(cadApi, cadFacade) {
  if (started) return
  started = true
  api = cadApi.v1
  facade = cadFacade
  try {
    set({ status: 'loading', note: 'Starting ClassCAD' })
    const res = await fetch('/impeller.ofb')
    if (!res.ok) throw new Error(`impeller.ofb could not be fetched (${res.status})`)
    const data = await res.arrayBuffer()
    set({ note: 'Loading impeller.ofb' })
    const loaded = await api.common.load({ data, format: 'OFB', doClear: true })
    part = loaded?.id ?? loaded
    // the model's own parameters are where the controls start
    const solved = {}
    for (const name of PARAMS) solved[name] = (await api.part.getExpression({ id: part, name })).value
    set({ note: 'Building the part' })
    const r = await read(true)
    r.sketch = stamp(r.sketch, solved)
    set({ status: 'ready', want: solved, solved, ...r })
    // (a wish made while it loaded)
    if (next) run()
  } catch (e) {
    console.error(e)
    set({ status: 'error', error: e?.message ?? String(e) })
  }
}

// a wish: the controls' configuration. The engine catches up with the latest one. A click goes at
// once (`now`); a drag waits a moment (QUICK ms from its first move, however many follow) so that a
// slider swept across its track is a handful of rebuilds, not a hundred.
const QUICK = 70
let timer = null
export function request(want, { now = false } = {}) {
  next = want
  if (useShop.getState().status !== 'ready' || running) return
  if (now) {
    clearTimeout(timer)
    timer = null
    run()
  } else if (!timer) {
    timer = setTimeout(() => {
      timer = null
      if (!running && next) run()
    }, QUICK)
  }
}
const pause = ms => new Promise(r => setTimeout(r, ms))

async function run() {
  running = true
  set({ busy: true })
  while (next) {
    const want = next
    next = null
    const solved = useShop.getState().solved
    const toUpdate = PARAMS.filter(k => want[k] !== solved[k]).map(k => ({ name: k, value: want[k] }))
    if (!toUpdate.length) continue
    try {
      await api.part.updateExpression({ id: part, toUpdate })
      const r = await read(useShop.getState().sketchOpen)
      if (r.sketch) r.sketch = stamp(r.sketch, want)
      set({ solved: { ...want }, ...r, error: null })
    } catch (e) {
      // the engine would not build it: the controls go back to what it last built
      console.error(e)
      set({ want: { ...solved }, error: `ClassCAD couldn't build that one: ${e?.message ?? e}` })
    }
    // (while a hand is still moving, a breath between rebuilds, for the latest wish to arrive)
    if (next) await pause(QUICK / 2)
  }
  running = false
  set({ busy: false })
}

// what the engine built: the current solid (its faces and edges), its volume, the vane sketch
async function read(withSketch) {
  const tree = await facade.tree({ refresh: true })
  const nodes = Object.values(tree)
  const ids = new Set(nodes.filter(n => n.class === 'CC_Solid' && !n.members?.consumed?.value).flatMap(n => n.geometryIdList ?? []))
  const graphic = await facade.graphic()
  const containers = (graphic?.containers ?? []).filter(c => ids.has(c.id))
  if (import.meta.env.DEV) window.containers = containers
  const body = containers.length ? makeBody(containers) : null
  const mass = await api.part.calculateMassProperties({ id: part })
  const out = { body, volume: mass?.volume ?? null }
  if (withSketch) out.sketch = await readSketch(tree)
  return out
}

// the vane sketch as the engine solved it: its two arcs, its two caps, the balance hole
async function readSketch(tree) {
  const nodes = Object.values(tree ?? (await facade.tree({ refresh: true })))
  const sk = nodes.find(n => n.name === 'Vane sketch')
  if (!sk) return null
  const geo = await api.sketch.getGeometry({ id: sk.id })
  const name = id => tree[id]?.name
  const pos = async id => api.sketch.getPositions({ id })
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
    const pts = await api.sketch.getPoints({ id })
    const p = await pos(pts.centerId)
    hole = xy(p.pos)
  }
  return { outer: arcs.Arc, inner: arcs.Arc0, capA: lines.Line7, capB: lines.Line8, hole }
}
// (a sketch read is marked with the configuration it was solved for)
const stamp = (sketch, solved) => sketch && { ...sketch, for: JSON.stringify(solved) }

// the sketch is read when it is opened
export async function refreshSketch() {
  if (!api || useShop.getState().status !== 'ready' || running) return
  const solved = useShop.getState().solved
  const sketch = stamp(await readSketch(await facade.tree()), solved)
  if (!running && useShop.getState().solved === solved) set({ sketch })
}
