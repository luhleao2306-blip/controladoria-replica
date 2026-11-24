import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { parseEnv } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { seedReplicaStore } from './replica-db.mjs';
import { snapshot, snapshotInserts, snapshotRows } from './replica-snapshot.mjs';

const cli = 'supabase@2.122.1';
const network = 'controladoria-replica-loopback';
const container = 'supabase_db_controladoria-replica-local';
const api = 'http://127.0.0.1:55421';
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Abra com npm run replica.');

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(`Falha em ${executable} (${args[0]}). Verifique se o Docker está aberto.`);
  return result.stdout?.trim();
}

function supabase(args, options) {
  return run(process.execPath, [npm, 'exec', '--yes', '--package', cli, '--', 'supabase', ...args], options);
}

const dockerHost = process.env.DOCKER_HOST || JSON.parse(run('docker', ['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}']));
if (!/^(?:unix|npipe):\/\//.test(dockerHost)) throw new Error('Use um Docker local antes de carregar os dados.');
if (spawnSync('docker', ['network','inspect',network], {stdio:'ignore'}).status !== 0) {
  run('docker', ['network','create','--driver','bridge','--opt','com.docker.network.bridge.host_binding_ipv4=127.0.0.1',network]);
}
const net = JSON.parse(run('docker', ['network','inspect',network]))[0];
if (net.Driver !== 'bridge' || net.Options['com.docker.network.bridge.host_binding_ipv4'] !== '127.0.0.1') throw new Error('A rede Docker da réplica precisa estar restrita a localhost.');
supabase(['start','--network-id',network], {stdio:'inherit'});
const containers = run('docker', ['ps','-q','--filter',`network=${network}`]).split(/\s+/).filter(Boolean);
if (!containers.length) throw new Error('A rede da réplica não contém serviços locais.');
const services = JSON.parse(run('docker',['inspect',...containers]));
const ports = services.flatMap(service => Object.values(service.NetworkSettings.Ports ?? {}).flatMap(bindings => bindings ?? []));
if (!services.some(service => service.Name === `/${container}`) || !ports.some(port => port.HostPort === '55421') || ports.some(port => !['127.0.0.1','::1'].includes(port.HostIp))) {
  throw new Error('Os serviços da réplica precisam estar acessíveis apenas por localhost. Nenhum dado foi carregado.');
}

const keys = parseEnv(supabase(['status','-o','env']));
if (keys.API_URL !== api || !keys.ANON_KEY || !keys.SERVICE_ROLE_KEY) throw new Error('O Supabase local não retornou as chaves esperadas.');
const db = sql => run('docker',['exec',container,'psql','-X','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1','-c',sql]);
db('CREATE SCHEMA IF NOT EXISTS replica_local; REVOKE ALL ON SCHEMA replica_local FROM PUBLIC; CREATE TABLE IF NOT EXISTS replica_local.snapshot (finished_at timestamptz PRIMARY KEY)');
const imported = db('SELECT count(*) FROM replica_local.snapshot') === '1';
if (!imported) {
  console.log('Importando o histórico para o banco local.');
  const postgres = spawn('docker',['exec','-i',container,'psql','-Xq','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{stdio:['pipe','ignore','ignore']});
  async function* sql() {
    yield "BEGIN; LOCK TABLE replica_local.snapshot IN EXCLUSIVE MODE; DO $$ BEGIN IF EXISTS (SELECT FROM replica_local.snapshot) OR EXISTS (SELECT FROM public.companies) OR EXISTS (SELECT FROM public.financial_transactions) OR EXISTS (SELECT FROM public.financial_transactions_raw) THEN RAISE EXCEPTION 'Local database is not empty'; END IF; END $$;\n";
    yield* snapshotInserts();
    for (const [table,count] of Object.entries(snapshot.counts)) {
      if (!['companies','financial_transactions','financial_transactions_raw'].includes(table) || !Number.isSafeInteger(count)) throw new Error('Manifesto da cópia inválido.');
      yield `DO $$ BEGIN IF (SELECT count(*) FROM public.${table}) <> ${count} THEN RAISE EXCEPTION 'Unexpected row count'; END IF; END $$;\n`;
    }
    yield `INSERT INTO replica_local.snapshot VALUES ('${new Date(snapshot.finishedAt).toISOString()}'); COMMIT;\n`;
  }
  const done = new Promise((resolve,reject) => { postgres.once('error',reject); postgres.once('close',resolve); });
  const [input,status] = await Promise.allSettled([pipeline(Readable.from(sql()),postgres.stdin),done]);
  if (input.status !== 'fulfilled' || status.value !== 0) throw new Error('A importação local falhou. Verifique se a réplica acabou de ser criada e se há espaço no Docker.');
}

const localAuth = createClient(api,keys.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
mkdirSync('.replica-local',{recursive:true});
const credentialsPath = '.replica-local/login.json';
const credentials = existsSync(credentialsPath)
  ? JSON.parse(readFileSync(credentialsPath,'utf8'))
  : { email:'editor@example.test', password:randomBytes(24).toString('base64url') };
if (credentials.email !== 'editor@example.test') throw new Error('Usuário da réplica inválido.');
if (!existsSync(credentialsPath)) writeFileSync(credentialsPath,JSON.stringify(credentials,null,2),{mode:0o600,flag:'wx'});
const userClient = createClient(api,keys.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
let login = await userClient.auth.signInWithPassword(credentials);
if (login.error) {
  if (db("SELECT count(*) FROM auth.users WHERE email='editor@example.test'") !== '0') throw new Error('Não foi possível entrar com a senha local registrada.');
  const token = randomBytes(24).toString('hex');
  db(`INSERT INTO public.convites(token,email,expires_at) VALUES ('${token}','editor@example.test',now()+interval '15 minutes')`);
  const created = await localAuth.auth.admin.createUser({ ...credentials, email_confirm:true,
    user_metadata:{ invite_token:token, full_name:'Editor da réplica' } });
  if (created.error) throw new Error('Não foi possível criar o login local da réplica.');
  login = await userClient.auth.signInWithPassword(credentials);
}
const userId = login.data.user?.id;
if (login.error || !userId || !/^[0-9a-f-]{36}$/i.test(userId)) throw new Error('Não foi possível confirmar o login local.');
db(`UPDATE public.user_roles SET role='admin' WHERE user_id='${userId}'; UPDATE public.users_profiles SET role='admin' WHERE user_id='${userId}';`);
const role = await userClient.rpc('has_role',{_user_id:userId,_role:'admin'});
const companyRows = await userClient.from('companies').select('id');
if (role.data !== true || companyRows.error || !companyRows.data?.length) throw new Error('As permissões locais da réplica não foram confirmadas.');
const seedIds = [];
for await (const row of snapshotRows('companies')) seedIds.push(row.id);
seedReplicaStore(snapshot,seedIds,userId);

const environment = { VITE_SUPABASE_URL:api, VITE_SUPABASE_PUBLISHABLE_KEY:keys.ANON_KEY,
  SUPABASE_URL:api, SUPABASE_PUBLISHABLE_KEY:keys.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY:keys.SERVICE_ROLE_KEY };
writeFileSync('.env.local',Object.entries(environment).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});
const cleaned = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(VITE_|.*SUPABASE|CONTA_AZUL|AUTOMATION_)/i.test(name)));
console.log('Réplica: http://127.0.0.1:5175');
console.log(`E-mail: ${credentials.email}\nSenha local: ${credentials.password}`);
const vite = spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5175','--strictPort'],{env:{...cleaned,...environment},stdio:'inherit'});
vite.once('exit', code => { process.exitCode = code ?? 0; });
