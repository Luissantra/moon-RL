import { ArrowLeft, ArrowRight, BookOpen, Braces, Lightbulb } from 'lucide-react'
import { useState } from 'react'

const LESSONS = [
  {
    title: 'El mundo no viene con instrucciones.',
    concept: '01 / AGENTE Y ENTORNO',
    body: 'LUNA-01 es el agente. La superficie lunar, la gravedad y los obstáculos forman su entorno. Cada intento empieza en el módulo y termina al llegar, sufrir un accidente o agotar el tiempo. A ese intento lo llamamos episodio.',
    try: 'Selecciona «Conducir» y prueba las flechas. Al soltar el control frenas, pero la inercia no desaparece al instante.',
    code: 'observación = entorno.reiniciar()\nwhile not terminado:\n    acción = agente.decidir(observación)\n    observación = entorno.paso(acción)',
  },
  {
    title: 'Ver es convertir el mundo en números.',
    concept: '02 / OBSERVACIÓN',
    body: 'El robot no recibe la imagen 3D. Recibe 17 valores: siete distancias de sensores, la dirección y distancia de la meta, velocidades, inclinación, contacto con el suelo y deslizamiento. Es una visión local: no conoce todo el mapa.',
    try: 'Activa los sensores. Un rayo más corto significa que algo está más cerca. Los sensores también detectan pendientes pronunciadas.',
    code: 'estado = [\n  sensores[0:7], sin(ángulo), cos(ángulo), distancia,\n  velocidad_frontal, velocidad_lateral, giro,\n  inclinación_frontal, inclinación_lateral,\n  contacto, deslizamiento\n]',
  },
  {
    title: 'Cinco acciones. Muchas consecuencias.',
    concept: '03 / POLÍTICA Y RED NEURONAL',
    body: 'La red transforma esos 17 valores en cinco estimaciones Q, una por acción. Q estima la recompensa futura acumulada con descuento. La política suele elegir el valor más alto. Estos valores no son probabilidades ni garantías de éxito.',
    try: 'Observa las barras de decisión mientras el rover se mueve. La acción resaltada es la ejecutada; puede diferir del máximo cuando explora.',
    code: 'Q = red(estado)  # 17 → 48 → 48 → 5\nacción = argmax(Q)\n# avanzar, izquierda, derecha, frenar, retroceder',
  },
  {
    title: 'La recompensa define lo que importa.',
    concept: '04 / RECOMPENSA',
    body: 'Llegar y detenerse da una recompensa positiva. Chocar, caer o volcar resta puntos. Cada paso tiene un pequeño coste y acercarse a la meta aporta una señal de progreso. Una recompensa mal diseñada puede enseñar un comportamiento que no queríamos.',
    try: 'En el laboratorio cambia el coste de un accidente. Compara éxitos, accidentes y longitud del recorrido, además de la recompensa.',
    code: 'recompensa = 1.5 * (distancia_anterior - distancia)\nrecompensa -= coste_por_paso\nif llegada_y_parado: recompensa += premio\nif accidente: recompensa -= penalización',
  },
  {
    title: 'Para aprender, a veces hay que equivocarse.',
    concept: '05 / EXPLORACIÓN Y DQN',
    body: 'Con probabilidad ε el agente prueba una acción aleatoria. Guarda cada experiencia y entrena con pequeños lotes de recuerdos. Double DQN usa la red actual para elegir la siguiente acción y una red objetivo más estable para valorarla.',
    try: 'Pulsa «Desde cero» y después «Entrenar». Verás las primeras decisiones al azar. Acelera la simulación y observa cómo baja la exploración.',
    code: 'acción = aleatoria() if random() < ε else argmax(red(s))\nmemoria.guardar(s, acción, recompensa, siguiente, terminal)\na = argmax(red(siguiente))\nobjetivo = recompensa + 0.985 * Q_objetivo(siguiente, a)\n# En un estado terminal: objetivo = recompensa\nactualizar_red(lote_de_memoria, objetivo)',
  },
  {
    title: 'Aprender una ruta no es aprender a navegar.',
    concept: '06 / EVALUACIÓN Y GENERALIZACIÓN',
    body: 'En una evaluación no hay exploración ni cambios en la red. Probamos el agente y su referencia inicial en las mismas variaciones nuevas del terreno. Que funcione bien aquí no garantiza que resuelva cualquier escenario.',
    try: 'Abre «Comparar agentes». Las pruebas usan posiciones distintas a las del entrenamiento y muestran resultados reales, incluso cuando falla.',
    code: 'for terreno in escenarios_nuevos:\n    resultado = evaluar(agente, ε=0, entrenar=False)\n    medir(éxito, accidentes, recorrido, recompensa)\ncomparar_con_referencia_inicial()',
  },
]

export default function Guide() {
  const [step, setStep] = useState(0)
  const [code, setCode] = useState(false)
  const lesson = LESSONS[step]
  return <section className="guide-card">
    <div className="section-kicker"><BookOpen size={15} /> BITÁCORA DE APRENDIZAJE <span>{step + 1} / 6</span></div>
    <div className="lesson-dots" aria-label="Pasos de la guía">
      {LESSONS.map((item, i) => <button key={item.concept} onClick={() => setStep(i)} className={step === i ? 'active' : ''} aria-label={item.concept} aria-current={step === i ? 'step' : undefined} />)}
    </div>
    <p className="eyebrow">{lesson.concept}</p>
    <h2>{lesson.title}</h2>
    <p className="guide-body">{lesson.body}</p>
    <div className="try-box"><Lightbulb size={18} /><p>{lesson.try}</p></div>
    <button className="code-toggle" onClick={() => setCode(!code)} aria-expanded={code}><Braces size={16} /> {code ? 'Ocultar pseudocódigo' : 'Ver pseudocódigo'}</button>
    {code && <pre className="pseudocode"><code>{lesson.code}</code></pre>}
    <div className="guide-navigation">
      <button className="button secondary" onClick={() => setStep(step - 1)} disabled={step === 0}><ArrowLeft size={15} /> Anterior</button>
      <button className="button dark" onClick={() => setStep(step + 1)} disabled={step === 5}>Siguiente <ArrowRight size={15} /></button>
    </div>
    <p className="guide-footnote">El ejemplo «Explorador» parte de demostraciones y se ajusta con DQN. «Desde cero» aprende únicamente mediante recompensas.</p>
  </section>
}
