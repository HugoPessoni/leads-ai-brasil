// Telas e fluxo do app.
(function () {
  'use strict';

  var config = window.APP_CONFIG;
  var Core = window.Core;
  var Scanner = window.Scanner;
  var Fila = window.Fila;
  var Sync = window.Sync;
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
    origemNome: 'manual'
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
    var hoje = Fila.contarHoje(estado.voluntario, new Date());
    var envio = Sync.estado();
    $('barra-nome').textContent = estado.voluntario || 'Sem voluntário';
    $('barra-hoje').textContent = hoje + (hoje === 1 ? ' lead hoje' : ' leads hoje');

    var status = $('barra-status');
    if (!envio.pendentes) status.textContent = 'Tudo enviado';
    else if (envio.enviando) status.textContent = 'Enviando ' + envio.pendentes + '…';
    else status.textContent = envio.pendentes + (envio.pendentes === 1 ? ' pendente' : ' pendentes');
    status.classList.toggle('pendente', envio.pendentes > 0);
  }

  // Toque no status ou "Enviar pendentes" no menu.
  function enviarAgora() {
    if (!Sync.estado().pendentes) {
      avisar('Tudo enviado.');
      return;
    }
    Sync.enviar().then(function (resultado) {
      if (resultado.erro) avisar('Não foi possível enviar agora. O app tenta de novo sozinho.');
      else avisar(resultado.enviados === 1 ? '1 lead enviado.' : resultado.enviados + ' leads enviados.');
    });
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
    if (acao === 'enviar') enviarAgora();
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

  /**
   * Recebe o texto lido do QR. Sem correspondência, o texto vai para o Nome e a origem fica manual.
   * Crachá já cadastrado neste celular: pergunta antes. Retorna false se o voluntário desistir.
   */
  function aplicarLeitura(texto) {
    var cracha = Core.parseBadge(texto);
    var anterior = cracha && Fila.ultimoDoCracha(cracha.codigo);
    if (anterior) {
      var pergunta = cracha.nome + ' já foi cadastrado neste celular ' +
        Core.formatarHorario(anterior.capturado_em, new Date()) + '. Cadastrar de novo?';
      if (!window.confirm(pergunta)) {
        limparCadastro();
        return false;
      }
    }
    estado.cracha = cracha;
    estado.origemNome = cracha ? 'qr' : 'manual';
    $('lead-nome').value = cracha ? cracha.nome : texto.trim();
    marcarInvalido('nome', false);
    return true;
  }

  function lerCracha() {
    if (!$('leitor').hidden) return;
    $('leitor').hidden = false;
    Scanner.abrir('leitor-video', function (texto) {
      $('leitor').hidden = true;
      if (navigator.vibrate) navigator.vibrate(200); // o Safari do iPhone não vibra
      if (!aplicarLeitura(texto)) return;
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

  // Salva o lead no celular primeiro; o envio começa em segundo plano, sem travar a tela.
  function escolherPasso(chave) {
    var lead = Core.montarLead({
      id: Fila.novoId(),
      agora: new Date(),
      voluntario: estado.voluntario,
      dispositivo: Fila.dispositivo(),
      cracha: estado.cracha,
      origemNome: estado.origemNome,
      nome: $('lead-nome').value,
      empresa: $('lead-empresa').value,
      celular: $('lead-celular').value,
      email: $('lead-email').value,
      autorizou: $('lead-autorizou').checked,
      proximoPasso: chave,
      observacao: $('lead-observacao').value
    });
    try {
      Fila.adicionar(lead);
    } catch (erro) {
      avisar('Não foi possível salvar no celular. Anote os dados e avise a coordenação.');
      return;
    }

    var passo = config.proximosPassos[chave];
    atualizarBarra();
    $('qr-titulo').textContent = passo.tituloQr;
    $('qr-imagem').src = passo.imagem;
    mostrarTela('qr');
    Sync.enviar();
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

    $('barra-status').addEventListener('click', enviarAgora);
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

    Sync.aoMudar(atualizarBarra);
    Sync.iniciar();
    mostrarTela(estado.voluntario ? 'cadastro' : 'identificacao');
  }

  iniciar();
})();
