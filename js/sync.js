// Envio dos leads pendentes para o Apps Script, em lotes.
(function (global) {
  'use strict';

  var config = global.APP_CONFIG;
  var Core = global.Core;
  var Fila = global.Fila;
  var TEMPO_LIMITE_MS = 15000;

  var emAndamento = null;
  var ouvintes = [];
  // Lead ainda na tela do QR: a opção pode ser trocada, então só sai ao tocar em "Novo lead".
  // Fica só na memória: se o app fechar, o lead é enviado na próxima abertura.
  var retido = null;

  function enviaveis() {
    return Fila.pendentes().filter(function (lead) {
      return lead.id !== retido;
    });
  }

  function estado() {
    return { pendentes: Fila.pendentes().length, enviando: !!emAndamento, retido: !!retido };
  }

  function reter(id) {
    retido = id;
  }

  function liberar() {
    retido = null;
    return enviar();
  }

  function aoMudar(ouvinte) {
    ouvintes.push(ouvinte);
  }

  function avisarMudanca() {
    var atual = estado();
    ouvintes.forEach(function (ouvinte) {
      ouvinte(atual);
    });
  }

  // O status só existe no celular; a planilha recebe o resto.
  function semStatus(lead) {
    var copia = {};
    Object.keys(lead).forEach(function (campo) {
      if (campo !== 'status') copia[campo] = lead[campo];
    });
    return copia;
  }

  // Sem Content-Type: o corpo vai como texto simples e evita a verificação prévia de CORS,
  // que o Apps Script não atende. Resolve com os ids confirmados.
  function enviarLote(lote) {
    var controle = typeof AbortController === 'function' ? new AbortController() : null;
    var temporizador;
    var tempoEsgotado = new Promise(function (_, rejeitar) {
      temporizador = setTimeout(function () {
        if (controle) controle.abort();
        rejeitar(new Error('Sem resposta em 15 segundos'));
      }, TEMPO_LIMITE_MS);
    });
    var requisicao = fetch(config.apiUrl, {
      method: 'POST',
      body: JSON.stringify({ token: config.token, leads: lote.map(semStatus) }),
      signal: controle ? controle.signal : undefined
    })
      .then(function (resposta) {
        if (!resposta.ok) throw new Error('HTTP ' + resposta.status);
        return resposta.json();
      })
      .then(function (corpo) {
        if (!corpo || corpo.ok !== true) throw new Error((corpo && corpo.erro) || 'Resposta inválida');
        return Core.idsConfirmados(corpo);
      });

    return Promise.race([requisicao, tempoEsgotado]).then(
      function (ids) {
        clearTimeout(temporizador);
        return ids;
      },
      function (erro) {
        clearTimeout(temporizador);
        throw erro;
      }
    );
  }

  /**
   * Envia todos os pendentes, um lote por vez. Nunca rejeita: resolve com { enviados, erro? }.
   * Se já houver um envio em andamento, devolve o mesmo.
   */
  function enviar() {
    if (emAndamento) return emAndamento;
    if (!enviaveis().length) return Promise.resolve({ enviados: 0 });

    var enviados = 0;
    function proximoLote() {
      var lote = enviaveis().slice(0, config.loteMaximo);
      if (!lote.length) return { enviados: enviados };
      return enviarLote(lote).then(function (ids) {
        var marcados = Fila.marcarEnviados(ids);
        enviados += marcados;
        avisarMudanca();
        // Nenhum confirmado: para, em vez de repetir o mesmo lote sem fim. O próximo ciclo tenta de novo.
        if (!marcados) return { enviados: enviados, erro: 'A planilha não confirmou o lote' };
        return proximoLote();
      });
    }

    emAndamento = Promise.resolve()
      .then(proximoLote)
      .catch(function (erro) {
        return { enviados: enviados, erro: String((erro && erro.message) || erro) };
      })
      .then(function (resultado) {
        emAndamento = null;
        avisarMudanca();
        return resultado;
      });
    avisarMudanca();
    return emAndamento;
  }

  // Envia na abertura (pendentes de antes), quando a internet volta e a cada intervalo enquanto houver o que enviar.
  function iniciar() {
    global.addEventListener('online', enviar);
    setInterval(function () {
      if (navigator.onLine !== false && enviaveis().length) enviar();
    }, config.intervaloSyncSegundos * 1000);
    enviar();
  }

  global.Sync = {
    iniciar: iniciar,
    enviar: enviar,
    estado: estado,
    aoMudar: aoMudar,
    reter: reter,
    liberar: liberar
  };
})(window);
