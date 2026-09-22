export interface SavedAgent {
  version: 1
  architecture: '17-48-48-5'
  updates: number
  episodes: number
  label: string
  weights: { shape: number[]; values: number[] }[]
}

export function validateAgent(value: unknown): value is SavedAgent {
  if (typeof value !== 'object' || value === null) return false
  const agent = value as Partial<SavedAgent>
  const shapes = [[17, 48], [48], [48, 48], [48], [48, 5], [5]]
  return agent.version === 1 && agent.architecture === '17-48-48-5'
    && typeof agent.label === 'string' && agent.label.length <= 200
    && Number.isSafeInteger(agent.updates) && (agent.updates ?? -1) >= 0
    && Number.isSafeInteger(agent.episodes) && (agent.episodes ?? -1) >= 0
    && Array.isArray(agent.weights) && agent.weights.length === shapes.length
    && agent.weights.every((weight, i) => weight !== null && typeof weight === 'object'
      && Array.isArray(weight.shape) && JSON.stringify(weight.shape) === JSON.stringify(shapes[i])
      && Array.isArray(weight.values) && weight.values.length === shapes[i].reduce((a, b) => a * b, 1)
      && weight.values.every((n: unknown) => typeof n === 'number' && Number.isFinite(n)))
}
