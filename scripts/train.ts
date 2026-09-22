import * as tf from '@tensorflow/tfjs'
import { writeFile } from 'node:fs/promises'
import { DQN } from '../src/learning/dqn'
import { initPhysics, LunarEnvironment } from '../src/sim/environment'
import { getMission, seededRandom, varyMission } from '../src/sim/missions'
import { DEFAULT_SETTINGS, SENSOR_ANGLES, type Action, type MissionId, type Snapshot } from '../src/sim/types'

const random = seededRandom(721)
const missions: MissionId[] = ['contact', 'rocks', 'base']
const sampleStates: number[][] = []
const sampleActions: number[] = []

function demonstration(state: Snapshot): Action {
  const o = state.observation
  const angle = Math.atan2(o[7], o[8])
  if (state.distance < 0.8 || (state.distance < 0.7 + state.speed ** 2 / 1.8 && Math.abs(angle) < 0.8)) return 3
  let desired = angle
  if (state.distance > 2.5) {
    let bestScore = -Infinity
    for (let candidate = -1.5; candidate <= 1.5; candidate += 0.15) {
      let clearance = 7
      for (const [index, sensorAngle] of SENSOR_ANGLES.entries()) {
        if (o[index] > 0.98) continue
        const distance = o[index] * 7
        const along = Math.cos(sensorAngle - candidate) * distance
        const across = Math.abs(Math.sin(sensorAngle - candidate) * distance)
        if (along > 0 && across < 1.3) clearance = Math.min(clearance, Math.max(0, along - Math.sqrt(1.3 ** 2 - across ** 2)))
      }
      const score = Math.min(clearance, 4) / 4 + 0.65 * Math.cos(candidate - angle) - 0.03 * Math.abs(candidate)
      if (score > bestScore) { bestScore = score; desired = candidate }
    }
    if (Math.min(o[2], o[3], o[4]) * 7 < 3.5 && state.speed > 0.9) return 3
  }
  const projectedAngle = desired - o[12] * 2 * 0.45
  if (projectedAngle > 0.16) return 1
  if (projectedAngle < -0.16) return 2
  return 0
}

await initPhysics()
await tf.setBackend('cpu')
await tf.ready()
const agent = new DQN(42)

async function evaluate(label: string, policy: (s: Snapshot) => Action, count = 8) {
  const report: Record<string, { successes: number; episodes: number; collisions: number; reward: number; original: Snapshot['outcome'] }> = {}
  for (const id of missions) {
    let successes = 0
    let collisions = 0
    let reward = 0
    for (let trial = 0; trial < count; trial++) {
      const env = new LunarEnvironment(varyMission(getMission(id), 9000 + trial), DEFAULT_SETTINGS, 8000 + trial)
      let state = env.snapshot()
      while (!state.done) state = env.step(policy(state))
      if (process.argv.includes('--probe')) console.log(id, trial, state.outcome, state.position.map(n => n.toFixed(1)), state.tilt.toFixed(1), state.steps)
      successes += Number(state.outcome === 'success')
      collisions += Number(state.outcome === 'collision' || state.outcome === 'fall')
      reward += state.totalReward / count
      env.dispose()
    }
    const original = new LunarEnvironment(getMission(id), DEFAULT_SETTINGS, 42)
    let state = original.snapshot()
    while (!state.done) state = original.step(policy(state))
    original.dispose()
    report[id] = { successes, episodes: count, collisions, reward, original: state.outcome }
  }
  console.log(label, JSON.stringify(report))
  return report
}

await evaluate('Demonstrator (training data only)', demonstration)
if (process.argv.includes('--probe')) { agent.dispose(); process.exit(0) }

for (let episode = 0; episode < 180; episode++) {
  const mission = varyMission(getMission(missions[episode % missions.length]), episode + 10)
  const env = new LunarEnvironment(mission, DEFAULT_SETTINGS, episode + 400, episode % 3 === 0)
  let state = env.snapshot()
  while (!state.done) {
    const expert = demonstration(state)
    for (let repeat = 0; repeat < (state.distance < 2.5 ? 3 : 1); repeat++) {
      sampleStates.push(state.observation)
      sampleActions.push(expert)
    }
    const action = random() < 0.06 ? Math.floor(random() * 5) as Action : expert
    const next = env.step(action)
    agent.replay.add({ state: state.observation, action, reward: next.reward, next: next.observation, done: next.done })
    state = next
  }
  agent.episodes++
  env.dispose()
  if (episode % 30 === 0) console.log(`Collected ${episode} episodes / ${sampleStates.length} examples`)
}

console.log('Warm start from sensor-based demonstrations')
agent.online.compile({ optimizer: tf.train.adam(0.002), loss: (truth, prediction) => tf.losses.softmaxCrossEntropy(truth, prediction) })
const xs = tf.tensor2d(sampleStates)
const labels = tf.tensor1d(sampleActions, 'int32')
const ys = tf.oneHot(labels, 5)
labels.dispose()
await agent.online.fit(xs, ys, {
  epochs: 64, batchSize: 256, shuffle: true, verbose: 0,
  callbacks: { onEpochEnd: (epoch, logs) => { if (epoch % 8 === 0) console.log(`Imitation epoch ${epoch}: loss ${logs?.loss}`) } },
})
xs.dispose()
ys.dispose()
agent.sync()
const warmReport = await evaluate('Warm-start network', s => agent.act(s.observation))
let best = agent.save('Explorador · demostraciones + DQN')
let bestScore = -1
let bestReport = warmReport
let selectedPhase = 'demonstration warm start'

for (let cycle = 0; cycle < 8; cycle++) {
  for (let update = 0; update < 90; update++) agent.train()
  for (let episode = 0; episode < 6; episode++) {
    const env = new LunarEnvironment(varyMission(getMission(missions[episode % 3]), 500 + cycle * 6 + episode))
    let state = env.snapshot()
    while (!state.done) {
      const action = agent.act(state.observation, 0.12)
      const next = env.step(action)
      agent.replay.add({ state: state.observation, action, reward: next.reward, next: next.observation, done: next.done })
      state = next
    }
    agent.episodes++
    env.dispose()
  }
  const report = await evaluate(`DQN cycle ${cycle}`, s => agent.act(s.observation))
  const score = Object.values(report).reduce((sum, r) => sum + r.successes + (r.original === 'success' ? 3 : 0), 0)
    + (report.contact.original === 'success' ? 24 : 0)
  if (score >= bestScore) {
    best = agent.save('Explorador · demostraciones + DQN')
    bestScore = score
    bestReport = report
    selectedPhase = `DQN cycle ${cycle}`
  }
}

await writeFile(new URL('../public/agents/explorer.json', import.meta.url), JSON.stringify(best))
await writeFile(new URL('../public/agents/evaluation.json', import.meta.url), JSON.stringify({
  method: 'Sensor-based demonstration warm start followed by Double DQN replay updates; selected by validation success.',
  selectedPhase, episodes: best.episodes, updates: best.updates, samples: sampleStates.length,
  validationSeeds: '9000–9007 (model selection)', results: bestReport,
}, null, 2))
console.log('Saved', selectedPhase, 'selection score:', bestScore)
agent.dispose()
