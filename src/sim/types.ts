export type MissionId = 'contact' | 'rocks' | 'base'
export type Action = 0 | 1 | 2 | 3 | 4
export const ACTIONS = ['Avanzar', 'Girar izquierda', 'Girar derecha', 'Frenar', 'Retroceder'] as const
export const INPUT_SIZE = 17
export const ACTION_COUNT = ACTIONS.length
export const DT = 1 / 60
export const SUBSTEPS = 8
export const SENSOR_ANGLES = [-1.45, -1, -0.5, 0, 0.5, 1, 1.45]
export const SENSOR_RANGE = 7
export const MOON_GRAVITY = 1.62
export type Vec3 = [number, number, number]
export type Quat = [number, number, number, number]

export interface Obstacle {
  id: number
  x: number
  z: number
  radius: number
  kind: 'rock' | 'crater'
}
export interface Mission {
  id: MissionId
  name: string
  subtitle: string
  description: string
  difficulty: string
  start: [number, number]
  goal: [number, number]
  rocks: Obstacle[]
  hills: boolean
}
export interface Settings {
  friction: number
  successReward: number
  collisionPenalty: number
  stepPenalty: number
}
export const DEFAULT_SETTINGS: Settings = {
  friction: 0.9,
  successReward: 30,
  collisionPenalty: 15,
  stepPenalty: 0.015,
}
export interface Sensor {
  start: Vec3
  end: Vec3
  distance: number
}
export type Outcome = 'success' | 'collision' | 'fall' | 'timeout'
export interface Snapshot {
  position: Vec3
  rotation: Quat
  sensors: Sensor[]
  speed: number
  tilt: number
  contact: number
  slip: number
  distance: number
  observation: number[]
  action: Action
  reward: number
  totalReward: number
  path: number
  steps: number
  done: boolean
  outcome?: Outcome
}
export interface Episode {
  episode: number
  reward: number
  outcome: Outcome
  steps: number
  path: number
}
export interface Evaluation {
  label: string
  episodes: number
  successes: number
  collisions: number
  meanPath: number
  meanReward: number
}
