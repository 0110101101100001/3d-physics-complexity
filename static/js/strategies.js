// --- strategies.js — Metadados das estratégias de broad-phase ---
// Fonte única de nomes, cores, notação e textos de cada estratégia. A ordem da lista
// é a ordem das teclas, das colunas da corrida e das linhas do benchmark.

export const STRATEGIES = [
  {
    key: 'brute',
    label: 'Força Bruta O(n²)',
    short: 'Força bruta',
    o: 'O(n²)',
    theory: 'n²',
    color: '#ff7139',
    context: {
      algorithm: 'AABB — Axis-Aligned Bounding Box',
      worstCase: 'O(n²) — verificação por força bruta',
      op: 'Sobreposição nos eixos X, Y e Z',
    },
    phaseNote: 'A força bruta não monta estrutura: todo o tempo vai para os testes de pares.',
    pseudo: `> FUNCAO intersectarAABB(A, B):
>   dx = abs(A.x - B.x)
>   dy = abs(A.y - B.y)
>   dz = abs(A.z - B.z)
>
>   SE dx < (A.size + B.size)/2
>    E dy < (A.size + B.size)/2
>    E dz < (A.size + B.size)/2:
>      RETORNAR VERDADEIRO
>   RETORNAR FALSO`,
  },
  {
    key: 'grid',
    label: 'Grade Espacial O(n)',
    short: 'Grade espacial',
    o: 'O(n)',
    theory: 'n',
    color: '#00ddff',
    context: {
      algorithm: 'Grade Espacial Uniforme 3D',
      worstCase: 'O(n²) no pior caso / O(n) no caso médio',
      op: 'Hashing espacial e teste entre cubos da mesma célula',
    },
    phaseNote: 'A grade é esvaziada e preenchida a cada frame. Células menores custam mais para montar e menos para consultar.',
    pseudo: `> FUNCAO detectarColisoesComGrade():
>   grade.limpar()
>   PARA CADA c EM cubos grade.inserir(c)
>   PARA CADA celula EM grade
>     PARA CADA par (a, b) EM celula
>       // par em várias células: só a
>       // "célula dona" (canto mínimo da
>       // interseção) o reporta
>       SE celula == dona(a, b)
>         testar(a, b)`,
  },
  {
    key: 'octree',
    label: 'Octree O(n log n)',
    short: 'Octree',
    o: 'O(n log n)',
    theory: 'n log n',
    color: '#a855f7',
    context: {
      algorithm: 'Octree 3D — Subdivisão Recursiva',
      worstCase: 'O(n²) no pior caso / O(n log n) no caso médio',
      op: 'Travessia de 8 octantes e teste de nós com entidades',
    },
    phaseNote: 'A árvore é refeita a cada frame. Mais profundidade custa mais para montar e reduz os pares consultados.',
    pseudo: `> FUNCAO inserir(no, obj, box):
>   SE box cabe em filho:
>     inserir(filho, obj, box)
>   SENÃO:           // straddling
>     no.objects.add(obj)

> FUNCAO candidatos(no, obj, box):
>   PARA CADA o EM no.objects:
>     candidatos.add(o)   // ancestrais sempre
>   PARA CADA filho:
>     SE filho.bounds.intersecta(box):
>       candidatos(filho, obj, box)
>   RETORNAR candidatos`,
  },
  {
    key: 'sap',
    label: 'Sweep and Prune O(n + k)',
    short: 'Sweep and prune',
    o: 'O(n + k)',
    theory: 'n + k',
    color: '#a3e635',
    context: {
      algorithm: 'Sweep and Prune — varredura no eixo X',
      worstCase: 'O(n²) no pior caso / O(n + k) com coerência temporal',
      op: 'Ordenação por inserção e varredura de intervalos',
    },
    phaseNote: 'A lista ordenada sobrevive entre frames. Como os cubos andam pouco, ela chega quase ordenada e reordenar custa perto de O(n).',
    pseudo: `> FUNCAO sweepAndPrune(lista):
>   // lista do frame anterior:
>   // quase ordenada, O(n + trocas)
>   ordenarPorInsercao(lista, min.x)
>   PARA i DE 0 ATÉ n-1:
>     a = lista[i]
>     PARA j DE i+1 ATÉ n-1:
>       b = lista[j]
>       SE b.min.x >= a.max.x: PARAR
>       testar(a, b)  // sobrepõem em X`,
  },
];

export const STRATEGY = Object.fromEntries(STRATEGIES.map(s => [s.key, s]));
export const MODE_KEYS = STRATEGIES.map(s => s.key);

export const strategyOf = mode => STRATEGY[mode] ?? STRATEGY.brute;
