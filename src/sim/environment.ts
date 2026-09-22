import RAPIER from '@dimforge/rapier3d-compat'
import { heightAt, seededRandom, terrainMesh } from './missions'
import {
  DEFAULT_SETTINGS, DT, MOON_GRAVITY, SENSOR_ANGLES, SENSOR_RANGE, SUBSTEPS,
  type Action, type Mission, type Outcome, type Sensor, type Settings, type Snapshot, type Vec3,
} from './types'

let ready: Promise<void> | undefined
export function initPhysics() {
  ready ??= RAPIER.init()
  return ready
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))
const WHEELS = [[-0.47, 0.48], [0.47, 0.48], [-0.47, -0.48], [0.47, -0.48]] as const

function rotate(v: Vec3, q: RAPIER.Quaternion): Vec3 {
  const [x, y, z] = v
  const tx = 2 * (q.y * z - q.z * y)
  const ty = 2 * (q.z * x - q.x * z)
  const tz = 2 * (q.x * y - q.y * x)
  return [x + q.w * tx + q.y * tz - q.z * ty, y + q.w * ty + q.z * tx - q.x * tz, z + q.w * tz + q.x * ty - q.y * tx]
}

export class LunarEnvironment {
  world: RAPIER.World
  body: RAPIER.RigidBody
  private chassis: RAPIER.Collider
  private hazards: RAPIER.Collider[] = []
  private contacts = 0
  private slip = 0
  private totalReward = 0
  private steps = 0
  private path = 0
  private done = false
  private outcome?: Outcome
  private previousDistance = 0

  constructor(public mission: Mission, public settings: Settings = DEFAULT_SETTINGS, seed = 1, randomHeading = false) {
    this.world = new RAPIER.World({ x: 0, y: -MOON_GRAVITY, z: 0 })
    this.world.timestep = DT
    const terrain = terrainMesh(mission.hills, mission.rocks)
    this.world.createCollider(RAPIER.ColliderDesc.trimesh(terrain.vertices, terrain.indices).setFriction(0.7))
    for (const rock of mission.rocks) {
      const y = heightAt(rock.x, rock.z, mission.hills)
      const desc = rock.kind === 'rock'
        ? RAPIER.ColliderDesc.ball(rock.radius).setTranslation(rock.x, y + rock.radius * 0.45, rock.z)
        : RAPIER.ColliderDesc.cylinder(0.6, rock.radius).setTranslation(rock.x, y + 0.15, rock.z).setSensor(true)
      this.hazards.push(this.world.createCollider(desc))
    }
    for (const [x, z, hx, hz] of [[-11, 0, 0.2, 11], [11, 0, 0.2, 11], [0, -11, 11, 0.2], [0, 11, 11, 0.2]]) {
      this.hazards.push(this.world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 2, hz).setTranslation(x, 1, z)))
    }
    const random = seededRandom(seed)
    const angle = Math.atan2(mission.goal[0] - mission.start[0], mission.goal[1] - mission.start[1])
      + (random() - 0.5) * (randomHeading ? Math.PI * 2 : 0.3)
    this.body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(mission.start[0], heightAt(...mission.start, mission.hills) + 0.7, mission.start[1])
      .setRotation({ x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) })
      .setLinearDamping(0.05).setAngularDamping(2).setCcdEnabled(true))
    this.chassis = this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.38, 0.17, 0.6).setMass(12).setFriction(0.4), this.body)
    this.world.step()
    for (let i = 0; i < 90; i++) this.physicsStep(3)
    this.previousDistance = this.distance()
  }

  private distance() {
    const p = this.body.translation()
    return Math.hypot(p.x - this.mission.goal[0], p.z - this.mission.goal[1])
  }

  private physicsStep(action: Action) {
    const p = this.body.translation()
    const q = this.body.rotation()
    const forward = rotate([0, 0, 1], q)
    const right = rotate([1, 0, 0], q)
    const velocity = this.body.linvel()
    const angular = this.body.angvel()
    this.body.resetForces(true)
    this.body.resetTorques(true)
    this.contacts = 0
    this.slip = 0
    let normalTotal = 0
    const targetSpeed = [2.4, 0.65, 0.65, 0, -1.1][action]
    const targetYaw = action === 1 ? 0.95 : action === 2 ? -0.95 : 0
    for (const [wx, wz] of WHEELS) {
      const offset = rotate([wx, -0.06, wz], q)
      const point = { x: p.x + offset[0], y: p.y + offset[1], z: p.z + offset[2] }
      const hit = this.world.castRayAndGetNormal(new RAPIER.Ray(point, { x: 0, y: -1, z: 0 }),
        0.64, true, undefined, undefined, undefined, this.body, c => !c.isSensor())
      if (!hit) continue
      this.contacts++
      const vy = velocity.y + angular.z * offset[0] - angular.x * offset[2]
      const spring = clamp((0.55 - hit.timeOfImpact) * 100 - vy * 8, 0, 70)
      normalTotal += spring
      const n = hit.normal
      this.body.addForceAtPoint({ x: n.x * spring, y: n.y * spring, z: n.z * spring }, point, true)
      const vx = velocity.x + angular.y * offset[2] - angular.z * offset[1]
      const vz = velocity.z + angular.x * offset[1] - angular.y * offset[0]
      const longitudinal = vx * forward[0] + vz * forward[2]
      const lateral = vx * right[0] + vz * right[2]
      const drive = (targetSpeed - longitudinal) * 5
      const side = -lateral * 7
      const requested = Math.hypot(drive, side)
      const limit = spring * this.settings.friction
      const scale = requested > 0 ? Math.min(1, limit / requested) : 1
      this.slip += 1 - scale
      this.body.addForceAtPoint({
        x: (drive * forward[0] + side * right[0]) * scale, y: 0,
        z: (drive * forward[2] + side * right[2]) * scale,
      }, point, true)
    }
    this.slip /= 4
    const torqueLimit = normalTotal * this.settings.friction * 0.55
    this.body.addTorque({ x: 0, y: clamp((targetYaw - angular.y) * 12, -torqueLimit, torqueLimit), z: 0 }, true)
    this.world.step()
  }

  step(action: Action): Snapshot {
    if (this.done) return this.snapshot(action, 0)
    const prev = this.body.translation()
    let collision = false
    for (let i = 0; i < SUBSTEPS; i++) {
      this.physicsStep(action)
      for (const hazard of this.hazards) {
        if (!hazard.isSensor()) this.world.contactPair(this.chassis, hazard, manifold => {
          for (let j = 0; j < manifold.numContacts(); j++) {
            if (manifold.contactDist(j) < 0.025) collision = true
          }
        })
      }
    }
    const p = this.body.translation()
    const v = this.body.linvel()
    const speed = Math.hypot(v.x, v.z)
    this.path += Math.hypot(p.x - prev.x, p.z - prev.z)
    this.steps++
    const distance = this.distance()
    let reward = 1.5 * (this.previousDistance - distance) - this.settings.stepPenalty
    const up = rotate([0, 1, 0], this.body.rotation())
    const crater = this.mission.rocks.some(o => o.kind === 'crater' && Math.hypot(p.x - o.x, p.z - o.z) < o.radius - 0.1)
    if (collision) this.outcome = 'collision'
    else if (p.y < -1 || Math.abs(p.x) > 10.5 || Math.abs(p.z) > 10.5 || up[1] < 0.35 || crater) this.outcome = 'fall'
    else if (distance < 1 && speed < 0.5) this.outcome = 'success'
    else if (this.steps >= 550) this.outcome = 'timeout'
    if (this.outcome === 'success') reward += this.settings.successReward
    if (this.outcome === 'collision' || this.outcome === 'fall') reward -= this.settings.collisionPenalty
    if (this.outcome === 'timeout') reward -= 3
    this.done = this.outcome !== undefined
    this.totalReward += reward
    this.previousDistance = distance
    return this.snapshot(action, reward)
  }

  snapshot(action: Action = 3, reward = 0): Snapshot {
    const p = this.body.translation()
    const q = this.body.rotation()
    const v = this.body.linvel()
    const w = this.body.angvel()
    const forward = rotate([0, 0, 1], q)
    const right = rotate([1, 0, 0], q)
    const up = rotate([0, 1, 0], q)
    const yaw = Math.atan2(forward[0], forward[2])
    const delta = Math.atan2(this.mission.goal[0] - p.x, this.mission.goal[1] - p.z) - yaw
    const sensors: Sensor[] = SENSOR_ANGLES.map(angle => {
      const dir = { x: Math.sin(yaw + angle), y: -0.04, z: Math.cos(yaw + angle) }
      const start: Vec3 = [p.x + forward[0] * 0.4, p.y + 0.12, p.z + forward[2] * 0.4]
      const hit = this.world.castRay(new RAPIER.Ray({ x: start[0], y: start[1], z: start[2] }, dir),
        SENSOR_RANGE, true, undefined, undefined, undefined, this.body)
      const distance = hit?.timeOfImpact ?? SENSOR_RANGE
      return { start, end: [start[0] + dir.x * distance, start[1] + dir.y * distance, start[2] + dir.z * distance], distance }
    })
    const distance = this.distance()
    const observation = [
      ...sensors.map(s => s.distance / SENSOR_RANGE),
      Math.sin(delta), Math.cos(delta), Math.min(distance / 24, 1),
      clamp((v.x * forward[0] + v.z * forward[2]) / 3, -1, 1),
      clamp((v.x * right[0] + v.z * right[2]) / 3, -1, 1),
      clamp(w.y / 2, -1, 1), forward[1], right[1], this.contacts / 4, this.slip,
    ]
    return {
      position: [p.x, p.y, p.z], rotation: [q.x, q.y, q.z, q.w], sensors,
      speed: Math.hypot(v.x, v.z), tilt: Math.acos(clamp(up[1], -1, 1)) * 180 / Math.PI,
      contact: this.contacts, slip: this.slip, distance, observation, action, reward,
      totalReward: this.totalReward, path: this.path, steps: this.steps, done: this.done, outcome: this.outcome,
    }
  }

  dispose() {
    this.world.free()
  }
}
