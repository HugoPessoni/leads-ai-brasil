// Funções puras: leitura do crachá, validações e formatação. Testadas em tests.html.
(function (global) {
  'use strict';

  var PARTICULAS = ['da', 'de', 'do', 'das', 'dos', 'e'];
  var PADRAO_CRACHA = /([A-Z]{2,5})-([0-9A-Z]+)\/(.+?)(?=\s+[A-Z]{2,5}-[0-9A-Z]+\/|$)/i;

  /**
   * Lê o texto do QR do crachá ("PREFIXO-ID/NOME"). Se houver mais de um código, usa o primeiro.
   * Retorna { prefixo, id, codigo, nome, nomeOriginal, bruto } ou null.
   */
  function parseBadge(texto) {
    if (typeof texto !== 'string') return null;
    var limpo = texto.trim();
    var achado = PADRAO_CRACHA.exec(limpo);
    if (!achado) return null;

    var prefixo = achado[1].toUpperCase();
    var id = achado[2].toUpperCase();
    var nomeOriginal = achado[3].trim();
    return {
      prefixo: prefixo,
      id: id,
      codigo: prefixo + '-' + id,
      nome: formatarNome(nomeOriginal),
      nomeOriginal: nomeOriginal,
      bruto: texto
    };
  }

  // "MARIA DA CONCEIÇÃO" -> "Maria da Conceição". A primeira palavra sempre começa em maiúscula.
  function formatarNome(nome) {
    if (typeof nome !== 'string') return '';
    var palavras = nome.trim().toLocaleLowerCase('pt-BR').split(/\s+/);
    return palavras
      .filter(Boolean)
      .map(function (palavra, indice) {
        if (indice > 0 && PARTICULAS.indexOf(palavra) !== -1) return palavra;
        // Maiúscula no início e depois de hífen ou apóstrofo: "Ana-Maria", "D'Ávila".
        return palavra.replace(/(^|[-'’])(\p{L})/gu, function (_, antes, letra) {
          return antes + letra.toLocaleUpperCase('pt-BR');
        });
      })
      .join(' ');
  }

  function somenteDigitos(valor) {
    return String(valor || '').replace(/\D/g, '');
  }

  // Dígitos do celular sem o código do país (+55), no máximo 11.
  function digitosCelular(valor) {
    var digitos = somenteDigitos(valor);
    if (digitos.length > 11 && digitos.indexOf('55') === 0) digitos = digitos.slice(2);
    return digitos.slice(0, 11);
  }

  // Máscara aplicada enquanto digita: "(11) 98765-4321" (ou "(11) 3456-7890" para fixo).
  function formatarCelular(valor) {
    var d = digitosCelular(valor);
    if (!d) return '';
    if (d.length <= 2) return '(' + d;
    var ddd = '(' + d.slice(0, 2) + ') ';
    var resto = d.slice(2);
    if (resto.length <= 4) return ddd + resto;
    var corte = resto.length === 9 ? 5 : 4;
    return ddd + resto.slice(0, corte) + '-' + resto.slice(corte);
  }

  // DDD sem zero + celular (9 e mais 8 dígitos) ou fixo (8 dígitos começando de 2 a 8).
  function celularValido(valor) {
    return /^[1-9]{2}(9\d{8}|[2-8]\d{7})$/.test(digitosCelular(valor));
  }

  function emailValido(valor) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(valor || '').trim());
  }

  /**
   * Valida o cadastro antes de seguir para o próximo passo.
   * campos: { nome, celular, email, autorizou }. Retorna uma lista de { campo, mensagem }, vazia se estiver ok.
   */
  function validarCadastro(campos, exigirAutorizacao) {
    var erros = [];
    var celular = String(campos.celular || '').trim();
    var email = String(campos.email || '').trim();

    if (!String(campos.nome || '').trim()) {
      erros.push({ campo: 'nome', mensagem: 'Informe o nome.' });
    }
    if (!celular && !email) {
      erros.push({ campo: 'celular', mensagem: 'Informe o celular ou o e-mail.' });
      erros.push({ campo: 'email', mensagem: 'Informe o celular ou o e-mail.' });
    }
    if (celular && !celularValido(celular)) {
      erros.push({ campo: 'celular', mensagem: 'Celular incompleto ou inválido.' });
    }
    if (email && !emailValido(email)) {
      erros.push({ campo: 'email', mensagem: 'E-mail inválido.' });
    }
    if (exigirAutorizacao && !campos.autorizou) {
      erros.push({ campo: 'autorizou', mensagem: 'Marque a autorização de contato.' });
    }
    return erros;
  }

  /**
   * Lead pronto para a fila e para a planilha (mesmos nomes de campo do Code.gs).
   * dados: { id, agora, voluntario, dispositivo, cracha, origemNome, nome, empresa, celular, email,
   *          autorizou, proximoPasso, observacao }
   */
  function montarLead(dados) {
    var cracha = dados.cracha;
    return {
      id: dados.id,
      capturado_em: dados.agora.toISOString(),
      status: 'pendente',
      voluntario: dados.voluntario,
      cracha_codigo: cracha ? cracha.codigo : '',
      cracha_tipo: cracha ? cracha.prefixo : '',
      nome: String(dados.nome || '').trim().replace(/\s+/g, ' '),
      empresa: String(dados.empresa || '').trim(),
      celular: formatarCelular(dados.celular),
      email: String(dados.email || '').trim().toLowerCase(),
      proximo_passo: dados.proximoPasso,
      observacao: String(dados.observacao || '').trim(),
      autorizou_contato: dados.autorizou === true,
      origem_nome: dados.origemNome === 'qr' ? 'qr' : 'manual',
      dispositivo: dados.dispositivo
    };
  }

  // Mesmo dia no relógio do celular.
  function mesmoDia(iso, agora) {
    var data = new Date(iso);
    return (
      data.getFullYear() === agora.getFullYear() &&
      data.getMonth() === agora.getMonth() &&
      data.getDate() === agora.getDate()
    );
  }

  function doisDigitos(n) {
    return (n < 10 ? '0' : '') + n;
  }

  // "hoje às 14:32" ou "27/10 às 09:05".
  function formatarHorario(iso, agora) {
    var data = new Date(iso);
    var hora = doisDigitos(data.getHours()) + ':' + doisDigitos(data.getMinutes());
    var dia = mesmoDia(iso, agora) ? 'hoje' : doisDigitos(data.getDate()) + '/' + doisDigitos(data.getMonth() + 1);
    return dia + ' às ' + hora;
  }

  // ids que a planilha confirmou (gravados agora ou já existentes). Resposta com erro não confirma nada.
  function idsConfirmados(resposta) {
    if (!resposta || resposta.ok !== true) return [];
    var gravados = Array.isArray(resposta.gravados) ? resposta.gravados : [];
    var ignorados = Array.isArray(resposta.ignorados) ? resposta.ignorados : [];
    return gravados.concat(ignorados);
  }

  global.Core = {
    parseBadge: parseBadge,
    formatarNome: formatarNome,
    formatarCelular: formatarCelular,
    celularValido: celularValido,
    emailValido: emailValido,
    validarCadastro: validarCadastro,
    montarLead: montarLead,
    mesmoDia: mesmoDia,
    formatarHorario: formatarHorario,
    idsConfirmados: idsConfirmados
  };
})(window);
