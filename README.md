# PHYSICS_SIM v2.6 — Detecção de Colisão 3D & Análise Assintótica

Ferramenta de demonstração empírica e telemetria em tempo real para algoritmos de *Broad-Phase* em física 3D. Compara a eficiência de Força Bruta $O(n^2)$, Grade Espacial Uniforme $O(n)$ e Octree 3D $O(n \log n)$ através de medição por frame com `performance.now()` e renderização de curvas assintóticas comparativas.

Construído em JavaScript vanilla (ES6+) com Three.js r128, sem *build* step nem dependências externas além de CDN.

---

## Arquitetura & Algoritmos

### Fase Estreita (Narrow-Phase)

Intersecção **AABB** (*Axis-Aligned Bounding Box*) testando sobreposição nos eixos X, Y e Z entre pares de objetos.

### Estratégias Broad-Phase

| Estratégia | Complexidade | Abordagem |
|---|---|---|
| Força Bruta | $O(n^2)$ | Verificação par-a-par total via combinação $\frac{N(N-1)}{2}$ |
| Grade Espacial | $O(n)$ | Mapeamento e hashing de células 3D fixas com consulta de vizinhança |
| Octree | $O(n \log n)$ | Subdivisão recursiva de 8 octantes com retenção em nós pai para evitar *straddling* |

---

## Recursos da Interface

**Design System**
- Painel *Bento Grid* com layout estilo *developer tool* / IDE (superfícies matte escuras, tipografia monospace Fira Code, variáveis CSS por modo de algoritmo).

**Telemetria em Tempo Real**
- Canvas 2D renderizando curvas assintóticas teóricas vs. medições empíricas instantâneas.
- Cabeçalho com contador de objetos, colisões, modo ativo e métrica de economia dinâmica.
- Painel lateral de telemetria: N, algoritmo, comparações, tempo médio em ms.

**Controles Inteligentes**
- Bloqueio dinâmico dos sliders de parâmetros espaciais (Tamanho de Célula e Profundidade da Octree) conforme a estratégia selecionada. Ambos bloqueados em Força Bruta.
- Badge de economia no cabeçalho: exibe a porcentagem de testes de colisão evitados; estado neutro/cinza desativado em Força Bruta.

**Notificações (Toast HUD)**
- Feedback em tempo real para pausa/retomada, ativação/desativação da física real e troca de algoritmo.

**Benchmark & Exportação**
- Widget com cálculo de média aparada (20 execuções, descarte de 15% de ruído de GC).
- Exportação do histórico de telemetria da sessão para CSV.

**Modos de Operação**
- **Modo Apresentação:** câmera orbital automática com HUD limpo.
- **Stress Test:** suporte a até 150 objetos simultâneos com efeitos visuais de sobrecarga.

**Outros Recursos**
- Arrastar e largar cubos na cena 3D.
- Toggle wireframe, grade 3D opcional, física real ligada/desligada.
- Modal de teoria com seis blocos explicativos.
- Terminal de pseudocódigo com efeito de digitação ao trocar de estratégia.
- Landing page animada.

---

## Estrutura do Projeto

```
3d-physics-complexity-main/
├── app.py                  # Servidor Flask (renderiza templates/index.html)
├── README.md               # Este arquivo
├── screenshot.png          # Captura da interface
├── flask.log               # Log do servidor
├── templates/
│   └── index.html          # HTML: landing page, top bar, painel bento, gráfico, modais, overlays
└── static/
    ├── css/
    │   ├── style.css       # Variáveis CSS, reset, layout global, tipografia, componentes
    │   ├── layout.css      # Layout da landing page e elementos decorativos
    │   └── components.css  # Componentes específicos: economy-badge, toast, stress, bento
    └── js/
        ├── main.js         # Orquestrador de módulos ES (importa three-setup, physics, ui)
        ├── three-setup.js  # Cena Three.js, câmera, renderer, pós-processamento (dithering Bayer 4×4)
        ├── physics.js      # Estado da simulação, AABB, SpatialGrid, Octree, detecção de colisões
        └── ui.js           # UI, eventos, animação, toast notifications, landing page
```

---

## Como Executar

### Via Flask (recomendado)

```bash
# Instalar dependência
pip install flask

# Executar servidor
python app.py

# Acessar
http://localhost:5000
```

### Arquivos estáticos diretos

Não há etapa de *build*. Todas as dependências carregam via CDN.

```bash
# Abrir diretamente no navegador
open templates/index.html
```

> **Nota:** o contexto de áudio dos navegadores modernos requer interação do usuário. Clique em "Iniciar Simulação" na landing page para ativar o *AudioContext*.

---

## Atalhos de Teclado

| Tecla | Ação |
|---|---|
| `Espaço` | Pausar / Retomar simulação |
| `R` | Reiniciar simulação (8 cubos, velocidade padrão) |
| `S` | Ativar / Desativar Stress Test (150 objetos) |
| `W` | Alternar modo Wireframe |
| `P` | Entrar / Sair do Modo Apresentação |
| `Esc` | Sair do Modo Apresentação |

---

## Tecnologias

| Recurso | Versão / Fonte |
|---|---|
| [Three.js](https://threejs.org/) | r128 (CDN cdnjs) |
| OrbitControls | r128 (CDN jsdelivr) |
| EffectComposer + ShaderPass | r128 (CDN jsdelivr) — pós-processamento dithering Bayer 4×4 |
| Fira Code | Google Fonts — monospace para terminal e UI técnica |
| Inter | Google Fonts — tipografia geral da interface |
| JavaScript | Vanilla ES6+, módulos ES, sem framework ou bundler |
| Flask | Servidor de template para `templates/index.html` |

---

## Autor

Kaíque Nunes

Trabalho Acadêmico — Física 3D / Análise de Algoritmos