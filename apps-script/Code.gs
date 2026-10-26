/**
 * Backend do app de captação de leads.
 *
 * Cole este arquivo no editor do Apps Script da planilha (Extensões > Apps Script),
 * rode setup() uma vez e publique como App da Web (veja o PLANO.md).
 */

// Pede acesso só a esta planilha, não a todas as planilhas da conta.
/** @OnlyCurrentDoc */

var VERSAO = '1';

var ABA_LEADS = 'Leads';
var ABA_DASHBOARD = 'Dashboard';
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
  'dispositivo'
];

var MAX_CARACTERES = 200;
var MAX_LEADS_POR_REQUISICAO = 50;
var ESPERA_LOCK_MS = 10000;

var FUSO = 'America/Sao_Paulo';
var FORMATO_DATA_HORA = 'yyyy-mm-dd hh:mm:ss';
var FORMATO_DATA = 'yyyy-mm-dd';

// Valores que o app envia -> texto gravado na planilha.
var PROXIMOS_PASSOS = { reuniao: 'Reunião', contato: 'Contato' };
var ORIGENS = { qr: 'QR', manual: 'Manual' };

/* ---------- Configuração inicial (rodar uma vez, pelo editor) ---------- */

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(FUSO);

  var leads = obterOuCriarAba_(ss, ABA_LEADS);
  if (leads.getLastRow() === 0) {
    leads.getRange(1, 1, 1, COLUNAS.length).setValues([COLUNAS]).setFontWeight('bold');
    leads.setFrozenRows(1);
  }

  // Dashboard só tem fórmulas e gráficos: monta se estiver vazio (para refazer: menu Leads > Recriar Dashboard).
  var dashboard = obterOuCriarAba_(ss, ABA_DASHBOARD);
  if (dashboard.getLastRow() === 0 && dashboard.getCharts().length === 0) {
    montarDashboard_(dashboard);
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

// Implementado na fase 9.
function importarBackup() {
  SpreadsheetApp.getUi().alert('A importação de backup ainda não foi implementada (fase 9).');
}

function recriarDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  montarDashboard_(obterOuCriarAba_(ss, ABA_DASHBOARD));
  SpreadsheetApp.getUi().alert('Dashboard recriado.');
}

/* ---------- Dashboard ---------- */

var VERDE = '#6BDD3E';
var LIMA = '#E4EF3A';
var CINZA_CABECALHO = '#EFEFEF';
var LINHAS_RESERVADAS = 200; // tamanho das áreas lidas pelos gráficos

/**
 * Apaga e monta a aba Dashboard: KPIs com fórmulas (atualizam sozinhas) e três gráficos.
 * Fórmulas com nomes em inglês e vírgula como separador, como o Apps Script exige.
 */
function montarDashboard_(aba) {
  aba.getCharts().forEach(function (grafico) {
    aba.removeChart(grafico);
  });
  aba.clear();

  aba.getRange('A1').setValue('Dashboard de leads').setFontSize(16).setFontWeight('bold');
  aba.getRange('A2')
    .setValue('Atualiza sozinho a cada lead que chega. Para refazer: menu Leads > Recriar Dashboard.')
    .setFontColor('#666666');

  // Resumo
  aba.getRange('A4:A5').setValues([['Total de leads'], ['Último lead recebido']]).setFontWeight('bold');
  aba.getRange('B4').setFormula(f_('=COUNTA({id})'));
  aba.getRange('B5').setFormula(f_('=IF(B4=0,"—",MAX({recebido_em}))')).setNumberFormat('dd/mm/yyyy hh:mm:ss');

  tabelaDeContagem_(aba, 7, 'Próximo passo', [
    ['Reunião', '=COUNTIF({proximo_passo},"Reunião")'],
    ['Contato', '=COUNTIF({proximo_passo},"Contato")']
  ]);
  tabelaDeContagem_(aba, 11, 'Qualidade do contato', [
    ['Com celular', '=COUNTA({celular})'],
    ['Com e-mail', '=COUNTA({email})'],
    ['Com os dois', '=COUNTIFS({celular},"<>",{email},"<>")']
  ]);
  tabelaDeContagem_(aba, 16, 'Leitura do crachá', [
    ['QR', '=COUNTIF({origem_nome},"QR")'],
    ['Manual', '=COUNTIF({origem_nome},"Manual")']
  ]);

  // Tipo de crachá (DOI, FD...) cruzado com o próximo passo. Lead digitado não tem tipo: "Sem crachá".
  titulo_(aba, 'A20', 'Tipo de crachá × próximo passo');
  aba.getRange('A21').setFormula(f_(
    '=IFERROR(QUERY({ARRAYFORMULA(IF({cracha_tipo}="","Sem crachá",{cracha_tipo})),{proximo_passo},{id}},' +
    '"select Col1, count(Col3) where Col3 is not null group by Col1 pivot Col2 label Col1 \'Tipo de crachá\'",0),' +
    '"Sem leads ainda")'
  ));

  // Crachás cadastrados mais de uma vez (no mesmo celular ou em celulares diferentes).
  titulo_(aba, 'A27', 'Crachás com mais de um cadastro');
  var porCracha = 'QUERY({todas},"select [cracha_codigo], count([id]) where [cracha_codigo] is not null ' +
    'group by [cracha_codigo] label count([id]) \'\'",0)';
  aba.getRange('B27').setFormula(f_('=IFERROR(ROWS(QUERY(' + porCracha + ',"select Col1 where Col2 > 1",0)),0)'));
  aba.getRange('A28').setFormula(f_('=IFERROR(QUERY(' + porCracha + ',"select Col1, Col2 where Col2 > 1 order by Col2 desc ' +
    'label Col1 \'Crachá\', Col2 \'Cadastros\'",0),"Nenhum")'));

  // Ranking de voluntários, do maior total para o menor.
  titulo_(aba, 'E4', 'Ranking de voluntários');
  cabecalho_(aba.getRange('E5:I5').setValues([['Voluntário', 'Reunião', 'Contato', 'Total', '% reunião']]));
  aba.getRange('E6').setFormula(f_(
    '=IFERROR(SORT(LET(v,UNIQUE(FILTER({voluntario},{id}<>"")),' +
    'r,ARRAYFORMULA(COUNTIFS({voluntario},v,{proximo_passo},"Reunião")),' +
    'c,ARRAYFORMULA(COUNTIFS({voluntario},v,{proximo_passo},"Contato")),' +
    't,ARRAYFORMULA(COUNTIFS({voluntario},v,{id},"<>")),' +
    '{v,r,c,t,ARRAYFORMULA(r/t)}),4,FALSE,1,TRUE),"Sem leads ainda")'
  ));
  aba.getRange(6, 9, LINHAS_RESERVADAS, 1).setNumberFormat('0%');

  // Leads por dia e por hora (horário do celular, não da chegada).
  titulo_(aba, 'K4', 'Leads por dia');
  aba.getRange('K5').setFormula(f_(
    '=IFERROR(QUERY({todas},"select [data], count([id]) where [id] is not null group by [data] order by [data] ' +
    'label [data] \'Dia\', count([id]) \'Leads\'",0),"Sem leads ainda")'
  ));
  aba.getRange(6, 11, LINHAS_RESERVADAS, 1).setNumberFormat('dd/mm/yyyy');

  titulo_(aba, 'N4', 'Leads por hora');
  aba.getRange('N5').setFormula(f_(
    '=IFERROR(QUERY({ARRAYFORMULA(IF({id}="","",TEXT({data},"dd/mm")&" "&TEXT({hora},"00")&"h")),{id}},' +
    '"select Col1, count(Col2) where Col2 is not null group by Col1 order by Col1 ' +
    'label Col1 \'Dia e hora\', count(Col2) \'Leads\'",0),"Sem leads ainda")'
  ));

  [[1, 230], [2, 150], [3, 70], [5, 170], [6, 80], [7, 80], [8, 70], [9, 90], [11, 110], [12, 70], [14, 120], [15, 70]]
    .forEach(function (par) {
      aba.setColumnWidth(par[0], par[1]);
    });

  inserirGraficos_(aba);

  var ss = aba.getParent();
  ss.setActiveSheet(aba);
  ss.moveActiveSheet(1);
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

function inserirGraficos_(aba) {
  // Mesmas cores dos botões do app: reunião verde, contato amarelo-lima.
  aba.insertChart(aba.newChart()
    .setChartType(Charts.ChartType.PIE)
    .addRange(aba.getRange('A8:B9'))
    .setPosition(4, 17, 0, 0)
    .setOption('title', 'Reunião × Contato')
    .setOption('colors', [VERDE, LIMA])
    .build());

  aba.insertChart(aba.newChart()
    .setChartType(Charts.ChartType.BAR)
    .addRange(aba.getRange(5, 5, LINHAS_RESERVADAS + 1, 3)) // Voluntário, Reunião, Contato
    .setNumHeaders(1)
    .setPosition(22, 17, 0, 0)
    .setOption('title', 'Ranking de voluntários')
    .setOption('isStacked', true)
    .setOption('colors', [VERDE, LIMA])
    .build());

  aba.insertChart(aba.newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(aba.getRange(5, 14, LINHAS_RESERVADAS + 1, 2)) // Dia e hora, Leads
    .setNumHeaders(1)
    .setPosition(40, 17, 0, 0)
    .setOption('title', 'Leads por hora')
    .setOption('legend', { position: 'none' })
    .setOption('colors', [VERDE])
    .build());
}

/**
 * Troca os nomes das colunas pela posição real na aba Leads (constante COLUNAS):
 * {campo} vira o intervalo "Leads!X2:X", [campo] vira a letra "X" (para o texto da QUERY)
 * e {todas} vira "Leads!A2:Q". Nome errado interrompe o setup, em vez de gerar fórmula quebrada.
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
    observacao: texto_(lead.observacao),
    autorizou_contato: lead.autorizou_contato === true ? 'Sim' : 'Não',
    origem_nome: rotulo_(ORIGENS, lead.origem_nome),
    dispositivo: texto_(lead.dispositivo)
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

// Converte para texto, tira espaços das pontas e corta em MAX_CARACTERES.
function limitar_(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor).trim().slice(0, MAX_CARACTERES);
}

// Texto pronto para a planilha. O apóstrofo faz a planilha guardar exatamente o que veio,
// sem converter em número, data ou fórmula (quem envia pode ser qualquer pessoa).
function texto_(valor) {
  var limpo = limitar_(valor);
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
