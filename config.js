// Tudo que muda de um evento para outro fica aqui.
// Este arquivo é público (GitHub Pages): a URL e o token só permitem inserir linhas na planilha.
// "self" funciona na página e no sw.js, que lê as imagens dos QRs daqui para guardar offline.
self.APP_CONFIG = {
  evento: 'AI.Brasil Experience 2026',
  apiUrl: 'https://script.google.com/macros/s/AKfycbyVBTiPH3WOYrvr_xXkuPhZBPahf3luQwg_Ztqt6tm-s8LL-BS6hEsYppN94GVGLRMU/exec',
  token: '6da5e61d893b47d1b299cc97c7b6d02f4ce772050ed54117a24a5b42bc0134e4',
  // Cores claras: o texto dos botões é preto. "selo" (opcional) aparece como etiqueta dentro do botão.
  proximosPassos: {
    reuniao: {
      botao: 'Marcar uma reunião',
      tituloQr: 'Escaneie para agendar',
      imagem: 'img/qr-reuniao.png',
      cor: '#6BDD3E'
    },
    contato: {
      botao: 'Receber nosso contato',
      selo: 'BOT 🤖', // o QR de contato leva para um chatbot
      tituloQr: 'Escaneie para falar com a gente',
      imagem: 'img/qr-contato.png',
      cor: '#E4EF3A'
    }
  },
  // Temperatura do lead, escolhida antes do QR. Só o ícone aparece na tela (a pessoa abordada pode ver).
  // As chaves (quente, morno, frio) precisam ser as mesmas do Code.gs.
  temperaturas: {
    quente: { icone: '🔥', nome: 'Quente' },
    morno: { icone: '💨', nome: 'Morno' },
    frio: { icone: '❄️', nome: 'Frio' }
  },
  exigirAutorizacao: true,
  intervaloSyncSegundos: 30,
  loteMaximo: 20
};
