// The impeller, as a parametric ClassCAD model: the script public/impeller.ofb was built with.
//
// It runs as the body of an async function with `api` (ClassCAD's v1 API), as the ClassCAD MCP's
// run_script tool runs scripts: run it there, then save the drawing as OFB (the MCP's save tool,
// format OFB). The shop loads that file and changes its expressions, and drags its vane sketch.
//
// The model: a plate (a ring), a vane extruded from a sketch and patterned round, a hub (a ring),
// the balance holes (a pin through the plate between two vanes, patterned round), the bore through
// all. What the shop offers are its six parameters:
//
//   diameter    the plate's diameter (mm)
//   vanes       how many vanes, and as many balance holes
//   vaneHeight  the vanes' height above the plate (mm); the hub stands 2 mm higher
//   bore        the bore (mm); the hub is max(32, bore + 16) across
//   wrap        how far round the vane sweeps from the hub to the rim (degrees)
//   bow         how far the vane bows off its chord, of the chord's length
//
// The vane sketch is drawn as a hand would hold it. The vane is drawn about its middle line: an arc
// from A (on the hub, on the x axis) through P (its middle) to B (on the rim). How far round B stands
// is one dimension, `Sweep` (the angle of O→B, bound to `wrap`). P stands on the perpendicular
// bisector of the chord A–B, and the angle between the chord and A→P is the other, `Bow` (bound to
// atan(2·bow): an arc whose middle stands `bow` chords off its chord is seen from its end at that
// angle, so the vane keeps its curve, whatever its chord). The walls are concentric with the middle
// line, between two caps square to it, as long as the vane is thick and centred on A and on B.
//
// The balance hole stands holeR out, half a pitch round from where the middle line crosses that
// circle. That angle the expressions work out (the same math as src/design.js): a circle crosses a
// circle twice, and a solver left to find the crossing may take the other one.
//
// So each of the sketch's two handles, B and P, is held by one dimension, and that is how the shop
// drags them: it opens the sketch (part.openFeature: the features after it wait), and sets the
// handle's dimension to where the hand is (sketch.updateDimension); the solver re-solves the sketch
// and nothing else, in a few dozen milliseconds. On letting go it sets `wrap` and `bow` to match (the
// balance holes follow them) and closes the sketch, and the part is rebuilt once. The dimension keeps
// the number the hand gave it.
//
// (sketch.moveGeometry, the solver's own drag, moves the points it is given and settles everything
// else by least squares. Here everything else, the arc's centre, the caps and the walls, moves with
// the handle and holds it back: the handle would not follow the hand.)

const PLATE = 6 // the plate's thickness (mm)
const T = 3.6 // the vanes' thickness (mm)
const HOLE = 7 // the balance holes' diameter (mm)
const FRAC = 0.25 // where the balance holes sit, of the way from the hub to the rim
const BASE = { D: 120, N: 9, H: 32, B: 16, wrap: 62, bow: 0.1555 }

// Where the sketch's points start (the solver puts them where its constraints want them): the same
// math as src/design.js.
function seed({ D, N, B: bore, wrap, bow }) {
  const hub = Math.max(32, bore + 16)
  const R1 = hub / 2 - 3
  const R2 = D / 2 - 3
  const W = (wrap * Math.PI) / 180
  const B = [R2 * Math.cos(W), R2 * Math.sin(W), 0]
  const chord = Math.hypot(B[0] - R1, B[1])
  const psi = Math.acos((B[0] - R1) / chord)
  const theta = 4 * Math.atan(2 * bow)
  const RC = chord / (2 * Math.sin(theta / 2))
  const a0 = psi + Math.PI / 2 + theta / 2
  const am = psi + Math.PI / 2
  const C = [R1 - RC * Math.cos(a0), -RC * Math.sin(a0)]
  const on = (R, a) => [C[0] + R * Math.cos(a), C[1] + R * Math.sin(a), 0]
  const holeR = hub / 2 + FRAC * (D / 2 - hub / 2)
  const dC = Math.hypot(C[0], C[1])
  const cross = Math.atan2(C[1], C[0]) + Math.acos((holeR * holeR + dC * dC - RC * RC) / (2 * holeR * dC))
  const round = a => [holeR * Math.cos(a), holeR * Math.sin(a), 0]
  const a1 = a0 - theta
  const Ro = RC + T / 2
  const Ri = RC - T / 2
  // the middle line's ends and middle, the walls' corners and middles, the hole
  return {
    hub,
    A: [R1, 0, 0],
    B,
    P: on(RC, am),
    Oa: on(Ro, a0),
    Ia: on(Ri, a0),
    Ob: on(Ro, a1),
    Ib: on(Ri, a1),
    Om: on(Ro, am),
    Im: on(Ri, am),
    H: round(cross + Math.PI / N),
  }
}

const s = seed(BASE)
const P_ = api.v1.part
const S = api.v1.sketch
// (a call's result, or what went wrong)
const ok = (r, what) => {
  if (!r || r.result === null || r.result === undefined || r.maxLevel > 31)
    throw new Error(what + ': ' + JSON.stringify(r?.messages ?? []).slice(0, 400))
  return r.result
}
await api.v1.common.clear()
const id = ok(await P_.create({ name: 'Impeller' }), 'part')
const top = ok(await P_.getWorkGeometry({ id, name: 'Top' }), 'Top')
const zAxis = ok(await P_.getWorkGeometry({ id, name: 'ZAxis' }), 'ZAxis')

// ---- the parameters, and what follows from them
ok(
  await P_.expression({
    id,
    toCreate: [
      // what the shop offers
      { name: 'diameter', value: BASE.D },
      { name: 'vanes', value: BASE.N },
      { name: 'vaneHeight', value: BASE.H },
      { name: 'bore', value: BASE.B },
      { name: 'wrap', value: BASE.wrap },
      { name: 'bow', value: BASE.bow },
      // what does not change
      { name: 'plate', value: PLATE },
      { name: 'thick', value: T },
      { name: 'holeD', value: HOLE },
      { name: 'holeFrac', value: FRAC },
      // what follows
      { name: 'hub', value: 'max(32, bore + 16)' },
      { name: 'hubHeight', value: 'vaneHeight + 2' },
      { name: 'vaneTop', value: 'plate + vaneHeight' },
      { name: 'hubTop', value: 'plate + hubHeight' },
      { name: 'pitch', value: '2*C:PI/vanes' },
      { name: 'halfPitch', value: 'C:PI/vanes' },
      { name: 'holes', value: 'vanes' },
      { name: 'R1', value: 'hub/2 - 3' },
      { name: 'R2', value: 'diameter/2 - 3' },
      { name: 'W', value: 'wrap*C:PI/180' },
      { name: 'beta', value: 'atan(2*bow)' },
      { name: 'halfThick', value: 'thick/2' },
      { name: 'holeR', value: 'hub/2 + holeFrac*(diameter/2 - hub/2)' },
      // (where the middle line crosses the hole's circle: from its centre C and radius RC)
      { name: 'Bx', value: 'R2*cos(W)' },
      { name: 'By', value: 'R2*sin(W)' },
      { name: 'chord', value: 'sqrt((Bx - R1)*(Bx - R1) + By*By)' },
      { name: 'psi', value: 'acos((Bx - R1)/chord)' },
      { name: 'theta', value: '4*beta' },
      { name: 'RC', value: 'chord/(2*sin(theta/2))' },
      { name: 'a0', value: 'psi + C:PI/2 + theta/2' },
      { name: 'Cx', value: 'R1 - RC*cos(a0)' },
      { name: 'Cy', value: '0 - RC*sin(a0)' },
      { name: 'dC', value: 'sqrt(Cx*Cx + Cy*Cy)' },
      { name: 'phiC', value: 'acos(Cx/dC)*Cy/sqrt(Cy*Cy + 0.000000001)' },
      { name: 'alpha', value: 'acos((holeR*holeR + dC*dC - RC*RC)/(2*holeR*dC))' },
      { name: 'holeAng', value: 'phiC + alpha + halfPitch' },
      { name: 'holeDepth', value: '4*plate' },
      { name: 'boreDepth', value: '4*hubTop' },
    ],
  }),
  'expressions',
)

const NO = { genFixation: false, genIncidence: false, genTangency: false, genVertAndHoriz: false }
const pt = async g => ok(await S.getPoints({ id: g }), 'points of ' + g)
// (names, for the shop to find them by: setObjectName answers null, so only its level is checked)
const named = async pairs => {
  for (const [g, name] of pairs) {
    const r = await api.v1.common.setObjectName({ id: g, name })
    if (r.maxLevel > 31) throw new Error('name ' + name + ': ' + JSON.stringify(r.messages))
  }
}

// a ring: two circles about the origin, their diameters bound to expressions, extruded up
const ring = async (name, r1, e1, r2, e2, H) => {
  const sk = ok(await S.create({ id, planeId: top, name: name + ' sketch' }), name)
  const [a, b] = ok(
    await S.circle([
      { id: sk, centerPos: [0, 0, 0], radius: r1, ...NO },
      { id: sk, centerPos: [0, 0, 0], radius: r2, ...NO },
    ]),
    name + ' circles',
  )
  const ca = (await pt(a)).centerId
  const cb = (await pt(b)).centerId
  ok(
    await S.constraint([
      { id: sk, type: 'FIXATION', geomIds: [ca] },
      { id: sk, type: 'COINCIDENT', geomIds: [cb, ca] },
    ]),
    name + ' fix',
  )
  ok(
    await S.dimension([
      { id: sk, name: e1, type: 'DIAMETER', geomIds: [a], value: '@expr.' + e1 },
      { id: sk, name: e2, type: 'DIAMETER', geomIds: [b], value: '@expr.' + e2 },
    ]),
    name + ' dims',
  )
  return ok(await P_.extrusion({ id, name, references: [a, b], type: 'UP', limit2: '@expr.' + H }), name)
}

// ---- the plate
const plate = await ring('Plate', BASE.D / 2, 'diameter', BASE.B / 2, 'bore', 'plate')

// ---- the vane, and the balance hole beside it
const sk = ok(await S.create({ id, planeId: top, name: 'Vane sketch' }), 'vane sketch')
const O = ok(await S.point({ id: sk, pos: [0, 0, 0], ...NO }), 'origin')
// the middle line: O→A, O→B, the chord A–B, A→P and B→P (construction), and the arc A–P–B
const line = (a, b) => ({ id: sk, startPos: a, endPos: b, isConstruction: true, ...NO })
const [toA, toB, chord, aToP, bToP] = ok(
  await S.line([line([0, 0, 0], s.A), line([0, 0, 0], s.B), line(s.A, s.B), line(s.A, s.P), line(s.B, s.P)]),
  'middle line',
)
const middle = ok(
  await S.arcBy3Points({ id: sk, startPos: s.A, midPos: s.P, endPos: s.B, isConstruction: true, ...NO }),
  'middle arc',
)
// the walls: the caps (each hung from two half-lines out of A or B, on the line through the arc's
// centre), and the two arcs between them
const [aOut, aIn, bOut, bIn] = ok(
  await S.line([line(s.A, s.Oa), line(s.A, s.Ia), line(s.B, s.Ob), line(s.B, s.Ib)]),
  'half caps',
)
const [capA, capB] = ok(
  await S.line([
    { id: sk, startPos: s.Ia, endPos: s.Oa, ...NO },
    { id: sk, startPos: s.Ob, endPos: s.Ib, ...NO },
  ]),
  'caps',
)
const [outer, inner] = ok(
  await S.arcBy3Points([
    { id: sk, startPos: s.Oa, midPos: s.Om, endPos: s.Ob, ...NO },
    { id: sk, startPos: s.Ib, midPos: s.Im, endPos: s.Ia, ...NO },
  ]),
  'walls',
)
// the balance hole: O→H, holeR long and holeAng round
const toH = ok(await S.line(line([0, 0, 0], s.H)), 'hole line')
const hole = ok(await S.circle({ id: sk, centerPos: s.H, radius: HOLE / 2, ...NO }), 'hole')
await named([
  [toA, 'To A'],
  [toB, 'To B'],
  [chord, 'Chord'],
  [aToP, 'A to P'],
  [bToP, 'B to P'],
  [middle, 'Middle'],
  [aOut, 'A out'],
  [aIn, 'A in'],
  [bOut, 'B out'],
  [bIn, 'B in'],
  [capA, 'Cap A'],
  [capB, 'Cap B'],
  [outer, 'Outer'],
  [inner, 'Inner'],
  [toH, 'To hole'],
  [hole, 'Hole'],
])

const [pA, pB, pChord, pAP, pBP, pMid, pCapA, pCapB, pOut, pIn, pH, pHole] = await Promise.all(
  [toA, toB, chord, aToP, bToP, middle, capA, capB, outer, inner, toH, hole].map(pt),
)
const [pAo, pAi, pBo, pBi] = await Promise.all([aOut, aIn, bOut, bIn].map(pt))
const A = pA.endId
const B = pB.endId
const P = pAP.endId
const C = pMid.centerId
ok(
  await S.constraint(
    [
      { type: 'FIXATION', geomIds: [O] },
      ...[pA, pB, pH].map(p => ({ type: 'COINCIDENT', geomIds: [p.startId, O] })),
      { type: 'HORIZONTAL', geomIds: [toA] },
      // the middle line: the chord, P on its bisector, the arc through A, P and B
      { type: 'COINCIDENT', geomIds: [pChord.startId, A] },
      { type: 'COINCIDENT', geomIds: [pChord.endId, B] },
      { type: 'COINCIDENT', geomIds: [pAP.startId, A] },
      { type: 'COINCIDENT', geomIds: [pBP.startId, B] },
      { type: 'COINCIDENT', geomIds: [pBP.endId, P] },
      { type: 'EQUAL_LENGTH', geomIds: [aToP, bToP] },
      { type: 'COINCIDENT', geomIds: [pMid.startId, A] },
      { type: 'COINCIDENT', geomIds: [pMid.endId, B] },
      { type: 'COINCIDENT', geomIds: [P, middle] },
      // the caps: half a thickness out of A (and of B) to either side, on the line through the arc's
      // centre, and the cap from end to end
      ...[pAo, pAi].map(p => ({ type: 'COINCIDENT', geomIds: [p.startId, A] })),
      ...[pBo, pBi].map(p => ({ type: 'COINCIDENT', geomIds: [p.startId, B] })),
      { type: 'COLINEAR', geomIds: [aIn, aOut] },
      { type: 'COLINEAR', geomIds: [bIn, bOut] },
      { type: 'COINCIDENT', geomIds: [C, aOut] },
      { type: 'COINCIDENT', geomIds: [C, bOut] },
      { type: 'COINCIDENT', geomIds: [pCapA.startId, pAi.endId] },
      { type: 'COINCIDENT', geomIds: [pCapA.endId, pAo.endId] },
      { type: 'COINCIDENT', geomIds: [pCapB.startId, pBo.endId] },
      { type: 'COINCIDENT', geomIds: [pCapB.endId, pBi.endId] },
      // the walls: from cap to cap, about the arc's centre
      { type: 'COINCIDENT', geomIds: [pOut.startId, pCapA.endId] },
      { type: 'COINCIDENT', geomIds: [pOut.endId, pCapB.startId] },
      { type: 'COINCIDENT', geomIds: [pIn.startId, pCapB.endId] },
      { type: 'COINCIDENT', geomIds: [pIn.endId, pCapA.startId] },
      { type: 'CONCENTRIC', geomIds: [outer, middle] },
      { type: 'CONCENTRIC', geomIds: [inner, middle] },
      // the hole's centre at H
      { type: 'COINCIDENT', geomIds: [pHole.centerId, pH.endId] },
    ].map(c => ({ id: sk, ...c })),
  ),
  'vane constraints',
)
// (an angle's dimension is placed inside the angle it measures: that is the angle it keeps)
const inside = (at, a, b, r) => {
  const u = [a[0] - at[0], a[1] - at[1]]
  const v = [b[0] - at[0], b[1] - at[1]]
  const lu = Math.hypot(...u)
  const lv = Math.hypot(...v)
  return [at[0] + r * (u[0] / lu + v[0] / lv), at[1] + r * (u[1] / lu + v[1] / lv), 0]
}
ok(
  await S.dimension(
    [
      { name: 'R1', type: 'OFFSET', geomIds: [toA], value: '@expr.R1' },
      { name: 'R2', type: 'OFFSET', geomIds: [toB], value: '@expr.R2' },
      { name: 'Sweep', type: 'ANGLEOX', geomIds: [toB], value: '@expr.W' },
      { name: 'Bow', type: 'ANGLE', geomIds: [chord, aToP], value: '@expr.beta', dimPos: inside(s.A, s.B, s.P, 12) },
      ...[aOut, aIn, bOut, bIn].map(g => ({ type: 'OFFSET', geomIds: [g], value: '@expr.halfThick' })),
      { name: 'Hole out', type: 'OFFSET', geomIds: [toH], value: '@expr.holeR' },
      { name: 'Hole round', type: 'ANGLEOX', geomIds: [toH], value: '@expr.holeAng' },
      { name: 'Hole size', type: 'DIAMETER', geomIds: [hole], value: '@expr.holeD' },
    ].map(x => ({ id: sk, ...x })),
  ),
  'vane dimensions',
)
const vane = ok(
  await P_.extrusion({ id, name: 'Vane', references: [outer, capB, inner, capA], type: 'UP', limit2: '@expr.vaneTop' }),
  'vane',
)
const vanes = ok(
  await P_.circularPattern({
    id,
    name: 'Vanes',
    targets: [vane],
    references: [zAxis],
    angle: '@expr.pitch',
    count: '@expr.vanes',
    merged: 1,
  }),
  'vanes',
)
const pin = ok(
  await P_.extrusion({ id, name: 'Hole', references: [hole], type: 'SYMMETRIC', limit2: '@expr.holeDepth' }),
  'hole',
)
const pins = ok(
  await P_.circularPattern({
    id,
    name: 'Balance holes',
    targets: [pin],
    references: [zAxis],
    angle: '@expr.pitch',
    count: '@expr.holes',
    merged: 1,
  }),
  'holes',
)

// ---- the hub; the bore, through all
const hubF = await ring('Hub', s.hub / 2, 'hub', BASE.B / 2, 'bore', 'hubTop')
const sk5 = ok(await S.create({ id, planeId: top, name: 'Bore sketch' }), 'bore sketch')
const bc = ok(await S.circle({ id: sk5, centerPos: [0, 0, 0], radius: BASE.B / 2, ...NO }), 'bore circle')
ok(await S.constraint({ id: sk5, type: 'FIXATION', geomIds: [(await pt(bc)).centerId] }), 'bore fix')
ok(await S.dimension({ id: sk5, name: 'bore', type: 'DIAMETER', geomIds: [bc], value: '@expr.bore' }), 'bore dim')
const boreF = ok(
  await P_.extrusion({ id, name: 'Bore', references: [bc], type: 'SYMMETRIC', limit2: '@expr.boreDepth' }),
  'bore',
)

// ---- one body
const body = ok(await P_.boolean({ id, name: 'Body', type: 'UNION', target: plate, tools: [vanes, hubF] }), 'union')
ok(await P_.boolean({ id, name: 'Impeller', type: 'SUBTRACTION', target: body, tools: [pins, boreF] }), 'subtraction')
const mp = ok(await P_.calculateMassProperties({ id }), 'mass')
// (129 933.9 mm³, as the shop starts)
return { id, volume: mp.volume }
