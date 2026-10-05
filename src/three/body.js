// The engine's solid as three.js geometry, the way the film draws its parts: the faces (each keeping
// its surface, for the silhouettes), the B-rep's own edges as segments (a seam, an edge only one face
// names, left out), and the silhouette of its curved faces as an eye sees them.
import * as THREE from 'three'

export function makeBody(containers) {
  let nv = 0
  let ni = 0
  for (const c of containers) for (const m of c.meshes ?? []) { nv += m.vertices.length / 3; ni += m.indices.length }
  const pos = new Float32Array(nv * 3)
  const nor = new Float32Array(nv * 3)
  const idx = new Uint32Array(ni)
  const faces = []
  let vo = 0
  let io = 0
  let hasNormals = true
  for (const c of containers) {
    for (const m of c.meshes ?? []) {
      const n = m.vertices.length / 3
      pos.set(m.vertices, vo * 3)
      if (m.normals && m.normals.length === m.vertices.length) nor.set(m.normals, vo * 3)
      else hasNormals = false
      for (let i = 0; i < m.indices.length; i++) idx[io + i] = m.indices[i] + vo
      faces.push({ start: vo, count: n, i0: io, ni: m.indices.length, surface: m.properties?.surface?.type ?? 'other' })
      vo += n
      io += m.indices.length
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  geometry.setIndex(new THREE.BufferAttribute(idx, 1))
  if (!hasNormals) geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  // the edges: the B-rep's own (an edge that only one face names is that face's seam)
  const named = new Map()
  for (const c of containers) for (const m of c.meshes ?? []) for (const loop of m.loops ?? []) for (const e of loop) named.set(e, (named.get(e) ?? 0) + 1)
  const segs = []
  const real = e => (named.get(e.id) ?? 2) > 1
  const poly = p => {
    for (let i = 0; i + 5 < p.length; i += 3) segs.push(p[i], p[i + 1], p[i + 2], p[i + 3], p[i + 4], p[i + 5])
  }
  for (const c of containers) {
    // (edges as point lists, as the engine sends them; or, as buerli keeps them, lines and arcs)
    for (const e of c.edges ?? []) if (real(e)) poly(e.points)
    for (const e of c.lines ?? []) if (real(e)) poly(e.points)
    for (const e of c.arcs ?? []) if (real(e)) poly(arcPoints(e))
  }
  const body = { geometry, faces, pos, idx, edges: new Float32Array(segs), box: geometry.boundingBox.clone() }
  let sil = null
  body.silCands = () => (sil ??= silhouetteCandidates(body))
  return body
}

// an arc edge as points: round its centre in the plane of its x and y axes, `angle` from its x axis
function arcPoints(a) {
  const [cx, cy, cz] = a.center, [xx, xy, xz] = a.xAxis, [zx, zy, zz] = a.zAxis
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx
  const n = Math.max(6, Math.ceil((Math.abs(a.angle) / (2 * Math.PI)) * 96))
  const out = []
  for (let i = 0; i <= n; i++) {
    const t = (a.angle * i) / n, c = Math.cos(t) * a.radius, s = Math.sin(t) * a.radius
    out.push(cx + c * xx + s * yx, cy + c * xy + s * yy, cz + c * xz + s * yz)
  }
  return out
}

// interior edges of curved faces, with both triangles' normals: the silhouette is where one of the two
// faces the eye and the other does not (a closed face's seam is welded, so the outline of a cylinder
// is found across it too)
function silhouetteCandidates(body) {
  const out = []
  const { pos, idx } = body
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3()
  const u = new THREE.Vector3(), v = new THREE.Vector3()
  for (const f of body.faces) {
    if (f.surface === 'plane') continue
    const key = i => `${Math.round(pos[3 * i] * 500)},${Math.round(pos[3 * i + 1] * 500)},${Math.round(pos[3 * i + 2] * 500)}`
    const weld = new Map(), remap = new Map()
    for (let i = f.start; i < f.start + f.count; i++) {
      const k = key(i)
      if (!weld.has(k)) weld.set(k, i)
      remap.set(i, weld.get(k))
    }
    const edges = new Map(), tn = []
    for (let t = 0; t < f.ni / 3; t++) {
      const a = remap.get(idx[f.i0 + 3 * t]), b = remap.get(idx[f.i0 + 3 * t + 1]), c = remap.get(idx[f.i0 + 3 * t + 2])
      A.fromArray(pos, a * 3); B.fromArray(pos, b * 3); C.fromArray(pos, c * 3)
      const n = u.subVectors(B, A).clone().cross(v.subVectors(C, A))
      if (n.lengthSq() < 1e-12) { tn.push(null); continue }
      tn.push(n.normalize())
      for (const [p, q] of [[a, b], [b, c], [c, a]]) {
        const k = p < q ? `${p}_${q}` : `${q}_${p}`
        const e = edges.get(k)
        if (e) e.t2 = t
        else edges.set(k, { p, q, t1: t, t2: -1 })
      }
    }
    for (const e of edges.values()) {
      if (e.t2 < 0 || !tn[e.t1] || !tn[e.t2]) continue
      const n1 = tn[e.t1], n2 = tn[e.t2]
      if (n1.dot(n2) > 0.99999) continue
      out.push(pos[3 * e.p], pos[3 * e.p + 1], pos[3 * e.p + 2], pos[3 * e.q], pos[3 * e.q + 1], pos[3 * e.q + 2], n1.x, n1.y, n1.z, n2.x, n2.y, n2.z)
    }
  }
  return new Float32Array(out)
}

// the silhouette as an eye at `eye` (in the body's own space) sees it
export function silhouette(body, eye) {
  const c = body.silCands(), out = []
  for (let i = 0; i < c.length; i += 12) {
    const dx = eye[0] - (c[i] + c[i + 3]) / 2, dy = eye[1] - (c[i + 1] + c[i + 4]) / 2, dz = eye[2] - (c[i + 2] + c[i + 5]) / 2
    const d1 = c[i + 6] * dx + c[i + 7] * dy + c[i + 8] * dz, d2 = c[i + 9] * dx + c[i + 10] * dy + c[i + 11] * dz
    if (d1 * d2 < 0) out.push(c[i], c[i + 1], c[i + 2], c[i + 3], c[i + 4], c[i + 5])
  }
  return out
}
