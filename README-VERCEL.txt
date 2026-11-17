YOHANA GOMES - SITE PARA VERCEL

ESTRUTURA DO PROJETO
A raiz do repositorio precisa conter api/, lib/, public/, package.json e vercel.json. Nao envie apenas os arquivos soltos: mantenha as pastas.

CONFIGURAR O ARMAZENAMENTO
1. Na Vercel, abra o projeto e acesse Storage.
2. Crie um Blob Store com acesso Private e conecte-o a este projeto.
3. A Vercel disponibiliza as credenciais do Blob conectado. O site usa o SDK oficial @vercel/blob; nao coloque tokens no codigo ou no GitHub.

CONFIGURAR O CODIGO DE PRIMEIRO ACESSO
1. Abra Project Settings > Environment Variables.
2. Cadastre ADMIN_SETUP_KEY com o codigo privado fornecido pelo desenvolvedor (minimo 32 caracteres). Marque Production; marque Preview tambem se quiser testar a area administrativa em previews.
3. Salve e publique novamente para a funcao receber a variavel.
4. Abra /admin/. No primeiro acesso, informe esse codigo e crie uma senha de pelo menos 12 caracteres. O nome Yohana Gomes ja esta definido.
5. Nos acessos seguintes, basta a senha. Para reabrir o primeiro acesso, confirme a senha atual e informe o mesmo codigo privado.

PAINEL E VIDEOS
- A proprietaria pode adicionar ate 10 videos MP4, WebM ou MOV, de ate 300 MB cada, com um titulo individual.
- Os videos aparecem na mesma posicao do site e as setas alternam entre eles.
- O envio e feito em partes menores que o limite de corpo das Vercel Functions.
- Remova um video na lista do painel para liberar uma vaga.

SEGURANCA
- Ha uma unica conta predefinida para Yohana Gomes.
- A senha e armazenada como hash scrypt com salt, nunca em texto puro.
- O codigo de primeiro acesso fica apenas como variavel privada da Vercel.
- Os dados da conta, sessoes, tentativas de login, manifesto e blocos de video ficam num Blob Store privado.
- O site serve os videos pelo endpoint /api/media com suporte a requisicoes parciais de video.

MIGRACAO DO NETLIFY
O armazenamento do Netlify nao e compartilhado com a Vercel. Crie a conta no primeiro acesso da Vercel e envie os videos novamente pelo painel. O codigo privado de verificacao pode ser reutilizado, desde que seja cadastrado como ADMIN_SETUP_KEY na Vercel.
