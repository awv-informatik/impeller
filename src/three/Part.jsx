// The part in the CAD app's look, as the film draws it: an even light and one lamp over the viewer's
// left shoulder (wherever the part is turned), its B-rep edges and its silhouettes inked.
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { silhouette } from './body'

const INK = '#0f1320'

const vert = /* glsl */ `
varying vec3 vNv;
void main() {
  vNv = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`
const frag = /* glsl */ `
uniform vec3 uBase;
varying vec3 vNv;
void main() {
  vec3 Nv = normalize(vNv);
  if (!gl_FrontFacing) Nv = -Nv;
  float lamp = max(dot(Nv, normalize(vec3(-0.46, 0.56, 0.69))), 0.0);
  gl_FragColor = vec4(uBase * (0.5 + 0.5 * lamp), 1.0);
  #include <colorspace_fragment>
}`

// The ink. An edge lies exactly on the faces it bounds, and the faces are flat facets of the true
// curve the edge follows: where they meet, the faces would cover part of the line's width and leave
// it ragged, thick in one place and thin in the next. So every line is drawn a hair nearer the eye
// than it is (its ends pulled toward the camera along their own rays: on screen nothing moves).
function inkMaterial() {
  const m = new LineMaterial({ color: INK, linewidth: 1.6, transparent: true, depthWrite: false })
  m.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );', 'vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );\n\t\t\tstart.xyz *= 0.9975;\n\t\t\tend.xyz *= 0.9975;')
  }
  m.customProgramCacheKey = () => 'ink'
  return m
}

export function Part({ body, color, width = 1.6 }) {
  const { size, viewport, camera } = useThree()
  const mat = useMemo(() => new THREE.ShaderMaterial({ uniforms: { uBase: { value: new THREE.Color(color) } }, vertexShader: vert, fragmentShader: frag, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1.5, polygonOffsetUnits: 2 }), [])
  const lineMat = useMemo(() => inkMaterial(), [])
  const edges = useMemo(() => { const l = new LineSegments2(new LineSegmentsGeometry(), lineMat); l.frustumCulled = false; l.renderOrder = 2; return l }, [lineMat])
  const sil = useMemo(() => { const l = new LineSegments2(new LineSegmentsGeometry(), lineMat); l.frustumCulled = false; l.renderOrder = 2; return l }, [lineMat])
  const group = useRef()
  const last = useRef({ eye: null, body: null })

  // (the colour eases to the finish's)
  const target = useMemo(() => new THREE.Color(), [])
  useEffect(() => { target.set(color) }, [color, target])

  useEffect(() => {
    if (!body) return
    edges.geometry.dispose()
    edges.geometry = new LineSegmentsGeometry()
    edges.geometry.setPositions(body.edges.length ? body.edges : [0, 0, 0, 0, 0, 0])
    last.current.body = null
  }, [body, edges])

  useFrame((state, dt) => {
    mat.uniforms.uBase.value.lerp(target, 1 - Math.exp(-dt * 10))
    const dpr = state.gl.getPixelRatio()
    lineMat.resolution.set(size.width * dpr, size.height * dpr)
    lineMat.linewidth = width * dpr
    if (!body || !group.current) return
    // the silhouette, from where the eye is (in the part's own space)
    const inv = group.current.matrixWorld.clone().invert()
    const eye = camera.position.clone().applyMatrix4(inv)
    const l = last.current
    if (l.body === body && l.eye && l.eye.distanceToSquared(eye) < 1e-4) return
    l.body = body
    l.eye = eye
    const s = silhouette(body, eye.toArray())
    sil.geometry.dispose()
    sil.geometry = new LineSegmentsGeometry()
    sil.geometry.setPositions(s.length ? s : [0, 0, 0, 0, 0, 0])
    sil.visible = s.length > 0
  })

  if (!body) return null
  const zMid = (body.box.min.z + body.box.max.z) / 2
  void viewport
  return (
    <group rotation={[-Math.PI / 2, 0, 0]}>
      <group ref={group} position={[0, 0, -zMid]}>
        <mesh geometry={body.geometry} material={mat} />
        <primitive object={edges} />
        <primitive object={sil} />
      </group>
    </group>
  )
}
