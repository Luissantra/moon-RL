import type { Mission, MissionId, Obstacle } from './types'

export const MISSIONS: Mission[] = [
  {
    id: 'contact', name: 'Primer contacto', subtitle: 'Aprende a llegar. Y a parar.',
    description: 'Lleva a LUNA-01 hasta la baliza verde y detente dentro del círculo. El primer paso de toda gran exploración.',
    difficulty: 'INICIACIÓN', start: [-6, 5], goal: [5, -5], hills: false,
    rocks: [
      { id: 1, x: -6, z: -5, radius: 1.15, kind: 'rock' },
      { id: 2, x: 6, z: 4, radius: 1.1, kind: 'rock' },
      { id: 3, x: -4, z: -7, radius: 0.65, kind: 'rock' },
      { id: 4, x: 3, z: 7, radius: 0.85, kind: 'crater' },
    ],
  },
  {
    id: 'rocks', name: 'Campo de rocas', subtitle: 'El camino recto no siempre es el mejor.',
    description: 'Encuentra una ruta entre rocas y cráteres. Tus sensores solo ven lo que está cerca: explorar forma parte del aprendizaje.',
    difficulty: 'INTERMEDIO', start: [-6, 5], goal: [6, -5], hills: false,
    rocks: [
      { id: 1, x: -2, z: 2, radius: 1.15, kind: 'rock' },
      { id: 2, x: 1, z: -1, radius: 1.2, kind: 'rock' },
      { id: 3, x: -5, z: -4, radius: 1.05, kind: 'crater' },
      { id: 4, x: 4, z: 3, radius: 0.9, kind: 'rock' },
      { id: 5, x: 3, z: -5, radius: 0.8, kind: 'rock' },
      { id: 6, x: -6, z: -6, radius: 0.7, kind: 'rock' },
    ],
  },
  {
    id: 'base', name: 'Regreso a la base', subtitle: 'La gravedad también enseña.',
    description: 'Sube la ladera, controla la velocidad y vuelve al módulo. Mantener la tracción es tan importante como elegir la dirección.',
    difficulty: 'AVANZADO', start: [-6, 5], goal: [5, -6], hills: true,
    rocks: [
      { id: 1, x: -3, z: 0, radius: 1.25, kind: 'rock' },
      { id: 2, x: 2, z: 1, radius: 1.35, kind: 'rock' },
      { id: 3, x: 0, z: -5, radius: 1.1, kind: 'crater' },
      { id: 4, x: 6, z: 1, radius: 0.7, kind: 'rock' },
      { id: 5, x: -6, z: -5, radius: 0.7, kind: 'rock' },
    ],
  },
]

export function getMission(id: MissionId): Mission {
  return structuredClone(MISSIONS.find(m => m.id === id) ?? MISSIONS[0])
}

export function heightAt(x: number, z: number, hills: boolean): number {
  if (!hills) return 0
  return 1.7 * Math.exp(-((x - 3) ** 2 + (z + 4) ** 2) / 25)
    + 0.25 * Math.sin(x * 0.55) * Math.cos(z * 0.5)
}

export function terrainMesh(hills: boolean, obstacles: Obstacle[] = []) {
  const segments = 40
  const vertices: number[] = []
  const indices: number[] = []
  for (let z = 0; z <= segments; z++) {
    for (let x = 0; x <= segments; x++) {
      const px = x / segments * 22 - 11
      const pz = z / segments * 22 - 11
      let y = heightAt(px, pz, hills)
      for (const crater of obstacles.filter(o => o.kind === 'crater')) {
        const d = Math.hypot(px - crater.x, pz - crater.z)
        if (d < crater.radius) y -= 1.8 * Math.sqrt(1 - d / crater.radius)
      }
      vertices.push(px, y, pz)
    }
  }
  for (let z = 0; z < segments; z++) {
    for (let x = 0; x < segments; x++) {
      const i = z * (segments + 1) + x
      indices.push(i, i + segments + 1, i + 1, i + 1, i + segments + 1, i + segments + 2)
    }
  }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) }
}

export function seededRandom(seed: number) {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let t = Math.imul(value ^ (value >>> 15), 1 | value)
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function varyMission(mission: Mission, seed: number): Mission {
  const random = seededRandom(seed)
  const result = structuredClone(mission)
  result.start = [mission.start[0] + (random() - 0.5) * 2, mission.start[1] + (random() - 0.5) * 2]
  result.goal = [mission.goal[0] + (random() - 0.5) * 2, mission.goal[1] + (random() - 0.5) * 2]
  result.rocks = mission.rocks.map(r => ({ ...r, x: r.x + (random() - 0.5) * 1.3, z: r.z + (random() - 0.5) * 1.3 }))
  return result
}

export function validObstacle(mission: Mission, obstacle: Obstacle): boolean {
  return Math.abs(obstacle.x) <= 8 && Math.abs(obstacle.z) <= 8
    && [mission.start, mission.goal].every(([x, z]) => Math.hypot(x - obstacle.x, z - obstacle.z) > obstacle.radius + 1.8)
    && mission.rocks.every(r => Math.hypot(r.x - obstacle.x, r.z - obstacle.z) > r.radius + obstacle.radius + 0.4)
}
