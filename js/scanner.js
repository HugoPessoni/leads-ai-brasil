// Câmera traseira e leitura do QR do crachá (html5-qrcode, em vendor/).
(function (global) {
  'use strict';

  // Leitura em andamento: { leitor, iniciou, encerrada }.
  var sessao = null;

  // Área de leitura: um quadrado de 75% do lado menor do vídeo.
  function areaDeLeitura(largura, altura) {
    var lado = Math.floor(Math.min(largura, altura) * 0.75);
    return { width: lado, height: lado };
  }

  /**
   * Abre a câmera traseira dentro do elemento idContainer (que já deve estar visível).
   * aoLer(texto) é chamado uma única vez, depois que a câmera desliga.
   * A Promise rejeita se a câmera não abrir.
   */
  function abrir(idContainer, aoLer) {
    if (sessao) return Promise.resolve();
    if (typeof global.Html5Qrcode !== 'function') {
      return Promise.reject(new Error('Leitor de QR não carregou.'));
    }

    var atual = {
      leitor: new global.Html5Qrcode(idContainer, {
        formatsToSupport: [global.Html5QrcodeSupportedFormats.QR_CODE],
        // No Chrome do Android usa o leitor nativo, mais rápido; no iPhone cai no leitor da biblioteca.
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        verbose: false
      }),
      iniciou: false,
      encerrada: false
    };
    sessao = atual;

    function leu(texto) {
      if (atual.encerrada) return;
      fechar().then(function () {
        aoLer(texto);
      });
    }

    return atual.leitor
      .start({ facingMode: 'environment' }, { fps: 10, qrbox: areaDeLeitura }, leu, function () {})
      .then(function () {
        atual.iniciou = true;
        // Cancelado enquanto a câmera abria: desliga agora.
        if (atual.encerrada) return desligar(atual);
      })
      .catch(function (erro) {
        atual.encerrada = true;
        if (sessao === atual) sessao = null;
        throw erro;
      });
  }

  // Desliga a câmera. Pode ser chamado a qualquer momento, inclusive enquanto ela ainda abre.
  function fechar() {
    var atual = sessao;
    sessao = null;
    if (!atual || atual.encerrada) return Promise.resolve();
    atual.encerrada = true;
    return atual.iniciou ? desligar(atual) : Promise.resolve();
  }

  function desligar(atual) {
    return atual.leitor
      .stop()
      .catch(function () {})
      .then(function () {
        try {
          atual.leitor.clear();
        } catch (erro) {
          // O elemento já pode ter sido limpo.
        }
      });
  }

  // Texto curto para o voluntário. A biblioteca rejeita com texto; o navegador, com objetos de erro.
  function mensagemDeErro(erro) {
    var texto = erro && typeof erro === 'object' ? [erro.name, erro.message, String(erro)].join(' ') : String(erro);
    if (/NotAllowed|Permission/i.test(texto)) {
      return 'Sem permissão para a câmera. Libere o acesso nas configurações do navegador ou use "Digitar nome".';
    }
    if (/NotFound|Requested device not found|no camera/i.test(texto)) {
      return 'Nenhuma câmera encontrada. Use "Digitar nome".';
    }
    if (/NotReadable|in use|Could not start/i.test(texto)) {
      return 'A câmera está em uso por outro app. Feche o outro app e tente de novo.';
    }
    return 'Não foi possível abrir a câmera. Use "Digitar nome".';
  }

  global.Scanner = {
    abrir: abrir,
    fechar: fechar,
    mensagemDeErro: mensagemDeErro
  };
})(window);
