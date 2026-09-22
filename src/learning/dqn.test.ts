import { beforeAll, describe, expect, it } from 'vitest'
import * as tf from '@tensorflow/tfjs'
import { DQN, ReplayBuffer, validateAgent } from './dqn'
import { INPUT_SIZE } from '../sim/types'

beforeAll(async () => { await tf.setBackend('cpu'); await tf.ready() })

describe('DQN', () => {
  it('learns a terminal reward and round-trips all network weights', () => {
    const agent = new DQN()
    const state = Array.from({ length: INPUT_SIZE }, (_, i) => i / INPUT_SIZE)
    const initial = agent.values(state)[0]
    for (let i = 0; i < 64; i++) agent.replay.add({ state, action: 0, reward: 5, next: state, done: true })
    for (let i = 0; i < 55; i++) agent.train()
    expect(agent.values(state)[0]).toBeGreaterThan(initial + 1)
    const saved = agent.save('test')
    expect(validateAgent(saved)).toBe(true)
    const restored = new DQN(88)
    restored.load(saved)
    expect(restored.values(state)).toEqual(agent.values(state))
    expect(restored.updates).toBe(55)
    agent.dispose()
    restored.dispose()
  })
  it('rejects corrupted and incompatible saves', () => {
    expect(validateAgent(null)).toBe(false)
    expect(validateAgent({ version: 7 })).toBe(false)
    const agent = new DQN()
    const save = agent.save('test')
    save.weights[0].values[0] = NaN
    expect(validateAgent(save)).toBe(false)
    agent.dispose()
  })
  it('keeps replay memory bounded', () => {
    const replay = new ReplayBuffer(5)
    for (let i = 0; i < 20; i++) replay.add({ state: [i], action: 0, reward: i, next: [i], done: false })
    expect(replay.size).toBe(5)
    expect(replay.sample(10, () => 0.5).every(t => t.reward >= 15)).toBe(true)
  })
  it('does not leak tensors during inference and training', () => {
    const agent = new DQN()
    const state = Array(INPUT_SIZE).fill(0) as number[]
    for (let i = 0; i < 64; i++) agent.replay.add({ state, action: 0, reward: 1, next: state, done: false })
    agent.train()
    const count = tf.memory().numTensors
    for (let i = 0; i < 20; i++) { agent.values(state); agent.train() }
    expect(tf.memory().numTensors).toBe(count)
    agent.dispose()
  })
})
