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

  // Fórmulas e gráficos do Dashboard entram na fase 8.
  obterOuCriarAba_(ss, ABA_DASHBOARD);

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

// Implementado na fase 8.
function recriarDashboard() {
  SpreadsheetApp.getUi().alert('O Dashboard ainda não foi implementado (fase 8).');
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
