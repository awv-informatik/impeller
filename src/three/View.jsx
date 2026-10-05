// The part's room in the page: no walls, no floor, the page's own paper behind it. It turns slowly
// until a hand turns it.
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Part } from './Part'
import { useShop } from '../store'
import { finishOf } from '../design'

// The camera keeps the part framed whatever shape the room has (wide, tall, small): it stands back as
// far as the narrower of the two angles of view needs. A larger part still looks larger, only not by
// as much as it is larger.
function Rig() {
  const diameter = useShop(s => s.solved?.diameter ?? 120)
  const camera = useThree(s => s.camera)
  const size = useThree(s => s.size)
  useFrame((_, dt) => {
    const aspect = size.width / Math.max(1, size.height)
    const v = (camera.fov * Math.PI) / 360
    const half = Math.min(v, Math.atan(Math.tan(v) * aspect))
    const fill = 0.62 * Math.pow(diameter / 120, 0.45)
    const want = (diameter * 0.5) / fill / Math.tan(half)
    const d = camera.position.length()
    camera.position.multiplyScalar((d + (want - d) * (1 - Math.exp(-dt * 4))) / d)
  })
  return null
}

export function View() {
  const body = useShop(s => s.body)
  const finish = useShop(s => s.finish)
  return (
    <Canvas className="canvas" flat dpr={[1, 2]} gl={{ antialias: true, alpha: true }} camera={{ fov: 30, near: 10, far: 5000, position: [-175, 225, 320] }}>
      <Part body={body} color={finishOf(finish).color} />
      <Rig />
      <OrbitControls makeDefault autoRotate autoRotateSpeed={0.55} enableDamping dampingFactor={0.08} enablePan={false} enableZoom={false} minPolarAngle={0.25} maxPolarAngle={1.5} />
    </Canvas>
  )
}
