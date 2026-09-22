import { Component, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { heightAt, seededRandom, terrainMesh } from '../sim/missions'
import type { Mission, Snapshot, Vec3 } from '../sim/types'

interface Props {
  mission: Mission
  snapshot: Snapshot | null
  sensors: boolean
  topView: boolean
  editing: boolean
  onPlace: (x: number, z: number) => void
  onRemove: (id: number) => void
  path: Vec3[]
}

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <div className="scene-fallback">No se pudo iniciar la escena 3D. Activa WebGL o prueba un navegador compatible.</div>
    return this.props.children
  }
}

function Camera({ top }: { top: boolean }) {
  const { camera, gl } = useThree()
  const controls = useRef<OrbitControls | null>(null)
  useEffect(() => {
    const orbit = new OrbitControls(camera, gl.domElement)
    orbit.target.set(0, 0, 0)
    orbit.enableDamping = true
    orbit.minDistance = 17
    orbit.maxDistance = 43
    orbit.maxPolarAngle = Math.PI * 0.46
    orbit.enablePan = false
    controls.current = orbit
    return () => orbit.dispose()
  }, [camera, gl])
  useEffect(() => {
    camera.position.set(...(top ? [0.01, 33, 0] : [18, 20, 24]) as Vec3)
    camera.lookAt(0, 0, 0)
    if (controls.current) controls.current.enableRotate = !top
  }, [camera, top])
  useFrame(() => controls.current?.update())
  return null
}

function Stars() {
  const geometry = useMemo(() => {
    const random = seededRandom(501)
    const points = Array.from({ length: 300 }, () => new THREE.Vector3((random() - 0.5) * 120, random() * 45 + 6, -random() * 65 - 14))
    return new THREE.BufferGeometry().setFromPoints(points)
  }, [])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <points geometry={geometry}><pointsMaterial color="#b8c9df" size={0.075} transparent opacity={0.65} sizeAttenuation /></points>
}

function Earth() {
  return <group position={[-15, 13, -27]} rotation={[0.1, 0.2, -0.3]}>
    <mesh><sphereGeometry args={[2.7, 24, 18]} /><meshStandardMaterial color="#8daabf" roughness={1} /></mesh>
    <mesh position={[-0.65, 0.75, 2.35]} rotation={[0, -0.4, 0.1]} scale={[0.75, 1.2, 0.22]}><icosahedronGeometry args={[1, 1]} /><meshStandardMaterial color="#b4c6b8" /></mesh>
    <mesh position={[0.9, -0.3, 2.43]} rotation={[0.2, 0.3, 0.6]} scale={[0.6, 1, 0.2]}><icosahedronGeometry args={[1, 1]} /><meshStandardMaterial color="#b4c6b8" /></mesh>
    <mesh position={[0, 1.9, 1.68]} scale={[1.6, 0.2, 0.35]}><sphereGeometry args={[1, 12, 8]} /><meshStandardMaterial color="#e9ece7" /></mesh>
  </group>
}

function Terrain({ mission, editing, onPlace }: Pick<Props, 'mission' | 'editing' | 'onPlace'>) {
  const geometry = useMemo(() => {
    const { vertices, indices } = terrainMesh(mission.hills, mission.rocks)
    const mesh = new THREE.BufferGeometry()
    mesh.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
    mesh.setIndex(new THREE.BufferAttribute(indices, 1))
    mesh.computeVertexNormals()
    const flat = mesh.toNonIndexed()
    mesh.dispose()
    const colors = new Float32Array(flat.attributes.position.count * 3)
    const random = seededRandom(103)
    for (let i = 0; i < colors.length; i += 9) {
      const c = new THREE.Color('#85888d').multiplyScalar(0.87 + random() * 0.24)
      for (let j = 0; j < 9; j += 3) { colors[i + j] = c.r; colors[i + j + 1] = c.g; colors[i + j + 2] = c.b }
    }
    flat.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return flat
  }, [mission])
  useEffect(() => () => geometry.dispose(), [geometry])
  function place(event: ThreeEvent<MouseEvent>) {
    if (!editing) return
    event.stopPropagation()
    onPlace(Math.round(event.point.x * 2) / 2, Math.round(event.point.z * 2) / 2)
  }
  return <group>
    <mesh geometry={geometry} receiveShadow onClick={place}>
      <meshStandardMaterial vertexColors flatShading roughness={1} />
    </mesh>
    <mesh position={[0, -2.1, 0]}><boxGeometry args={[22, 0.2, 22]} /><meshStandardMaterial color="#444a54" flatShading /></mesh>
    {[-1, 1].map(side => <group key={side}>
      <mesh position={[side * 11, -1, 0]}><boxGeometry args={[0.04, 2, 22]} /><meshStandardMaterial color="#505661" flatShading /></mesh>
      <mesh position={[0, -1, side * 11]}><boxGeometry args={[22, 2, 0.04]} /><meshStandardMaterial color="#505661" flatShading /></mesh>
      <mesh position={[side * 10.7, 0.06, 0]}><boxGeometry args={[0.045, 0.04, 21.4]} /><meshBasicMaterial color="#adb3a4" transparent opacity={0.4} /></mesh>
      <mesh position={[0, 0.06, side * 10.7]}><boxGeometry args={[21.4, 0.04, 0.045]} /><meshBasicMaterial color="#adb3a4" transparent opacity={0.4} /></mesh>
    </group>)}
  </group>
}

function Rover({ snapshot, mission }: Pick<Props, 'snapshot' | 'mission'>) {
  const rover = useRef<THREE.Group>(null)
  const wheelRefs = useRef<(THREE.Group | null)[]>([])
  useFrame((_, dt) => {
    if (!rover.current) return
    if (snapshot) {
      const target = new THREE.Vector3(...snapshot.position)
      if (rover.current.position.distanceTo(target) > 3) rover.current.position.copy(target)
      else rover.current.position.lerp(target, Math.min(1, dt * 18))
      rover.current.quaternion.slerp(new THREE.Quaternion(...snapshot.rotation), Math.min(1, dt * 18))
      for (const wheel of wheelRefs.current) if (wheel) wheel.rotation.x += snapshot.speed * dt * 3
    }
  })
  return <group ref={rover} position={[mission.start[0], 0.56, mission.start[1]]}>
    <mesh castShadow position={[0, 0.02, 0]}><boxGeometry args={[0.83, 0.32, 1.2]} /><meshStandardMaterial color="#ebeee6" roughness={0.6} /></mesh>
    <mesh castShadow position={[0, 0.23, -0.04]}><boxGeometry args={[0.74, 0.14, 0.8]} /><meshStandardMaterial color="#d7f098" /></mesh>
    <mesh castShadow position={[0, 0.32, -0.2]} rotation={[-0.08, 0, 0]}><boxGeometry args={[1.06, 0.055, 0.56]} /><meshStandardMaterial color="#202e44" metalness={0.3} roughness={0.45} /></mesh>
    {[-0.35, -0.12, 0.12, 0.35].map(x => <mesh key={x} position={[x, 0.352, -0.2]}><boxGeometry args={[0.012, 0.01, 0.54]} /><meshStandardMaterial color="#718ba8" /></mesh>)}
    <mesh castShadow position={[0, 0.48, 0.35]}><cylinderGeometry args={[0.05, 0.07, 0.36, 8]} /><meshStandardMaterial color="#9aa6a9" /></mesh>
    <mesh castShadow position={[0, 0.71, 0.37]}><boxGeometry args={[0.65, 0.25, 0.25]} /><meshStandardMaterial color="#eff0e7" /></mesh>
    {[-0.18, 0.18].map(x => <group key={x} position={[x, 0.71, 0.515]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.085, 0.085, 0.045, 16]} /><meshStandardMaterial color="#1a2435" /></mesh>
      <mesh position={[-0.015, 0.025, 0.035]}><sphereGeometry args={[0.025, 8, 8]} /><meshBasicMaterial color="#bded92" /></mesh>
    </group>)}
    <mesh position={[-0.33, 0.62, -0.43]}><cylinderGeometry args={[0.012, 0.012, 0.65, 6]} /><meshStandardMaterial color="#b8c4ce" /></mesh>
    <mesh position={[-0.33, 0.96, -0.43]}><sphereGeometry args={[0.04, 8, 6]} /><meshBasicMaterial color="#c3ec8b" /></mesh>
    {([-1, 1] as const).flatMap((side, a) => [-0.42, 0.42].map((z, b) => <group key={`${side}-${z}`} position={[side * 0.51, -0.22, z]}>
      <group ref={el => { wheelRefs.current[a * 2 + b] = el }}>
        <mesh castShadow rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.27, 0.27, 0.23, 12]} /><meshStandardMaterial color="#222b35" flatShading /></mesh>
        <mesh position={[side * 0.125, 0, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.13, 0.13, 0.03, 8]} /><meshStandardMaterial color="#ccd2c8" metalness={0.4} roughness={0.7} /></mesh>
        <mesh position={[side * 0.15, 0, 0]}><boxGeometry args={[0.015, 0.21, 0.035]} /><meshStandardMaterial color="#607174" /></mesh>
      </group>
    </group>))}
    <mesh position={[0, 0.02, 0.61]}><boxGeometry args={[0.6, 0.05, 0.025]} /><meshBasicMaterial color="#c0f18a" /></mesh>
  </group>
}

function Beacon({ mission }: { mission: Mission }) {
  return <group position={[mission.goal[0], heightAt(...mission.goal, mission.hills) + 0.08, mission.goal[1]]}>
    <mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.9, 1.06, 48]} /><meshBasicMaterial color="#c7f3a0" side={THREE.DoubleSide} /></mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.9, 40]} /><meshBasicMaterial color="#b7eb8b" transparent opacity={0.15} depthWrite={false} /></mesh>
    <mesh position={[0, 0.9, 0]}><cylinderGeometry args={[0.04, 0.04, 1.8, 8]} /><meshStandardMaterial color="#dae9c5" /></mesh>
    <mesh position={[0.28, 1.65, 0]}><boxGeometry args={[0.55, 0.32, 0.035]} /><meshStandardMaterial color="#bbee88" emissive="#a5d479" emissiveIntensity={0.12} /></mesh>
    <mesh position={[0, 0.03, 0]}><cylinderGeometry args={[0.25, 0.35, 0.06, 8]} /><meshStandardMaterial color="#535c5b" /></mesh>
  </group>
}

function Lines({ snapshot, visible, path }: { snapshot: Snapshot | null; visible: boolean; path: Vec3[] }) {
  const sensorLines = useMemo(() => {
    const geometry = new THREE.BufferGeometry().setFromPoints(snapshot?.sensors.flatMap(s => [new THREE.Vector3(...s.start), new THREE.Vector3(...s.end)]) ?? [])
    return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#cdf49b', transparent: true, opacity: 0.5 }))
  }, [snapshot])
  const trail = useMemo(() => new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(path.map(p => new THREE.Vector3(p[0], p[1] - 0.43, p[2]))),
    new THREE.LineBasicMaterial({ color: '#d4ebaa', transparent: true, opacity: 0.5 }),
  ), [path])
  useEffect(() => () => { sensorLines.geometry.dispose(); sensorLines.material.dispose() }, [sensorLines])
  useEffect(() => () => { trail.geometry.dispose(); trail.material.dispose() }, [trail])
  return <>{visible && <primitive object={sensorLines} />}<primitive object={trail} /></>
}

function Scene(props: Props) {
  const { mission, snapshot, sensors, topView, editing, onRemove } = props
  const moduleX = mission.id === 'base' ? mission.goal[0] + 2.5 : -9
  const moduleZ = mission.id === 'base' ? mission.goal[1] : -9
  return <>
    <color attach="background" args={['#131c29']} />
    <ambientLight intensity={0.55} />
    <hemisphereLight args={['#c7d7e9', '#4a4341', 1.2]} />
    <directionalLight position={[-8, 18, -5]} intensity={3} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-17} shadow-camera-right={17} shadow-camera-top={17} shadow-camera-bottom={-17} shadow-normalBias={0.035} />
    <Camera top={topView} /><Stars /><Earth />
    <Terrain {...props} />
    {mission.rocks.map(rock => <group key={rock.id} position={[rock.x, heightAt(rock.x, rock.z, mission.hills), rock.z]}
      onClick={event => { if (editing) { event.stopPropagation(); onRemove(rock.id) } }}>
      {rock.kind === 'rock' ? <>
        <mesh castShadow receiveShadow position={[0, rock.radius * 0.45, 0]} rotation={[rock.id * 0.6, rock.id * 0.8, 0.2]}>
          <icosahedronGeometry args={[rock.radius, 1]} /><meshStandardMaterial color={rock.id % 2 ? '#737783' : '#a0a09f'} flatShading roughness={1} />
        </mesh>
        <mesh position={[rock.radius * 0.9, 0.1, rock.radius * 0.6]} castShadow><dodecahedronGeometry args={[rock.radius * 0.18, 0]} /><meshStandardMaterial color="#777b83" flatShading /></mesh>
      </> : <>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}><circleGeometry args={[rock.radius * 0.92, 20]} /><meshStandardMaterial color="#333b47" /></mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}><torusGeometry args={[rock.radius, 0.13, 5, 20]} /><meshStandardMaterial color="#969696" flatShading /></mesh>
      </>}
    </group>)}
    <Beacon mission={mission} />
    <Rover snapshot={snapshot} mission={mission} />
    <Lines snapshot={snapshot} visible={sensors} path={props.path} />
    <group position={[mission.start[0], heightAt(...mission.start, mission.hills) + 0.025, mission.start[1]]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.8, 0.86, 32]} /><meshBasicMaterial color="#dfbd8a" /></mesh>
    </group>
    <group position={[moduleX, heightAt(moduleX, moduleZ, mission.hills), moduleZ]} rotation={[0, 0.3, 0]}>
      <mesh castShadow position={[0, 0.85, 0]}><cylinderGeometry args={[0.7, 0.95, 1.25, 6]} /><meshStandardMaterial color="#d9d8ce" flatShading /></mesh>
      <mesh position={[0, 1.55, 0]}><sphereGeometry args={[0.62, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#939c9c" flatShading /></mesh>
      <mesh position={[0, 0.85, 0.78]}><boxGeometry args={[0.35, 0.32, 0.05]} /><meshStandardMaterial color="#293e52" /></mesh>
      {[-1, 1].map(side => <mesh key={side} castShadow position={[side * 1.4, 0.8, 0]}><boxGeometry args={[1.6, 0.04, 1]} /><meshStandardMaterial color="#2f435d" /></mesh>)}
    </group>
  </>
}

export default function World(props: Props) {
  return <SceneBoundary>
    <Canvas shadows dpr={[1, 1.75]} camera={{ position: [18, 20, 24], fov: 43, near: 0.1, far: 160 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      aria-label="Simulación 3D de un rover explorando una zona lunar">
      <Scene {...props} />
    </Canvas>
  </SceneBoundary>
}
