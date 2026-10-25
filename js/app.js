// Telas e fluxo do app.
(function () {
  'use strict';

  var config = window.APP_CONFIG;
  var Core = window.Core;
  var Scanner = window.Scanner;
  var CHAVE_VOLUNTARIO = 'voluntario_v1';

  // Campo do formulário de cadastro de cada nome usado por Core.validarCadastro.
  var CAMPOS = {
    nome: 'lead-nome',
    celular: 'lead-celular',
    email: 'lead-email',
    autorizou: 'lead-autorizou'
  };

  var estado = {
    voluntario: lerVoluntario(),
    cracha: null, // resultado de Core.parseBadge da última leitura
    origemNome: 'manual',
    leadsHoje: 0 // fictício até a fila local entrar (fase 5)
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
    var nome = Core.formatarNome($('voluntario-nome').value);
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

  // Recebe o texto lido do QR. Sem correspondência, o texto vai para o Nome e a origem fica manual.
  function aplicarLeitura(texto) {
    var cracha = Core.parseBadge(texto);
    estado.cracha = cracha;
    estado.origemNome = cracha ? 'qr' : 'manual';
    $('lead-nome').value = cracha ? cracha.nome : texto.trim();
    marcarInvalido('nome', false);
  }

  function lerCracha() {
    if (!$('leitor').hidden) return;
    $('leitor').hidden = false;
    Scanner.abrir('leitor-video', function (texto) {
      $('leitor').hidden = true;
      if (navigator.vibrate) navigator.vibrate(200); // o Safari do iPhone não vibra
      aplicarLeitura(texto);
      avisar(estado.cracha ? 'Crachá lido: ' + estado.cracha.nome : 'QR não reconhecido. Confira o nome.');
    }).catch(function (erro) {
      $('leitor').hidden = true;
      avisar(Scanner.mensagemDeErro(erro));
    });
  }

  function cancelarLeitura() {
    Scanner.fechar();
    $('leitor').hidden = true;
  }

  function digitarNome() {
    estado.cracha = null;
    estado.origemNome = 'manual';
    $('lead-nome').focus();
  }

  function mascararCelular() {
    var campo = $('lead-celular');
    campo.value = Core.formatarCelular(campo.value);
  }

  function marcarInvalido(campo, invalido) {
    var elemento = $(CAMPOS[campo]);
    var alvo = campo === 'autorizou' ? elemento.closest('.checkbox') : elemento;
    if (invalido) alvo.setAttribute('aria-invalid', 'true');
    else alvo.removeAttribute('aria-invalid');
  }

  function continuarCadastro(evento) {
    evento.preventDefault();
    var erros = Core.validarCadastro(
      {
        nome: $('lead-nome').value,
        celular: $('lead-celular').value,
        email: $('lead-email').value,
        autorizou: $('lead-autorizou').checked
      },
      config.exigirAutorizacao
    );

    Object.keys(CAMPOS).forEach(function (campo) {
      marcarInvalido(campo, erros.some(function (erro) { return erro.campo === campo; }));
    });
    if (erros.length) {
      avisar(erros[0].mensagem);
      return;
    }

    document.activeElement.blur();
    mostrarTela('passo');
  }

  function limparCadastro() {
    $('form-cadastro').reset();
    $('lead-observacao').value = '';
    Object.keys(CAMPOS).forEach(function (campo) {
      marcarInvalido(campo, false);
    });
    estado.cracha = null;
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
    $('leitor-cancelar').addEventListener('click', cancelarLeitura);
    // Saiu do app com a câmera aberta: desliga, para não gastar bateria nem travar a câmera.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && !$('leitor').hidden) cancelarLeitura();
    });
    $('digitar-nome').addEventListener('click', digitarNome);
    $('lead-celular').addEventListener('input', mascararCelular);
    $('form-cadastro').addEventListener('submit', continuarCadastro);
    // Corrigir um campo tira a marcação de erro dele.
    Object.keys(CAMPOS).forEach(function (campo) {
      $(CAMPOS[campo]).addEventListener('input', function () {
        marcarInvalido(campo, false);
      });
    });
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
