// The impeller, as a parametric ClassCAD model: the script public/impeller.ofb was built with.
//
// It runs as the body of an async function with `api` (ClassCAD's v1 API), as the ClassCAD MCP's
// run_script tool runs scripts: run it there, then save the drawing as OFB (the MCP's save tool,
// format OFB). The shop loads that file and only ever changes its expressions.
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
// The vane is drawn about its middle line: an arc from A (on the hub, R1 out on the x axis) to B (on
// the rim, R2 out, `wrap` round), bowed by `bow`. The expressions compute that arc's centre C and the
// angles its ends are seen at from C; in the sketch, every point of the vane is placed from C by a
// length and an angle (OFFSET and ANGLEOX dimensions bound to those expressions), so the solver has
// nothing left to choose and no other solution to fall into, however far a parameter jumps.

const PLATE = 6, T = 3.6, HOLE = 7, FRAC = 0.25
const BASE = { D: 120, N: 9, H: 32, B: 16, wrap: 62, bow: 0.1555 }

// the same math the expressions do, for the seed geometry
function design(cfg) {
  const { D, N, B, wrap, bow } = cfg
  const hub = Math.max(32, B + 16), R1 = hub / 2 - 3, R2 = D / 2 - 3, W = (wrap * Math.PI) / 180
  const Bx = R2 * Math.cos(W), By = R2 * Math.sin(W)
  const chord = Math.hypot(Bx - R1, By), psi = Math.acos((Bx - R1) / chord)
  const theta = 4 * Math.atan(2 * bow), RC = chord / (2 * Math.sin(theta / 2))
  const a0 = psi + Math.PI / 2 + theta / 2, a1 = a0 - theta, am = psi + Math.PI / 2
  const C = [R1 - RC * Math.cos(a0), -RC * Math.sin(a0)]
  const dC = Math.hypot(C[0], C[1]), phiC = Math.acos(C[0] / dC) * Math.sign(C[1])
  const holeR = hub / 2 + FRAC * (D / 2 - hub / 2)
  const alpha = Math.acos((holeR * holeR + dC * dC - RC * RC) / (2 * holeR * dC))
  const holeAng = phiC + alpha + Math.PI / N
  const on = (R, a) => [C[0] + R * Math.cos(a), C[1] + R * Math.sin(a), 0]
  return { hub, R1, R2, RC, a0, a1, am, C, holeR, holeAng, on, Ro: RC + T / 2, Ri: RC - T / 2 }
}

const d = design(BASE)
const P_ = api.v1.part, S = api.v1.sketch
const ok = (r, what) => {
  if (!r || r.result === null || r.result === undefined || r.maxLevel > 31) throw new Error(what + ': ' + JSON.stringify(r?.messages ?? []).slice(0, 400))
  return r.result
}
await api.v1.common.clear()
const id = ok(await P_.create({ name: 'Impeller' }), 'part')
const top = ok(await P_.getWorkGeometry({ id, name: 'Top' }), 'Top')
const zAxis = ok(await P_.getWorkGeometry({ id, name: 'ZAxis' }), 'ZAxis')

// ---- the parameters, and what follows from them
ok(await P_.expression({ id, toCreate: [
  // what the shop offers
  { name: 'diameter', value: BASE.D }, { name: 'vanes', value: BASE.N }, { name: 'vaneHeight', value: BASE.H }, { name: 'bore', value: BASE.B },
  { name: 'wrap', value: BASE.wrap }, { name: 'bow', value: BASE.bow },
  // what does not change
  { name: 'plate', value: PLATE }, { name: 'thick', value: T }, { name: 'holeD', value: HOLE }, { name: 'holeFrac', value: FRAC },
  // what follows
  { name: 'hub', value: 'max(32, bore + 16)' }, { name: 'hubHeight', value: 'vaneHeight + 2' },
  { name: 'vaneTop', value: 'plate + vaneHeight' }, { name: 'hubTop', value: 'plate + hubHeight' },
  { name: 'pitch', value: '2*C:PI/vanes' }, { name: 'halfPitch', value: 'C:PI/vanes' }, { name: 'holes', value: 'vanes' },
  { name: 'R1', value: 'hub/2 - 3' }, { name: 'R2', value: 'diameter/2 - 3' }, { name: 'W', value: 'wrap*C:PI/180' },
  { name: 'Bx', value: 'R2*cos(W)' }, { name: 'By', value: 'R2*sin(W)' },
  { name: 'chord', value: 'sqrt((Bx - R1)*(Bx - R1) + By*By)' }, { name: 'psi', value: 'acos((Bx - R1)/chord)' },
  { name: 'theta', value: '4*atan(2*bow)' }, { name: 'RC', value: 'chord/(2*sin(theta/2))' },
  { name: 'Ro', value: 'RC + thick/2' }, { name: 'Ri', value: 'RC - thick/2' },
  { name: 'a0', value: 'psi + C:PI/2 + theta/2' }, { name: 'a1', value: 'a0 - theta' }, { name: 'am', value: 'psi + C:PI/2' },
  { name: 'Cx', value: 'R1 - RC*cos(a0)' }, { name: 'Cy', value: '0 - RC*sin(a0)' }, { name: 'dC', value: 'sqrt(Cx*Cx + Cy*Cy)' },
  { name: 'phiC', value: 'acos(Cx/dC)*Cy/sqrt(Cy*Cy + 0.000000001)' },
  { name: 'holeR', value: 'hub/2 + holeFrac*(diameter/2 - hub/2)' },
  { name: 'alpha', value: 'acos((holeR*holeR + dC*dC - RC*RC)/(2*holeR*dC))' },
  { name: 'holeAng', value: 'phiC + alpha + halfPitch' },
  { name: 'holeDepth', value: '4*plate' }, { name: 'boreDepth', value: '4*hubTop' },
] }), 'expressions')

const NO = { genFixation: false, genIncidence: false, genTangency: false, genVertAndHoriz: false }
const pt = async g => ok(await S.getPoints({ id: g }), 'points of ' + g)

// a ring: two circles about the origin, their diameters bound to expressions, extruded up
const ring = async (name, r1, e1, r2, e2, H) => {
  const sk = ok(await S.create({ id, planeId: top, name: name + ' sketch' }), name)
  const [a, b] = ok(await S.circle([{ id: sk, centerPos: [0, 0, 0], radius: r1, ...NO }, { id: sk, centerPos: [0, 0, 0], radius: r2, ...NO }]), name + ' circles')
  const ca = (await pt(a)).centerId, cb = (await pt(b)).centerId
  ok(await S.constraint([{ id: sk, type: 'FIXATION', geomIds: [ca] }, { id: sk, type: 'COINCIDENT', geomIds: [cb, ca] }]), name + ' fix')
  ok(await S.dimension([{ id: sk, name: e1, type: 'DIAMETER', geomIds: [a], value: '@expr.' + e1 }, { id: sk, name: e2, type: 'DIAMETER', geomIds: [b], value: '@expr.' + e2 }]), name + ' dims')
  return ok(await P_.extrusion({ id, name, references: [a, b], type: 'UP', limit2: '@expr.' + H }), name)
}

// ---- the plate
const plate = await ring('Plate', BASE.D / 2, 'diameter', BASE.B / 2, 'bore', 'plate')

// ---- the vane, and the balance hole beside it
const sk = ok(await S.create({ id, planeId: top, name: 'Vane sketch' }), 'vane sketch')
const O = ok(await S.point({ id: sk, pos: [0, 0, 0], ...NO }), 'origin')
const A = [d.R1, 0, 0]
const lOA = ok(await S.line({ id: sk, startPos: [0, 0, 0], endPos: A, isConstruction: true, ...NO }), 'OA')
const lCA = ok(await S.line({ id: sk, startPos: [...d.C, 0], endPos: A, isConstruction: true, ...NO }), 'CA')
// from C: the four corners and the two arcs' middles
const spokes = [['Ro', 'a0'], ['Ri', 'a0'], ['Ro', 'a1'], ['Ri', 'a1'], ['Ro', 'am'], ['Ri', 'am']]
const sl = ok(await S.line(spokes.map(([r, a]) => ({ id: sk, startPos: [...d.C, 0], endPos: d.on(d[r], d[a]), isConstruction: true, ...NO }))), 'spokes')
const [Oa, Ia, Ob, Ib, Om, Im] = spokes.map(([r, a]) => d.on(d[r], d[a]))
const [outer, inner] = ok(await S.arcBy3Points([{ id: sk, startPos: Oa, midPos: Om, endPos: Ob, ...NO }, { id: sk, startPos: Ib, midPos: Im, endPos: Ia, ...NO }]), 'arcs')
const [capA, capB] = ok(await S.line([{ id: sk, startPos: Ia, endPos: Oa, ...NO }, { id: sk, startPos: Ob, endPos: Ib, ...NO }]), 'caps')
// the balance hole: holeR out, half a pitch round from where the vane's middle line crosses that circle
const H = [d.holeR * Math.cos(d.holeAng), d.holeR * Math.sin(d.holeAng), 0]
const lOH = ok(await S.line({ id: sk, startPos: [0, 0, 0], endPos: H, isConstruction: true, ...NO }), 'OH')
const hole = ok(await S.circle({ id: sk, centerPos: H, radius: HOLE / 2, ...NO }), 'hole')
const [pOA, pCA, pOH, pHole, pOut, pIn, pCapA, pCapB] = await Promise.all([lOA, lCA, lOH, hole, outer, inner, capA, capB].map(pt))
const ps = await Promise.all(sl.map(pt))
ok(await S.constraint([
  { type: 'FIXATION', geomIds: [O] },
  { type: 'COINCIDENT', geomIds: [pOA.startId, O] }, { type: 'HORIZONTAL', geomIds: [lOA] }, { type: 'COINCIDENT', geomIds: [pCA.endId, pOA.endId] },
  ...ps.map(p => ({ type: 'COINCIDENT', geomIds: [p.startId, pCA.startId] })),
  { type: 'COINCIDENT', geomIds: [pOut.startId, ps[0].endId] }, { type: 'COINCIDENT', geomIds: [pOut.endId, ps[2].endId] }, { type: 'COINCIDENT', geomIds: [ps[4].endId, outer] },
  { type: 'COINCIDENT', geomIds: [pIn.startId, ps[3].endId] }, { type: 'COINCIDENT', geomIds: [pIn.endId, ps[1].endId] }, { type: 'COINCIDENT', geomIds: [ps[5].endId, inner] },
  { type: 'COINCIDENT', geomIds: [pCapA.startId, ps[1].endId] }, { type: 'COINCIDENT', geomIds: [pCapA.endId, ps[0].endId] },
  { type: 'COINCIDENT', geomIds: [pCapB.startId, ps[2].endId] }, { type: 'COINCIDENT', geomIds: [pCapB.endId, ps[3].endId] },
  { type: 'COINCIDENT', geomIds: [pOH.startId, O] }, { type: 'COINCIDENT', geomIds: [pHole.centerId, pOH.endId] },
].map(c => ({ id: sk, ...c }))), 'vane constraints')
ok(await S.dimension([
  { name: 'R1', type: 'OFFSET', geomIds: [lOA], value: '@expr.R1' },
  { name: 'RC', type: 'OFFSET', geomIds: [lCA], value: '@expr.RC' }, { name: 'a0', type: 'ANGLEOX', geomIds: [lCA], value: '@expr.a0' },
  ...sl.flatMap((l, i) => [{ name: 'r' + i, type: 'OFFSET', geomIds: [l], value: '@expr.' + spokes[i][0] }, { name: 'a' + i, type: 'ANGLEOX', geomIds: [l], value: '@expr.' + spokes[i][1] }]),
  { name: 'HoleR', type: 'OFFSET', geomIds: [lOH], value: '@expr.holeR' }, { name: 'HoleAng', type: 'ANGLEOX', geomIds: [lOH], value: '@expr.holeAng' },
  { name: 'Hole', type: 'DIAMETER', geomIds: [hole], value: '@expr.holeD' },
].map(x => ({ id: sk, ...x }))), 'vane dimensions')
const vane = ok(await P_.extrusion({ id, name: 'Vane', references: [outer, capB, inner, capA], type: 'UP', limit2: '@expr.vaneTop' }), 'vane')
const vanes = ok(await P_.circularPattern({ id, name: 'Vanes', targets: [vane], references: [zAxis], angle: '@expr.pitch', count: '@expr.vanes', merged: 1 }), 'vanes')
const pin = ok(await P_.extrusion({ id, name: 'Hole', references: [hole], type: 'SYMMETRIC', limit2: '@expr.holeDepth' }), 'hole')
const pins = ok(await P_.circularPattern({ id, name: 'Balance holes', targets: [pin], references: [zAxis], angle: '@expr.pitch', count: '@expr.holes', merged: 1 }), 'holes')

// ---- the hub; the bore, through all
const hubF = await ring('Hub', d.hub / 2, 'hub', BASE.B / 2, 'bore', 'hubTop')
const sk5 = ok(await S.create({ id, planeId: top, name: 'Bore sketch' }), 'bore sketch')
const bc = ok(await S.circle({ id: sk5, centerPos: [0, 0, 0], radius: BASE.B / 2, ...NO }), 'bore circle')
ok(await S.constraint({ id: sk5, type: 'FIXATION', geomIds: [(await pt(bc)).centerId] }), 'bore fix')
ok(await S.dimension({ id: sk5, name: 'bore', type: 'DIAMETER', geomIds: [bc], value: '@expr.bore' }), 'bore dim')
const boreF = ok(await P_.extrusion({ id, name: 'Bore', references: [bc], type: 'SYMMETRIC', limit2: '@expr.boreDepth' }), 'bore')

// ---- one body
const body = ok(await P_.boolean({ id, name: 'Body', type: 'UNION', target: plate, tools: [vanes, hubF] }), 'union')
ok(await P_.boolean({ id, name: 'Impeller', type: 'SUBTRACTION', target: body, tools: [pins, boreF] }), 'subtraction')
const mp = ok(await P_.calculateMassProperties({ id }), 'mass')
// (129 933.9 mm³: the first film's part, as that film measured it)
return { id, volume: mp.volume }
