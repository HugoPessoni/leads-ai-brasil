// Telas e fluxo do app.
(function () {
  'use strict';

  var config = window.APP_CONFIG;
  var CHAVE_VOLUNTARIO = 'voluntario_v1';

  // Fase 2: leitura simulada até a câmera entrar (fase 4).
  var NOMES_FICTICIOS = ['Anderson Santos', 'Gabriel Monteiro', 'Saulo Souza', 'Jhonny Ribeiro'];

  var estado = {
    voluntario: lerVoluntario(),
    origemNome: 'manual',
    leadsHoje: 0, // fictício até a fila local entrar (fase 5)
    leiturasSimuladas: 0
  };

  function $(id) {
    return document.getElementById(id);
  }

  /* ---------- Voluntário salvo no celular ---------- */

  function lerVoluntario() {
    try {
      return localStorage.getItem(CHAVE_VOLUNTARIO) || '';
    } catch (erro) {
      return '';
    }
  }

  function salvarVoluntario(nome) {
    estado.voluntario = nome;
    try {
      localStorage.setItem(CHAVE_VOLUNTARIO, nome);
    } catch (erro) {
      // Sem armazenamento (ex.: navegação privada): o nome vale só até fechar a aba.
    }
  }

  /* ---------- Navegação ---------- */

  function mostrarTela(nome) {
    fecharMenu();
    $('aviso').hidden = true;
    document.querySelectorAll('.tela').forEach(function (tela) {
      tela.hidden = tela.id !== 'tela-' + nome;
    });
    window.scrollTo(0, 0);
  }

  function atualizarBarra() {
    $('barra-nome').textContent = estado.voluntario || 'Sem voluntário';
    $('barra-hoje').textContent = estado.leadsHoje + (estado.leadsHoje === 1 ? ' lead hoje' : ' leads hoje');
  }

  var temporizadorAviso;
  function avisar(mensagem) {
    var aviso = $('aviso');
    aviso.textContent = mensagem;
    aviso.hidden = false;
    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(function () {
      aviso.hidden = true;
    }, 3000);
  }

  /* ---------- Menu ---------- */

  function abrirMenu() {
    $('menu').hidden = false;
    $('botao-menu').setAttribute('aria-expanded', 'true');
  }

  function fecharMenu() {
    $('menu').hidden = true;
    $('botao-menu').setAttribute('aria-expanded', 'false');
  }

  function acaoDoMenu(acao) {
    fecharMenu();
    if (acao === 'enviar') avisar('O envio para a planilha entra na fase 5.');
    if (acao === 'backup') avisar('O backup entra na fase 9.');
    if (acao === 'trocar') {
      $('voluntario-nome').value = estado.voluntario;
      mostrarTela('identificacao');
    }
  }

  /* ---------- Tela 1: identificação ---------- */

  function confirmarVoluntario(evento) {
    evento.preventDefault();
    var nome = $('voluntario-nome').value.trim();
    if (!nome) {
      avisar('Digite seu nome para começar.');
      $('voluntario-nome').focus();
      return;
    }
    salvarVoluntario(nome);
    atualizarBarra();
    mostrarTela('cadastro');
  }

  /* ---------- Tela 2: cadastro ---------- */

  function lerCracha() {
    var nome = NOMES_FICTICIOS[estado.leiturasSimuladas % NOMES_FICTICIOS.length];
    estado.leiturasSimuladas++;
    estado.origemNome = 'qr';
    $('lead-nome').value = nome;
    avisar('Leitura simulada. A câmera entra na fase 4.');
  }

  function digitarNome() {
    estado.origemNome = 'manual';
    $('lead-nome').focus();
  }

  function continuarCadastro(evento) {
    evento.preventDefault();
    document.activeElement.blur();
    mostrarTela('passo');
  }

  function limparCadastro() {
    $('form-cadastro').reset();
    $('lead-observacao').value = '';
    estado.origemNome = 'manual';
  }

  /* ---------- Tela 3: próximo passo ---------- */

  function montarBotoesPasso() {
    var container = $('botoes-passo');
    Object.keys(config.proximosPassos).forEach(function (chave) {
      var passo = config.proximosPassos[chave];
      var botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'botao botao-passo';
      botao.textContent = passo.botao;
      botao.style.background = passo.cor;
      botao.addEventListener('click', function () {
        escolherPasso(chave);
      });
      container.appendChild(botao);
    });
  }

  function escolherPasso(chave) {
    var passo = config.proximosPassos[chave];
    estado.leadsHoje++;
    atualizarBarra();
    $('qr-titulo').textContent = passo.tituloQr;
    $('qr-imagem').src = passo.imagem;
    mostrarTela('qr');
  }

  /* ---------- Tela 4: QR ---------- */

  function novoLead() {
    limparCadastro();
    mostrarTela('cadastro');
  }

  /* ---------- Início ---------- */

  function iniciar() {
    document.title = 'Leads · ' + config.evento;
    $('nome-evento').textContent = config.evento;
    montarBotoesPasso();
    atualizarBarra();

    $('form-identificacao').addEventListener('submit', confirmarVoluntario);
    $('ler-cracha').addEventListener('click', lerCracha);
    $('digitar-nome').addEventListener('click', digitarNome);
    $('form-cadastro').addEventListener('submit', continuarCadastro);
    $('voltar-cadastro').addEventListener('click', function () {
      mostrarTela('cadastro');
    });
    $('novo-lead').addEventListener('click', novoLead);

    $('barra-status').addEventListener('click', function () {
      avisar('O envio para a planilha entra na fase 5.');
    });
    $('botao-menu').addEventListener('click', function (evento) {
      evento.stopPropagation();
      if ($('menu').hidden) abrirMenu();
      else fecharMenu();
    });
    $('menu').addEventListener('click', function (evento) {
      var acao = evento.target.getAttribute('data-acao');
      if (acao) acaoDoMenu(acao);
    });
    document.addEventListener('click', function (evento) {
      if (!$('menu').hidden && !$('menu').contains(evento.target)) fecharMenu();
    });

    mostrarTela(estado.voluntario ? 'cadastro' : 'identificacao');
  }

  iniciar();
})();
