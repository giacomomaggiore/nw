---
title: 'Sulla gestione'
publishedAt: '2026-10-24'
summary: ''
---

Negli ultimi anni, ho sempre tenuto traccia di entrate, uscite e investimenti in un semplice Google Sheet. 
Si trattava di una soluzione abbastanza efficiente e minimale: sempre a portata di mano, delle funzioni di filtro/aggregazione, tabelle di riepilogo mese per mese e qualche grafico per i trend di lungo periodo.

Ero ben consapevole del fatto che ci fossero tools più eleganti, automatizzate e "ricchi" di metriche e analisi; ciò nonostante, restavo sereno e soddisfatto del mio spreadsheet, con formule _"faticosamente"_ scritte a mano, prima che Gemini e Copilot approdassero sulle rispettive suite.

Negli ultimi mesi, tuttavia, ho visto una serie _infinita_ di soluzioni molto più eleganti ed evolute, nel 99.x% dei casi AI-based o comunque sviluppate a botta di prompt: fancy dashboard, sincronizzazione con la banca, l'estratto conto e WhatsApp, analisi in tempo reale degli investimenti e molte altre features che, _per forza di cose,_ erano poco compatibili con il mio umile spreadsheet.

Tutto ciò non ha fatto altro che mettere in discussione il modo in cui tracciavo i flussi di cassa e gli investimenti. Tuttavia, pur rimanendo tentato di fare qualcosa di simile e convertirmi anche io a un flow automatizzato in grado di sincronizzare Revolut, UBS, Interactive Brokers e tutto il resto... ho preso una strada alternativa che riflette abbastanza bene la mia filosofia di tracking e rapporto con i soldi.

Nello specifico, parto da quelli che sono, almeno per me, i punti deboli di una strategia totalmente automatizzata (AI-based), piena di analisi, grafici e statistiche iper-granulari e specifiche:
- attribuisco valore in senso lato a sedermi periodicamente, aprire l'app della banca e segnarmi _manualmente_ le spese effettuate. Si tratta comunque di pochi minuti a settimana e, _anche nel caso fossero notevolmente di più_, sono convinto che diano una maggiore consapevolezza di quello che entra e di quello che esce.
- mi bastano pochi indicatori, grafici e tabelle per tracciare il mio spending e l'evoluzione del mio patrimonio, motivo per cui la loro ridondanza non fa altro che aumentare il rumore e togliere l'attenzione dai _(pochi)_ numeri che mi interessano davvero
- trattandosi di finanza _personale_, perché mai dovrei delegare _(anche parzialmente)_ all'AI la sua gestione? Mi piace infatti l'idea di avere _tutto sotto controllo,_ i.e. decidere di avere la metrica x secondo la formula y per il motivo z, non perché secondo Claude stava bene. 

In sintesi: tutte queste soluzioni overkill mi sembravano più uno show-off su chi facesse la dashboard più figa, senza la necessità di mettere l'uomo _(e le sue necessità)_ al centro... _(ma questo è ormai un pattern frequente: quante volte facciamo qualcosa perché è figo e gratis farlo - grazie Claude - e quante volte perché davvero porta del valore aggiunto?)_

Ciò nonostante, non nego che patissi anche io i limiti di uno spreadsheet, motivo per cui mi sono interrogato su come evolvere il mio sistema di tracciamento, pur mantenendolo essenziale, human-centered e rilevante per le mie necessità.

La soluzione che ne è uscita, _pur essendo ancora un WIP,_ mantiene infatti uno spreadsheet per l'input manuale dei dati e una dashboard di analytics più elaborata per una  visualizzazione dei numeri in sola lettura, accessibile tramite un server localhost o facilmente hostabile online; sempre mantenendo l'assoluta protezione della privacy.

Il progetto è pubblico su GitHub o a questo link e, _più rilevante,_ la soluzione è utilizzabile da tutti seguendo il setup riportato nel dettaglio qui..

Più nello specifico, l'idea è di utilizzare Google Sheet, facilmente accessibile ovunque, come source of truth e database esterno, collegato alla dashboard tramite l'API di Google Cloud in modo che i dati, e la rispettiva classificazione, sia totamente deterministica e in mano all'utente _(non lascerò mai decidere a una rete neurale in quale categoria rientra rientrano 190 euro spesi in scarpe da corsa...)_

L'utente infatti digita manualmente spese, guadagni e, _alla fine di ogni periodo,_ gli asset in portafoglio (inserendo il numero di shares dell'asset corrispondente o la liquidità cash su un conto) e _"magicamente"_ l'app legge i dati e si aggiorna in tempo reale _(l'app non ha accesso in scrittura sul foglio di calcolo, quindi l'integrità dei dati è solo nostra responsibilità)_.

Una volta configurata, infatti, l'utente può fare tutto tramite Google Sheet: categorie di spesa, guadagni, asset in portafoglio, valute di riferimento e costanti sono infatti totalmente definite nello spreadsheet e, _di conseguenza,_ facilmente modificabili.

Per quanto riguarda l'app, si tratta di una semplice app in Next.js, sviluppata _ovviamente_ con il supporto di **LLM di fiducia**, in seguito però a un lungo e non-lineare brainstorming e dettagliato file di specifiche, affinchè il progetto, _nonostante non avessi scritto io il codice html (a volte mi capita comunque di leggerlo...),_ incarnasse al meglio i design principles e la filosofia sottostante.


Nello specifico, l'app si divide, _almeno al momento,_ in due sezioni principali:
- /cashflow, dove è possibile visualizzare, periodo per periodo, spese divise per categorie e sottocategorie, entrate e metriche derivate _(prima fra tutte: il saving rate!)_, in semplici tabelle _(richiamando la grafica di uno spreadsheet)_, in line chart e poco altro, permettendo sempre all'utente di scegliere la valuta di riferimento
- /networth, dove viene presentata, sempre con tabelle e line chart, l'evoluzione del patrimonio, sia nell'aggregato sia suddiviso per strumenti finanziari, lasciando gestire all'app il download dei dati finanziari e i cambi valuta più necessari. _Secondariamente,_ nella stessa pagina è anche presente il confronto tra il proprio portafoglio storico "effettivo" con un ipotetico benchmark (60/40 e 100% equities) a parità di flussi di cassa in ingresso/uscita.

---

<b>

Volendo tuttavia pubblicare la dashboard online, _in primis_ per una questione di accessibilità e, secondariamente, per poterla condividere più facilmente, non ero sicuro di voler pubblicare, _nonostante nessuno vada a vedere il sito e non abbia nulla da nascondere,_ i numeri assoluti dietro le mie abitudini di spesa e il mio conto in banca.

Di conseguenza, ho pensato a due modi, _entrambi implementati_ ma eventualmente ridondanti tra loro, per poter mettere il progetto online pur mantenendo i dati protetti.

_In primis,_ tutti gli importi letti dal foglio vengono moltiplicati, direttamente nel backend, per un numero pseudo-random compreso in [0,10], così che un visitatore esterno non possa risalire ai valori reali. Il moltiplicatore dipende da un seed, che ogni visitatore può scegliere dalla navbar. Se il seed inserito coincide con il `LUCKY_SEED` _(che si può "indovinare" oppure, più probabilmente, già conoscere in quanto proprietario della dashboard)_, il moltiplicatore diventa 1 e la dashboard mostra i valori esatti.

_Secondariamente,_ è possibile accedere con Google: se l'email dell'account rientra tra quelle autorizzate dal proprietario, la dashboard mostra i valori reali.

Sia il `LUCKY_SEED` sia la lista delle email autorizzate sono costanti definite nel Google Sheet, quindi modificabili da lì senza mai toccare il codice.

_Lastly,_ non nego che la tentazione di aggiungere dashboard, analisi e metriche derivate, soprattutto quando a farlo è Claude e basta un prompt di due righe, sia alta. Ciò nonostante, preferisco limitarmi e pensare a possibili estensioni del progetto.

_In primis,_ una prossima release introdurrà probabilmente un Monte Carlo generator per poter simulare l'evoluzione di spese e patrimonio. _Secondariamente,_ non mi dispiacerebbe aggiungere una sezione di fund look-through, in grado di scomporre il portafoglio in fattori di rischio, esposizioni nazionali, per asset class etc etc, in modo da avere una visione il più possibile "lucida" sul proprio net worth.

A prescindere dai suoi sviluppi futuri, l'app resta comunque "umana", di conseguenza limitata e potenzialmente imprecisa: i divdenti ricevuti sul broker non ricevono il trattamento giusto, discrepanze e missing data nello spreadhseet potrebbero causare bug e, _non meno importante,_ il fattore umano introduce un ulteriore incertezza.

That's it. I dettagli tecnici restano noiosi per il 99.x% di chi mi legge, quindi rimando alla repo GitHub e invito i più coraggiosi a clonarla, configurarla e giocarci un po'! 

PS: non posso garantire che non ci siano bug nel progetto: in caso di problemi, segnalazioni e pull request sono ben accette!

Cheers!