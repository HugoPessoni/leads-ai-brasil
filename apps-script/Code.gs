/**
 * Backend do app de captação de leads.
 *
 * Cole este arquivo no editor do Apps Script da planilha (Extensões > Apps Script),
 * rode setup() uma vez e publique como App da Web (veja o PLANO.md).
 */

// Pede acesso só a esta planilha, não a todas as planilhas da conta.
/** @OnlyCurrentDoc */

var VERSAO = '2';

var ABA_LEADS = 'Leads';
var ABA_DASHBOARD = 'Dashboard';
var ABA_RANKING = 'Ranking';
var ABA_CONFIG = 'Config';

// Ordem das colunas da aba Leads. As fórmulas do Dashboard usam esta constante.
var COLUNAS = [
  'id',
  'recebido_em',
  'capturado_em',
  'data',
  'hora',
  'voluntario',
  'cracha_codigo',
  'cracha_tipo',
  'nome',
  'empresa',
  'celular',
  'email',
  'proximo_passo',
  'observacao',
  'autorizou_contato',
  'origem_nome',
  'dispositivo',
  'temperatura' // no fim: assim as linhas gravadas antes dela continuam alinhadas
];

var MAX_CARACTERES = 200;
var MAX_OBSERVACAO = 500; // resumo da conversa, escrito na tela do QR
var MAX_LEADS_POR_REQUISICAO = 50;
var ESPERA_LOCK_MS = 10000;

var FUSO = 'America/Sao_Paulo';
var FORMATO_DATA_HORA = 'yyyy-mm-dd hh:mm:ss';
var FORMATO_DATA = 'yyyy-mm-dd';

// Valores que o app envia -> texto gravado na planilha.
var PROXIMOS_PASSOS = { reuniao: 'Reunião', contato: 'Contato' };
var ORIGENS = { qr: 'QR', manual: 'Manual' };
var TEMPERATURAS = { quente: 'Quente', morno: 'Morno', frio: 'Frio' };

/* ---------- Configuração inicial (rodar uma vez, pelo editor) ---------- */

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(FUSO);

  var leads = obterOuCriarAba_(ss, ABA_LEADS);
  if (leads.getLastRow() === 0) {
    leads.getRange(1, 1, 1, COLUNAS.length).setValues([COLUNAS]).setFontWeight('bold');
    leads.setFrozenRows(1);
  } else {
    garantirCabecalho_(leads);
  }

  // Dashboard e Ranking só têm fórmulas e gráficos: monta se algum estiver vazio
  // (para refazer: menu Leads > Recriar Dashboard).
  if (painelVazio_(ss.getSheetByName(ABA_DASHBOARD)) || painelVazio_(ss.getSheetByName(ABA_RANKING))) {
    montarPaineis_(ss);
  }

  var config = obterOuCriarAba_(ss, ABA_CONFIG);
  if (config.getLastRow() === 0) {
    config.appendRow(['chave', 'valor']);
    config.getRange(1, 1, 1, 2).setFontWeight('bold');
  }
  if (!lerToken_()) {
    config.appendRow(['token', texto_(gerarToken_())]);
  }

  Logger.log('Planilha pronta. Token (copie para o config.js): ' + lerToken_());
}

/* ---------- Web App ---------- */

function doGet() {
  return json_({ ok: true, versao: VERSAO });
}

function doPost(e) {
  try {
    var corpo;
    try {
      corpo = JSON.parse(e && e.postData ? e.postData.contents : '');
    } catch (erroJson) {
      return json_({ ok: false, erro: 'JSON inválido' });
    }

    var token = lerToken_();
    if (!corpo || !token || String(corpo.token) !== token) {
      return json_({ ok: false, erro: 'Token inválido' });
    }
    if (!Array.isArray(corpo.leads)) {
      return json_({ ok: false, erro: 'Campo leads ausente' });
    }
    if (corpo.leads.length > MAX_LEADS_POR_REQUISICAO) {
      return json_({ ok: false, erro: 'Máximo de ' + MAX_LEADS_POR_REQUISICAO + ' leads por requisição' });
    }

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(ESPERA_LOCK_MS)) {
      return json_({ ok: false, erro: 'Servidor ocupado, tente de novo' });
    }
    try {
      var resultado = gravarLeads_(corpo.leads);
      return json_({ ok: true, gravados: resultado.gravados, ignorados: resultado.ignorados });
    } finally {
      lock.releaseLock();
    }
  } catch (erro) {
    return json_({ ok: false, erro: String(erro && erro.message ? erro.message : erro) });
  }
}

/* ---------- Menu da planilha ---------- */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Leads')
    .addItem('Importar backup', 'importarBackup')
    .addItem('Recriar Dashboard', 'recriarDashboard')
    .addToUi();
}

/* ---------- Backup (plano B) ---------- */

var PREFIXO_BACKUP = 'LEADS1:';
var ESPERA_LOCK_IMPORTACAO_MS = 30000;

// Caixa para colar o texto "LEADS1:..." ou escolher o arquivo .txt exportado pelo app.
var HTML_IMPORTAR = [
  '<style>',
  'body{font-family:Arial,sans-serif;font-size:14px;margin:0}',
  'textarea{width:100%;height:170px;box-sizing:border-box;font-family:monospace;font-size:12px}',
  '.linha{margin:10px 0}button{padding:8px 18px;font-size:14px}',
  '#resultado{margin-top:12px;font-weight:bold;white-space:pre-wrap}',
  '</style>',
  '<p>Escolha o arquivo <b>.txt</b> recebido do voluntário ou cole o texto que começa com <b>LEADS1:</b>.',
  ' Leads que já estão na planilha não são duplicados.</p>',
  '<div class="linha"><input type="file" id="arquivo" accept=".txt,text/plain"></div>',
  '<textarea id="texto" placeholder="LEADS1:..."></textarea>',
  '<div class="linha"><button id="importar">Importar</button></div>',
  '<div id="resultado"></div>',
  '<script>',
  'var arquivo=document.getElementById("arquivo"),texto=document.getElementById("texto"),',
  'botao=document.getElementById("importar"),resultado=document.getElementById("resultado");',
  'arquivo.onchange=function(){var f=arquivo.files[0];if(!f)return;var leitor=new FileReader();',
  'leitor.onload=function(){texto.value=leitor.result;};leitor.readAsText(f);};',
  'botao.onclick=function(){botao.disabled=true;resultado.textContent="Importando…";',
  'google.script.run.withSuccessHandler(function(m){resultado.textContent=m;botao.disabled=false;})',
  '.withFailureHandler(function(e){resultado.textContent="Erro: "+e.message;botao.disabled=false;})',
  '.importarTextoDeBackup(texto.value);};',
  '</script>'
].join('\n');

// Menu Leads > Importar backup.
function importarBackup() {
  var html = HtmlService.createHtmlOutput(HTML_IMPORTAR).setWidth(560).setHeight(430);
  SpreadsheetApp.getUi().showModalDialog(html, 'Importar backup de leads');
}

/**
 * Chamado pela caixa de importação. Grava os leads do backup que ainda não estão na planilha
 * (mesma regra do doPost: o id decide) e devolve um resumo para mostrar na caixa.
 */
function importarTextoDeBackup(texto) {
  var leads = lerBackup_(texto);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(ESPERA_LOCK_IMPORTACAO_MS)) {
    throw new Error('A planilha está ocupada recebendo leads. Tente de novo em alguns segundos.');
  }
  var resultado;
  try {
    resultado = gravarLeads_(leads);
  } finally {
    lock.releaseLock();
  }
  var semId = leads.length - resultado.gravados.length - resultado.ignorados.length;
  return resultado.gravados.length + ' lead(s) importado(s); ' +
    resultado.ignorados.length + ' já estava(m) na planilha' +
    (semId > 0 ? '; ' + semId + ' sem id, ignorado(s)' : '') + '.';
}

// "LEADS1:" + Base64 do JSON em UTF-8. Espaços e quebras de linha no meio são ignorados.
function lerBackup_(texto) {
  var limpo = String(texto || '').replace(/\s+/g, '');
  if (limpo.indexOf(PREFIXO_BACKUP) !== 0) {
    throw new Error('O texto do backup precisa começar com ' + PREFIXO_BACKUP);
  }
  var leads;
  try {
    var json = Utilities.newBlob(Utilities.base64Decode(limpo.slice(PREFIXO_BACKUP.length))).getDataAsString('UTF-8');
    leads = JSON.parse(json);
  } catch (erro) {
    throw new Error('O texto do backup está incompleto ou corrompido. Exporte de novo no celular.');
  }
  if (!Array.isArray(leads)) throw new Error('O texto do backup não tem uma lista de leads.');
  return leads;
}

function recriarDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  garantirCabecalho_(obterOuCriarAba_(ss, ABA_LEADS));
  var problemas = montarPaineis_(ss);
  SpreadsheetApp.getUi().alert(problemas.length
    ? 'Dashboard e Ranking recriados, mas ' + problemas.length + ' fórmula(s) com problema: ' + problemas.join(', ') +
      '. Envie esta mensagem para quem mantém o app.'
    : 'Dashboard e Ranking recriados. Todas as fórmulas calcularam.');
}

/* ---------- Dashboard e Ranking ---------- */

var VERDE = '#6BDD3E';
var LIMA = '#E4EF3A';
var CORES_TEMPERATURA = ['#FF6B35', '#F2C14E', '#5BC0EB']; // quente, morno, frio
var CORES_DIAS = [VERDE, LIMA, '#5BC0EB', '#FF6B35', '#B39DDB'];
var CINZA_CABECALHO = '#EFEFEF';
var LINHAS_RESERVADAS = 200; // tamanho das áreas lidas pelos gráficos
var SEM_LEADS = 'Sem leads ainda'; // o que as tabelas mostram com a aba Leads vazia
var LOCALIDADE_DAS_FORMULAS = 'en_US';

function painelVazio_(aba) {
  return !aba || (aba.getLastRow() === 0 && aba.getCharts().length === 0);
}

/**
 * Apaga e monta as abas Dashboard (visão geral) e Ranking (leaderboard e métricas por voluntário).
 * Tudo com fórmulas, que atualizam sozinhas a cada lead que chega.
 * As fórmulas são escritas em inglês, com vírgula. Uma planilha em português lê ponto e vírgula,
 * então a localidade fica en_US só durante a escrita; ao voltar, o Google converte as fórmulas.
 * Retorna as células com problema (vazio se tudo calculou).
 */
function montarPaineis_(ss) {
  var dashboard = obterOuCriarAba_(ss, ABA_DASHBOARD);
  var ranking = obterOuCriarAba_(ss, ABA_RANKING);
  var localidade = ss.getSpreadsheetLocale();
  var trocar = localidade !== LOCALIDADE_DAS_FORMULAS;
  if (trocar) ss.setSpreadsheetLocale(LOCALIDADE_DAS_FORMULAS);
  try {
    escreverDashboard_(dashboard);
    escreverRanking_(ranking);
    SpreadsheetApp.flush();
  } finally {
    if (trocar) ss.setSpreadsheetLocale(localidade);
  }
  SpreadsheetApp.flush();

  ss.setActiveSheet(ranking);
  ss.moveActiveSheet(1);
  ss.setActiveSheet(dashboard);
  ss.moveActiveSheet(1);

  var temLeads = obterOuCriarAba_(ss, ABA_LEADS).getLastRow() > 1;
  var problemas = conferirPainel_(dashboard, temLeads).concat(conferirPainel_(ranking, temLeads));
  Logger.log(problemas.length
    ? 'Painéis com problemas: ' + problemas.join(', ')
    : 'Painéis ok: todas as fórmulas calcularam.');
  return problemas;
}

// Lê o que cada fórmula mostra: erro (#ERROR!, #N/A...) ou "Sem leads ainda" com leads na planilha.
function conferirPainel_(aba, temLeads) {
  var faixa = aba.getDataRange();
  var formulas = faixa.getFormulas();
  var mostrados = faixa.getDisplayValues();
  var problemas = [];
  formulas.forEach(function (linha, i) {
    linha.forEach(function (formula, j) {
      var mostrado = mostrados[i][j];
      if (formula && (/^#/.test(mostrado) || (temLeads && mostrado === SEM_LEADS))) {
        problemas.push(aba.getName() + '!' + letraDaColuna_(j + 1) + (i + 1) + ' (' + mostrado + ')');
      }
    });
  });
  return problemas;
}

function limparPainel_(aba, titulo, subtitulo) {
  aba.getCharts().forEach(function (grafico) {
    aba.removeChart(grafico);
  });
  aba.clear();
  aba.getRange('A1').setValue(titulo).setFontSize(16).setFontWeight('bold');
  aba.getRange('A2').setValue(subtitulo).setFontColor('#666666');
}

/* Dashboard: visão geral do estande. */
function escreverDashboard_(aba) {
  limparPainel_(aba, 'Dashboard de leads',
    'Atualiza sozinho a cada lead que chega. Ranking dos voluntários na aba Ranking. Para refazer: menu Leads > Recriar Dashboard.');

  // Resumo
  aba.getRange('A4:A6').setValues([['Total de leads'], ['Último lead recebido'], ['Horário de pico']]).setFontWeight('bold');
  aba.getRange('B4').setFormula(f_('=COUNTA({id})'));
  aba.getRange('B5').setFormula(f_('=IF(B4=0,"—",MAX({recebido_em}))')).setNumberFormat('dd/mm/yyyy hh:mm:ss');
  aba.getRange('B6').setFormula(f_('=' + pico_('FILTER({hora},{hora}<>"")')));

  tabelaDeContagem_(aba, 8, 'Próximo passo', [
    ['Reunião', '=COUNTIF({proximo_passo},"Reunião")'],
    ['Contato', '=COUNTIF({proximo_passo},"Contato")']
  ]);
  tabelaDeContagem_(aba, 12, 'Temperatura', [
    ['🔥 Quente', '=COUNTIF({temperatura},"Quente")'],
    ['💨 Morno', '=COUNTIF({temperatura},"Morno")'],
    ['❄️ Frio', '=COUNTIF({temperatura},"Frio")'],
    ['Sem temperatura', '=COUNTIFS({id},"<>",{temperatura},"")']
  ]);
  tabelaDeContagem_(aba, 18, 'Qualidade do contato', [
    ['Com celular', '=COUNTA({celular})'],
    ['Com e-mail', '=COUNTA({email})'],
    ['Com os dois', '=COUNTIFS({celular},"<>",{email},"<>")']
  ]);
  tabelaDeContagem_(aba, 23, 'Leitura do crachá', [
    ['QR', '=COUNTIF({origem_nome},"QR")'],
    ['Manual', '=COUNTIF({origem_nome},"Manual")']
  ]);

  // Tipo de crachá (DOI, FD...) cruzado com o próximo passo. Lead digitado não tem tipo: "Sem crachá".
  titulo_(aba, 'A27', 'Tipo de crachá × próximo passo');
  aba.getRange('A28').setFormula(f_(
    '=IFERROR(QUERY({ARRAYFORMULA(IF({cracha_tipo}="","Sem crachá",{cracha_tipo})),{proximo_passo},{id}},' +
    '"select Col1, count(Col3) where Col3 is not null group by Col1 pivot Col2 label Col1 \'Tipo de crachá\'",0),' +
    '"' + SEM_LEADS + '")'
  ));

  // Crachás cadastrados mais de uma vez (no mesmo celular ou em celulares diferentes).
  titulo_(aba, 'A34', 'Crachás com mais de um cadastro');
  var porCracha = 'QUERY({todas},"select [cracha_codigo], count([id]) where [cracha_codigo] is not null ' +
    'group by [cracha_codigo] label count([id]) \'\'",0)';
  aba.getRange('B34').setFormula(f_('=IFERROR(ROWS(QUERY(' + porCracha + ',"select Col1 where Col2 > 1",0)),0)'));
  aba.getRange('A35').setFormula(f_('=IFERROR(QUERY(' + porCracha + ',"select Col1, Col2 where Col2 > 1 order by Col2 desc ' +
    'label Col1 \'Crachá\', Col2 \'Cadastros\'",0),"Nenhum")'));

  // Por dia: volume, próximo passo, temperatura e horário de pico de cada dia.
  titulo_(aba, 'E4', 'Por dia');
  cabecalho_(aba.getRange('E5:L5').setValues([[
    'Dia', 'Leads', 'Reunião', 'Contato', '🔥 Quente', '💨 Morno', '❄️ Frio', 'Horário de pico'
  ]]));
  aba.getRange('E6').setFormula(f_(
    '=IFERROR(LET(datas,SORT(UNIQUE(FILTER({data},{data}<>""))),' +
    'qtd,MAP(datas,LAMBDA(x,COUNTIFS({data},x,{id},"<>"))),' +
    'reuniao,MAP(datas,LAMBDA(x,COUNTIFS({data},x,{proximo_passo},"Reunião"))),' +
    'contato,MAP(datas,LAMBDA(x,COUNTIFS({data},x,{proximo_passo},"Contato"))),' +
    'quente,MAP(datas,LAMBDA(x,COUNTIFS({data},x,{temperatura},"Quente"))),' +
    'morno,MAP(datas,LAMBDA(x,COUNTIFS({data},x,{temperatura},"Morno"))),' +
    'frio,MAP(datas,LAMBDA(x,COUNTIFS({data},x,{temperatura},"Frio"))),' +
    'pico,MAP(datas,LAMBDA(x,' + pico_('FILTER({hora},{data}=x)') + ')),' +
    '{datas,qtd,reuniao,contato,quente,morno,frio,pico}),"' + SEM_LEADS + '")'
  ));
  aba.getRange(6, 5, LINHAS_RESERVADAS, 1).setNumberFormat('dd/mm/yyyy');

  // Leads por hora, uma coluna por dia: mostra os horários de pico do estande e compara os dias.
  titulo_(aba, 'N4', 'Leads por hora (uma coluna por dia)');
  aba.getRange('N5').setFormula(f_(
    '=IFERROR(QUERY({{hora},ARRAYFORMULA(TEXT({data},"dd/mm")),{id}},' +
    '"select Col1, count(Col3) where Col3 is not null and Col1 is not null group by Col1 pivot Col2 order by Col1 ' +
    'label Col1 \'Hora\'",0),"' + SEM_LEADS + '")'
  ));
  aba.getRange(6, 14, LINHAS_RESERVADAS, 1).setNumberFormat('00"h"');

  [[1, 230], [2, 150], [3, 70], [5, 100], [6, 70], [7, 75], [8, 75], [9, 85], [10, 85], [11, 75], [12, 120], [14, 70]]
    .forEach(function (par) {
      aba.setColumnWidth(par[0], par[1]);
    });

  // Mesmas cores dos botões do app: reunião verde, contato amarelo-lima.
  inserirGrafico_(aba, Charts.ChartType.PIE, [aba.getRange('A9:B10')], 0, 4, 24, 'Reunião × Contato', { colors: [VERDE, LIMA] });
  inserirGrafico_(aba, Charts.ChartType.PIE, [aba.getRange('A13:B15')], 0, 22, 24, 'Temperatura dos leads',
    { colors: CORES_TEMPERATURA });
  inserirGrafico_(aba, Charts.ChartType.COLUMN, [aba.getRange(5, 14, LINHAS_RESERVADAS + 1, 6)], 1, 40, 24,
    'Leads por hora (uma cor por dia)', { colors: CORES_DIAS });
}

/* Ranking: leaderboard e métricas pessoais de cada voluntário. */
function escreverRanking_(aba) {
  limparPainel_(aba, 'Ranking dos voluntários', '');
  // Quais datas são o Dia 1 e o Dia 2 (os dois primeiros dias com leads).
  aba.getRange('A2').setFormula(f_(
    '=IFERROR("Dia 1 = "&TEXT(SMALL(UNIQUE(FILTER({data},{data}<>"")),1),"dd/mm")&' +
    'IFERROR("   ·   Dia 2 = "&TEXT(SMALL(UNIQUE(FILTER({data},{data}<>"")),2),"dd/mm")&' +
    '"   ·   Evolução = Dia 2 comparado ao Dia 1",""),"' + SEM_LEADS + '")'
  ));

  cabecalho_(aba.getRange('A4:J4').setValues([[
    'Posição', 'Voluntário', 'Leads', '🔥 Quentes', 'Reuniões', '% reunião', 'Dia 1', 'Dia 2', 'Evolução', 'Horário de pico'
  ]]));
  // Ordem: mais leads; empate, mais quentes; depois nome.
  aba.getRange('A5').setFormula(f_(
    '=IFERROR(LET(vol,UNIQUE(FILTER({voluntario},{id}<>"")),' +
    'total,MAP(vol,LAMBDA(x,COUNTIFS({voluntario},x,{id},"<>"))),' +
    'quentes,MAP(vol,LAMBDA(x,COUNTIFS({voluntario},x,{temperatura},"Quente"))),' +
    'reunioes,MAP(vol,LAMBDA(x,COUNTIFS({voluntario},x,{proximo_passo},"Reunião"))),' +
    'datas,SORT(UNIQUE(FILTER({data},{data}<>""))),' +
    'diaum,INDEX(datas,1,1),' +
    'diadois,IF(ROWS(datas)>1,INDEX(datas,2,1),""),' +
    'noum,MAP(vol,LAMBDA(x,COUNTIFS({voluntario},x,{data},diaum))),' +
    'nodois,MAP(vol,LAMBDA(x,IF(diadois="","",COUNTIFS({voluntario},x,{data},diadois)))),' +
    'evolucao,MAP(noum,nodois,LAMBDA(antes,depois,IF(OR(depois="",antes=0),"",(depois-antes)/antes))),' +
    'pico,MAP(vol,LAMBDA(x,' + pico_('FILTER({hora},{voluntario}=x)') + ')),' +
    'tabela,SORT({vol,total,quentes,reunioes,MAP(reunioes,total,LAMBDA(parte,tudo,parte/tudo)),noum,nodois,evolucao,pico},' +
    '2,FALSE,3,FALSE,1,TRUE),' +
    '{MAP(SEQUENCE(ROWS(tabela)),LAMBDA(posicao,IF(posicao=1,"🥇 1º",IF(posicao=2,"🥈 2º",' +
    'IF(posicao=3,"🥉 3º",posicao&"º"))))),tabela}),' +
    '"' + SEM_LEADS + '")'
  ));
  aba.getRange(5, 6, LINHAS_RESERVADAS, 1).setNumberFormat('0%');
  aba.getRange(5, 9, LINHAS_RESERVADAS, 1).setNumberFormat('+0%;-0%;0%');

  [[1, 80], [2, 180], [3, 70], [4, 90], [5, 85], [6, 90], [7, 65], [8, 65], [9, 90], [10, 120]].forEach(function (par) {
    aba.setColumnWidth(par[0], par[1]);
  });

  inserirGrafico_(aba, Charts.ChartType.BAR, [aba.getRange(4, 2, LINHAS_RESERVADAS + 1, 2)], 1, 4, 12,
    'Leads por voluntário', { colors: [VERDE], legend: { position: 'none' } });
  inserirGrafico_(aba, Charts.ChartType.COLUMN,
    [aba.getRange(4, 2, LINHAS_RESERVADAS + 1, 1), aba.getRange(4, 7, LINHAS_RESERVADAS + 1, 2)], 1, 22, 12,
    'Dia 1 × Dia 2 por voluntário', { colors: [VERDE, LIMA] });
}

/**
 * Fórmula do horário com mais leads entre as horas dadas (empate: o mais cedo), como "10h"; sem horas, "—".
 * Usa nomes próprios (horas, unicas, k) para não colidir com os nomes do LET de fora.
 */
function pico_(horas) {
  return 'IFERROR(TEXT(LET(horas,' + horas + ',unicas,UNIQUE(horas),' +
    'INDEX(SORT({unicas,MAP(unicas,LAMBDA(k,SUMPRODUCT(--(horas=k))))},2,FALSE,1,TRUE),1,1)),"00")&"h","—")';
}

// Cabeçalho [título, Leads, %] e uma linha por item: [rótulo, fórmula da contagem]. % sobre o total (B4).
function tabelaDeContagem_(aba, linha, titulo, itens) {
  cabecalho_(aba.getRange(linha, 1, 1, 3).setValues([[titulo, 'Leads', '%']]));
  itens.forEach(function (item, i) {
    var l = linha + 1 + i;
    aba.getRange(l, 1).setValue(item[0]);
    aba.getRange(l, 2).setFormula(f_(item[1]));
    aba.getRange(l, 3).setFormula('=IF($B$4=0,0,B' + l + '/$B$4)').setNumberFormat('0%');
  });
}

function titulo_(aba, celula, texto) {
  aba.getRange(celula).setValue(texto).setFontWeight('bold').setFontSize(12);
}

function cabecalho_(intervalo) {
  return intervalo.setFontWeight('bold').setBackground(CINZA_CABECALHO);
}

// Gráfico flutuante na linha/coluna dadas. intervalos: o primeiro é o eixo (rótulos), os outros as séries.
function inserirGrafico_(aba, tipo, intervalos, linhasDeCabecalho, linha, coluna, titulo, opcoes) {
  var construtor = aba.newChart().setChartType(tipo).setPosition(linha, coluna, 0, 0).setOption('title', titulo);
  intervalos.forEach(function (intervalo) {
    construtor.addRange(intervalo);
  });
  if (linhasDeCabecalho) construtor.setNumHeaders(linhasDeCabecalho);
  Object.keys(opcoes).forEach(function (chave) {
    construtor.setOption(chave, opcoes[chave]);
  });
  aba.insertChart(construtor.build());
}

/**
 * Troca os nomes das colunas pela posição real na aba Leads (constante COLUNAS):
 * {campo} vira o intervalo "Leads!X2:X", [campo] vira a letra "X" (para o texto da QUERY)
 * e {todas} vira "Leads!A2:<última coluna>". Nome errado interrompe o setup, em vez de gerar fórmula quebrada.
 */
function f_(modelo) {
  var ultima = letraDaColuna_(COLUNAS.length);
  return modelo
    .replace(/\{todas\}/g, ABA_LEADS + '!A2:' + ultima)
    .replace(/\{(\w+)\}/g, function (_, nome) {
      var letra = letraDe_(nome);
      return ABA_LEADS + '!' + letra + '2:' + letra;
    })
    .replace(/\[(\w+)\]/g, function (_, nome) {
      return letraDe_(nome);
    });
}

function letraDe_(nome) {
  var posicao = colunaDe_(nome);
  if (!posicao) throw new Error('Coluna desconhecida no Dashboard: ' + nome);
  return letraDaColuna_(posicao);
}

function letraDaColuna_(numero) {
  var letras = '';
  while (numero > 0) {
    var resto = (numero - 1) % 26;
    letras = String.fromCharCode(65 + resto) + letras;
    numero = Math.floor((numero - 1) / 26);
  }
  return letras;
}

/* ---------- Gravação ---------- */

/**
 * Grava os leads cujo id ainda não está na coluna A. Quem chama deve segurar o lock.
 * Retorna { gravados: [ids], ignorados: [ids que já existiam] }.
 */
function gravarLeads_(leads) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var aba = ss.getSheetByName(ABA_LEADS);
  if (!aba) throw new Error('Aba Leads não encontrada. Rode setup() primeiro.');

  var fuso = ss.getSpreadsheetTimeZone();
  var existentes = idsExistentes_(aba);
  var recebidoEm = new Date();
  var linhas = [];
  var gravados = [];
  var ignorados = [];

  leads.forEach(function (lead) {
    var id = lead ? limitar_(lead.id) : '';
    if (!id) return;
    if (existentes[id]) {
      ignorados.push(id);
      return;
    }
    existentes[id] = true;
    linhas.push(montarLinha_(lead, id, recebidoEm, fuso));
    gravados.push(id);
  });

  if (linhas.length) {
    var primeira = aba.getLastRow() + 1;
    var faltam = primeira + linhas.length - 1 - aba.getMaxRows();
    if (faltam > 0) aba.insertRowsAfter(aba.getMaxRows(), faltam);

    aba.getRange(primeira, 1, linhas.length, COLUNAS.length).setValues(linhas);
    formatarDatas_(aba, primeira, linhas.length);
    SpreadsheetApp.flush();
  }

  return { gravados: gravados, ignorados: ignorados };
}

function montarLinha_(lead, id, recebidoEm, fuso) {
  var capturadoEm = lerData_(lead.capturado_em);
  var valores = {
    id: texto_(id),
    recebido_em: recebidoEm,
    // O horário vem do celular: o lead pode ter sido enviado horas depois.
    capturado_em: capturadoEm || '',
    data: capturadoEm ? inicioDoDia_(capturadoEm, fuso) : '',
    hora: capturadoEm ? Number(Utilities.formatDate(capturadoEm, fuso, 'H')) : '',
    voluntario: texto_(lead.voluntario),
    cracha_codigo: texto_(lead.cracha_codigo),
    cracha_tipo: texto_(lead.cracha_tipo),
    nome: texto_(lead.nome),
    empresa: texto_(lead.empresa),
    celular: texto_(lead.celular),
    email: texto_(lead.email),
    proximo_passo: rotulo_(PROXIMOS_PASSOS, lead.proximo_passo),
    observacao: texto_(lead.observacao, MAX_OBSERVACAO),
    autorizou_contato: lead.autorizou_contato === true ? 'Sim' : 'Não',
    origem_nome: rotulo_(ORIGENS, lead.origem_nome),
    dispositivo: texto_(lead.dispositivo),
    temperatura: rotulo_(TEMPERATURAS, lead.temperatura)
  };
  return COLUNAS.map(function (coluna) {
    return valores[coluna];
  });
}

function idsExistentes_(aba) {
  var ids = {};
  var total = aba.getLastRow() - 1;
  if (total < 1) return ids;
  aba.getRange(2, 1, total, 1).getValues().forEach(function (linha) {
    if (linha[0] !== '') ids[String(linha[0])] = true;
  });
  return ids;
}

function formatarDatas_(aba, primeiraLinha, quantidade) {
  [
    ['recebido_em', FORMATO_DATA_HORA],
    ['capturado_em', FORMATO_DATA_HORA],
    ['data', FORMATO_DATA]
  ].forEach(function (par) {
    aba.getRange(primeiraLinha, colunaDe_(par[0]), quantidade, 1).setNumberFormat(par[1]);
  });
}

/* ---------- Utilitários ---------- */

function obterOuCriarAba_(ss, nome) {
  return ss.getSheetByName(nome) || ss.insertSheet(nome);
}

// Escreve no cabeçalho da aba Leads os nomes de colunas novas (ex.: temperatura), sem mexer nos dados.
function garantirCabecalho_(aba) {
  var faltam = COLUNAS.length - aba.getMaxColumns();
  if (faltam > 0) aba.insertColumnsAfter(aba.getMaxColumns(), faltam);
  var atual = aba.getRange(1, 1, 1, COLUNAS.length).getValues()[0];
  COLUNAS.forEach(function (nome, i) {
    if (atual[i] === '') aba.getRange(1, i + 1).setValue(nome).setFontWeight('bold');
  });
}

function lerToken_() {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_CONFIG);
  if (!aba || aba.getLastRow() === 0) return '';
  var linhas = aba.getRange(1, 1, aba.getLastRow(), 2).getValues();
  for (var i = 0; i < linhas.length; i++) {
    if (String(linhas[i][0]).trim() === 'token') return String(linhas[i][1]).trim();
  }
  return '';
}

function gerarToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function colunaDe_(nome) {
  return COLUNAS.indexOf(nome) + 1;
}

// Converte para texto, tira espaços das pontas e corta em maximo (padrão: MAX_CARACTERES).
function limitar_(valor, maximo) {
  if (valor === null || valor === undefined) return '';
  return String(valor).trim().slice(0, maximo || MAX_CARACTERES);
}

// Texto pronto para a planilha. O apóstrofo faz a planilha guardar exatamente o que veio,
// sem converter em número, data ou fórmula (quem envia pode ser qualquer pessoa).
function texto_(valor, maximo) {
  var limpo = limitar_(valor, maximo);
  return limpo ? "'" + limpo : '';
}

function rotulo_(mapa, valor) {
  return Object.prototype.hasOwnProperty.call(mapa, valor) ? mapa[valor] : texto_(valor);
}

function lerData_(valor) {
  if (!valor) return null;
  var data = new Date(valor);
  return isNaN(data.getTime()) ? null : data;
}

function inicioDoDia_(data, fuso) {
  var dia = Utilities.formatDate(data, fuso, 'yyyy-MM-dd');
  return Utilities.parseDate(dia, fuso, 'yyyy-MM-dd');
}

function json_(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto)).setMimeType(ContentService.MimeType.JSON);
}
