import type { SavedAgent } from './dqn'
import type { Action, Episode, Evaluation, Mission, Settings, Snapshot } from '../sim/types'

export type Mode = 'demo' | 'train' | 'manual'
export type Command =
  | { type: 'configure'; mission: Mission; settings: Settings }
  | { type: 'run'; running: boolean; mode: Mode; speed: number; epsilon: number }
  | { type: 'manual'; action: Action }
  | { type: 'reset'; fresh: boolean }
  | { type: 'load'; agent: SavedAgent }
  | { type: 'save'; label: string }
  | { type: 'evaluate'; episodes: number }

export type Event =
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'saved'; agent: SavedAgent }
  | { type: 'evaluation'; current: Evaluation; baseline: Evaluation }
  | { type: 'evaluating'; completed: number; total: number }
  | {
    type: 'state'; snapshot: Snapshot; episode: number; history: Episode[]; q: number[];
    epsilon: number; loss: number | null; updates: number; replay: number; running: boolean;
  }
