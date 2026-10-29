// Leaderboard: quantos leads cada voluntário já tem na planilha. Só nomes e totais vêm de lá.
(function (global) {
  'use strict';

  var config = global.APP_CONFIG;
  var TEMPO_LIMITE_MS = 15000;

  /**
   * GET simples no Apps Script, que responde com CORS liberado. Resolve com [{ nome, leads }] na ordem
   * da aba Ranking; rejeita com erro de rede, resposta inválida ou mais de 15 segundos sem resposta.
   */
  function buscar() {
    var controle = typeof AbortController === 'function' ? new AbortController() : null;
    var temporizador;
    var tempoEsgotado = new Promise(function (_, rejeitar) {
      temporizador = setTimeout(function () {
        if (controle) controle.abort();
        rejeitar(new Error('Sem resposta em 15 segundos'));
      }, TEMPO_LIMITE_MS);
    });
    var url = config.apiUrl + '?acao=ranking&token=' + encodeURIComponent(config.token);
    var requisicao = fetch(url, { cache: 'no-store', signal: controle ? controle.signal : undefined })
      .then(function (resposta) {
        if (!resposta.ok) throw new Error('HTTP ' + resposta.status);
        return resposta.json();
      })
      .then(function (corpo) {
        if (!corpo || corpo.ok !== true || !Array.isArray(corpo.voluntarios)) {
          throw new Error((corpo && corpo.erro) || 'Resposta inválida');
        }
        return corpo.voluntarios;
      });

    return Promise.race([requisicao, tempoEsgotado]).then(
      function (voluntarios) {
        clearTimeout(temporizador);
        return voluntarios;
      },
      function (erro) {
        clearTimeout(temporizador);
        throw erro;
      }
    );
  }

  global.Ranking = {
    buscar: buscar
  };
})(window);
