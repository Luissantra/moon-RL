import * as tf from '@tensorflow/tfjs'
import { ACTION_COUNT, INPUT_SIZE, type Action } from '../sim/types'
import { seededRandom } from '../sim/missions'
import { validateAgent, type SavedAgent } from './agent-format'

export { validateAgent, type SavedAgent } from './agent-format'

export interface Transition {
  state: number[]
  action: Action
  reward: number
  next: number[]
  done: boolean
}
export class ReplayBuffer {
  private items: Transition[] = []
  private cursor = 0
  constructor(private capacity = 18000) {}
  get size() { return this.items.length }
  clear() { this.items = []; this.cursor = 0 }
  add(transition: Transition) {
    this.items[this.cursor] = transition
    this.cursor = (this.cursor + 1) % this.capacity
  }
  sample(count: number, random: () => number): Transition[] {
    if (!this.size) return []
    return Array.from({ length: count }, () => this.items[Math.floor(random() * this.size)])
  }
}

function network(seed: number) {
  const model = tf.sequential()
  model.add(tf.layers.dense({ inputShape: [INPUT_SIZE], units: 48, activation: 'relu', kernelInitializer: tf.initializers.glorotUniform({ seed }) }))
  model.add(tf.layers.dense({ units: 48, activation: 'relu', kernelInitializer: tf.initializers.glorotUniform({ seed: seed + 1 }) }))
  model.add(tf.layers.dense({ units: ACTION_COUNT, kernelInitializer: tf.initializers.glorotUniform({ seed: seed + 2 }) }))
  return model
}

export class DQN {
  readonly online: tf.Sequential
  readonly target: tf.Sequential
  readonly replay = new ReplayBuffer()
  private optimizer = tf.train.adam(0.0007)
  private random: () => number
  updates = 0
  episodes = 0

  constructor(seed = 42) {
    this.random = seededRandom(seed)
    this.online = network(seed)
    this.target = network(seed + 10)
    this.sync()
  }

  values(state: number[]): number[] {
    return tf.tidy(() => {
      const result = this.online.predict(tf.tensor2d([state])) as tf.Tensor2D
      return Array.from(result.dataSync())
    })
  }

  act(state: number[], epsilon = 0): Action {
    if (this.random() < epsilon) return Math.floor(this.random() * ACTION_COUNT) as Action
    const values = this.values(state)
    return values.indexOf(Math.max(...values)) as Action
  }

  train(batchSize = 48): number | null {
    if (this.replay.size < batchSize) return null
    const batch = this.replay.sample(batchSize, this.random)
    const loss = tf.tidy(() => {
      const states = tf.tensor2d(batch.map(t => t.state))
      const next = tf.tensor2d(batch.map(t => t.next))
      const rewards = tf.tensor1d(batch.map(t => t.reward))
      const alive = tf.tensor1d(batch.map(t => t.done ? 0 : 1))
      const nextActions = (this.online.predict(next) as tf.Tensor2D).argMax(1)
      const nextValues = (this.target.predict(next) as tf.Tensor2D).mul(tf.oneHot(nextActions, ACTION_COUNT)).sum(1)
      const targets = rewards.add(nextValues.mul(alive).mul(0.985))
      const mask = tf.oneHot(tf.tensor1d(batch.map(t => t.action), 'int32'), ACTION_COUNT)
      const cost = this.optimizer.minimize(() => {
        const values = (this.online.apply(states) as tf.Tensor2D).mul(mask).sum(1)
        return tf.losses.huberLoss(targets, values) as tf.Scalar
      }, true)
      return cost?.dataSync()[0] ?? 0
    })
    this.updates++
    if (this.updates % 120 === 0) this.sync()
    return loss
  }

  sync() { this.target.setWeights(this.online.getWeights()) }

  save(label: string): SavedAgent {
    return {
      version: 1, architecture: '17-48-48-5', updates: this.updates, episodes: this.episodes, label,
      weights: this.online.getWeights().map(t => ({ shape: [...t.shape], values: Array.from(t.dataSync()) })),
    }
  }

  load(data: SavedAgent) {
    if (!validateAgent(data)) throw new Error('El archivo no contiene un agente compatible.')
    const tensors = data.weights.map(w => tf.tensor(w.values, w.shape))
    try {
      this.online.setWeights(tensors)
      this.sync()
      this.updates = data.updates
      this.episodes = data.episodes
    } finally {
      tf.dispose(tensors)
    }
  }

  dispose() {
    this.online.dispose()
    this.target.dispose()
    this.optimizer.dispose()
  }
}
