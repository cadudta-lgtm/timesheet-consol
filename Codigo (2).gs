/**
 * Timesheet consol — multiusuário
 *
 * Papéis:
 *   'user'  -> vê e edita apenas o próprio timesheet
 *   'admin' -> vê o timesheet de todos em modo leitura (e edita o seu)
 *
 * Login: a pessoa informa o e-mail, recebe um código de 6 dígitos nele
 * e ganha um token válido por SESSAO_HORAS. Quem não está na EQUIPE não entra.
 */

// ===================== Configuração =====================
const FUSO = 'Pacific/Auckland';
const MIN_LUNCH = 30;
const MIN_SMOKO = 0;
const MOEDA = '$';
const CODIGO_MINUTOS = 10;
const SESSAO_HORAS = 8;

/** Quem pode usar o app. Adicione ou remova linhas conforme a equipe muda. */
const EQUIPE = [
  { email: 'cadu.dta@gmail.com', nome: 'Davi',       papel: 'admin', taxa: 25 },
  { email: 'colega1@exemplo.com', nome: 'Colega 1',  papel: 'user',  taxa: 25 },
  { email: 'patrao@exemplo.com',  nome: 'Supervisor', papel: 'admin', taxa: 0 }
];

// ===================== Entrada do web app =====================
function doGet() {
  const t = HtmlService.createTemplateFromFile('Index');
  t.cfg = JSON.stringify({ lunch: MIN_LUNCH, smoko: MIN_SMOKO, moeda: MOEDA });
  return t.evaluate()
    .setTitle('Timesheet')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);  // permite a casca PWA
}

// ===================== Login =====================
/** Envia o código para o e-mail informado, se ele estiver na equipe. */
function pedirCodigo(email) {
  const pessoa = acharPessoa_(email);
  if (!pessoa) throw new Error('This e-mail is not on the team list.');

  const codigo = String(Math.floor(100000 + Math.random() * 900000));
  props_().setProperty('otp_' + apelido_(pessoa.email), JSON.stringify({
    codigo: codigo,
    expira: Date.now() + CODIGO_MINUTOS * 60000
  }));

  MailApp.sendEmail({
    to: pessoa.email,
    subject: 'Timesheet — code ' + codigo,
    body: 'Hi ' + pessoa.nome + ',\n\nYour access code is ' + codigo + '.\n' +
          'It expires in ' + CODIGO_MINUTOS + ' minutes.\n\n' +
          'If you did not request it, ignore this e-mail — nobody can get in without the code.'
  });

  return { ok: true };
}

/** Confere o código e devolve o token da sessão. */
function validarCodigo(email, codigo) {
  const pessoa = acharPessoa_(email);
  if (!pessoa) throw new Error('This e-mail is not on the team list.');

  const chave = 'otp_' + apelido_(pessoa.email);
  const bruto = props_().getProperty(chave);
  if (!bruto) throw new Error('No code pending. Request a new one.');

  const otp = JSON.parse(bruto);
  if (Date.now() > otp.expira) {
    props_().deleteProperty(chave);
    throw new Error('Code expired. Request a new one.');
  }
  if (String(codigo).trim() !== otp.codigo) throw new Error('Wrong code.');

  props_().deleteProperty(chave);

  const expira = Date.now() + SESSAO_HORAS * 3600000;
  const token = Utilities.getUuid();
  props_().setProperty('tk_' + token, JSON.stringify({ email: pessoa.email, expira: expira }));

  return sessaoPublica_(pessoa, expira, token);
}

/** Devolve os dados da sessão, ou null se o token não vale mais. */
function sessao(token) {
  const s = lerToken_(token);
  if (!s) return null;
  return sessaoPublica_(acharPessoa_(s.email), s.expira, token);
}

function sair(token) {
  if (token) props_().deleteProperty('tk_' + token);
  return { ok: true };
}

// ===================== Leitura =====================
function carregarSemana(token, alvo, segunda) {
  const s = exigirLeitura_(token, alvo);
  validarData_(segunda);
  const bruto = props_().getProperty(chave_(s.alvo, segunda));
  return bruto ? JSON.parse(bruto) : {};
}

function carregarHistorico(token, alvo) {
  const s = exigirLeitura_(token, alvo);
  const prefixo = 'ts_' + apelido_(s.alvo) + '_';
  const todas = props_().getProperties();

  return Object.keys(todas)
    .filter(function (k) { return k.indexOf(prefixo) === 0; })
    .sort().reverse()
    .map(function (k) {
      let dados = {};
      try { dados = JSON.parse(todas[k]) || {}; } catch (e) { dados = {}; }
      return { segunda: k.substring(prefixo.length), dados: dados };
    });
}

function carregarLog(token, alvo) {
  const s = exigirLeitura_(token, alvo);
  const prefixo = 'log_' + apelido_(s.alvo) + '_';
  const todas = props_().getProperties();
  const lista = [];

  Object.keys(todas).forEach(function (k) {
    if (k.indexOf(prefixo) !== 0) return;
    try { (JSON.parse(todas[k]) || []).forEach(function (e) { lista.push(e); }); } catch (err) {}
  });

  return lista.sort(function (a, b) { return b.ts - a.ts; }).slice(0, 200);
}

/** Painel do admin: total da semana de cada pessoa da equipe. */
function resumoEquipe(token, segunda) {
  const s = lerSessao_(token);
  if (s.papel !== 'admin') throw new Error('Admins only.');
  validarData_(segunda);

  return EQUIPE.map(function (p) {
    const bruto = props_().getProperty(chave_(p.email, segunda));
    return {
      email: p.email,
      nome: p.nome,
      papel: p.papel,
      taxa: p.taxa,
      dados: bruto ? JSON.parse(bruto) : {}
    };
  });
}

// ===================== Escrita (só o próprio timesheet) =====================
function salvarDia(token, segunda, dia, valores, motivo) {
  const s = lerSessao_(token);
  validarData_(segunda);
  validarData_(dia);

  const chave = chave_(s.email, segunda);
  const bruto = props_().getProperty(chave);
  const dados = bruto ? JSON.parse(bruto) : {};
  const antes = dados[dia] || null;

  const depois = {
    entrada: (valores && valores.entrada) || '',
    saida: (valores && valores.saida) || '',
    lunch: !!(valores && valores.lunch),
    smoko: !!(valores && valores.smoko)
  };
  const vazio = !depois.entrada && !depois.saida && !depois.lunch && !depois.smoko;

  if (vazio) { delete dados[dia]; } else { dados[dia] = depois; }

  if (Object.keys(dados).length) {
    props_().setProperty(chave, JSON.stringify(dados));
  } else {
    props_().deleteProperty(chave);
  }

  registrar_(s.email, segunda, {
    dia: dia,
    tipo: antes ? (vazio ? 'removed' : 'changed') : 'added',
    antes: descrever_(antes),
    depois: descrever_(vazio ? null : depois),
    motivo: String(motivo || '').trim()
  });

  return { ok: true, hora: Utilities.formatDate(new Date(), FUSO, 'HH:mm') };
}

function limparSemana(token, segunda, motivo) {
  const s = lerSessao_(token);
  validarData_(segunda);

  const chave = chave_(s.email, segunda);
  const bruto = props_().getProperty(chave);
  const dados = bruto ? JSON.parse(bruto) : {};
  props_().deleteProperty(chave);

  registrar_(s.email, segunda, {
    dia: segunda,
    tipo: 'week cleared',
    antes: Object.keys(dados).length + ' day(s) recorded',
    depois: 'empty',
    motivo: String(motivo || '').trim()
  });

  return { ok: true };
}

// ===================== Registro de alterações =====================
function registrar_(email, segunda, entrada) {
  const chave = chaveLog_(email, segunda);
  let lista = [];
  try { lista = JSON.parse(props_().getProperty(chave) || '[]'); } catch (e) { lista = []; }

  entrada.ts = Date.now();
  entrada.quando = Utilities.formatDate(new Date(), FUSO, 'dd/MM/yyyy HH:mm');
  entrada.semana = segunda;
  lista.unshift(entrada);

  props_().setProperty(chave, JSON.stringify(lista.slice(0, 60)));
}

function descrever_(d) {
  if (!d) return '—';
  const extras = [];
  if (d.smoko) extras.push('smoko');
  if (d.lunch) extras.push('lunch');
  return (d.entrada || '--:--') + '–' + (d.saida || '--:--') +
    (extras.length ? ' (' + extras.join(', ') + ')' : '');
}

// ===================== Sessão e permissões =====================
function lerToken_(token) {
  if (!token) return null;
  const bruto = props_().getProperty('tk_' + token);
  if (!bruto) return null;

  const s = JSON.parse(bruto);
  if (Date.now() > s.expira) {
    props_().deleteProperty('tk_' + token);
    return null;
  }
  if (!acharPessoa_(s.email)) return null;   // saiu da equipe
  return s;
}

function lerSessao_(token) {
  const s = lerToken_(token);
  if (!s) throw new Error('Session expired. Sign in again.');
  const p = acharPessoa_(s.email);
  return { email: p.email, nome: p.nome, papel: p.papel, taxa: p.taxa };
}

/** Valida o acesso de leitura a um timesheet e devolve de quem é. */
function exigirLeitura_(token, alvo) {
  const s = lerSessao_(token);
  const email = alvo ? String(alvo).trim().toLowerCase() : s.email;

  if (email !== s.email && s.papel !== 'admin') {
    throw new Error('You can only see your own timesheet.');
  }
  if (!acharPessoa_(email)) throw new Error('Person not on the team list.');

  s.alvo = email;
  return s;
}

function sessaoPublica_(pessoa, expira, token) {
  return {
    token: token,
    email: pessoa.email,
    nome: pessoa.nome,
    papel: pessoa.papel,
    taxa: pessoa.taxa,
    ate: Utilities.formatDate(new Date(expira), FUSO, 'HH:mm'),
    equipe: pessoa.papel === 'admin'
      ? EQUIPE.map(function (p) { return { email: p.email, nome: p.nome, taxa: p.taxa }; })
      : []
  };
}

// ===================== Auxiliares =====================
function props_() { return PropertiesService.getScriptProperties(); }
function apelido_(email) { return String(email).toLowerCase().replace(/[^a-z0-9]/g, ''); }
function chave_(email, segunda) { return 'ts_' + apelido_(email) + '_' + segunda; }
function chaveLog_(email, segunda) { return 'log_' + apelido_(email) + '_' + segunda; }

function acharPessoa_(email) {
  const alvo = String(email || '').trim().toLowerCase();
  for (let i = 0; i < EQUIPE.length; i++) {
    if (EQUIPE[i].email.toLowerCase() === alvo) return EQUIPE[i];
  }
  return null;
}

function validarData_(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) throw new Error('Invalid date: ' + s);
}

/**
 * Execute UMA VEZ para trazer os dados da versão anterior (um usuário só)
 * para a chave do seu e-mail. Troque abaixo se o seu e-mail for outro.
 */
function migrarDados() {
  const meu = 'cadu.dta@gmail.com';
  const p = props_();
  const todas = p.getProperties();
  let n = 0;

  Object.keys(todas).forEach(function (k) {
    const antiga = /^ts_(\d{4}-\d{2}-\d{2})$/.exec(k);
    if (!antiga) return;
    const nova = chave_(meu, antiga[1]);
    if (!p.getProperty(nova)) { p.setProperty(nova, todas[k]); n++; }
  });

  Logger.log('Semanas migradas: ' + n);
  return n;
}
