import { Activity, ArrowUpRight, Network } from 'lucide-react'
import { ACTIONS, type Episode, type Snapshot } from '../sim/types'

export function DecisionPanel({ q, snapshot }: { q: number[]; snapshot: Snapshot | null }) {
  const min = Math.min(...q, 0)
  const max = Math.max(...q, 1)
  return <section className="decision-card">
    <div className="section-kicker"><Network size={15} /> DENTRO DE LA RED <span className="live-dot" /></div>
    <div className="network-diagram" aria-label="Red neuronal: 17 entradas, dos capas de 48 neuronas y 5 acciones">
      <svg viewBox="0 0 260 75" aria-hidden="true">
        {[0, 1, 2].flatMap(col => Array.from({ length: 5 }, (_, a) => Array.from({ length: 5 }, (_, b) =>
          <line key={`${col}-${a}-${b}`} x1={22 + col * 72} y1={9 + a * 14} x2={94 + col * 72} y2={9 + b * 14} stroke="#d6ded1" strokeWidth=".65" opacity=".65" />)))}
        {[0, 1, 2, 3].flatMap(col => Array.from({ length: 5 }, (_, row) =>
          <circle key={`${col}-${row}`} cx={22 + col * 72} cy={9 + row * 14} r={4}
            fill={col === 3 && row === snapshot?.action ? '#283b29' : col === 0 ? '#bedf97' : '#e8eddf'} stroke={col === 3 && row === snapshot?.action ? '#283b29' : '#adbea6'} />))}
      </svg>
      <div className="network-labels"><span>17 entradas</span><span>48</span><span>48</span><span>5 acciones</span></div>
    </div>
    <div className="action-bars">
      {ACTIONS.map((label, i) => <div key={label} className={`action-row ${snapshot?.action === i ? 'chosen' : ''}`}>
        <span>{label}</span><div className="bar-track"><i style={{ width: `${q.length ? 8 + (q[i] - min) / (max - min || 1) * 92 : 0}%` }} /></div>
        <span className="mono">{q[i]?.toFixed(2) ?? '—'}</span>
      </div>)}
    </div>
    <p className="small-note">Valores Q estimados · No son probabilidades.<br />Diagrama simplificado; acción ejecutada resaltada.</p>
  </section>
}

export function LearningChart({ history, episode, epsilon, loss, updates, replay }: {
  history: Episode[]; episode: number; epsilon: number; loss: number | null; updates: number; replay: number
}) {
  const window = history.slice(-45)
  const max = Math.max(30, ...window.map(h => h.reward))
  const min = Math.min(-15, ...window.map(h => h.reward))
  const y = (value: number) => 100 - (value - min) / (max - min) * 76
  const points = window.map((item, i) => `${35 + i / Math.max(1, window.length - 1) * 465},${y(item.reward)}`).join(' ')
  const successes = history.filter(h => h.outcome === 'success').length
  return <section className="learning-card">
    <div className="chart-heading"><div><div className="section-kicker"><Activity size={15} /> EL APRENDIZAJE, A LA VISTA</div><h3>Cada intento cuenta.</h3></div><span className="subtle-badge">Últimos {history.length} episodios</span></div>
    <div className="learning-content">
      <div className="reward-chart">
        <div className="chart-caption">Recompensa por episodio <span><i /> Agente actual</span></div>
        <svg viewBox="0 0 525 130" role="img" aria-label={history.length ? `Recompensas de ${history.length} episodios completados` : 'El gráfico se llenará al completar episodios'}>
          {[min, 0, max].map(n => <g key={n}><line x1="35" y1={y(n)} x2="510" y2={y(n)} stroke="#e3e5dc" strokeDasharray="3 4" /><text x="25" y={y(n) + 3} textAnchor="end" fill="#90988c" fontSize="9">{Math.round(n)}</text></g>)}
          {window.length > 0 && <><polygon points={`35,108 ${points} ${35 + (window.length > 1 ? 465 : 0)},108`} fill="#b4d88b" opacity=".14" /><polyline points={points} stroke="#6c9942" strokeWidth="2" strokeLinejoin="round" fill="none" />{window.map((h, i) => <circle key={h.episode} cx={35 + i / Math.max(1, window.length - 1) * 465} cy={y(h.reward)} r="2.5" fill={h.outcome === 'success' ? '#6c9942' : '#b4936f'} />)}</>}
          {!window.length && <text x="277" y="64" textAnchor="middle" fill="#8b9385" fontSize="11">Las primeras experiencias empiezan aquí.</text>}
          <text x="35" y="125" fontSize="9" fill="#92978d">EP. {window[0]?.episode ?? '0'}</text><text x="507" y="125" textAnchor="end" fontSize="9" fill="#92978d">EP. {episode}</text>
        </svg>
      </div>
      <div className="chart-stats">
        <div><span>Éxito reciente</span><strong>{history.length ? Math.round(successes / history.length * 100) : '—'}<small>%</small></strong></div>
        <div><span>Exploración ε</span><strong>{Math.round(epsilon * 100)}<small>%</small></strong></div>
        <div><span>Actualizaciones</span><strong>{updates.toLocaleString('es')}</strong></div>
      </div>
    </div>
    <div className="chart-footer"><span><ArrowUpRight size={13} /> Memoria: {replay.toLocaleString('es')} experiencias</span><span>Pérdida Huber: {loss === null ? '—' : loss.toFixed(4)}</span></div>
  </section>
}
