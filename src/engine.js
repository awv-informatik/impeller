// The model, in the page: ClassCAD runs here as WebAssembly (buerli.io), loads impeller.ofb, and every
// change on the page is a change of the model's own parameters. The engine rebuilds the part, and the
// page reads back what it built: the solid as it tessellated it, the vane sketch as it solved it, and
// the volume the price is made of.
//
// Changes are queued: while the engine rebuilds, only the latest wish waits; when it is done it goes
// on with that one. So a slider can be dragged as fast as a hand likes.
//
// The vane's curve is its sketch's own. Each of the sketch's two handles is held by one dimension,
// Sweep and Bow (see cad/impeller.js), and a handle is dragged in the sketch alone: the sketch is
// opened, so the features after it wait, and the handle's dimension takes the value the hand gives
// it. The solver re-solves the sketch and nothing else, and the vane follows the hand. When the hand
// lets go, the sketch stays open a moment, for a hand that grips again; then the model's `wrap` and
// `bow` are set to match (the balance holes follow them) and the sketch is closed: the part is rebuilt
// once. (From then on the dimension keeps its own number: the curve is the sketch's.) A hand that
// takes a handle while the engine is busy is never turned away: its moves wait, the latest one only,
// and the sketch catches up with it as soon as the engine is free.
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
let recovering = false // a new session is being opened
let built = null // the configuration the session's model has (the page shows the one it last read back)
let running = false // the engine is at work: a rebuild, or a sketch being closed
let next = null // the latest wish, waiting
let final = false // that wish is one a hand has let go of (or a click): the one to show
let held = null // the vane sketch, open for a hand (or let go of a moment ago)

const set = s => useShop.setState(s)
const pause = ms => new Promise(r => setTimeout(r, ms))

// (how a dead session answers: it is not connected, its drawing is gone)
const DEAD = /not connected|drawing id not set|connect\(\)|destroyed|reading 'api'|reading 'drawingId'/i
const lost = e => DEAD.test(String(e?.message ?? e))

// (while developing: a change here reloads the page)
if (import.meta.hot) import.meta.hot.decline()

// The session to work in: the model is loaded into it, and the latest wish built in it. (While the
// engine has a live session with the model in it, it keeps it.)
export function attach(cadApi, cadFacade, drawingId) {
  if (!drawingId || session?.drawingId === drawingId) return
  if (session && (loaded || recovering)) return
  session = { api: cadApi.v1, facade: cadFacade, drawingId, part: null }
  load(session)
}

// A dead session is replaced by one of the engine's own.
async function recover() {
  if (recovering) return
  recovering = true
  loaded = false
  clearTimeout(held?.letGo)
  held = null
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
    const { id } = await s.api.common.load({ data, format: 'OFB', doClear: true })
    if (gen !== generation) return
    s.part = id
    // the model's own parameters, as the file has them
    const solved = {}
    for (const name of PARAMS) solved[name] = (await s.api.part.getExpression({ id: s.part, name })).value
    built = solved
    if (first) {
      // the controls start where the model is
      set({ note: 'Building the part' })
      const r = await read(s, solved)
      if (gen !== generation) return
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
    if (first) set({ status: 'error', error: e?.message ?? String(e) })
    else set({ busy: false, error: `ClassCAD lost its session: ${e?.message ?? e}` })
  }
}

// A wish: the controls' configuration. The engine catches up with the latest one. A click goes at
// once (`now`); a drag waits a moment (QUICK ms from its first move, however many follow) so that a
// slider swept across its track is a handful of rebuilds, not a hundred.
const QUICK = 70
let timer = null
export function request(want, { now = false } = {}) {
  next = want
  final = now
  hurry()
  if (!loaded || running || held) return
  if (now) {
    clearTimeout(timer)
    timer = null
    run()
  } else if (!timer) {
    timer = setTimeout(() => {
      timer = null
      if (loaded && !running && !held && next) run()
    }, QUICK)
  }
}

// A hand lets go of a slider: where it let go is final. A rebuild the engine is still busy with is out
// of date by then, and is not shown; the final one is built at once, so the part changes once, to it.
export function release() {
  if (!next) return
  final = true
  hurry()
  if (!loaded || running || held) return
  clearTimeout(timer)
  timer = null
  run()
}

async function run() {
  if (running || !loaded || held) return
  running = true
  const s = session
  const gen = generation
  set({ busy: true })
  while (next && gen === generation) {
    const want = next
    next = null
    try {
      if (!(await rebuild(s, want))) continue
      // (a hand has let go of a newer one meanwhile: this one is out of date, not read back nor shown)
      if (next && final) continue
      const r = await read(s, want)
      if (gen !== generation) break
      if (next && final) continue
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
      // The engine would not build it. While the hand is still moving, the next wish is tried; once it
      // has let go, the controls go back to what the engine last built.
      if (!next) {
        set({ want: { ...useShop.getState().solved }, error: `ClassCAD couldn't build that one: ${e?.message ?? e}` })
      }
    }
    // (while a hand is still moving, a breath between rebuilds, for the latest wish to arrive)
    if (next) await pause(QUICK / 2)
  }
  running = false
  set({ busy: false })
  // (a wish that came in while the last one was being read back)
  if (next && loaded && !held && gen === generation) run()
}

// The model brought to a wish: its parameters set, the part rebuilt once. A new curve (only a new
// session has one to catch up with) is first brought there in the sketch, as a hand would drag it.
async function rebuild(s, want) {
  const toUpdate = PARAMS.filter(k => want[k] !== built[k]).map(k => ({ name: k, value: want[k] }))
  if (!toUpdate.length) return false
  if (want.wrap !== built.wrap || want.bow !== built.bow) {
    const sketch = await vaneSketch(s)
    await s.api.part.openFeature({ id: sketch.id })
    try {
      await walk(s, sketch, built, want)
      await s.api.part.updateExpression({ id: s.part, toUpdate })
    } finally {
      await s.api.part.closeFeature({ id: sketch.id })
    }
  } else {
    await s.api.part.updateExpression({ id: s.part, toUpdate })
  }
  built = { ...want }
  return true
}

// ---- the vane sketch's curve

// The curve's two dimensions in the vane sketch, and what each holds in the sketch's own terms
// (radians: the angle of O→B, and the angle the arc's middle is seen at from its end).
const CURVE = {
  wrap: { dim: 'Sweep', value: wrap => (wrap * Math.PI) / 180 },
  bow: { dim: 'Bow', value: bow => Math.atan(2 * bow) },
}

// the vane sketch, and the ids of its curve's dimensions
async function vaneSketch(s) {
  const nodes = Object.values(await s.facade.tree())
  const id = nodes.find(n => n.name === 'Vane sketch').id
  const dim = name => nodes.find(n => n.name === name && /FeatureDimension/.test(n.class)).id
  return { id, wrap: dim(CURVE.wrap.dim), bow: dim(CURVE.bow.dim) }
}

// The curve set in the open sketch: its dimensions to the given values (the sketch alone is solved).
async function bend(s, sketch, curve) {
  for (const [k, v] of Object.entries(curve)) {
    await s.api.sketch.updateDimension({ id: sketch[k], value: CURVE[k].value(v) })
  }
}

// The curve brought from one wish to another in small steps, as a hand would have dragged it, so that
// the solver keeps to the shape the vane has (a long jump could leave a cap turned the wrong way).
async function walk(s, sketch, from, to) {
  const n = Math.max(1, Math.ceil(Math.abs(to.wrap - from.wrap) / 4), Math.ceil(Math.abs(to.bow - from.bow) / 0.03))
  for (let i = 1; i <= n; i++) {
    const at = (a, b) => a + ((b - a) * i) / n
    await bend(s, sketch, { wrap: at(from.wrap, to.wrap), bow: at(from.bow, to.bow) })
  }
}

// A hand takes a handle: the sketch is opened, once the engine is free. (If it was let go of only a
// moment ago, it is still open: the hand goes on in it.)
export function grabSketch() {
  if (!loaded) return
  clearTimeout(timer)
  timer = null
  if (held) {
    clearTimeout(held.letGo)
    held.hand = true
    return
  }
  const h = (held = { s: session, hand: true, latest: null, moved: {}, solving: null })
  h.ready = (async () => {
    while (running) await pause(15)
    h.sketch = await vaneSketch(h.s)
    await h.s.api.part.openFeature({ id: h.sketch.id })
    await showHeld(h)
  })().catch(e => void (h.failed = e)) // (for the closing to deal with)
}

// (the sketch under the hand, as the engine solved it, for the page to draw: the hand is followed)
const showHeld = async h => set({ sketch: { ...readSketch(await h.s.facade.tree()), for: 'held' } })

// The hand moves: the curve follows it, in the sketch alone. (While one move is solved, or the sketch
// waits to be opened, only the latest move waits.)
export function dragSketch(curve) {
  const h = held
  if (!h?.hand) return
  h.latest = { ...h.latest, ...curve }
  h.solving ??= solve(h)
}
async function solve(h) {
  try {
    await h.ready
    while (h.latest && !h.failed) {
      const curve = h.latest
      h.latest = null
      await bend(h.s, h.sketch, curve)
      Object.assign(h.moved, curve)
      await showHeld(h)
    }
  } catch (e) {
    h.failed = e
  } finally {
    h.solving = null
  }
}

// The hand lets go. The sketch stays open for a moment, LINGER ms, for a hand that grips again (as one
// does on a trackpad, to drag on); then it is closed.
const LINGER = 400
export function dropSketch() {
  const h = held
  if (!h?.hand) {
    // (the sketch was never opened, the engine not ready: the wish goes the ordinary way)
    request(useShop.getState().want, { now: true })
    return
  }
  h.hand = false
  set({ busy: true })
  h.letGo = setTimeout(() => close(h), LINGER)
}

// (anything else asked of the engine closes a sketch that was let go of, at once)
function hurry() {
  if (held && !held.hand) {
    clearTimeout(held.letGo)
    close(held)
  }
}

// The sketch let go of is closed: the model's wrap and bow are set to where the handles are, and the
// part is rebuilt once.
async function close(h) {
  if (held !== h) return
  held = null
  running = true
  try {
    await h.ready
    while (h.solving) await h.solving
    if (h.failed) throw h.failed
    let refused = null
    try {
      const toUpdate = Object.entries(h.moved).map(([name, value]) => ({ name, value }))
      if (toUpdate.length) await h.s.api.part.updateExpression({ id: h.s.part, toUpdate })
      built = { ...built, ...h.moved }
    } catch (e) {
      // (the engine would not build it: the curve goes back to where it was)
      if (lost(e)) throw e
      refused = e
      await bend(h.s, h.sketch, { wrap: built.wrap, bow: built.bow })
    }
    await h.s.api.part.closeFeature({ id: h.sketch.id })
    const r = await read(h.s, built)
    set({
      solved: { ...built },
      ...r,
      error: refused && `ClassCAD couldn't build that one: ${refused.message ?? refused}`,
      ...(refused && { want: { ...built } }),
    })
  } catch (e) {
    console.error(e)
    next = useShop.getState().want
    if (lost(e)) return recover()
    // (the sketch closed, in whatever state it is: the wish is then built the ordinary way)
    if (h.sketch) await h.s.api.part.closeFeature({ id: h.sketch.id }).catch(() => {})
    set({ error: `ClassCAD couldn't build that one: ${e?.message ?? e}` })
  } finally {
    running = false
    if (!recovering) {
      set({ busy: false })
      // what was asked meanwhile, as it stands now (unless a hand has the sketch again: it waits for that)
      if (next) next = useShop.getState().want
      if (next && loaded && !held) run()
    }
  }
}

// ---- reading back

// What the engine built: the current solid (its faces and edges), its volume, the vane sketch (marked
// with the configuration it was solved for).
async function read(s, config) {
  const tree = await s.facade.tree({ refresh: true })
  const solids = Object.values(tree).filter(n => n.class === 'CC_Solid' && !n.members?.consumed?.value)
  const ids = new Set(solids.flatMap(n => n.geometryIdList ?? []))
  const graphic = await s.facade.graphic()
  const containers = (graphic?.containers ?? []).filter(c => ids.has(c.id))
  const body = containers.length ? makeBody(containers) : null
  const mass = await s.api.part.calculateMassProperties({ id: s.part })
  const sketch = readSketch(tree)
  return { body, volume: mass?.volume ?? null, sketch: sketch && { ...sketch, for: JSON.stringify(config) } }
}

// The vane sketch as the engine solved it: its two walls, its two caps, the balance hole. It is read
// from buerli's copy of the model's tree, which every answer of the engine keeps up to date: no calls.
// (The elements are found by the names they were given in cad/impeller.js.)
function readSketch(tree) {
  const nodes = Object.values(tree)
  const sketch = nodes.find(n => n.name === 'Vane sketch')
  if (!sketch) return null
  const kid = name => nodes.find(n => n.parent === sketch.id && n.name === name)
  const at = (geo, point) => {
    const p = tree[geo?.children?.find(c => tree[c]?.name === point)]?.members?.pos?.value
    return p && [p.x, p.y]
  }
  const arc = g => ({ start: at(g, 'startPoint'), end: at(g, 'endPoint'), center: at(g, 'center') })
  const line = g => ({ start: at(g, 'startPoint'), end: at(g, 'endPoint') })
  return {
    outer: arc(kid('Outer')),
    inner: arc(kid('Inner')),
    capA: line(kid('Cap A')),
    capB: line(kid('Cap B')),
    hole: at(kid('Hole'), 'center'),
  }
}
