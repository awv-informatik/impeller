# Impeller

**Set it. Bend it. Order it.** A web shop for a parametric part, built on one OFB file.
Live at **<https://impeller.classcad.ai>**.

A pump impeller, made to order. Set its diameter, its vanes and its bore; bend the vanes in their
sketch; pick a finish; order it. Every control on the page is a parameter of the model in
[`public/impeller.ofb`](public/impeller.ofb). ClassCAD runs in the page as WebAssembly and rebuilds
the part from that model at every change; the page draws what it built, and the price follows the
volume ClassCAD measures.

## OFB

OFB is ClassCAD's format for parametric models. It keeps a model's whole feature history: the
sketches with their constraints and dimensions, the features built from them (extrusions, patterns,
booleans), and the named expressions that drive it all. Load it, change an expression, and ClassCAD
replays the history into a new, exact solid.

That is what keeps an app like this one small. The page doesn't know how to build an impeller: the
model does. The page sets the model's parameters and shows what comes back.

## From file to part

The whole round trip, with [buerli.io](https://buerli.io)'s `@buerli.io/classcad`:

```js
import { init, WASMClient, BuerliCadFacade } from '@buerli.io/classcad'

// ClassCAD, in the page
init(drawingId => new WASMClient(drawingId, { token: import.meta.env.VITE_CLASSCAD_TOKEN }))
const facade = new BuerliCadFacade()
await facade.connect('impeller')
const api = facade.api.v1

// the model, with its history
const data = await (await fetch('/impeller.ofb')).arrayBuffer()
const { id: part } = await api.common.load({ data, format: 'OFB', doClear: true })

// a parameter changed: the part is rebuilt from its history
await api.part.updateExpression({ id: part, toUpdate: [{ name: 'diameter', value: 150 }] })

// what was built: its volume, and its faces and edges, ready for three.js
const { volume } = await api.part.calculateMassProperties({ id: part })
const { containers } = await facade.graphic()
```

That is the heart of [`src/engine.js`](src/engine.js). Everything else is an ordinary web page
around it: React for the controls, three.js for the drawing, zustand for the state.

## Dragging a sketch

The vanes' curve has no slider. It is dragged in the model's own vane sketch, by two handles: the
end of the vane, which sweeps it round the rim, and its middle, which bows it. Each handle is held
by one dimension of the sketch, `Sweep` and `Bow`, and a drag works on the sketch alone:

```js
const nodes = Object.values(await facade.tree())
const sketch = nodes.find(n => n.name === 'Vane sketch').id
const sweep = nodes.find(n => n.name === 'Sweep' && /FeatureDimension/.test(n.class)).id

// a handle is taken: the sketch is opened, and the features after it wait
await api.part.openFeature({ id: sketch })
// at every move: ClassCAD solves the sketch again, and nothing else
await api.sketch.updateDimension({ id: sweep, value: (wrap * Math.PI) / 180 })
// let go: the parameter is set to match, the sketch closed, and the part rebuilt once
await api.part.updateExpression({ id: part, toUpdate: [{ name: 'wrap', value: wrap }] })
await api.part.closeFeature({ id: sketch })
```

A move takes a few dozen milliseconds, so the red vane under the hand is the sketch as ClassCAD
solved it, live. buerli keeps its copy of the model's tree up to date with every answer, so reading
the solved points back costs no extra calls.

ClassCAD can also move sketch geometry directly (`sketch.moveGeometry`): it moves the points it is
given and lets the solver settle the rest, which is what a sketcher uses for free dragging. In this
sketch, though, a handle carries the arc's centre, the caps and the walls along with it, and the
settling holds it back: it would lag behind the hand. Setting the handle's own dimension solves the
same sketch and puts the handle exactly where the hand is.

## The model

[`cad/impeller.js`](cad/impeller.js) is the script the model was built with: run it with the
ClassCAD MCP, then save the drawing as OFB. It makes a plate, a vane extruded from a sketch and
patterned round, a hub, balance holes patterned round, and a bore through it all, driven by six
parameters:

| Parameter    | What it is                                                     | Starts at |
| ------------ | -------------------------------------------------------------- | --------: |
| `diameter`   | the plate's diameter (mm)                                      |       120 |
| `vanes`      | how many vanes (and balance holes)                             |         9 |
| `vaneHeight` | the vanes' height above the plate (mm)                         |        32 |
| `bore`       | the bore (mm); the hub is `max(32, bore + 16)` across          |        16 |
| `wrap`       | how far round the vane sweeps from the hub to the rim (°)      |        62 |
| `bow`        | how far the vane bows off its chord, as a share of the chord   |    0.1555 |

The vane is drawn about its middle line, an arc from the hub through its middle to the rim. `Sweep`
is how far round the rim it ends (from `wrap`). `Bow` is the angle between the chord and the line to
the arc's middle (from `atan(2·bow)`, so the vane keeps its curve whatever its length). The walls
run alongside the middle line, between two square caps. The balance holes are placed by the model's
expressions, half a pitch round from where each vane crosses their circle.

The controls only offer parts one would machine: the vane stepper stops at as many vanes as fit,
the diameter slider at the smallest the vanes allow, and the sketch's handles at curves that keep
the balance holes clear of the vanes.

The price is made up for the demo (CHF 24, plus 0.95 per cm³ of part, plus 14 for a coloured
anodizing), and there is no checkout.

## Run it

```bash
npm install
npm run dev
```

Then open <http://localhost:5173>. The first start downloads the engine.

ClassCAD's key is fetched with the public access token in `.env` (`VITE_CLASSCAD_TOKEN`). A `ccpk_`
token is made to sit in a web page: it only yields keys on its account's registered domains, and on
localhost. To publish on a domain of your own, use a token from your own ClassCAD account.

`npm run build` builds the static site into `dist/`, and `npm run format` formats the code
(Prettier). `npm run deploy` builds it and publishes it on Firebase Hosting (project
`awv-informatik`, site `impeller-classcad-ai`).

## How the code is laid out

- `src/engine.js`: the CAD session. The calls above, and what a real page needs around them.
  Changes are queued so that ClassCAD always works on the newest one: a slider swept across its
  track is a handful of rebuilds, and the part changes once more, to where the hand lets go. It also
  runs the sketch drag, and opens a new session should the old one ever die.
- `src/main.jsx`, `src/Session.jsx`: ClassCAD started in the page (buerli's React hook,
  `useBuerliCadFacade`), and its session handed to the engine.
- `src/store.js`: the page's state (zustand): how far the engine is, what the controls want, what
  was last built, and the cart.
- `src/design.js`: the model's design math, repeated for what the page must know before ClassCAD
  answers: where the sketch's handles are while they move, which configurations the controls allow,
  and the price.
- `src/three/`: the part, drawn from ClassCAD's tessellation in a flat CAD look. `body.js` turns it
  into faces, edges and silhouettes; `Part.jsx` draws them; `View.jsx` is the turning view.
- `src/ui/`: the page. `Card` is the configurator, `Stage` holds the part (or its sketch), `Sketch`
  is the vane sketch (`placeReadout.js` keeps its readout clear of the handles), and `Hero`,
  `Giant`, `Cart` and `Nav` are the rest. The layout fits any screen, from a phone held upright to
  a wide monitor.
- `cad/impeller.js`: the script the model was built with.
