import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, BookOpen, Box, Check,
  ChevronRight, CircleHelp, Compass, Download, Flag, FlaskConical, Gauge, GitCompareArrows,
  Keyboard, Layers3, Maximize2, MoreHorizontal, Mountain, Orbit, Pause, Play, Radio,
  RotateCcw, Save, ScanLine, Settings2, Sparkles, Target, Upload, X,
} from 'lucide-react'
import { getMission, MISSIONS, validObstacle } from './sim/missions'
import { DEFAULT_SETTINGS, type Action, type Evaluation, type Mission, type MissionId, type Obstacle, type Vec3 } from './sim/types'
import type { Command, Event, Mode } from './learning/protocol'
import { validateAgent, type SavedAgent } from './learning/agent-format'
import Guide from './components/Guide'
import { DecisionPanel, LearningChart } from './components/Telemetry'

const World = lazy(() => import('./components/World'))
type StateEvent = Extract<Event, { type: 'state' }>
type Tab = 'missions' | 'lab' | 'guide'
const STORAGE_KEY = 'rumbo-lunar-agent-v1'
const MODES: { value: Mode; label: string }[] = [{ value: 'demo', label: 'Observar' }, { value: 'train', label: 'Entrenar' }, { value: 'manual', label: 'Conducir' }]
const OUTCOMES = { success: '¡Destino alcanzado!', collision: 'Contacto con un obstáculo', fall: 'Rover fuera de servicio', timeout: 'Tiempo del intento agotado' }

function CourseMap({ mission, active }: { mission: Mission; active: boolean }) {
  return <svg viewBox="0 0 94 72" className="course-map" aria-hidden="true">
    <path d="M9 19 47 4 85 23 84 52 44 68 9 48Z" fill={active ? '#e0e9d4' : '#e6e6df'} stroke={active ? '#b0c594' : '#d3d4cb'} />
    <path d="m22 44 17-6 6-12 26-3" fill="none" stroke={active ? '#709447' : '#a0a296'} strokeDasharray="3 3" strokeWidth="1.5" />
    {mission.rocks.slice(0, 5).map((r, i) => <path key={r.id} d="m-5 3 0-6 5-3 5 3-1 6-5 2Z" transform={`translate(${25 + (i % 3) * 19},${21 + Math.floor(i / 3) * 22})`} fill={i % 2 ? '#a0a498' : '#c1c5b6'} />)}
    <rect x="18" y="39" width="9" height="7" rx="2" fill="#3e4940" transform="rotate(-20 22 42)" />
    <path d="M72 24V12l8 3-8 4" fill="#89ae55" stroke="#668840" strokeWidth="1.2" />
  </svg>
}

export default function App() {
  const worker = useRef<Worker | null>(null)
  const [ready, setReady] = useState(false)
  const [data, setData] = useState<StateEvent | null>(null)
  const [mission, setMission] = useState(getMission('contact'))
  const [settings, setSettings] = useState({ ...DEFAULT_SETTINGS })
  const [tab, setTab] = useState<Tab>('missions')
  const [mode, setMode] = useState<Mode>('demo')
  const [speed, setSpeed] = useState(1)
  const [epsilon, setEpsilon] = useState(0.65)
  const [sensors, setSensors] = useState(true)
  const [topView, setTopView] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editKind, setEditKind] = useState<Obstacle['kind']>('rock')
  const [agentLabel, setAgentLabel] = useState('Sin entrenar')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [evaluation, setEvaluation] = useState<{ current: Evaluation; baseline: Evaluation } | null>(null)
  const [evalProgress, setEvalProgress] = useState<number | null>(null)
  const [showCompare, setShowCompare] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [path, setPath] = useState<Vec3[]>([])
  const importRef = useRef<HTMLInputElement>(null)
  const downloadNext = useRef(false)
  const stageRef = useRef<HTMLElement>(null)
  const pretrained = useRef<SavedAgent | null>(null)
  const agentSelected = useRef(false)
  const snapshot = data?.snapshot ?? null
  const running = data?.running ?? false
  const send = useCallback((command: Command) => worker.current?.postMessage(command), [])

  useEffect(() => {
    const sim = new Worker(new URL('./learning/worker.ts', import.meta.url), { type: 'module' })
    worker.current = sim
    sim.onmessage = (event: MessageEvent<Event>) => {
      switch (event.data.type) {
        case 'ready': setReady(true); break
        case 'state': setData(event.data); break
        case 'error': setError(event.data.message); setEvalProgress(null); break
        case 'evaluating': setEvalProgress(event.data.completed / event.data.total); break
        case 'evaluation': setEvaluation(event.data); setEvalProgress(null); break
        case 'saved': {
          const json = JSON.stringify(event.data.agent)
          try { localStorage.setItem(STORAGE_KEY, json); setSaved(true); setNotice('Agente guardado en este navegador.') }
          catch { setError('No se pudo guardar localmente. Usa «Exportar» para descargar tu agente.') }
          if (downloadNext.current) {
            const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
            const link = document.createElement('a')
            link.href = url
            link.download = 'rumbo-lunar-agente.json'
            link.click()
            setTimeout(() => URL.revokeObjectURL(url), 1000)
            downloadNext.current = false
          }
          break
        }
      }
    }
    sim.onerror = event => setError(`No se pudo iniciar el simulador: ${event.message}`)
    try { setSaved(Boolean(localStorage.getItem(STORAGE_KEY))) } catch { /* Storage can be unavailable in private browsing. */ }
    return () => { sim.terminate(); worker.current = null }
  }, [])

  useEffect(() => {
    if (!ready) return
    send({ type: 'configure', mission, settings })
    setPath([])
    setEvaluation(null)
    setEvalProgress(null)
  }, [ready, mission, settings, send])

  useEffect(() => {
    if (!ready) return
    const controller = new AbortController()
    fetch(`${import.meta.env.BASE_URL}agents/explorer.json`, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('El agente de ejemplo no está disponible. Puedes entrenar desde cero.'); return response.json() as Promise<unknown> })
      .then(value => {
        if (!validateAgent(value)) throw new Error('El agente de ejemplo no es compatible.')
        pretrained.current = value
        if (!agentSelected.current) {
          send({ type: 'load', agent: value })
          setAgentLabel('Explorador · entrenado')
        }
      }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'No se pudo cargar el ejemplo.') })
    return () => controller.abort()
  }, [ready, send])

  useEffect(() => {
    if (!snapshot) return
    setPath(previous => {
      if (snapshot.steps === 0) return []
      const last = previous.at(-1)
      if (last && Math.hypot(last[0] - snapshot.position[0], last[2] - snapshot.position[2]) < 0.12) return previous
      return [...previous.slice(-249), snapshot.position]
    })
  }, [snapshot])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 5000)
    return () => clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (!showCompare && !showAbout) return
    const previous = document.activeElement
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog?.querySelector<HTMLElement>('button')?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        send({ type: 'run', running: false, mode, speed, epsilon })
        setEvalProgress(null)
        setShowCompare(false)
        setShowAbout(false)
      }
      if (event.key !== 'Tab' || !dialog) return
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, select'))
      const first = controls[0]
      const last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    window.addEventListener('keydown', keydown)
    return () => {
      document.body.style.overflow = overflow
      window.removeEventListener('keydown', keydown)
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [showCompare, showAbout, send, mode, speed, epsilon])

  const run = useCallback((next: boolean, nextMode = mode, nextSpeed = speed) => {
    setMode(nextMode)
    setSpeed(nextSpeed)
    if (next) setEditing(false)
    if (next && nextMode === 'train') setAgentLabel('Mi agente · entrenando')
    send({ type: 'run', running: next, mode: nextMode, speed: nextSpeed, epsilon })
  }, [mode, speed, epsilon, send])

  useEffect(() => {
    if (mode !== 'manual' || !ready || showCompare || showAbout) return
    const keys: Record<string, Action> = { ArrowUp: 0, w: 0, ArrowLeft: 1, a: 1, ArrowRight: 2, d: 2, ' ': 3, ArrowDown: 4, s: 4 }
    const down = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return
      if (event.key === ' ' && event.target instanceof HTMLElement && event.target.closest('button, a')) return
      const action = keys[event.key]
      if (action === undefined) return
      event.preventDefault()
      send({ type: 'manual', action })
      if (!running) run(true, 'manual', 1)
    }
    const up = (event: KeyboardEvent) => { if (keys[event.key] !== undefined) send({ type: 'manual', action: 3 }) }
    const brake = () => send({ type: 'manual', action: 3 })
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', brake)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', brake) }
  }, [mode, ready, running, run, send, showCompare, showAbout])

  function selectMission(id: MissionId) {
    setMission(getMission(id))
    setEditing(false)
    setNotice('Misión cargada. La red se conserva; comienza un nuevo intento.')
  }
  function fresh() {
    agentSelected.current = true
    run(false, 'train')
    send({ type: 'reset', fresh: true })
    setAgentLabel('Mi agente · desde cero')
    setEvaluation(null)
    setNotice('Nueva red aleatoria. Tu agente guardado se conserva.')
  }
  function loadAgent(agent: SavedAgent, label: string) {
    agentSelected.current = true
    run(false)
    send({ type: 'load', agent })
    setAgentLabel(label)
    setEvaluation(null)
  }
  function restore() {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
      if (!validateAgent(value)) throw new Error('No hay un agente guardado compatible.')
      loadAgent(value, 'Mi agente · restaurado')
      setNotice('Agente restaurado. La memoria de experiencias empieza vacía.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo restaurar el agente.') }
  }
  async function importAgent(file?: File) {
    if (!file) return
    try {
      if (file.size > 2_000_000) throw new Error('El archivo es demasiado grande (máximo 2 MB).')
      const value: unknown = JSON.parse(await file.text())
      if (!validateAgent(value)) throw new Error('Archivo de agente inválido o incompatible.')
      loadAgent(value, 'Mi agente · importado')
      setNotice('Agente importado correctamente.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo importar el archivo.') }
    if (importRef.current) importRef.current.value = ''
  }
  function place(x: number, z: number) {
    if (mission.rocks.length >= 20) { setNotice('Máximo 20 obstáculos. Haz clic en uno para retirarlo.'); return }
    const obstacle: Obstacle = { id: Date.now(), x, z, radius: editKind === 'rock' ? 0.8 : 1.1, kind: editKind }
    if (!validObstacle(mission, obstacle)) { setNotice('Deja espacio alrededor del inicio, la meta y los demás obstáculos.'); return }
    setMission(previous => ({ ...previous, rocks: [...previous.rocks, obstacle] }))
  }
  function evaluate() {
    run(false)
    setEvaluation(null)
    setEvalProgress(0)
    send({ type: 'evaluate', episodes: 6 })
  }
  function closeCompare() {
    if (evalProgress !== null) send({ type: 'run', running: false, mode, speed, epsilon })
    setEvalProgress(null)
    setShowCompare(false)
  }
  const history = data?.history ?? []
  const completed = history.some(e => e.outcome === 'success')

  return <div className="app">
    <header className="site-header">
      <a className="brand" href="#inicio" onClick={() => setTab('missions')} aria-label="Rumbo Lunar, inicio"><span className="brand-icon"><Orbit size={25} strokeWidth={1.7} /></span><span>rumbo<span className="brand-light">lunar</span><small>UN LABORATORIO DE EXPLORACIÓN</small></span></a>
      <nav aria-label="Navegación principal">
        <button onClick={() => setTab('missions')} className={tab === 'missions' ? 'active' : ''}><Flag size={16} /> Misiones</button>
        <button onClick={() => setTab('lab')} className={tab === 'lab' ? 'active' : ''}><FlaskConical size={16} /> Laboratorio</button>
        <button onClick={() => setTab('guide')} className={tab === 'guide' ? 'active' : ''}><BookOpen size={16} /> Cómo aprende</button>
      </nav>
      <button className="header-about" onClick={() => setShowAbout(true)}><span className="live-dot" /> Todo ocurre en tu navegador <CircleHelp size={15} /></button>
    </header>

    <main id="inicio">
      <section className="intro">
        <div><div className="eyebrow"><span /> APRENDIZAJE POR REFUERZO · EN LA LUNA</div>
          <h1>{tab === 'lab' ? <>Cambia las reglas.<br /><span>Descubre qué aprende.</span></> : tab === 'guide' ? <>No sigue instrucciones.<br /><span>Aprende de la experiencia.</span></> : <>Un pequeño rover.<br /><span>Un gran aprendizaje.</span></>}</h1>
        </div>
        <div className="intro-aside"><p>Explorar. Equivocarse. Volver a intentarlo.<br />Acompaña a LUNA-01 mientras aprende<br className="desktop-break" /> a encontrar su camino.</p>
          <button className="text-link" onClick={() => setTab(tab === 'guide' ? 'missions' : 'guide')}>{tab === 'guide' ? 'Volver a las misiones' : '¿Primera vez? Empieza por la guía'} <ArrowUpRight size={17} /></button>
        </div>
      </section>

      {error && <div className="error-banner" role="alert"><span>{error}</span><button aria-label="Cerrar aviso" onClick={() => setError('')}><X size={17} /></button></div>}

      <div className="workspace">
        <div className="main-column">
          <section className={`simulation ${editing ? 'editing' : ''}`} ref={stageRef} aria-label="Simulador lunar">
            <div className="stage-top">
              <div className="stage-title"><span className="stage-indicator" /><div>MARE TRANQUILLITATIS<small>SECTOR {String(MISSIONS.findIndex(m => m.id === mission.id) + 1).padStart(2, '0')} <span> / </span> ZONA DE ENTRENAMIENTO</small></div></div>
              <div className="stage-tools">
                <button title="Mostrar sensores" aria-label="Mostrar sensores" aria-pressed={sensors} className={sensors ? 'active' : ''} onClick={() => setSensors(!sensors)}><ScanLine size={17} /><span>Sensores</span></button>
                <button title={topView ? 'Vista orbital' : 'Vista cenital'} aria-label={topView ? 'Vista orbital' : 'Vista cenital'} onClick={() => setTopView(!topView)}><Layers3 size={17} /></button>
                <button title="Pantalla completa" aria-label="Pantalla completa" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void stageRef.current?.requestFullscreen().catch(() => setNotice('Tu navegador no permite pantalla completa.')) }}><Maximize2 size={16} /></button>
              </div>
            </div>
            <div className="world-container"><Suspense fallback={<div className="scene-fallback">Preparando el paisaje lunar…</div>}><World mission={mission} snapshot={snapshot} sensors={sensors} topView={topView} editing={editing} onPlace={place} onRemove={id => setMission(previous => ({ ...previous, rocks: previous.rocks.filter(r => r.id !== id) }))} path={path} /></Suspense></div>
            {!ready && <div className="stage-loading"><Orbit size={20} /> Iniciando física y red neuronal…</div>}
            {snapshot?.done && <div className={`outcome-banner ${snapshot.outcome === 'success' ? 'success' : ''}`}><Flag size={17} /> {OUTCOMES[snapshot.outcome ?? 'timeout']} <span>{snapshot.totalReward.toFixed(1)} pts</span></div>}
            <div className="stage-bottom">
              <div className="rover-tag"><span className="rover-glyph"><Box size={19} /></span><div>LUNA-01<small><i /> {editing ? 'EDITANDO TERRENO' : running ? mode === 'train' ? 'APRENDIENDO' : 'EN MOVIMIENTO' : 'LISTO PARA EXPLORAR'}</small></div></div>
              <div className="stage-coordinate"><span>GRAVEDAD LUNAR</span><strong>1,62 <small>m/s²</small></strong></div>
            </div>
            <div className="scene-hint">{editing ? 'Clic en el suelo: añadir · Clic en un obstáculo: retirar' : <><MoreHorizontal size={15} /> Arrastra para orbitar · Desplaza para acercarte</>}</div>
          </section>

          <section className="control-bar" aria-label="Controles de simulación">
            <button className={`play-button ${running ? 'playing' : ''}`} disabled={!ready || evalProgress !== null} onClick={() => run(!running)}>{running ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}{running ? 'Pausar' : mode === 'train' ? 'Entrenar' : mode === 'manual' ? 'Conducir' : 'Iniciar misión'}</button>
            <button className="icon-button reset-button" title="Reiniciar intento; conserva la red" aria-label="Reiniciar intento" disabled={!ready} onClick={() => send({ type: 'reset', fresh: false })}><RotateCcw size={17} /></button>
            <div className="mode-switch" aria-label="Modo del simulador">{MODES.map(item => <button key={item.value} className={mode === item.value ? 'active' : ''} aria-pressed={mode === item.value} onClick={() => run(false, item.value, item.value === 'manual' ? 1 : speed)}>{item.label}</button>)}</div>
            <div className="speed-control"><Gauge size={15} /><select aria-label="Velocidad de simulación" value={speed} disabled={mode === 'manual'} onChange={event => run(running, mode, Number(event.target.value))}><option value={1}>1×</option><option value={10}>10×</option><option value={50}>50×</option></select></div>
          </section>
          {mode === 'manual' && <div className="manual-controls"><span><Keyboard size={16} /> Flechas o WASD · Espacio para frenar</span><div>{[{ a: 1, icon: ArrowLeft, label: 'Girar izquierda' }, { a: 0, icon: ArrowUp, label: 'Avanzar' }, { a: 4, icon: ArrowDown, label: 'Retroceder' }, { a: 2, icon: ArrowRight, label: 'Girar derecha' }].map(({ a, icon: Icon, label }) => <button key={a} aria-label={label} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); send({ type: 'manual', action: a as Action }); run(true, 'manual', 1) }} onPointerUp={() => send({ type: 'manual', action: 3 })} onPointerCancel={() => send({ type: 'manual', action: 3 })}><Icon size={18} /></button>)}</div></div>}

          <section className="telemetry-strip" aria-label="Telemetría en directo">
            <div><Compass size={16} /><span>Distancia a meta<strong>{snapshot?.distance.toFixed(1) ?? '—'} <small>m</small></strong></span></div>
            <div><Gauge size={16} /><span>Velocidad<strong>{snapshot?.speed.toFixed(2) ?? '—'} <small>m/s</small></strong></span></div>
            <div><Mountain size={16} /><span>Inclinación<strong>{snapshot?.tilt.toFixed(1) ?? '—'}<small>°</small></strong></span></div>
            <div><Radio size={16} /><span>Contacto<strong>{snapshot?.contact ?? '—'}<small> / 4 ruedas</small></strong></span></div>
          </section>

          {tab === 'lab' ? <section className="lab-editor">
            <div className="chart-heading"><div><div className="section-kicker"><Mountain size={15} /> TU TERRENO DE PRUEBAS</div><h3>Diseña el siguiente desafío.</h3></div><button className={`button ${editing ? 'dark' : 'secondary'}`} onClick={() => { run(false); setEditing(!editing); setTopView(!editing) }}>{editing ? <Check size={15} /> : <Settings2 size={15} />}{editing ? 'Terminar edición' : 'Editar terreno'}</button></div>
            <p>Coloca hasta 20 obstáculos. Mantén despejados el punto de partida y la meta.</p>
            <div className="editor-options"><button className={editKind === 'rock' ? 'selected' : ''} onClick={() => setEditKind('rock')}><Mountain size={17} /> Roca</button><button className={editKind === 'crater' ? 'selected' : ''} onClick={() => setEditKind('crater')}><Orbit size={17} /> Cráter</button><button onClick={() => setMission(getMission(mission.id))}><RotateCcw size={15} /> Restaurar terreno</button></div>
          </section> : <section className="missions-section">
            <div className="missions-heading"><span className="section-kicker">UNA MISIÓN, UN NUEVO APRENDIZAJE</span><span>01 — 03</span></div>
            <div className="mission-grid">{MISSIONS.map((m, i) => <button key={m.id} className={`mission-tile ${mission.id === m.id ? 'selected' : ''}`} onClick={() => selectMission(m.id)} aria-pressed={mission.id === m.id}>
              <CourseMap mission={m} active={mission.id === m.id} /><div><span className="mission-number">MISIÓN 0{i + 1} {mission.id === m.id && <i />}</span><strong>{m.name}</strong><small>{m.difficulty}</small></div><ChevronRight size={16} />
            </button>)}</div>
          </section>}
          <LearningChart history={history} episode={data?.episode ?? 0} epsilon={data?.epsilon ?? 0} loss={data?.loss ?? null} updates={data?.updates ?? 0} replay={data?.replay ?? 0} />
        </div>

        <aside className="sidebar">
          {tab === 'guide' ? <Guide /> : tab === 'lab' ? <section className="settings-card">
            <div className="section-kicker"><Settings2 size={15} /> AJUSTES DEL EXPERIMENTO</div><h2>¿Qué merece una recompensa?</h2><p>Los cambios reinician el intento y las métricas. La red se conserva.</p>
            {([{ key: 'successReward', label: 'Llegar y detenerse', min: 5, max: 60, step: 5, suffix: 'pts' }, { key: 'collisionPenalty', label: 'Coste de un accidente', min: 5, max: 40, step: 5, suffix: 'pts' }, { key: 'stepPenalty', label: 'Coste por paso', min: 0, max: 0.08, step: 0.005, suffix: 'pts' }, { key: 'friction', label: 'Coeficiente de tracción', min: 0.2, max: 1.4, step: 0.1, suffix: 'μ' }] as const).map(item => <label className="slider-field" key={item.key}><span>{item.label}<strong>{Number(settings[item.key].toFixed(3))} <small>{item.suffix}</small></strong></span><input type="range" min={item.min} max={item.max} step={item.step} value={settings[item.key]} onChange={event => setSettings(previous => ({ ...previous, [item.key]: Number(event.target.value) }))} /></label>)}
            <label className="slider-field"><span>Exploración inicial<strong>{Math.round(epsilon * 100)}%</strong></span><input type="range" min={0.05} max={1} step={0.05} value={epsilon} onChange={event => { run(false); setEpsilon(Number(event.target.value)) }} /></label>
            <div className="physics-note"><Mountain size={17} /><span>Gravedad fija: <b>1,62 m/s²</b><br />Deslizamiento actual: {Math.round((snapshot?.slip ?? 0) * 100)}%</span></div>
            <button className="text-link" onClick={() => { setSettings({ ...DEFAULT_SETTINGS }); setEpsilon(0.65) }}><RotateCcw size={14} /> Restaurar parámetros</button>
          </section> : <section className="mission-card">
            <div className="section-kicker"><Flag size={15} /> MISIÓN {String(MISSIONS.findIndex(m => m.id === mission.id) + 1).padStart(2, '0')}<span className="subtle-badge">{mission.difficulty}</span></div>
            <h2>{mission.name}</h2><p>{mission.description}</p>
            <div className="mission-objective"><span><Target size={20} /></span><div>Tu objetivo<strong>Llegar a la baliza y detenerse</strong><small>A menos de 1 m · Velocidad &lt; 0,5 m/s</small></div>{completed && <Check size={18} />}</div>
            <div className="reward-summary"><div><span className="reward-plus">+{settings.successReward}</span><small>Meta alcanzada</small></div><div><span>−{settings.collisionPenalty}</span><small>Accidente</small></div><div><span>−{settings.stepPenalty}</span><small>Por paso</small></div></div>
            <div className="tip"><Sparkles size={16} /><p>{mission.id === 'contact' ? 'En la Luna, frenar también se aprende. Llegar rápido no siempre es llegar bien.' : mission.id === 'rocks' ? 'La red solo conoce lo que captan sus sensores. Un rodeo puede ser una buena decisión.' : 'Menos gravedad significa menos agarre. Observa la velocidad antes de una pendiente.'}</p></div>
          </section>}

          <section className="agent-card">
            <div className="agent-heading"><span className="agent-avatar"><Box size={22} /></span><div><span>AGENTE ACTIVO</span><strong>{agentLabel}</strong></div><span className="live-dot" /></div>
            <div className="agent-buttons"><button className="button secondary" disabled={!ready} onClick={fresh}><Sparkles size={14} /> Desde cero</button><button className="button secondary" disabled={!ready} onClick={() => { downloadNext.current = false; send({ type: 'save', label: agentLabel }) }}><Save size={14} /> Guardar</button></div>
            <div className="agent-links"><button disabled={!pretrained.current || !ready} onClick={() => { if (pretrained.current) loadAgent(pretrained.current, 'Explorador · entrenado') }}>Cargar ejemplo</button><span>·</span><button disabled={!saved || !ready} onClick={restore}>Mi guardado</button></div>
            {tab === 'lab' && <div className="agent-buttons file-actions"><button disabled={!ready} onClick={() => { downloadNext.current = true; send({ type: 'save', label: agentLabel }) }}><Download size={13} /> Exportar</button><button disabled={!ready} onClick={() => importRef.current?.click()}><Upload size={13} /> Importar</button><input ref={importRef} type="file" accept=".json,application/json" hidden onChange={event => { void importAgent(event.target.files?.[0]) }} /></div>}
          </section>
          <DecisionPanel q={data?.q ?? []} snapshot={snapshot} />
          <button className="compare-link" disabled={!ready} onClick={() => { run(false); setShowCompare(true) }}><GitCompareArrows size={18} /><span>¿Está aprendiendo de verdad?<strong>Comparar agentes</strong></span><ArrowUpRight size={18} /></button>
        </aside>
      </div>
      <footer className="site-footer"><span><Orbit size={15} /> RUMBO LUNAR <i /> Aprender también es explorar.</span><button onClick={() => setShowAbout(true)}>Sobre este experimento <ArrowUpRight size={13} /></button><span>REACT · RAPIER · TENSORFLOW.JS</span></footer>
    </main>
    {notice && <div className="toast" role="status"><Check size={16} /> {notice}<button aria-label="Cerrar notificación" onClick={() => setNotice('')}><X size={14} /></button></div>}
    {showCompare && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) closeCompare() }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="compare-title"><button className="modal-close" aria-label="Cerrar comparación" onClick={closeCompare}><X size={19} /></button><div className="eyebrow"><GitCompareArrows size={16} /> EVALUACIÓN SIN EXPLORACIÓN</div><h2 id="compare-title">Aprender. Y comprobarlo.</h2><p>Compara la red actual con su referencia al cargarla o crearla. Cada agente realiza seis intentos en las mismas variaciones nuevas de esta misión, sin modificar sus pesos.</p>
      {evaluation ? <table className="evaluation-table"><thead><tr><th>Resultado</th><th>Referencia</th><th>Actual</th></tr></thead><tbody><tr><td>Éxitos</td><td>{evaluation.baseline.successes} / 6</td><td>{evaluation.current.successes} / 6</td></tr><tr><td>Accidentes</td><td>{evaluation.baseline.collisions}</td><td>{evaluation.current.collisions}</td></tr><tr><td>Recorrido medio</td><td>{evaluation.baseline.meanPath.toFixed(1)} m</td><td>{evaluation.current.meanPath.toFixed(1)} m</td></tr><tr><td>Recompensa media</td><td>{evaluation.baseline.meanReward.toFixed(1)}</td><td>{evaluation.current.meanReward.toFixed(1)}</td></tr></tbody></table> : <div className="evaluation-placeholder"><GitCompareArrows size={30} /><p>{evalProgress === null ? 'La evaluación usa terrenos distintos al entrenamiento.' : `Evaluando ambos agentes… ${Math.round(evalProgress * 100)}%`}</p>{evalProgress !== null && <progress value={evalProgress} max={1} />}</div>}
      <div className="modal-actions"><button className="button secondary" onClick={closeCompare}>{evalProgress === null ? 'Cerrar' : 'Cancelar'}</button><button className="button dark" disabled={evalProgress !== null} onClick={evaluate}><Play size={15} /> {evaluation ? 'Repetir evaluación' : 'Evaluar 12 recorridos'}</button></div><p className="small-note">Una muestra pequeña orienta, pero no demuestra una mejora general. Un recorrido corto puede significar una colisión temprana.</p>
    </section></div>}
    {showAbout && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) setShowAbout(false) }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="about-title"><button className="modal-close" aria-label="Cerrar información" onClick={() => setShowAbout(false)}><X size={19} /></button><div className="eyebrow"><Orbit size={16} /> UN EXPERIMENTO ABIERTO</div><h2 id="about-title">Pequeñas decisiones.<br />Un mundo por aprender.</h2><p>Rumbo Lunar conecta una simulación física con una red neuronal real. La escena 3D se dibuja con Three.js; Rapier calcula gravedad, suspensión y colisiones; TensorFlow.js ajusta la red mediante Double DQN.</p><p>La física es una aproximación educativa: cuatro apoyos con suspensión, fuerzas de tracción limitadas por contacto y un paso fijo de 1/60 s. No pretende simular un rover de misión real.</p><p>El agente Explorador usa demostraciones para arrancar y después actualizaciones DQN. Puedes inspeccionar el entrenamiento y las métricas en el repositorio. Un agente desde cero comienza con pesos aleatorios.</p><div className="about-facts"><span><Check size={15} /> Sin cuentas ni servidores</span><span><Check size={15} /> Entrenamiento local en un worker</span><span><Check size={15} /> Guardado local de pesos, sin memoria de experiencias</span></div><a className="button dark" href="https://github.com/Luissantra/moon-RL" target="_blank" rel="noreferrer">Explorar el código <ArrowUpRight size={16} /></a></section></div>}
    <button className="sr-only" onClick={() => { run(false); setEditing(false); setShowAbout(false); closeCompare() }}>Pausar y cerrar paneles</button>
  </div>
}
