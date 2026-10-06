# impeller.parts

**Set it. Bend it. Order it.** The shop from the film *Part to parcel.*, for real: a pump impeller
made to order, configured live on its own parametric model.

The page loads the model, [`public/impeller.ofb`](public/impeller.ofb), into ClassCAD running in the
browser as WebAssembly ([buerli.io](https://buerli.io): `@buerli.io/classcad` and
`@buerli.io/react`). Every control on the page is one of the model's parameters. Change one and the
engine rebuilds the part; the page draws what it built, in the film's CAD look (lamp shading, inked
edges and silhouettes); and the price follows the volume the engine measures.

- **Diameter, vane height:** sliders.
- **Vanes:** a stepper (the balance holes follow: one between each two vanes).
- **Bore:** chips. The hub grows with it.
- **Vane curve:** *Edit the sketch* opens the vane sketch, seen down the part's axis. Drag the end
  handle round the rim to sweep the vanes, and the middle handle to bow them. The red vanes are the
  sketch as the engine solved it.
- **Finish:** raw, black, red or blue anodized.
- **Order** puts the part, exactly as configured and built, in the cart. The cart keeps it (in the
  browser), and **Buy** shakes its head: checkout isn't open.

The controls only allow parts one would machine: the vane stepper stops at as many vanes as the
diameter and curve leave room for, the diameter slider at the smallest the vanes allow, and the
sketch's handles at curves that keep the balance holes clear of the vanes.

## On any screen

The page arranges itself for the screen it is on:

- **Wide screens:** the film's layout. The headline runs down the left, the part stands in the
  middle, and the configurator is on the right. While a control is being changed, the headline
  steps aside for what is changing, as large as the page.
- **Laptops and tablets on their side:** the headline becomes a banner across the top, and the
  part and the configurator sit side by side under it.
- **Tablets upright and phones:** the part stays at the top of the screen while the controls
  scroll under it, and the price and the order stay docked at the foot.
- **Short screens:** the configurator gets tighter, and the price moves beside the order button.

In every arrangement the camera keeps the part framed for the shape of its room.

## Run it

```bash
npm install
npm run dev
```

Then open <http://localhost:5173>. The first start downloads the engine.

`npm run build` makes the static site in `dist/`. The engine's key is fetched with the ClassCAD
public access token in `.env` (`VITE_CLASSCAD_TOKEN`). A `ccpk_` token is made to sit in a web
page: it only yields keys on the account's registered domains (impeller.classcad.ai) and on
localhost.

It is published at <https://impeller.classcad.ai>, on Firebase Hosting (project `awv-informatik`,
site `impeller-classcad-ai`): `npm run deploy` builds it and puts it there.

## The model

`impeller.ofb` was built with the ClassCAD MCP, from [`cad/impeller.js`](cad/impeller.js). It has
a plate, a vane extruded from a sketch and patterned round, a hub, balance holes patterned round,
and the bore through all, driven by six parameters:

| Parameter    | What it is                                                     | Starts at |
| ------------ | -------------------------------------------------------------- | --------: |
| `diameter`   | the plate's diameter (mm)                                      |       120 |
| `vanes`      | how many vanes (and balance holes)                             |         9 |
| `vaneHeight` | the vanes' height above the plate (mm)                         |        32 |
| `bore`       | the bore (mm); the hub is `max(32, bore + 16)` across          |        16 |
| `wrap`       | how far round the vane sweeps from the hub to the rim (°)      |        62 |
| `bow`        | how far the vane bows off its chord, as a share of the chord   |    0.1555 |

The vane is drawn about its middle line: an arc from the hub to the rim, `wrap` round, bowed by
`bow`. The model's own expressions compute the arc's centre and the angles its ends are seen at
from there. In the sketch, every point of the vane is placed from that centre by a length and an
angle, using OFFSET and ANGLEOX dimensions bound to those expressions. That leaves the solver no
second solution to fall into, however far a parameter jumps.

It starts as the first film's part: Ø120, nine vanes 32 high, a 16 bore, 129 933.9 mm³. The film's
other engine states served as the test: regenerated from their parameters, in any order and with
any jump between them, this model gives each one exactly the volume the film measured.

The price is the film's: CHF 24 + 0.95 per cm³ of the part + 14 for a coloured anodizing.

## How it is built

- `src/engine.js`: the CAD session. It loads the OFB and reads back what the engine built: the
  current solid's faces and edges, the volume, and the vane sketch's solved geometry. It also
  paces the changes. A click goes to the engine at once. A drag goes 70 ms after it starts, and
  after that as fast as the engine rebuilds, always with the latest value: a slider swept across
  its whole track is a handful of rebuilds, not a hundred.
- `src/three/`: the part in the film's look (`body.js` builds the geometry, edges and silhouette
  candidates from the engine's graphic; `Part.jsx` draws them; `View.jsx` is the turning view).
- `src/ui/`: the page: `Hero` (with the giant readout of what is being changed), `Card` (the
  configurator), `Stage` (the part, or its sketch), `Sketch`, `Cart`, `Nav`.
- `src/design.js`: the same design math as the model's expressions. The page uses it for what it
  must know before the engine answers: where the sketch's handles are while they are dragged,
  which configurations the controls allow, and the price.
