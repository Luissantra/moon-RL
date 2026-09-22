# Rumbo Lunar

Un laboratorio 3D en español para entender el aprendizaje por refuerzo conduciendo,
observando y entrenando un rover lunar. Pensado para personas que programan y
empiezan con RL.

## Arrancar

Requiere **Node.js 22.12 o posterior**, npm y un navegador con WebGL 2 y Web Workers.
No necesita cuentas, claves, base de datos ni backend.

```sh
npm ci
npm run dev
```

Vite muestra la dirección local. Para verificar y servir la versión de producción:

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run preview
```

`dist/` es una web estática. Los pesos incluidos permiten usarla sin ejecutar
el entrenamiento previo. Las fuentes de Google Fonts son opcionales y tienen
alternativas locales; los pesos y las experiencias permanecen en el navegador.

## Primera exploración

1. Abre **Cómo aprende**: seis pasos conectan los conceptos con los sensores,
   acciones y resultados de la escena. Cada paso tiene pseudocódigo opcional.
2. En **Misiones**, inicia **Observar** para ejecutar la red Explorador.
   No cambia sus pesos. Alterna sensores, cámara orbital y vista cenital.
3. Prueba **Conducir** con flechas/WASD o los botones. Espacio o soltar el
   control frena; la inercia hace que detenerse lleve tiempo.
4. Pulsa **Desde cero** y después **Entrenar** para aprender por recompensas
   con una red nueva. Pausa, reinicia el intento o usa 10×/50×.
5. En **Laboratorio**, coloca y retira rocas/cráteres, cambia recompensas,
   exploración y tracción. Cambiar el entorno vacía las experiencias y las
   métricas del experimento, pero conserva los pesos.
6. **Comparar agentes** ejecuta seis variantes por agente sin exploración
   ni entrenamiento. La referencia es una copia de la red al cargarla o
   crearla: antes de entrenar ambos resultados deben coincidir.
7. **Guardar / Mi guardado** conserva un agente en este navegador.
   **Exportar / Importar** intercambia sus pesos mediante JSON validado.

El guardado contiene arquitectura, pesos y contadores; no incluye el terreno,
el replay buffer ni el estado del optimizador. Solo hay una ranura de guardado
local. Exporta los experimentos que quieras conservar por separado.

### Misiones

| Misión | Qué pone a prueba |
| --- | --- |
| Primer contacto | Llegar a una baliza y detenerse a menos de 1 m y 0,5 m/s |
| Campo de rocas | Evitar rocas y bordes de cráteres |
| Regreso a la base | Navegar entre obstáculos y subir una ladera con tracción limitada |

## Cómo funciona, a alto nivel

El ciclo es **observar → actuar → recibir una recompensa → aprender**.
El rover desconoce el mapa completo. Una red estima qué recompensa futura
conseguirá con cada acción y elige una; a veces explora al azar. Las experiencias
se guardan para aprender de ellas varias veces, sin necesitar etiquetas humanas
en el modo **Desde cero**.

| Concepto | Implementación |
| --- | --- |
| Observación | 17 valores normalizados: 7 distancias; seno/coseno de dirección y distancia a meta; velocidad frontal/lateral y giro; inclinación frontal/lateral; contacto y deslizamiento |
| Acciones | Avanzar, izquierda, derecha, frenar y retroceder |
| Política | Red densa `17 → 48 ReLU → 48 ReLU → 5`; el máximo Q, salvo exploración |
| Recompensa | `1.5 × progreso − coste por paso`, más premio de éxito o penalización de accidente; timeout añade −3 |
| Episodio | Finaliza al llegar y parar, chocar, caer/volcar o consumir 550 acciones |
| Memoria | Replay buffer circular de 18.000 transiciones |
| Actualización | Double DQN, lotes de 48, Adam 0,0007, pérdida Huber, descuento 0,985 |
| Red objetivo | Copia de la red actual cada 120 actualizaciones |
| Exploración | `max(0.05, epsilon_inicial × exp(−pasos/18000))` |

Double DQN separa seleccionar una acción y valorar su resultado:

```text
siguiente_accion = argmax(red_actual(siguiente_estado))
objetivo = recompensa + 0.985 * red_objetivo(siguiente_estado)[siguiente_accion]
si terminal: objetivo = recompensa
minimizar Huber(objetivo, red_actual(estado)[accion_ejecutada])
```

Los valores Q no son probabilidades. Una recompensa mayor no garantiza una
política mejor: observa también éxitos, accidentes y distancia recorrida.
Un recorrido muy corto puede corresponder a una colisión temprana.

### El ejemplo Explorador

`public/agents/explorer.json` contiene pesos reales. El script
`scripts/train.ts` recoge demostraciones de navegación basadas exclusivamente
en sensores, precalienta la red y continúa con actualizaciones Double DQN.
La política heurística **solo genera datos de entrenamiento**; el navegador
elige acciones con la red, sin un controlador que las corrija.

```sh
npm run train      # Regenera pesos y el informe de selección
npm run evaluate   # Compara el ejemplo con una red aleatoria, sin entrenarlos
```

La selección usa variantes con semillas 9000–9007 y las misiones originales,
priorizando que la primera demostración se complete. El informe generado está
en `public/agents/evaluation.json`. La evaluación independiente usa 20000–20007;
el botón del navegador utiliza las primeras seis de esas variantes. No uses
estas evaluaciones reiteradamente para elegir pesos si necesitas una estimación
imparcial de generalización.

Las semillas de escenarios y la inicialización de la red son fijas; el
barajado de lotes de TensorFlow.js hace que regenerar el agente pueda cambiar
los resultados. El ejemplo es un punto de partida, no un navegador infalible.
Entrenar desde cero necesita muchos intentos y no garantiza convergencia.

## Arquitectura

```text
React UI ── comandos tipados ──▶ Web Worker
   │                            ├─ Rapier: entorno, suspensión, sensores
   │                            └─ TensorFlow.js CPU: red, replay, DQN
   ◀── snapshots y métricas ────┘
   └─ React Three Fiber / Three.js: representación low-poly
```

- `src/sim/`: física, observaciones, recompensas y geometría de misiones.
- `src/learning/dqn.ts`: inferencia, replay, actualización y pesos.
- `src/learning/worker.ts`: reloj fijo, modos, evaluación cancelable y mensajes.
- `src/learning/agent-format.ts`: validación de pesos sin cargar TensorFlow
  en el hilo principal.
- `src/components/`: escena, guía y paneles de telemetría.
- `scripts/`: generación y evaluación del agente incluido.

La física avanza siempre a **1/60 s**, con ocho subpasos por decisión.
La aceleración cambia cuántas decisiones se procesan, no las reglas físicas.
El worker limita el tiempo de cada lote y cede el control durante la evaluación.
50× es un máximo solicitado; la velocidad real depende de la CPU.

### Aproximación física

Gravedad de 1,62 m/s², cuerpo rígido, cuatro apoyos de suspensión por raycast
y fuerzas longitudinales/laterales limitadas por contacto y fricción.
El terreno tiene pendientes y depresiones reales. Volúmenes sensoriales
virtuales hacen detectables los bordes de los cráteres sin soportar las ruedas.
Los módulos y los pequeños detalles decorativos no tienen colisiones.

No modela suelo granular, neumáticos deformables ni un vehículo espacial real.
El contacto con una roca termina el episodio; el sensor de inclinación y los
límites del terreno también pueden dar por finalizado el intento.

## Verificación

Vitest comprueba suspensión, frenado, fricción, sensores de cráteres, colisiones,
terreno reproducible, aprendizaje de recompensas terminales, validación y
restauración de pesos, límites del replay y estabilidad del número de tensores.
GitHub Actions ejecuta tipos, ESLint, tests y build en cada PR.

Rapier 0.19.3 puede emitir un aviso de parámetros de inicialización obsoletos
desde su propio wrapper WASM. El backend CPU de TensorFlow.js recomienda su
adaptador nativo al usar Node; este proyecto mantiene el mismo backend portable
que usa el worker del navegador.
