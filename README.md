# Controladoria — réplica local

Este repositório contém o código da réplica de desenvolvimento. A réplica usa um banco Supabase local e armazena suas configurações em um arquivo SQLite local. Use esta pasta para editar e testar o sistema.

## Como iniciar

1. Instale Node.js 24 e abra o Docker Desktop com contêineres Linux.
2. Se você recebeu o pacote privado da réplica, extraia-o e copie a pasta `dados/` para a raiz deste repositório. A pasta fica ignorada pelo Git. Se ainda não recebeu o pacote, solicite-o à pessoa responsável pelos dados.
3. Execute `npm ci` e depois `npm run replica`.
4. Abra `http://127.0.0.1:5175`. O terminal mostra o login gerado para esta instalação.

O primeiro uso importa os registros no banco local em `http://127.0.0.1:55421`. Nas execuções seguintes, suas alterações ficam no banco local. Para trocar a base de teste, use uma instalação separada.

Edite somente este repositório e trabalhe no ambiente local. A sincronização com a Conta Azul fica desativada. Mantenha os dados, as credenciais e o arquivo protegido fora dos commits, das issues e dos anexos do GitHub.
