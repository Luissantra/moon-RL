import { beforeAll, describe, expect, it } from 'vitest'
import { initPhysics, LunarEnvironment } from './environment'
import { getMission, heightAt, terrainMesh, varyMission, validObstacle } from './missions'
import { DEFAULT_SETTINGS, INPUT_SIZE } from './types'

beforeAll(initPhysics)

describe('lunar dynamics and observations', () => {
  it('settles on four suspension contacts with finite normalized observations', () => {
    const env = new LunarEnvironment(getMission('contact'))
    const state = env.snapshot()
    expect(state.contact).toBe(4)
    expect(state.position[1]).toBeGreaterThan(0.3)
    expect(state.observation).toHaveLength(INPUT_SIZE)
    expect(state.observation.every(n => Number.isFinite(n) && Math.abs(n) <= 1)).toBe(true)
    expect(state.sensors).toHaveLength(7)
    env.dispose()
  })

  it('accelerates with bounded traction and requires time to brake', () => {
    const env = new LunarEnvironment(getMission('contact'))
    let state = env.snapshot()
    for (let i = 0; i < 30; i++) state = env.step(0)
    expect(state.speed).toBeGreaterThan(1)
    const speed = state.speed
    state = env.step(3)
    expect(state.speed).toBeGreaterThan(0.1)
    expect(state.speed).toBeLessThan(speed)
    for (let i = 0; i < 25; i++) state = env.step(3)
    expect(state.speed).toBeLessThan(0.15)
    env.dispose()
  })

  it('reduces acceleration on slippery ground', () => {
    const normal = new LunarEnvironment(getMission('contact'))
    const slippery = new LunarEnvironment(getMission('contact'), { ...DEFAULT_SETTINGS, friction: 0.2 })
    for (let i = 0; i < 12; i++) { normal.step(0); slippery.step(0) }
    expect(normal.snapshot().speed).toBeGreaterThan(slippery.snapshot().speed * 1.5)
    normal.dispose()
    slippery.dispose()
  })

  it('only succeeds after stopping in the goal and stays terminal', () => {
    const mission = getMission('contact')
    mission.goal = [...mission.start]
    const env = new LunarEnvironment(mission)
    const result = env.step(3)
    expect(result.outcome).toBe('success')
    expect(result.reward).toBeGreaterThan(29)
    expect(env.step(0).steps).toBe(result.steps)
    env.dispose()
  })

  it('detects obstacle collisions and terminates', () => {
    const mission = getMission('contact')
    mission.start = [0, 4]
    mission.goal = [0, -5]
    mission.rocks = [{ id: 1, x: 0, z: 1.5, radius: 0.8, kind: 'rock' }]
    const env = new LunarEnvironment(mission)
    let result = env.snapshot()
    for (let i = 0; i < 100 && !result.done; i++) result = env.step(0)
    expect(result.outcome).toBe('collision')
    expect(result.reward).toBeLessThan(-10)
    env.dispose()
  })

  it('uses actual slope geometry and reproducible held-out variants', () => {
    expect(heightAt(3, -4, true)).toBeGreaterThan(1)
    const mesh = terrainMesh(true)
    expect(mesh.indices.length).toBeGreaterThan(1000)
    const mission = getMission('base')
    expect(varyMission(mission, 9001)).toEqual(varyMission(mission, 9001))
    expect(varyMission(mission, 9001)).not.toEqual(varyMission(mission, 9002))
    expect(validObstacle(mission, { id: 5, x: mission.goal[0], z: mission.goal[1], radius: 1, kind: 'rock' })).toBe(false)
    const env = new LunarEnvironment(mission)
    for (let i = 0; i < 20; i++) env.step(0)
    expect(env.snapshot().position.every(Number.isFinite)).toBe(true)
    env.dispose()
  })

  it('senses crater edges before falling without supporting wheels on a sensor', () => {
    const mission = getMission('contact')
    mission.start = [0, 4]
    mission.goal = [0, -5]
    mission.rocks = [{ id: 1, x: 0, z: 0, radius: 1.2, kind: 'crater' }]
    const env = new LunarEnvironment(mission)
    let state = env.snapshot()
    expect(state.sensors[3].distance).toBeLessThan(3)
    for (let i = 0; i < 100 && !state.done; i++) state = env.step(0)
    expect(state.outcome).toBe('fall')
    env.dispose()
  })
})
