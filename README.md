# PHYSICS_SIM v2.6 — Detecção de Colisão 3D & Análise Assintótica

Ferramenta de demonstração empírica e telemetria em tempo real para algoritmos de *Broad-Phase* em física 3D. Compara a eficiência de Força Bruta $O(n^2)$, Grade Espacial Uniforme $O(n)$, Octree 3D $O(n \log n)$ e Sweep and Prune $O(n + k)$ através de medição por frame com `performance.now()` e renderização de curvas assintóticas comparativas.


Construído em JavaScript vanilla (ES6+) com Three.js r170 (módulos ES via import map), sem bundler e sem dependências de front-end além de CDN. É servido por um pequeno servidor Flask, que renderiza o template e os arquivos estáticos.

---

## Arquitetura & Algoritmos

### Fase Estreita (Narrow-Phase)

Intersecção **AABB** (*Axis-Aligned Bounding Box*) testando sobreposição nos eixos X, Y e Z entre pares de objetos.

### Estratégias Broad-Phase

| Estratégia | Complexidade | Abordagem |
|---|---|---|
| Força Bruta | $O(n^2)$ | Verificação par-a-par total via combinação $\frac{N(N-1)}{2}$ |
| Grade Espacial | $O(n)$ | Mapeamento e hashing de células 3D fixas com consulta de vizinhança |
| Octree | $O(n \log n)$ | Subdivisão recursiva de 8 octantes com retenção em nós pai para evitar *straddling*. A raiz é um cubo de 40 apoiado no chão da arena: o primeiro corte em y cai no teto da arena, e em cenas de 150 cubos isso testa ~17% menos pares que a raiz antiga (cubo de 60 na origem) |
| Sweep and Prune | $O(n + k)$ | Lista ordenada pelo início no eixo X, mantida entre frames (ordenação por inserção, coerência temporal) e varrida em busca de intervalos sobrepostos |

Os algoritmos ficam em `static/js/broadphase.js`, sem Three.js e sem DOM. O mesmo arquivo roda na página, no Web Worker do benchmark e nos testes do Node. A grade reporta cada par só na "célula dona" (o canto mínimo da interseção das células dos dois cubos), sem precisar de um `Set` de pares vistos. A Octree tira os nós de um pool e percorre a árvore com uma pilha única, então montar e consultar não alocam memória e o coletor de lixo fica fora do tempo medido.

---

## Recursos da Interface
![simulador](screenshot2.png)
**Layout**
- Bancada de instrumento em volta da cena: teclas de estratégia na barra superior, controles no trilho esquerdo, telemetria no trilho direito e leituras com atalhos no rodapé. O centro da cena fica livre.
- Superfícies matte opacas, IBM Plex Mono na interface e IBM Plex Sans na teoria (as mesmas fontes da página inicial), uma cor por estratégia vinda de `body[data-mode]`.
- Cubos em colisão ficam rosa (`#ff2e88`), uma cor fora das quatro paletas. A paleta da Octree usa violetas puxados para o azul, longe desse rosa.
- Barra superior: teclas de estratégia, os dois trilhos, Corrida e Benchmark (com rótulo até 1000 px de largura) e um menu "mais opções" com modo apresentação, som e teoria. O menu abre pelo teclado (setas, Home, End, Esc).
- Em telas largas os dois trilhos abrem sozinhos; nas menores a cena começa livre e a barra superior passa a duas linhas.

**Telemetria em Tempo Real**
- Canvas 2D com as curvas assintóticas das quatro estratégias e um marcador do N atual. Antes do benchmark as curvas são ilustrativas; depois dele o eixo passa a ms, com os tempos medidos como pontos e a forma teórica de cada estratégia (tracejada) ancorada no ponto de n = 150. Onde os pontos descolam do tracejado, a medição foge do caso médio teórico.
- Rodapé com contador de cubos, colisões e porcentagem de testes evitados, sempre visível.
- Trilho de telemetria: pares testados por frame, tempo médio em ms, gráfico, estratégia ativa e pseudocódigo.

**Controles Inteligentes**
- Bloqueio dinâmico dos sliders de parâmetros espaciais (Célula da grade e Profundidade da Octree) conforme a estratégia selecionada. Ambos bloqueados em Força Bruta.
- Indicador de economia no rodapé: porcentagem de testes de colisão evitados; fica cinza em Força Bruta.

**Notificações (Toast HUD)**
- Feedback em tempo real para pausa/retomada, ativação/desativação da física real e troca de algoritmo. Aparecem embaixo, no centro, acima do rodapé (sobem para o topo quando o benchmark está aberto).

**Benchmark & Exportação**
- Painel de benchmark com as quatro estratégias lado a lado. As medições rodam num Web Worker (`bench-worker.js`), então a cena continua animando enquanto o benchmark mede. Cada tempo é a média de pelo menos 20 execuções, repetidas até somar tempo suficiente para vencer a resolução do relógio do navegador.
- **Custo por fase:** o tempo de detecção é separado em montar a estrutura e consultar os pares. Aparece como barra empilhada no trilho de telemetria (média dos últimos 180 frames), no benchmark e no placar da corrida.
- **Ajuste empírico da curva:** o benchmark mede cenas sintéticas de 10 a 150 cubos, ajusta `t = a·n^k` por mínimos quadrados em escala log-log e mostra o expoente medido de cada estratégia ao lado do teórico, com R² e o gráfico log-log. As cenas usam a arena fixa do simulador, então a densidade cresce com N e a grade e a Octree medem acima do caso médio teórico.
- Exportação do histórico de telemetria da sessão para CSV.

**Modos de Operação**
- **Modo Apresentação:** câmera orbital automática com HUD limpo.
- **Corrida:** a tela se divide em quatro colunas, uma por estratégia. A simulação é uma só: as quatro estratégias rodam no mesmo frame sobre os mesmos cubos, e cada coluna mostra os pares que a sua estratégia testou, a estrutura que ela montou e um placar com pares, tempo médio e custo por fase.
- **Stress Test:** suporte a até 150 objetos simultâneos com efeitos visuais de sobrecarga.

**Efeitos Visuais**
- **Brilho neon:** linhas de teste, gizmos, cubos em colisão, faíscas e a crista das ondas do piso emitem luz (bloom seletivo, aplicado antes do dithering). Quanto mais pares uma estratégia testa, mais a cena acende. Pode ser desligado no painel de controles ou com `brilho=0`.
- **Piso reativo:** cada colisão solta uma ondulação que se espalha pela grade do chão a partir do ponto de impacto.
- **Troca de estratégia com glitch:** meio segundo de separação RGB e faixas deslocadas, enquanto os cubos trocam de paleta em onda, do centro para fora. A cena não é recriada: a estratégia nova roda sobre os mesmos cubos. Com `prefers-reduced-motion` o glitch não acontece.
- **Raio-X (segure X):** a cena apaga, os cubos ficam translúcidos e sobra a estrutura da estratégia ativa: as células da grade e os nós da Octree se enchem de luz conforme os pares que testam, as arestas da Octree acendem mais nos níveis de cima e as linhas da força bruta ficam mais fortes. Os cubos em colisão continuam visíveis. `raiox=1` na URL abre com ele ligado.
- **Rastro de fósforo (T):** as linhas dos pares testados deixam um rastro que some em ~0,8 s, como num osciloscópio. Fica mais forte quando há poucas linhas (grade, Octree) e enfraquece com milhares (força bruta) e no raio-X, para não estourar o brilho. Ligado por padrão; `rastro=0` na URL desliga.
- **Estilhaços:** com a física real ligada, colisões fortes soltam fragmentos que quicam e somem. São só visuais e ficam fora da detecção e dos tempos medidos.

- **Régua do Sweep and Prune:** na frente da arena, cada cubo aparece como o intervalo que ocupa no eixo X. Intervalos sobrepostos ficam empilhados (até 8 fileiras), e os empilhados são justamente os pares que a varredura visita. Uma linha de varredura atravessa a arena e acende os intervalos que cruza (a lista ativa do algoritmo). O cubo sob o ponteiro aparece em branco na régua, e apontar um intervalo da régua destaca o cubo. Com `prefers-reduced-motion` a varredura fica parada.
- **Wireframe:** só as 12 arestas de cada cubo, sem as diagonais dos triângulos.
- **Octree dentro da caixa:** os nós são desenhados recortados pela arena; os que ficam inteiros fora dela não aparecem.

**Prova de complexidade (menu ⋯)**
- Janela com sete abas: resumo, modelo de custo e uma aba por estratégia com prova de correção (por que acha as mesmas colisões que a força bruta) e análise de custo, com as hipóteses de cada resultado. As fórmulas são renderizadas com KaTeX, baixado só quando a janela abre.
- Resultado principal: com densidade constante a grade é Θ(n); a Octree com retenção no nó pai tem Ω(n^(4/3)) pares para cubos de tamanho fixo (o O(n log n) vale para a montagem e para objetos pontuais); o k do Sweep and Prune cresce como n^(5/3) em 3D. Na arena fixa do simulador as quatro são Θ(n²) e o que muda é a constante.
- Aba Verificação: roda as quatro estratégias na cena atual (mesmas colisões, força bruta = n(n−1)/2, cubos presos na raiz da Octree e k do Sweep and Prune contra o previsto), roda no worker o experimento de crescimento (pares contados de n = 100 a 1600 nos dois regimes, com o expoente ajustado) e mostra os expoentes do último benchmark.

**Outros Recursos**
- Arrastar e largar cubos na cena 3D.
- Wireframe, grade do chão opcional, física real ligada/desligada.
- Corrida e benchmark marcam "empate" quando duas ou mais estratégias ficam a até 5% da mais rápida.
- Modal de teoria com sete blocos explicativos (fecha com Esc ou clicando fora).
- Terminal de pseudocódigo com efeito de digitação ao trocar de estratégia.
- Página inicial separada do simulador, com capturas reais da cena.

---

## Estrutura do Projeto

```
3d-physics-complexity-main/
├── app.py                  # Servidor Flask: / (página inicial) e /simulador
├── requirements.txt        # Dependências Python (Flask e Waitress)
├── package.json            # Só para `npm test` (sem dependências)
├── test/
│   └── broadphase.test.js  # Cada estratégia contra a força bruta, pares repetidos, Octree, SAP, ajuste da curva
├── README.md               # Este arquivo
├── scrollcraft/            # Brief da versão com animações de rolagem (não usada no momento)
├── templates/
│   ├── index.html          # Página inicial (feita com o kit da tasteskill)
│   └── simulador.html      # Simulador: top bar, painel bento, gráfico, modais, overlays
└── static/
    ├── favicon.svg
    ├── img/                # Capturas reais do simulador (hero-seq/ só era usado pela versão scroll-craft)
    ├── data/               # broadphase-150.json: pares reais de runBroadPhase (não usado no momento)
    ├── scrollcraft/        # Motor scroll-craft (MIT; não carregado no momento)
    ├── landing/            # Kit da tasteskill (MIT, ver LICENSE-taste-skill): CSS, JS, momento e fragmento de código
    ├── css/
    │   ├── style.css       # Simulador: tokens, cena (canvas, vinheta, scanlines), barra superior, trilhos, rodapé
    │   └── components.css  # Simulador: controles, botões, leituras, gráfico, benchmark, avisos, modais, HUD
    └── js/
        ├── main.js         # Confere o WebGL e importa three-setup, physics e ui
        ├── broadphase.js   # Grade, Octree, Sweep and Prune, AABB, medição e ajuste da curva (sem Three.js)
        ├── strategies.js   # Nomes, cores, notação, pseudocódigo e textos de cada estratégia
        ├── three-setup.js  # Cena Three.js, câmera, renderer, piso reativo, pós-processamento (brilho, glitch, dithering Bayer 4×4)
        ├── fragments.js    # Estilhaços das colisões fortes (InstancedMesh, só visual)
        ├── physics.js      # Estado da simulação, física, detecção de colisões, gizmos das estruturas
        ├── ui.js           # Controles, atalhos, laço de animação, parâmetros de URL
        ├── telemetry.js    # Médias de tempo, custo por fase, gráfico assintótico
        ├── benchmark.js    # Painel de benchmark e ajuste da curva (cliente do worker)
        ├── bench-worker.js # Web Worker que roda as medições
        ├── history.js      # Histórico da sessão e exportação CSV
        ├── view-modes.js   # Modo apresentação e corrida
        ├── panels.js       # Trilhos laterais
        ├── drag.js         # Arrastar e largar cubos
        ├── menu.js         # Menu "mais opções" da barra superior
        ├── proof.js        # Janela "Prova de complexidade" (abas, KaTeX, verificação)
        ├── dom.js          # setText, formatação de tempos, toasts
        ├── glitch.js       # Página inicial: o glitch da troca de estratégia como filtro SVG (texto e imagem)
        ├── hero-strategies.js # Página inicial: abas de estratégia do hero, trocando a captura com glitch
        └── landing.js      # Animações da versão scroll-craft (não carregado no momento)
```

---

## Como Executar

Não há etapa de *build*: as bibliotecas carregam via CDN ou de `static/`. As páginas usam caminhos absolutos (`/static/...`), então precisam de um servidor.

```bash
# Instalar dependências
python -m pip install -r requirements.txt

# Executar (Waitress, servidor WSGI de produção)
python app.py

# Ou o servidor de desenvolvimento do Flask, com o debugger
FLASK_DEBUG=1 python app.py

# Acessar
http://localhost:5000            # página inicial
http://localhost:5000/simulador  # simulador
```

`PORT` e `HOST` mudam a porta e o endereço (padrão `127.0.0.1:5000`).

Os templates não usam Jinja: são HTML estático. Para publicar sem servidor Python (GitHub Pages, Netlify, Vercel), basta servir `static/` na raiz e os dois templates como `/` e `/simulador`.

### Testes

```bash
npm test
```

Roda `node --test` (Node 20 ou mais novo, sem dependências). Os testes geram cenas com semente e conferem que a grade, a Octree e o Sweep and Prune acham exatamente as mesmas colisões que a força bruta, sem repetir pares, inclusive com as estruturas reaproveitadas ao longo de vários frames.

### Cenas prontas por URL

O simulador aceita parâmetros para abrir um estado específico (útil em aula ou para capturas):

| Parâmetro | Valores | Efeito |
|---|---|---|
| `modo` | `brute`, `grid`, `octree`, `sap` | Estratégia de broad-phase |
| `n` | 2 a 150 | Número de cubos (acima de 20 liga o stress test) |
| `paineis` | `1`, `0` | Abre ou fecha os dois trilhos laterais (controles e telemetria) |
| `fisica=1` | | Liga a resposta a colisões |
| `wireframe=1` | | Liga o wireframe |
| `corrida=1` | | Abre a corrida com as quatro estratégias lado a lado |
| `brilho=0` | | Desliga o brilho neon |
| `apresentacao=1` | | Entra no modo apresentação |

Exemplo: `/simulador?modo=octree&n=60&paineis=1`.

> **Nota:** o contexto de áudio dos navegadores modernos requer interação do usuário; o som começa depois do primeiro clique na página.

---

## Atalhos de Teclado

| Tecla | Ação |
|---|---|
| `1` a `4` | Escolher a estratégia (força bruta, grade, Octree, Sweep and Prune) |
| `Espaço` | Pausar / Retomar simulação |
| `R` | Reiniciar simulação (8 cubos, velocidade padrão) |
| `S` | Ativar / Desativar Stress Test (150 objetos) |
| `W` | Alternar modo Wireframe |
| `C` | Entrar / Sair da Corrida |
| `B` | Rodar o benchmark e o ajuste da curva |
| `P` | Entrar / Sair do Modo Apresentação |
| `Esc` | Sair do Modo Apresentação |

---

## Tecnologias

| Recurso | Versão / Fonte |
|---|---|
| [Three.js](https://threejs.org/) | r170, módulos ES via import map (CDN jsdelivr) |
| OrbitControls | r170 (`three/addons/`) |
| EffectComposer + ShaderPass | r170 (`three/addons/`) — pós-processamento dithering Bayer 4×4 |
| UnrealBloomPass | r170 (`three/addons/`) — brilho neon |
| IBM Plex Mono | Google Fonts — interface e terminal |
| IBM Plex Sans | Google Fonts — textos de teoria |
| JavaScript | Vanilla ES6+, módulos ES, sem framework ou bundler |
| Flask + Waitress | Servidor das páginas (Waitress em produção) |
| Node `node:test` | Testes dos algoritmos de broad-phase |
| [KaTeX](https://katex.org/) 0.16.11 | Fórmulas da prova de complexidade (CDN jsdelivr, carregado sob demanda) |

---

## Autor

Kaíque Nunes

Trabalho Acadêmico — Física 3D / Análise de Algoritmos
