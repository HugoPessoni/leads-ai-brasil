# Plano de Construção — App de Captação de Leads

Oct 23, 2026 · @hugo

## Visão geral

Um web app para celular em que os voluntários do evento cadastram leads: leem o QR do crachá, informam celular ou e-mail, escolhem o próximo passo e mostram à pessoa o QR correspondente. Cada lead vai para uma Planilha Google, que calcula os KPIs sozinha.

Decisões já tomadas:

- Roda 100% no navegador, hospedado no GitHub Pages. Sem loja de apps e sem servidor próprio.
- Todo lead é gravado primeiro no celular e enviado para a planilha quando houver internet.
- O backend é uma Planilha Google com Apps Script.
- A classificação aparece na tela como uma pergunta neutra sobre o próximo passo ("Marcar uma reunião" ou "Receber nosso contato"), porque a pessoa abordada pode ver a tela. O treinamento ensina o critério: empresa madura vai para reunião; startup ou empresa em estágio inicial vai para contato.
- O "código para copiar e mandar" da ideia original vira o backup de emergência, não o fluxo principal.
- Os QRs mostrados para a empresa já existem como imagens prontas, uma por próximo passo. O app só exibe a imagem indicada no `config.js`; até as imagens finais chegarem, usa imagens de mockup.

## Instruções para o Claude Code

Exporte este documento em Markdown, salve na raiz do repositório como `PLANO.md` e comece a sessão com o prompt abaixo.

```text
Leia o PLANO.md inteiro antes de escrever qualquer código.
Implemente uma fase por vez, na ordem da seção "Fases de construção".
Ao fim de cada fase: diga o que foi feito, como eu testo no celular, e pare até eu aprovar.
Não adicione nada fora do plano. Se algo estiver ambíguo, pergunte antes.
```

Restrições técnicas:

- HTML, CSS e JavaScript puros. Sem framework, sem etapa de build, sem npm no frontend.
- Bibliotecas copiadas para `vendor/`, nunca via CDN, para o app abrir sem internet.
- Interface em português do Brasil, mobile-first, botões com pelo menos 48 px de altura, usável com uma mão.
- Identidade visual do AI.Brasil Experience 2026: fundo preto, verde `#6BDD3E`, amarelo-lima `#E4EF3A`, títulos em Rajdhani e textos em Montserrat (fontes em `fonts/`). Logo do CEIA em branco nas telas de identificação e do QR.
- Funcionar no Safari (iPhone) e no Chrome (Android) atuais.
- Tudo que é editável (URLs, textos dos botões, imagens dos QRs) fica em `config.js`. Nenhuma URL ou lista solta no meio do código.
- Funções puras (parser do QR, validações, formatação) ficam em `js/core.js` e são testadas em `tests.html`, que roda abrindo no navegador.

## Arquitetura e estrutura de arquivos

O app é um site estático: guarda cada lead no celular e envia para um Apps Script, que grava na planilha.

&#91;embedded content: arquitetura · do celular à planilha, com o caminho de backup tracejado\]

A linha tracejada é o plano B: o backup exportado do celular é importado direto na planilha, sem passar pela fila.

```text
/
├── index.html            # página única; as telas trocam via JS
├── config.js             # URLs, voluntários, textos editáveis
├── css/style.css
├── js/
│   ├── core.js           # parser do QR, validações, formatação (funções puras)
│   ├── storage.js        # fila local de leads (localStorage)
│   ├── sync.js           # envio para o Apps Script
│   ├── scanner.js        # câmera e leitura do QR
│   └── app.js            # telas e fluxo
├── vendor/
│   └── html5-qrcode.min.js   # leitura de QR pela câmera
├── img/                  # QRs mostrados para a empresa e logo do CEIA
├── fonts/                # Rajdhani e Montserrat (identidade AI.Brasil Experience)
├── sw.js                 # service worker: cache para uso offline
├── manifest.json         # instalar na tela inicial
├── icons/                # ícones 192 px e 512 px
├── tests.html            # testes das funções puras
├── apps-script/Code.gs   # backend (colado no editor do Apps Script)
└── PLANO.md
```

- **Leitura de QR:** html5-qrcode, que funciona no Safari do iPhone e no Chrome do Android.
- **QR exibido para a empresa:** imagem pronta em `img/`, uma por próximo passo, com o caminho no `config.js`. Trocar o QR é só substituir o arquivo.
- **Hospedagem:** GitHub Pages. No plano gratuito o repositório precisa ser público, então o código fica visível. Nenhum dado de lead fica no repositório.
- **Câmera:** só funciona em https, por isso o app é testado no celular pelo link do GitHub Pages desde a fase 2.

## Leitura do QR do crachá

O QR traz um código do crachá e o nome da pessoa, separados por barra: `PREFIXO-ID/NOME`. O app grava os dois; o código serve para detectar cadastro duplicado e cruzar com a lista do evento depois.

| Texto lido | Prefixo | ID | Nome exibido |
| --- | --- | --- | --- |
| DOI-467956180/ANDERSON SANTOS | DOI | 467956180 | Anderson Santos |
| FD-0D26715492/GABRIEL MONTEIRO | FD | 0D26715492 | Gabriel Monteiro |
| DOI-56FE55826/SAULO SOUZA | DOI | 56FE55826 | Saulo Souza |
| FD-0F79CE63CF/JHONNY RIBEIRO | FD | 0F79CE63CF | Jhonny Ribeiro |

Regras de `parseBadge(texto)` em `core.js`:

1. Remover espaços e quebras de linha nas pontas.
2. Procurar `([A-Z]{2,5})-([0-9A-Z]+)\/(.+?)(?=\s+[A-Z]{2,5}-[0-9A-Z]+\/|$)`, sem diferenciar maiúsculas de minúsculas.
3. Se houver mais de um código no mesmo texto, usar o primeiro. Um dos exemplos recebidos veio assim: `DOI-467956180/ANDERSON SANTOS FD-0D26715492/GABRIEL MONTEIRO`.
4. Retornar `{ prefixo, id, codigo, nome, nomeOriginal, bruto }`, em que `codigo` é `DOI-467956180`.
5. Nome em formato título: `ANDERSON SANTOS` vira `Anderson Santos`. As partículas da, de, do, das, dos, e ficam em minúsculo; acentos são mantidos.
6. Sem correspondência: retornar `null`. A tela coloca o texto lido no campo Nome para o voluntário corrigir e marca a origem como `manual`.

Casos de teste obrigatórios em `tests.html`:

- Os quatro exemplos da tabela.
- Dois códigos no mesmo texto (retorna Anderson Santos).
- Acento e partícula: `DOI-ABC123/MARIA DA CONCEIÇÃO` retorna `Maria da Conceição`.
- Espaços e quebra de linha nas pontas.
- Texto sem barra, texto vazio e uma URL qualquer: todos retornam `null`.

## Fluxo das telas

Uma página com quatro telas; depois do primeiro uso, o voluntário só passa pelas telas 2, 3 e 4.

1. **Identificação (só no primeiro uso):** o voluntário digita o próprio nome; não há lista prévia. O nome vai para formato título, como os nomes do crachá, para "ana" e "Ana" contarem como a mesma pessoa no ranking. Fica salvo no celular e pode ser trocado pelo menu.
2. **Cadastro:**
   - Botão grande "Ler crachá" abre a câmera traseira. Ao ler, a câmera fecha, o celular vibra e o nome é preenchido.
   - Link "Digitar nome" para quando o QR falhar.
   - Campos: Nome (editável), Empresa (opcional), Celular, E-mail. Exigir pelo menos um entre celular e e-mail: só celular, só e-mail ou os dois seguem para o QR. Os dois ficam num grupo "Contato — preencha pelo menos um"; o que for preenchido precisa estar completo, e a mensagem de erro diz para corrigir ou apagar.
   - Celular com máscara `(11) 98765-4321` e teclado numérico; e-mail com teclado de e-mail e validação de formato.
   - Checkbox "Autorizou o contato" (LGPD), obrigatório.
   - Se o mesmo crachá já foi cadastrado neste celular, avisar com o horário do cadastro anterior e perguntar se quer cadastrar de novo.
3. **Próximo passo:** a pergunta "Qual o melhor próximo passo?" com dois botões grandes:
   - "Marcar uma reunião" grava `proximo_passo = reuniao`.
   - "Receber nosso contato" grava `proximo_passo = contato`.
   - Cada botão tem uma cor fixa, para o voluntário reconhecer pelo treinamento; o texto é neutro para quem está olhando a tela.
   - Antes dos botões, a temperatura do lead, obrigatória: três ícones (🔥 quente, 💨 morno, ❄️ frio), sem texto, porque a pessoa abordada pode ver a tela. Ícones e nomes ficam no `config.js`.
   - Ao tocar no botão, o lead é salvo no celular na hora, sem travar a tela.
4. **QR para a empresa:** tela cheia com a imagem do QR do passo escolhido (agendamento ou contato), um título curto vindo do `config.js` e o botão "Novo lead", que volta ao cadastro com os campos limpos.
   - Campo opcional "Observação" (até 500 caracteres), abaixo do QR: o voluntário resume a conversa depois que a pessoa escaneou. O texto vai para o lead aberto enquanto ele digita.
   - Link "Trocar opção": volta à tela 3 com os dados preenchidos. Escolher de novo corrige o mesmo lead (mesmo `id` e horário), sem criar outro.
   - Por isso o lead da tela do QR só vai para a planilha ao tocar em "Novo lead" (ou ao trocar de voluntário). Se o app fechar antes, ele é enviado na próxima abertura.

Em todas as telas, uma barra fixa no topo mostra o nome do voluntário, quantos leads ele cadastrou hoje neste celular e o status de envio ("Tudo enviado" ou "3 pendentes"). Tocar no status força o envio.

O menu tem três itens: Enviar pendentes, Exportar backup, Trocar voluntário.

## Salvamento no celular e sincronização

Todo lead é gravado no celular antes de qualquer envio; a planilha recebe uma cópia assim que houver internet, e nada se perde se o sinal cair.

- **Fila:** `localStorage`, chave `leads_v1`, um array de leads. Cada lead tem `id` (gerado com `crypto.randomUUID()`), `capturado_em` (horário do celular) e `status`: `pendente` ou `enviado`.
- **Quando envia:** ao tocar em "Novo lead" (o lead da tela do QR fica retido até lá); ao abrir o app; no evento `online` do navegador; a cada 30 segundos enquanto houver pendentes; ao tocar no status da barra.
- **Como envia:** os pendentes em lote, até 20 por requisição, com `fetch(apiUrl, { method: 'POST', body: JSON.stringify({ token, leads }) })`. Não definir `Content-Type`: o corpo vai como texto simples e evita a verificação prévia de CORS, que o Apps Script não atende.
- **Confirmação:** marcar como `enviado` só os `id`s que a resposta listar em `gravados` ou `ignorados` (já existiam). Erro ou mais de 15 segundos sem resposta: continuam pendentes para o próximo ciclo.
- **Nunca apagar** leads do celular, mesmo enviados. Eles servem de backup e alimentam o aviso de crachá duplicado.
- **Offline:** o service worker guarda todos os arquivos do app no primeiro acesso; depois disso o app abre sem internet.
  - Os arquivos vêm do cache primeiro (abre na hora, mesmo com sinal fraco). Ao publicar mudança de código, aumentar `VERSAO` no `sw.js`; o celular baixa a versão nova numa abertura e passa a usá-la na seguinte.
  - O `sw.js` importa o `config.js` (por isso ele usa `self.APP_CONFIG`) para guardar as imagens dos QRs; mudar só o `config.js` já atualiza o app.
  - No iPhone, o app instalado na tela inicial guarda os dados separados do Safari: instalar antes do evento e usar só o ícone instalado.
- **Exportar backup (plano B):** gera um texto com todos os leads deste celular, no formato `LEADS1:` seguido do JSON em Base64 (codificado em UTF-8 para preservar acentos). Abre o compartilhamento nativo do celular (`navigator.share`) ou copia para a área de transferência, para mandar por WhatsApp ou e-mail. A planilha importa esse texto pelo menu "Leads > Importar backup", sem duplicar.
  - O texto vai dentro de um arquivo `backup-leads-<voluntario>-<data>.txt`, porque o WhatsApp corta mensagens de texto longas. Sem compartilhamento de arquivo, o app copia o texto.
  - A caixa "Importar backup" aceita escolher o arquivo .txt ou colar o texto (quebras de linha no meio são ignoradas) e mostra quantos leads entraram e quantos já estavam na planilha.

## Backend: Google Planilha + Apps Script

Um único arquivo, `apps-script/Code.gs`, recebe os leads, grava uma linha por lead e ignora repetidos pelo `id`.

Funções:

- `setup()`: roda uma vez, manualmente. Cria as abas Leads (com cabeçalho), Dashboard (fórmulas e gráficos) e Config (guarda o token). Define o fuso da planilha como America/Sao\_Paulo. Se uma aba já existir, não apaga os dados.
- `doPost(e)`: lê `e.postData.contents` como `{ token, leads: [...] }`. Recusa token errado. Usa `LockService` para dois envios simultâneos não se atropelarem. Compara os `id`s com a coluna A, grava só os novos de uma vez com `setValues` e responde `{ ok: true, gravados: [...], ignorados: [...] }` em JSON via `ContentService`.
- `doGet()`: responde só `{ ok: true, versao }`, para testar se está no ar. Nunca devolve leads.
- `onOpen()`: cria o menu Leads com "Importar backup" (abre uma caixa para colar o texto `LEADS1:` e grava o que faltar) e "Recriar Dashboard".
- Colunas calculadas no servidor a partir de `capturado_em`: `data` e `hora`. O horário vem do celular, não da chegada, porque um lead pode ser enviado horas depois.
- Fórmulas escritas pelo script usam nomes de função em inglês e vírgula como separador, mesmo com a planilha em português.

Publicação: Implantar > Nova implantação > App da Web, "Executar como: eu", "Quem pode acessar: qualquer pessoa". A URL terminada em `/exec` vai para o `config.js`. Para atualizar o código depois, use Gerenciar implantações > Editar > Nova versão; a URL não muda.

Segurança: o repositório é público, então a URL e o token ficam visíveis. O token só barra envios aleatórios. O risco aceito é alguém inserir linhas falsas; ninguém consegue ler os leads por essa URL. O servidor também limita cada campo a 200 caracteres e cada requisição a 50 leads.

A planilha e o Apps Script estão numa conta Google pessoal (decisão do dono do projeto). Para proteger essa conta:

- O script declara `@OnlyCurrentDoc` e só tem acesso a esta planilha, não às outras planilhas da conta.
- O repositório não guarda nenhuma credencial da conta: só a URL `/exec` e o token, que permitem apenas inserir linhas.
- Os commits usam o e-mail `noreply` do GitHub, não o e-mail pessoal.
- Depois do evento: arquivar a implantação (Implantar > Gerenciar implantações > Arquivar), o que derruba a URL, e remover o acesso do script em myaccount.google.com > Segurança > Apps de terceiros.

## Planilha: colunas e KPIs

A aba Leads guarda uma linha por lead; a aba Dashboard calcula os KPIs com fórmulas e se atualiza a cada lead que chega.

Aba Leads, nesta ordem (a ordem fica numa constante no `Code.gs`, e as fórmulas usam essa constante):

| Coluna | Exemplo | Vem de |
| --- | --- | --- |
| id | UUID | celular |
| recebido\_em | AAAA-MM-DD hh:mm:ss | servidor |
| capturado\_em | AAAA-MM-DD hh:mm:ss | celular |
| data | AAAA-MM-DD | servidor, de capturado\_em |
| hora | 10 | servidor, de capturado\_em |
| voluntario | Ana | celular |
| cracha\_codigo | DOI-467956180 | QR |
| cracha\_tipo | DOI | QR |
| nome | Anderson Santos | QR ou digitado |
| empresa | Acme | digitado |
| celular | (11) 98765-4321 | digitado |
| email | anderson@acme.com | digitado |
| proximo\_passo | Reunião ou Contato | botão |
| observacao | texto livre | digitado |
| autorizou\_contato | Sim | checkbox |
| origem\_nome | QR ou Manual | app |
| dispositivo | código curto do celular | app |
| temperatura | Quente, Morno ou Frio | ícone da tela 3 (coluna acrescentada no fim, para não desalinhar as linhas antigas) |

Aba Dashboard (visão geral), criada pelo `setup()`:

| KPI | Como calcular |
| --- | --- |
| Total de leads | contagem da coluna id |
| Último lead recebido | maior recebido\_em; confirma que o envio está chegando |
| Horário de pico | hora com mais leads no evento todo |
| Reunião × Contato | quantidade e % de cada próximo passo |
| Temperatura | quantidade e % de quente, morno, frio e sem temperatura |
| Qualidade do contato | % com celular, % com e-mail, % com os dois |
| Leitura do crachá | % por QR × manual; mostra se o leitor está funcionando |
| Tipo de crachá | DOI × FD, cruzado com o próximo passo |
| Duplicados | crachás com mais de um cadastro |
| Por dia | por data: leads, reunião, contato, quente, morno, frio e horário de pico |
| Leads por hora | QUERY por hora com uma coluna por dia; compara os horários de pico dos dias |

Aba Ranking (leaderboard e métricas pessoais), criada pelo `setup()`:

| Coluna | Como calcular |
| --- | --- |
| Posição | ordem por leads (empate: mais quentes), com 🥇 🥈 🥉 |
| Leads, 🔥 Quentes, Reuniões, % reunião | contagens por voluntário |
| Dia 1, Dia 2 | leads do voluntário no primeiro e no segundo dia com leads |
| Evolução | Dia 2 comparado ao Dia 1, em % |
| Horário de pico | hora com mais leads daquele voluntário |

Gráficos criados pelo script: pizzas de Reunião × Contato e de temperatura, colunas de leads por hora (uma cor por dia), barras de leads por voluntário e colunas Dia 1 × Dia 2 por voluntário.

As fórmulas são escritas com a planilha em en\_US e a localidade original volta em seguida (planilha em português lê ponto e vírgula). "Leads > Recriar Dashboard" refaz as duas abas e avisa quais células deram erro.

## Configuração (config.js)

Tudo que muda de um evento para outro fica neste arquivo; os valores abaixo são exemplos a substituir.

```js
self.APP_CONFIG = {
  evento: 'AI Experience',
  apiUrl: 'https://script.google.com/macros/s/XXXX/exec',
  token: 'troque-por-um-texto-aleatorio-longo',
  proximosPassos: {
    reuniao: {
      botao: 'Marcar uma reunião',
      tituloQr: 'Escaneie para agendar',
      imagem: 'img/qr-reuniao.png',
      cor: '#1F6FEB'
    },
    contato: {
      botao: 'Receber nosso contato',
      tituloQr: 'Escaneie para falar com a gente',
      imagem: 'img/qr-contato.png',
      cor: '#1A7F37'
    }
  },
  exigirAutorizacao: true,
  intervaloSyncSegundos: 30,
  loteMaximo: 20
};
```

Para medir, na ferramenta de agendamento ou no site, quantas pessoas escanearam cada QR, os links dentro das imagens precisam ter `?utm_source=evento`.

## Fases de construção

Dez fases, cada uma testável no celular; o Claude Code para ao fim de cada uma e só segue com sua aprovação.

| Fase | Entrega | Pronta quando |
| --- | --- | --- |
| 1. Backend | `Code.gs` com `setup`, `doPost`, `doGet` e `onOpen` | um envio de teste com `curl` grava uma linha, e o mesmo `id` enviado de novo não duplica |
| 2. Esqueleto no ar | `index.html`, `config.js`, CSS, as 4 telas navegáveis com dados fictícios, publicado no GitHub Pages | o link https abre no celular e todas as telas funcionam |
| 3. Parser e validações | `core.js` e `tests.html` | todos os casos de teste da seção do QR passam |
| 4. Leitura do QR | `scanner.js` com html5-qrcode | lê um crachá impresso no iPhone e no Android e preenche o nome |
| 5. Fila e envio | `storage.js`, `sync.js` e a barra de status | em modo avião o lead fica pendente; com internet de volta, chega à planilha e o contador zera |
| 6. QR para a empresa | exibição da imagem de cada passo a partir do `config.js` | cada opção mostra a imagem certa, e o QR dela abre a URL certa |
| 7. Offline e instalação | `sw.js`, `manifest.json` e ícones | abre sem internet depois do primeiro acesso e instala na tela inicial |
| 8. Dashboard | aba Dashboard e gráficos no `setup()` | com 20 leads fictícios, todos os KPIs batem com a contagem manual |
| 9. Backup | exportar no app e importar na planilha | um backup exportado é importado sem duplicar linhas |
| 10. Ensaio geral | ajustes finais | 2 voluntários, 10 crachás e modo avião no meio do teste: planilha completa e sem duplicados |

## Checklist de testes antes do evento

Rode tudo nos celulares que os voluntários vão usar, com crachás reais do evento.

- [ ] iPhone (Safari) e Android (Chrome): a câmera abre e lê crachá impresso
- [ ] Leitura com pouca luz e com o crachá inclinado
- [ ] QR ilegível: "Digitar nome" funciona e grava origem Manual
- [ ] Modo avião: cadastrar 3 leads, voltar a internet e conferir as 3 linhas na planilha
- [ ] Fechar o navegador com leads pendentes, reabrir: continuam lá e são enviados
- [ ] Mesmo crachá duas vezes: aparece o aviso de duplicado
- [ ] Sem celular e sem e-mail: o app não deixa salvar
- [ ] QR de reunião abre a agenda; QR de contato abre o link certo
- [ ] Dois voluntários enviando ao mesmo tempo: nenhuma linha perdida
- [ ] Dashboard confere com a contagem manual
- [ ] Exportar backup no celular e importar na planilha sem duplicar
- [ ] Uso contínuo por uma sessão longa: checar bateria e levar carregadores portáteis
- [ ] App instalado na tela inicial de cada voluntário antes do evento (no iPhone, usar só o ícone instalado: ele não enxerga os dados do Safari)

## Pendências para preencher antes de começar

Sete respostas destravam o `config.js` e a fase 1.

- [x] Nome do evento e datas: AI Experience, 28 e 29 de outubro de 2026
- [x] Lista de voluntários: não há; cada voluntário digita o próprio nome no primeiro uso
- [x] Link de agendamento para o QR de reunião: QR já pronto, a imagem será enviada depois (mockup até lá)
- [x] Link para o QR de contato: QR já pronto, a imagem será enviada depois (mockup até lá)
- [x] Manter o campo Empresa? Sim, opcional
- [x] O que significam os prefixos DOI e FD? Ainda não se sabe; tratados só como código do crachá
- [x] Conta Google dona da planilha e do Apps Script: conta pessoal do dono do projeto
