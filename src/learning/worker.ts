import * as tf from '@tensorflow/tfjs'
import { DQN } from './dqn'
import type { Command, Event, Mode } from './protocol'
import { initPhysics, LunarEnvironment } from '../sim/environment'
import { getMission, varyMission } from '../sim/missions'
import { DEFAULT_SETTINGS, type Action, type Episode, type Evaluation } from '../sim/types'

const emit = (event: Event) => postMessage(event)
const yieldTask = () => new Promise<void>(resolve => setTimeout(resolve, 0))
await initPhysics()
await tf.setBackend('cpu')
await tf.ready()

let mission = getMission('contact')
let settings = { ...DEFAULT_SETTINGS }
let env = new LunarEnvironment(mission, settings)
let agent = new DQN()
let baseline = new DQN(7)
let snapshot = env.snapshot()
let history: Episode[] = []
let q = agent.values(snapshot.observation)
let running = false
let mode: Mode = 'demo'
let speed = 1
let epsilon = 0.65
let episode = 0
let action: Action = 3
let loss: number | null = null
let runSteps = 0
let budget = 0
let lastTime = performance.now()
let lastEmit = 0
let holdUntil = 0
let version = 0
let evaluating = false

function state() {
  emit({ type: 'state', snapshot, episode, history, q, epsilon: mode === 'train' ? exploration() : 0,
    loss, updates: agent.updates, replay: agent.replay.size, running })
}
function exploration() {
  return Math.max(0.05, epsilon * Math.exp(-runSteps / 18000))
}
function resetWorld() {
  env.dispose()
  env = new LunarEnvironment(mission, settings, 42 + episode, mode === 'train')
  snapshot = env.snapshot()
  q = agent.values(snapshot.observation)
  holdUntil = 0
  budget = 0
}

async function evaluate(count: number, token: number) {
  evaluating = true
  running = false
  state()
  const results: Evaluation[] = []
  try {
    for (const [index, model] of [agent, baseline].entries()) {
      const result: Evaluation = { label: index ? 'Referencia inicial' : 'Agente actual', episodes: count, successes: 0, collisions: 0, meanPath: 0, meanReward: 0 }
      for (let trial = 0; trial < count; trial++) {
        if (version !== token) return
        const test = new LunarEnvironment(varyMission(mission, 20000 + trial), settings, 18000 + trial)
        try {
          let current = test.snapshot()
          while (!current.done) {
            current = test.step(model.act(current.observation))
            if (current.steps % 25 === 0) {
              await yieldTask()
              if (version !== token) return
            }
          }
          result.successes += Number(current.outcome === 'success')
          result.collisions += Number(current.outcome === 'collision' || current.outcome === 'fall')
          result.meanPath += current.path / count
          result.meanReward += current.totalReward / count
        } finally { test.dispose() }
        emit({ type: 'evaluating', completed: index * count + trial + 1, total: count * 2 })
        await yieldTask()
      }
      results.push(result)
    }
    if (version === token) emit({ type: 'evaluation', current: results[0], baseline: results[1] })
  } finally {
    if (version === token) { evaluating = false; state() }
  }
}

self.onmessage = (event: MessageEvent<Command>) => {
  const command = event.data
  try {
    if (evaluating && command.type !== 'evaluate') { version++; evaluating = false }
    switch (command.type) {
      case 'configure':
        version++
        mission = command.mission
        settings = command.settings
        running = false
        episode = 0
        history = []
        agent.replay.clear()
        runSteps = 0
        loss = null
        resetWorld()
        break
      case 'run':
        mode = command.mode
        running = command.running
        speed = command.speed
        epsilon = command.epsilon
        budget = 0
        break
      case 'manual': action = command.action; break
      case 'reset':
        version++
        running = false
        episode = 0
        history = []
        runSteps = 0
        loss = null
        if (command.fresh) {
          agent.dispose()
          agent = new DQN()
          baseline.dispose()
          baseline = new DQN()
        }
        resetWorld()
        break
      case 'load':
        running = false
        agent.dispose()
        agent = new DQN()
        agent.load(command.agent)
        baseline.dispose()
        baseline = new DQN()
        baseline.load(command.agent)
        episode = 0
        history = []
        runSteps = 0
        loss = null
        resetWorld()
        break
      case 'save': emit({ type: 'saved', agent: agent.save(command.label) }); break
      case 'evaluate':
        version++
        void evaluate(Math.min(20, Math.max(1, command.episodes)), version).catch(error => {
          emit({ type: 'error', message: error instanceof Error ? error.message : 'Error al evaluar.' })
        })
        break
    }
    state()
  } catch (error) {
    running = false
    emit({ type: 'error', message: error instanceof Error ? error.message : 'Error en el simulador.' })
  }
}

setInterval(() => {
  const now = performance.now()
  const elapsed = Math.min(250, now - lastTime)
  lastTime = now
  if (!running || evaluating || now < holdUntil) return
  budget = Math.min(80, budget + elapsed / (1000 * 8 / 60) * speed)
  const deadline = now + 22
  try {
    while (budget >= 1 && performance.now() < deadline && running) {
      budget--
      if (snapshot.done) {
        if (mode === 'manual') { running = false; break }
        resetWorld()
      }
      const previous = snapshot.observation
      q = agent.values(previous)
      const chosen = mode === 'manual' ? action : agent.act(previous, mode === 'train' ? exploration() : 0)
      snapshot = env.step(chosen)
      if (mode === 'train') {
        agent.replay.add({ state: previous, action: chosen, reward: snapshot.reward, next: snapshot.observation, done: snapshot.done })
        runSteps++
        if (runSteps % 4 === 0) loss = agent.train()
      }
      if (snapshot.done) {
        episode++
        if (mode === 'train') agent.episodes++
        history = [...history.slice(-149), { episode, reward: snapshot.totalReward, outcome: snapshot.outcome ?? 'timeout', steps: snapshot.steps, path: snapshot.path }]
        if (mode !== 'train') { holdUntil = performance.now() + 1600; break }
      }
    }
    if (now - lastEmit > 70 || snapshot.done) { state(); lastEmit = now }
  } catch (error) {
    running = false
    emit({ type: 'error', message: error instanceof Error ? error.message : 'Error en el entrenamiento.' })
  }
}, 16)
emit({ type: 'ready' })
state()
