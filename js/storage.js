// Fila local de leads no celular (localStorage). Nada é apagado: os enviados servem de backup
// e alimentam o aviso de crachá duplicado.
(function (global) {
  'use strict';

  var Core = global.Core;
  var CHAVE_LEADS = 'leads_v1';
  var CHAVE_DISPOSITIVO = 'dispositivo_v1';
  var LETRAS_DISPOSITIVO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function todos() {
    try {
      var leads = JSON.parse(localStorage.getItem(CHAVE_LEADS));
      return Array.isArray(leads) ? leads : [];
    } catch (erro) {
      return [];
    }
  }

  // Lança erro se o celular não conseguir gravar: quem chama precisa avisar o voluntário.
  function gravar(leads) {
    localStorage.setItem(CHAVE_LEADS, JSON.stringify(leads));
  }

  function adicionar(lead) {
    var leads = todos();
    leads.push(lead);
    gravar(leads);
  }

  function pendentes() {
    return todos().filter(function (lead) {
      return lead.status === 'pendente';
    });
  }

  // Marca como enviados os ids confirmados pela planilha. Retorna quantos mudaram.
  function marcarEnviados(ids) {
    if (!ids.length) return 0;
    var confirmados = {};
    ids.forEach(function (id) {
      confirmados[id] = true;
    });
    var leads = todos();
    var mudaram = 0;
    leads.forEach(function (lead) {
      if (confirmados[lead.id] && lead.status !== 'enviado') {
        lead.status = 'enviado';
        mudaram++;
      }
    });
    if (mudaram) gravar(leads);
    return mudaram;
  }

  function contarHoje(voluntario, agora) {
    return todos().filter(function (lead) {
      return lead.voluntario === voluntario && Core.mesmoDia(lead.capturado_em, agora);
    }).length;
  }

  // Cadastro mais recente deste crachá neste celular, ou null.
  function ultimoDoCracha(codigo) {
    if (!codigo) return null;
    var leads = todos();
    for (var i = leads.length - 1; i >= 0; i--) {
      if (leads[i].cracha_codigo === codigo) return leads[i];
    }
    return null;
  }

  function novoId() {
    if (global.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    // iPhones com iOS anterior ao 15.4 não têm randomUUID: UUID v4 com getRandomValues.
    var b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var hex = Array.prototype.map.call(b, function (n) {
      return (n < 16 ? '0' : '') + n.toString(16);
    }).join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  }

  // Código curto deste celular, criado no primeiro uso (coluna "dispositivo" da planilha).
  function dispositivo() {
    try {
      var codigo = localStorage.getItem(CHAVE_DISPOSITIVO);
      if (!codigo) {
        codigo = Array.prototype.map.call(crypto.getRandomValues(new Uint8Array(6)), function (n) {
          return LETRAS_DISPOSITIVO[n % LETRAS_DISPOSITIVO.length];
        }).join('');
        localStorage.setItem(CHAVE_DISPOSITIVO, codigo);
      }
      return codigo;
    } catch (erro) {
      return 'SEM-ID';
    }
  }

  global.Fila = {
    todos: todos,
    adicionar: adicionar,
    pendentes: pendentes,
    marcarEnviados: marcarEnviados,
    contarHoje: contarHoje,
    ultimoDoCracha: ultimoDoCracha,
    novoId: novoId,
    dispositivo: dispositivo
  };
})(window);
