import * as tf from '@tensorflow/tfjs'
import { readFile } from 'node:fs/promises'
import { DQN, validateAgent } from '../src/learning/dqn'
import { initPhysics, LunarEnvironment } from '../src/sim/environment'
import { MISSIONS, varyMission } from '../src/sim/missions'
import { DEFAULT_SETTINGS } from '../src/sim/types'

await initPhysics()
await tf.setBackend('cpu')
await tf.ready()
const saved: unknown = JSON.parse(await readFile(new URL('../public/agents/explorer.json', import.meta.url), 'utf8'))
if (!validateAgent(saved)) throw new Error('Invalid bundled agent')
const trained = new DQN()
trained.load(saved)
const random = new DQN()
const report = []
for (const [label, agent] of [['Untrained', random], ['Explorer', trained]] as const) {
  for (const mission of MISSIONS) {
    let successes = 0
    let accidents = 0
    let reward = 0
    for (let trial = 0; trial < 8; trial++) {
      const env = new LunarEnvironment(varyMission(mission, 20000 + trial), DEFAULT_SETTINGS, 18000 + trial)
      try {
        let state = env.snapshot()
        while (!state.done) state = env.step(agent.act(state.observation))
        successes += Number(state.outcome === 'success')
        accidents += Number(state.outcome === 'collision' || state.outcome === 'fall')
        reward += state.totalReward / 8
      } finally { env.dispose() }
    }
    const original = new LunarEnvironment(mission, DEFAULT_SETTINGS, 42)
    let state = original.snapshot()
    while (!state.done) state = original.step(agent.act(state.observation))
    original.dispose()
    report.push({ agent: label, mission: mission.id, successes, trials: 8, accidents, meanReward: reward.toFixed(2), original: state.outcome })
  }
}
console.table(report)
trained.dispose()
random.dispose()
