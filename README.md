# Mobile Simple Play

Interface de celular para o **Foundry VTT 14**, centrada no **chat**.

Feita para um caso concreto: um jogador que não tem computador e entra na mesa pelo
navegador do telefone. Todo módulo mobile de VTT começa pelo mapa; este começa pelo chat —
porque no Foundry o chat não é conversa, é o livro-razão da mesa. Quem tem o chat tem o
jogo.

**Estado: v0.1.0 — primeira versão de teste.** Ainda não foi usada em mesa.

---

## Como instalar

No Foundry, como Mestre: **Add-on Modules → Install Module**, e cole em *Manifest URL*:

```
https://github.com/WildPoxx/mobile-simple-play/releases/latest/download/module.json
```

Depois ative o módulo no mundo (**Game Settings → Manage Modules**).

---

## O módulo nasce desligado

Isto é a característica mais importante da v0.1, e vale entender antes de instalar:

> **Instalar e ativar não muda nada para ninguém.** Enquanto o modo celular não for ligado,
> o módulo não acrescenta um elemento de tela, não troca uma classe do Foundry e não
> registra um ouvinte de evento. Ele só declara três configurações e fica quieto.

Quem liga é o jogador, **no aparelho dele**:

- ao entrar por um aparelho de toque, o módulo **pergunta uma vez** se deve ligar;
- a resposta fica guardada **naquele navegador** (configuração de escopo `client`, no
  `localStorage`);
- ligar no celular **não afeta** o Mestre, os outros jogadores, nem o mesmo jogador em
  outro aparelho.

### Se algo der errado

O modo celular pode ser desligado de três formas, da mais simples à mais drástica:

1. dentro do modo celular, botão **Mais → Desligar o modo celular**;
2. **Game Settings → Configure Settings → Mobile Simple Play → Modo celular**, desmarcar;
3. e, no pior caso, desativar o módulo em **Manage Modules** — o mundo volta ao normal,
   sem deixar rastro.

O módulo **não escreve nada no mundo**: não cria documento, não põe flag em ator, item,
cena ou mensagem. Desinstalar não deixa sujeira.

---

## O que a v0.1 faz

- **Chat em tela cheia**, com os cartões de rolagem do SWADE como eles já são — com os
  botões de Benny, reroll e dano funcionando, porque quem os desenha continua sendo o
  sistema.
- **Trilho de ações** à esquerda, com:
  - as **armas e itens marcados como favoritos na ficha** (o *Quick Access* do SWADE);
  - as **perícias** mais usadas (configurável; em branco, usa as cinco centrais do SWADE
    mais Lutar e Atirar);
  - **selos de estado** — ferimentos, fadiga, Bennies — só leitura;
  - o botão de **alvo**, no pé.
- **Escolha de alvo por lista**: mostra os tokens da cena, hostis primeiro, e marca ou
  desmarca ao toque. Funciona **mesmo sem o mapa carregado**.
- **Barra inferior** com as abas **Chat** e **Mapa**, o **retrato do personagem** ao centro
  (abre a ficha) e o botão **Mais** (escrever no chat, hotbar, desligar).
- **Aviso de mensagem nova** na aba Chat quando você está no mapa.
- **Freio de bateria**: fora da aba Mapa, o motor gráfico para de desenhar.

## O que a v0.1 ainda NÃO faz

- aba de **Quests** (leitura dos Journals de missão);
- **gestos de toque no mapa** — dá para ver a cena, mas arrastar token e ampliar com dois
  dedos ainda não foi trabalhado;
- **reflow da ficha** do SWADE, que ainda quebra em telas estreitas;
- gastar Benny pelo trilho;
- tela de configuração das perícias (por ora, é um campo de texto nas configurações).

---

## Requisitos e alvo

- **Foundry VTT 14** (verificado na 14.365).
- Pensado para **Chrome no Android**, em telas a partir de 360 px de largura lógica.
  iPhone não é alvo desta fase — deve funcionar em parte, mas não foi testado.
- Sistema: desenhado sobre o **SWADE 6.0.4**. O trilho lê `system.favorite` e chama
  `rollSkill`, que são do SWADE; em outros sistemas o chat funciona e o trilho vem vazio.

### Um módulo mobile por vez

Não use junto com outros módulos que reorganizam a interface no celular (por exemplo o
Swipe VTT). Dois módulos disputando o mesmo layout dão um resultado que não se diagnostica.

---

## Princípios de projeto

1. **O Foundry é a autoridade.** O módulo não inventa número, não guarda estado paralelo,
   não decide regra. Toda rolagem nasce do sistema.
2. **Permissão não se contorna.** O que o jogador não pode ver no computador, não vê aqui.
3. **Nada de aplicativo.** Navegador, endereço, pronto.
4. **O módulo é removível.** Desinstalar não pode quebrar o mundo nem deixar sujeira.
5. **Sem conta, sem proxy, sem serviço de terceiro.**
6. **Uma mão só.** Alvo de toque de 48 px, nada de menu aninhado, nada de arrasto preciso.

---

## Licença

MIT — ver [LICENSE](LICENSE).

O módulo não contém código de terceiros. O desenho do trilho de ações foi informado pela
leitura de dois módulos de licença MIT — `token-action-hud-swade` e
`enhancedcombathud-swade` —, mas nenhuma linha foi copiada deles.
